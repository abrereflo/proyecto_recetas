import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { bytesToBase64Url } from '@recetas/crypto';
import {
  PasskeyAssertionRefusedError,
  PasskeyRejectedError,
  PasskeyUnavailableError,
  type AuthorizePasskeyInput,
  type PasskeyAuthorization,
  type PasskeyCredential,
  type PasskeyPort,
  type RegisterPasskeyInput,
} from '../../ports/passkey.port';
import { COSE_ALG_ES256 } from './cose';
import { assertionFromResponse, challengeFor, encodeAssertion } from './assertion-envelope';
import { describeRejection, inspectAssertion } from './assertion-diagnosis';
import { publicKeyFromRegistration } from './registration';

/**
 * `PasskeyPort` over the browser's WebAuthn API, through
 * `@simplewebauthn/browser` (docs/18, Fase 5 item 3).
 *
 * WHAT THIS FILE IS AND IS NOT. It runs the two ceremonies and hands the result
 * to the pure modules beside it, which do the arithmetic. That split is
 * deliberate: everything that can be got wrong — DER lengths, byte offsets, the
 * `s` flip, the ABI layout — lives where a test can reach it without a browser,
 * and what is left here is option-building and error translation. The ceremony
 * itself cannot be unit-tested against anything real (see
 * `webauthn-passkey.adapter.test.ts`), so as little as possible depends on it.
 *
 * WHAT IS DELIBERATELY MISSING: any submission. This adapter produces an
 * envelope and stops. There is no bundler, no paymaster and no UserOperation
 * here, because Fase 5 item 5 does not exist yet, and a client that pretended
 * to submit would be a client whose failures nobody could locate.
 *
 * HARD RULE (docs/01, docs/17): the interface never says «wallet», seed phrase
 * or balance. `navigator.credentials` and `publicKey` are protocol identifiers
 * that stay inside this file; every message thrown from here is already written
 * in the language the consulting room reads.
 */

/** The default the browser applies anyway, stated so it can be argued about. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** WebAuthn challenges are 32 bytes at registration, like the digest at assertion. */
const REGISTRATION_CHALLENGE_BYTES = 32;

export interface WebAuthnPasskeyOptions {
  /** Injected for tests; the real ceremonies are the default. */
  register?: (options: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }) => Promise<RegistrationResponseJSON>;
  authenticate?: (options: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }) => Promise<AuthenticationResponseJSON>;
  supported?: () => boolean;
  verifyingAuthenticator?: () => Promise<boolean>;
  randomChallenge?: () => string;
}

/**
 * A fresh 32-byte challenge for the ENROLMENT ceremony.
 *
 * NOT a `userOpHash`, and the difference matters. Nothing on chain ever sees
 * this value: `PasskeyAccount` is built from the public key, and the
 * registration ceremony is not something it verifies. It still has to be random
 * and single-use, because a registration whose challenge an attacker chose is a
 * registration they can replay elsewhere — and `WebAuthn.check` refuses a
 * registration ceremony offered as an authorisation (`WrongCeremonyType`)
 * precisely because the two would otherwise be interchangeable.
 */
function randomChallenge(): string {
  const bytes = new Uint8Array(REGISTRATION_CHALLENGE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Declining the prompt, letting it time out, or navigating away all arrive as
 * `NotAllowedError` or `AbortError`. None of them is a failure; they are the
 * doctor choosing not to sign, and the issuing flow reports them as such.
 */
function isDeclined(error: unknown): boolean {
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_CEREMONY_ABORTED') return true;
    const cause = error.cause;
    return cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError');
  }

  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

export function createWebAuthnPasskey(options: WebAuthnPasskeyOptions = {}): PasskeyPort {
  const runRegistration = options.register ?? startRegistration;
  const runAuthentication = options.authenticate ?? startAuthentication;
  const supported = options.supported ?? browserSupportsWebAuthn;
  const verifying = options.verifyingAuthenticator ?? platformAuthenticatorIsAvailable;
  const challenge = options.randomChallenge ?? randomChallenge;

  const requireSupport = (): void => {
    if (!supported()) throw new PasskeyUnavailableError();
  };

  return {
    isAvailable() {
      return supported();
    },

    async hasVerifyingAuthenticator() {
      if (!supported()) return false;
      return verifying();
    },

    async register(input: RegisterPasskeyInput): Promise<PasskeyCredential> {
      requireSupport();

      const optionsJSON: PublicKeyCredentialCreationOptionsJSON = {
        rp: input.rpId === undefined ? { name: input.serviceName } : { name: input.serviceName, id: input.rpId },
        user: { id: input.userId, name: input.userName, displayName: input.userDisplayName },
        challenge: challenge(),

        // ES256 AND NOTHING ELSE. `PasskeyAccount` verifies P-256 against the
        // RIP-7212 precompile or the Solidity fallback; a credential on any
        // other curve produces an account address nobody can ever sign for, and
        // that address is a permanent CREATE2 commitment. Offering a second
        // algorithm here would be offering a way to brick an enrolment.
        pubKeyCredParams: [{ alg: COSE_ALG_ES256, type: 'public-key' }],

        authenticatorSelection: {
          // MANDATORY, not preferred. `WebAuthn.check` hard-rejects an
          // assertion whose authenticator did not verify the user, because a
          // prescription has to name a PERSON and not a device that was
          // tapped. `'preferred'` silently produces UV=0 on some
          // authenticators, and those logins would be refused on chain with
          // nothing on screen to explain it.
          userVerification: 'required',

          // Preferred rather than required: a discoverable credential lets the
          // doctor authorise without naming themselves first, which is what
          // screen D1 wants, but an authenticator that cannot store one should
          // still be usable — the credential id is kept by this app anyway.
          residentKey: 'preferred',
        },

        // Nothing verifies attestation here, and asking for it would add a
        // privacy consent prompt to enrolment in exchange for a statement this
        // project has no way to check. The public key is what the account
        // commits to; who made the authenticator is not part of the trust
        // model (see `WebAuthn.sol`, "what is deliberately not checked").
        attestation: 'none',

        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };

      let response: RegistrationResponseJSON;

      try {
        response = await runRegistration({ optionsJSON });
      } catch (error) {
        if (isDeclined(error)) throw new PasskeyRejectedError({ cause: error });
        throw error;
      }

      return publicKeyFromRegistration(response);
    },

    async authorize(input: AuthorizePasskeyInput): Promise<PasskeyAuthorization> {
      requireSupport();

      const optionsJSON: PublicKeyCredentialRequestOptionsJSON = {
        // The operation digest, base64url, unpadded. `WebAuthn.check` rebuilds
        // exactly these 43 characters on chain and compares them anchored to
        // `"challenge":"`, closing quote included.
        challenge: challengeFor(input.userOpHash),
        userVerification: 'required',
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(input.rpId === undefined ? {} : { rpId: input.rpId }),
        ...(input.credentialId === undefined
          ? {}
          : { allowCredentials: [{ id: input.credentialId, type: 'public-key' as const }] }),
      };

      let response: AuthenticationResponseJSON;

      try {
        response = await runAuthentication({ optionsJSON });
      } catch (error) {
        if (isDeclined(error)) throw new PasskeyRejectedError({ cause: error });
        throw error;
      }

      const assertion = assertionFromResponse(response.response);

      // The pre-flight. Everything `WebAuthn.check` can decide without the
      // curve is decided here, before anything is submitted, so a refusal
      // arrives as a sentence rather than as `SIG_VALIDATION_FAILED`.
      const reason = inspectAssertion(assertion, input.userOpHash);

      if (reason !== 'None') {
        throw new PasskeyAssertionRefusedError(reason, describeRejection(reason));
      }

      return { signature: encodeAssertion(assertion), credentialId: response.rawId };
    },
  };
}
