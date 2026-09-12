import type { Hex, PublicClient } from 'viem';
import { accountOf, assertChainReachable, blockTimestamp, buildPublicClient } from '../chain';
import type { CliConfig } from '../config';
import {
  assertLocalEas,
  demoHolders,
  inspectCredential,
  issueAndRegister,
  readCredentialSetup,
  roleLabel,
  type CredentialSetup,
} from '../credentials';
import { formatDay, shortAddress } from '../format';
import * as ui from '../ui';

/**
 * Accredits the three demo accounts against EAS.
 *
 * The registry has no administrator and no whitelist: an account becomes able
 * to issue or dispense only by pointing itself at an attestation that the
 * credential authority signed for it (docs/04-smart-contracts.md). This command
 * plays both parts on the local chain — the authority attests, each account
 * registers — so the demo starts from a chain that mirrors the real setup.
 *
 * It is idempotent: an account that already holds a live credential is left
 * alone, so running it twice costs two reads and nothing else.
 */

export interface CredentialOutcome {
  label: string;
  address: Hex;
  uid: Hex;
  /** `true` when this run had to issue the credential. */
  issued: boolean;
}

export async function ensureDemoCredentials(
  publicClient: PublicClient,
  config: CliConfig,
  setup: CredentialSetup,
): Promise<CredentialOutcome[]> {
  const outcomes: CredentialOutcome[] = [];

  for (const { actor, role } of demoHolders(config)) {
    const account = accountOf(actor.privateKey);
    const blockTime = await blockTimestamp(publicClient);
    const report = await inspectCredential(publicClient, config, setup, account.address, role, blockTime);

    if (report.accredited) {
      ui.ok(
        `${actor.label} — ${roleLabel(role)} vigente` +
          (report.expiresAt !== undefined && report.expiresAt !== 0n
            ? ` hasta el ${formatDay(report.expiresAt)}`
            : ''),
      );
      ui.note(`uid ${report.uid}`);
      outcomes.push({ label: actor.label, address: account.address, uid: report.uid, issued: false });
      continue;
    }

    ui.fail(`${actor.label} — ${report.reason ?? 'sin credencial'}`);
    await assertLocalEas(publicClient, setup);

    const uid = await issueAndRegister(publicClient, config, setup, actor, role, blockTime);

    ui.ok(`${actor.label} — ${roleLabel(role)} emitida y registrada`);
    ui.note(`uid ${uid}`);
    outcomes.push({ label: actor.label, address: account.address, uid, issued: true });
  }

  return outcomes;
}

export function printSetup(config: CliConfig, setup: CredentialSetup): void {
  ui.info('Registro', config.registryAddress);
  ui.info('EAS', setup.eas);
  ui.info('Emisor autorizado', `${setup.issuerAuthority} (${shortAddress(setup.issuerAuthority)})`);
  ui.info('Esquema médico', setup.practitionerSchema);
  ui.info('Esquema farmacia', setup.pharmacySchema);
}

export async function runSetupCredentials(config: CliConfig): Promise<number> {
  const publicClient = buildPublicClient(config);
  await assertChainReachable(publicClient, config.rpcUrl);

  const setup = await readCredentialSetup(publicClient, config);

  ui.heading('ACREDITACIÓN PROFESIONAL');
  printSetup(config, setup);
  ui.line();

  const outcomes = await ensureDemoCredentials(publicClient, config, setup);

  ui.line();
  ui.line(
    ui.grey(
      `Credenciales emitidas en esta ejecución: ${outcomes.filter((o) => o.issued).length} de ${outcomes.length}.`,
    ),
  );
  ui.note(
    'El contrato no guarda el veredicto, solo el puntero: cada issue y cada dispense ' +
      'vuelven a leer la attestation en EAS.',
  );

  return 0;
}
