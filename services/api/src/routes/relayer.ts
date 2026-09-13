import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { RelayerConfig } from '../env';
import { RateLimiter } from '../relayer/rate-limit';
import { RelayerRefusal, type Relayer, type SerialisedDraft } from '../relayer/relayer';

/**
 * The relayer's HTTP surface.
 *
 * WHY IT LIVES IN `services/api` AND NOT IN ITS OWN SERVICE. Argued rather than
 * assumed, because "the Fastify server already exists" is a reason to look, not
 * a reason to decide:
 *
 *   - IT IS THE ONLY PROCESS IN THIS REPOSITORY THAT MAY HOLD A KEY. The doctor
 *     and pharmacy apps are browser SPAs; a relayer key in either is a key
 *     published to every visitor. The CLI is a developer tool that runs on a
 *     laptop. The contracts hold no keys. A server-side relayer needs a server,
 *     and this repository has exactly one.
 *   - IT IS ALREADY THE PLACE THE DOCTOR'S APP TALKS TO. `VITE_API_URL` is
 *     configured, CORS is already restricted to the two app origins, and the
 *     issuance flow already POSTs the encrypted payload here before anchoring.
 *     A second origin would mean a second CORS list, a second deployment unit
 *     and a second thing to be running for a demo to work.
 *   - THE COST IS REAL AND IS ACCEPTED: the encrypted payload store and the
 *     relayer now share a process, so a crash takes both down, and the service
 *     that was deliberately unable to read anything now holds a key. The second
 *     is the one that matters, and it is contained by the key never reaching
 *     this file — routes see a `Relayer`, never a private key — and by the
 *     relayer's authority being worth only the test AVAX it holds: it cannot
 *     issue, cancel or dispense, and `PasskeyAccount` would refuse it if it
 *     tried.
 *   - WHAT WOULD CHANGE THE ANSWER: a pilot where the relayer needs to scale,
 *     be restarted, or be funded independently of the payload store. Then it is
 *     its own service, and the split is cheap because everything above the HTTP
 *     layer is already a pure module.
 *
 * THE ENDPOINT IS OPEN. That decision, and the money flow behind it, is argued
 * in full in `relayer.ts`. What lives here is the consequence: a rate limiter,
 * keyed twice.
 */

const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be 0x-prefixed hex');
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte address');
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hash');
/** Every number crosses the wire as a decimal string: JSON has no bigint. */
const uintSchema = z.string().regex(/^[0-9]+$/, 'must be a decimal integer string');

const serialisedDraftSchema = z.object({
  sender: addressSchema,
  nonce: uintSchema,
  initCode: hexSchema,
  callData: hexSchema,
  verificationGasLimit: uintSchema,
  callGasLimit: uintSchema,
  preVerificationGas: uintSchema,
  maxPriorityFeePerGas: uintSchema,
  maxFeePerGas: uintSchema,
  paymaster: addressSchema,
  paymasterVerificationGasLimit: uintSchema,
  paymasterPostOpGasLimit: uintSchema,
  signature: hexSchema,
});

const prepareBodySchema = z.object({
  /**
   * The owner's P-256 public key, as decimal strings. The account address is
   * DERIVED from it and is never accepted from the caller: the address is a
   * CREATE2 commitment to these two numbers, so a caller cannot name an account
   * their key does not control.
   */
  publicKeyX: uintSchema,
  publicKeyY: uintSchema,
  callData: hexSchema,
});

const prepareResponseSchema = z.object({
  userOp: serialisedDraftSchema,
  userOpHash: bytes32Schema,
  deploying: z.boolean(),
  shape: z.enum(['register-credential', 'issue']),
  requiredPrefundWei: uintSchema,
});

const submitBodySchema = z.object({
  userOp: serialisedDraftSchema,
  /** Optional. Compared against the relayer's own, never used in its place. */
  userOpHash: bytes32Schema.optional(),
});

const submitResponseSchema = z.object({
  userOpHash: bytes32Schema,
  transactionHash: hexSchema,
  beneficiary: addressSchema,
});

const statusResponseSchema = z.object({
  address: addressSchema,
  chainId: z.number(),
  entryPoint: addressSchema,
  registry: addressSchema,
  paymaster: addressSchema,
  factory: addressSchema.optional(),
  balanceWei: uintSchema,
  paymasterDepositWei: uintSchema,
  maxFeePerGasWei: uintSchema,
  maxPrefundWei: uintSchema,
  isBundler: z.literal(false),
});

const refusalResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  /** The contract's own error and arguments, when there was one. */
  failure: z
    .object({
      entryPointReason: z.string().optional(),
      source: z.enum(['entry-point', 'paymaster', 'account', 'registry', 'unknown']),
      name: z.string().optional(),
      args: z.record(z.string()).optional(),
    })
    .optional(),
});

const rateLimitResponseSchema = z.object({
  error: z.literal('rate_limited'),
  message: z.string(),
  limit: z.number(),
  windowEndsAt: z.number(),
});

/**
 * Arguments come back from `decodeErrorResult` as bigints and addresses. They
 * are stringified rather than serialised as-is because JSON has no bigint and
 * because a client reading `SponsorshipExhausted` wants to print them, not do
 * arithmetic on them.
 */
function describeFailure(failure: {
  entryPointReason?: string;
  source: 'entry-point' | 'paymaster' | 'account' | 'registry' | 'unknown';
  name?: string;
  args?: Record<string, unknown>;
}) {
  return {
    ...(failure.entryPointReason === undefined
      ? {}
      : { entryPointReason: failure.entryPointReason }),
    source: failure.source,
    ...(failure.name === undefined ? {} : { name: failure.name }),
    ...(failure.args === undefined
      ? {}
      : {
          args: Object.fromEntries(
            Object.entries(failure.args).map(([key, value]) => [key, String(value)]),
          ),
        }),
  };
}

/** Refusal codes that say something about this relayer or its node, not about the operation. */
const OUR_FAULT: ReadonlySet<string> = new Set(['chain_unavailable', 'insufficient_funds', 'send_failed']);

export function relayerRoutes(relayer: Relayer, config: RelayerConfig): FastifyPluginAsyncZod {
  const limiter = new RateLimiter({
    limit: config.rateLimit,
    windowSeconds: config.rateLimitWindowSeconds,
  });

  return async (app) => {
    /**
     * Two keys, because they bound two different things. The remote address
     * bounds one caller; the sender bounds one account across callers, which is
     * what stops a distributed client from spending a single doctor's
     * sponsorship quota faster than that doctor could.
     *
     * THEY ARE CHARGED AT DIFFERENT MOMENTS, which is the point of the split.
     * `consume` is counted here; `check` is only read, because the sender bucket
     * bounds what ONE ACCOUNT SPENDS and a refused submission spends nothing.
     * Addresses are public and `submitBodySchema` checks only hex and decimal
     * shape, so charging on the way in lets anyone lock a doctor out of their
     * own prescriptions with garbage. The handler charges after `submit` returns.
     */
    const enforce = (
      consume: readonly string[],
      check: readonly string[] = [],
    ): { allowed: boolean; limit: number; windowEndsAt: number } => {
      limiter.sweep();

      const spent = check.map((key) => limiter.peek(key)).find((decision) => !decision.allowed);

      if (spent !== undefined) {
        return { allowed: false, limit: spent.limit, windowEndsAt: spent.windowEndsAt };
      }

      let worst = { allowed: true, limit: config.rateLimit, windowEndsAt: 0 };

      for (const key of consume) {
        const decision = limiter.take(key);

        if (!decision.allowed) {
          worst = { allowed: false, limit: decision.limit, windowEndsAt: decision.windowEndsAt };
        }
      }

      return worst;
    };

    app.get(
      '/relayer',
      {
        schema: {
          description:
            'What this relayer is, which chain it is on, and what it has left to spend. NOT a bundler.',
          response: { 200: statusResponseSchema },
        },
      },
      async (_request, reply) => reply.status(200).send(await relayer.describe()),
    );

    app.post(
      '/relayer/user-operations/prepare',
      {
        schema: {
          description:
            'Build the unsigned UserOperation for a passkey and return the userOpHash to sign.',
          body: prepareBodySchema,
          response: {
            200: prepareResponseSchema,
            422: refusalResponseSchema,
            429: rateLimitResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const decision = enforce([`ip:${request.ip}`]);

        if (!decision.allowed) {
          return reply.status(429).send({
            error: 'rate_limited' as const,
            message: 'Too many requests. Try again after the window closes.',
            limit: decision.limit,
            windowEndsAt: decision.windowEndsAt,
          });
        }

        try {
          const prepared = await relayer.prepare({
            publicKeyX: BigInt(request.body.publicKeyX),
            publicKeyY: BigInt(request.body.publicKeyY),
            callData: request.body.callData as `0x${string}`,
          });

          // The hash, never the operation's contents: `callData` carries a
          // content hash and a patient commitment (docs/03).
          request.log.info(
            { userOpHash: prepared.userOpHash, deploying: prepared.deploying },
            'prepared a user operation',
          );

          return reply.status(200).send(prepared);
        } catch (error) {
          if (error instanceof RelayerRefusal) {
            return reply.status(422).send({ error: error.code, message: error.message });
          }

          throw error;
        }
      },
    );

    app.post(
      '/relayer/user-operations',
      {
        schema: {
          description:
            'Submit a signed UserOperation through EntryPoint v0.7. One operation per transaction; no mempool, no bundling. The 200 carries a BROADCAST receipt: the hash the node accepted for the transaction, not proof of inclusion. Nothing here waits for it to be mined, so the transaction can still be dropped and the operation inside it can still revert on chain; watch the hash if the outcome matters.',
          body: submitBodySchema,
          response: {
            200: submitResponseSchema,
            422: refusalResponseSchema,
            429: rateLimitResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const senderKey = `sender:${request.body.userOp.sender.toLowerCase()}`;
        const decision = enforce([`ip:${request.ip}`], [senderKey]);

        if (!decision.allowed) {
          return reply.status(429).send({
            error: 'rate_limited' as const,
            message: 'Too many requests. Try again after the window closes.',
            limit: decision.limit,
            windowEndsAt: decision.windowEndsAt,
          });
        }

        try {
          const submission = await relayer.submit({
            // zod validated the shape; the cast only re-attaches the branded
            // `0x${string}` types the schema cannot express.
            userOp: request.body.userOp as SerialisedDraft,
            ...(request.body.userOpHash === undefined
              ? {}
              : { userOpHash: request.body.userOpHash as `0x${string}` }),
          });

          // Only now, because only now has anything been spent. See `enforce`.
          limiter.take(senderKey);

          request.log.info(
            { userOpHash: submission.userOpHash, transactionHash: submission.transactionHash },
            'submitted a user operation',
          );

          return reply.status(200).send(submission);
        } catch (error) {
          if (error instanceof RelayerRefusal) {
            // The refusals that are not verdicts on the operation: a node that
            // timed out, a broadcast it rejected, a relayer with no AVAX left.
            // Logged as ordinary refusals they send an operator hunting for a
            // validation bug, and only the cause says which of the three it is.
            if (OUR_FAULT.has(error.code)) {
              request.log.warn(
                { err: error.cause, code: error.code },
                'the operation could not be carried, and the reason is not the operation',
              );
            } else {
              request.log.info({ code: error.code }, 'refused a user operation');
            }

            return reply.status(422).send({
              error: error.code,
              message: error.message,
              ...(error.failure === undefined ? {} : { failure: describeFailure(error.failure) }),
            });
          }

          throw error;
        }
      },
    );
  };
}
