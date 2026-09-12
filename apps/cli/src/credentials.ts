import { randomBytes } from 'node:crypto';
import type { Account, Address, Hex, PublicClient, WalletClient } from 'viem';
import { accountOf, buildWalletClient } from './chain';
import { ANVIL_ACCOUNTS, type CliConfig, type DemoActor } from './config';
import { easAbi, mockEasAbi } from './eas-abi';
import { prescriptionRegistryAbi } from './registry-abi';
import { formatDay } from './format';

/**
 * Professional accreditation against EAS.
 *
 * The contract answers one question before every `issue` and every `dispense`:
 * does this address hold a live, unrevoked credential issued by the authority?
 * It answers it by reading EAS, every single time, and it caches nothing but
 * the pointer (docs/04-smart-contracts.md).
 *
 * This module is the client side of that: it inspects a credential, and on the
 * local chain it can also create and withdraw one, which is what lets the demo
 * show a revocation cutting access in the next transaction.
 */

export type CredentialRole = 'practitioner' | 'pharmacy';

/** Everything the registry was deployed with, read back from the chain. */
export interface CredentialSetup {
  eas: Address;
  practitionerSchema: Hex;
  pharmacySchema: Hex;
  issuerAuthority: Address;
}

export interface Attestation {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Address;
  attester: Address;
  revocable: boolean;
  data: Hex;
}

export interface CredentialReport {
  account: Address;
  role: CredentialRole;
  uid: Hex;
  accredited: boolean;
  /** The concrete reason it is not accepted, in the words the terminal prints. */
  reason?: string;
  expiresAt?: bigint;
}

const ZERO_UID = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

/** One year, matching what SetupCredentials.s.sol issues. */
const VALIDITY_SECONDS = 365n * 24n * 60n * 60n;

/** The three accounts the demo needs accredited, and the role of each. */
export const DEMO_HOLDERS: readonly { actor: DemoActor; role: CredentialRole }[] = [
  { actor: ANVIL_ACCOUNTS.doctor, role: 'practitioner' },
  { actor: ANVIL_ACCOUNTS.pharmacyA, role: 'pharmacy' },
  { actor: ANVIL_ACCOUNTS.pharmacyB, role: 'pharmacy' },
];

export function roleLabel(role: CredentialRole): string {
  return role === 'practitioner' ? 'credencial médica' : 'credencial de farmacia';
}

export async function readCredentialSetup(
  client: PublicClient,
  config: CliConfig,
): Promise<CredentialSetup> {
  const read = async <T>(functionName: 'eas' | 'practitionerSchema' | 'pharmacySchema' | 'issuerAuthority') =>
    (await client.readContract({
      address: config.registryAddress,
      abi: prescriptionRegistryAbi,
      functionName,
    })) as T;

  const [eas, practitionerSchema, pharmacySchema, issuerAuthority] = await Promise.all([
    read<Address>('eas'),
    read<Hex>('practitionerSchema'),
    read<Hex>('pharmacySchema'),
    read<Address>('issuerAuthority'),
  ]);

  return { eas, practitionerSchema, pharmacySchema, issuerAuthority };
}

export function schemaFor(setup: CredentialSetup, role: CredentialRole): Hex {
  return role === 'practitioner' ? setup.practitionerSchema : setup.pharmacySchema;
}

export async function readAttestation(
  client: PublicClient,
  eas: Address,
  uid: Hex,
): Promise<Attestation> {
  const attestation = await client.readContract({
    address: eas,
    abi: easAbi,
    functionName: 'getAttestation',
    args: [uid],
  });

  return attestation as unknown as Attestation;
}

/**
 * The same five checks the contract runs, reproduced client-side so the
 * terminal can say WHICH one fails instead of only "not accredited".
 *
 * This is a courtesy, never an authority: the chain decides, and a mismatch
 * between this and the contract is a bug in this function.
 */
export async function inspectCredential(
  client: PublicClient,
  config: CliConfig,
  setup: CredentialSetup,
  account: Address,
  role: CredentialRole,
  blockTime: bigint,
): Promise<CredentialReport> {
  const uid = (await client.readContract({
    address: config.registryAddress,
    abi: prescriptionRegistryAbi,
    functionName: 'credentialOf',
    args: [account],
  })) as Hex;

  if (uid === ZERO_UID) {
    return { account, role, uid, accredited: false, reason: 'no hay ninguna credencial registrada' };
  }

  const a = await readAttestation(client, setup.eas, uid);

  if (a.uid === ZERO_UID) {
    return { account, role, uid, accredited: false, reason: 'la attestation no existe en EAS' };
  }
  if (a.schema.toLowerCase() !== schemaFor(setup, role).toLowerCase()) {
    return {
      account,
      role,
      uid,
      accredited: false,
      reason: `la credencial no corresponde al esquema de ${roleLabel(role)}`,
    };
  }
  if (a.recipient.toLowerCase() !== account.toLowerCase()) {
    return { account, role, uid, accredited: false, reason: 'la credencial fue emitida a otra cuenta' };
  }
  if (a.attester.toLowerCase() !== setup.issuerAuthority.toLowerCase()) {
    return { account, role, uid, accredited: false, reason: 'la emitió un emisor no autorizado' };
  }
  if (a.revocationTime !== 0n) {
    return {
      account,
      role,
      uid,
      accredited: false,
      reason: `fue revocada el ${formatDay(a.revocationTime)}`,
    };
  }
  if (a.expirationTime !== 0n && blockTime >= a.expirationTime) {
    return {
      account,
      role,
      uid,
      accredited: false,
      reason: `caducó el ${formatDay(a.expirationTime)}`,
    };
  }

  return { account, role, uid, accredited: true, expiresAt: a.expirationTime };
}

/**
 * Refuses to write to anything but the local test double.
 *
 * Attesting and revoking belong to the credential authority, on its own
 * infrastructure. The CLI may only drive the MockEAS that Anvil runs.
 */
export async function assertLocalEas(client: PublicClient, setup: CredentialSetup): Promise<void> {
  let mock = false;
  try {
    mock = (await client.readContract({
      address: setup.eas,
      abi: mockEasAbi,
      functionName: 'isMock',
    })) as boolean;
  } catch {
    mock = false;
  }

  if (!mock) {
    throw new Error(
      `El EAS configurado (${setup.eas}) no es el simulador local. ` +
        'La emisión y la revocación de credenciales solo pueden hacerse desde la autoridad emisora.',
    );
  }
}

async function sendTo(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  address: Address,
  data:
    | { functionName: 'attestWithUid'; args: [Hex, Hex, Address, Address, bigint, bigint] }
    | { functionName: 'revoke'; args: [Hex] },
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address,
    abi: mockEasAbi,
    account,
    ...data,
  } as never);

  const hash = await walletClient.writeContract(request as never);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Issues a credential and has its holder register the pointer.
 *
 * Two keys sign the two transactions, and that separation is the design: the
 * authority attests in EAS, the professional points the registry at its own
 * uid, and the registry believes neither of them without re-reading EAS.
 */
export async function issueAndRegister(
  publicClient: PublicClient,
  config: CliConfig,
  setup: CredentialSetup,
  holder: DemoActor,
  role: CredentialRole,
  blockTime: bigint,
): Promise<Hex> {
  const issuerAccount = accountOf(ANVIL_ACCOUNTS.credentialIssuer.privateKey);
  if (issuerAccount.address.toLowerCase() !== setup.issuerAuthority.toLowerCase()) {
    throw new Error(
      `El emisor autorizado del contrato es ${setup.issuerAuthority} y esta CLI firma con ` +
        `${issuerAccount.address}. Redesplegue el registro o configure el emisor correcto.`,
    );
  }

  const holderAccount = accountOf(holder.privateKey);
  const uid = `0x${randomBytes(32).toString('hex')}` as Hex;
  const validUntil = blockTime + VALIDITY_SECONDS;

  await sendTo(
    publicClient,
    buildWalletClient(config, ANVIL_ACCOUNTS.credentialIssuer.privateKey),
    issuerAccount,
    setup.eas,
    {
      functionName: 'attestWithUid',
      args: [uid, schemaFor(setup, role), holderAccount.address, issuerAccount.address, validUntil, 0n],
    },
  );

  const holderWallet = buildWalletClient(config, holder.privateKey);
  const { request } = await publicClient.simulateContract({
    address: config.registryAddress,
    abi: prescriptionRegistryAbi,
    account: holderAccount,
    functionName: 'registerCredential',
    args: [uid],
  } as never);

  const hash = await holderWallet.writeContract(request as never);
  await publicClient.waitForTransactionReceipt({ hash });

  return uid;
}

/** Withdraws a credential, as the authority would on losing a licence. */
export async function revokeCredential(
  publicClient: PublicClient,
  config: CliConfig,
  setup: CredentialSetup,
  uid: Hex,
): Promise<Hex> {
  const issuerAccount = accountOf(ANVIL_ACCOUNTS.credentialIssuer.privateKey);

  return sendTo(
    publicClient,
    buildWalletClient(config, ANVIL_ACCOUNTS.credentialIssuer.privateKey),
    issuerAccount,
    setup.eas,
    { functionName: 'revoke', args: [uid] },
  );
}
