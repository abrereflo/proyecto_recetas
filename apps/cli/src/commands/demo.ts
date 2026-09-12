import type { PublicClient } from 'viem';
import { accountOf, assertChainReachable, blockTimestamp, buildPublicClient } from '../chain';
import { pharmacyAccount as demoPharmacy, type CliConfig } from '../config';
import {
  assertLocalEas,
  inspectCredential,
  issueAndRegister,
  readCredentialSetup,
  revokeCredential,
  type CredentialSetup,
} from '../credentials';
import { shortAddress } from '../format';
import { runDispense } from './dispense';
import { runIssue, type IssueOptions } from './issue';
import { ensureDemoCredentials, printSetup } from './setup-credentials';
import * as ui from '../ui';

/**
 * The three-minute script in one command: issue, dispense, refuse the second
 * dispensing.
 *
 * The whole pitch is built around the third act (docs/00-vision-y-alcance.md),
 * so the rejection is not an error path here: it is the expected outcome, and
 * the command only fails if it does NOT happen.
 *
 * `--revoked` swaps the third act for the other rejection worth showing: a
 * pharmacy whose licence was withdrawn a moment ago. Same prescription, same
 * code, and the contract refuses because it re-reads EAS on every call instead
 * of trusting what it learned at registration time.
 */

export interface DemoOptions extends IssueOptions {
  /** Pause between acts, in milliseconds. Use 0 for scripted runs. */
  pauseMs?: number | undefined;
  /** Show the credential rejection instead of the double-dispensing one. */
  revoked?: boolean | undefined;
}

const DEFAULT_PAUSE_MS = 1500;

/** Act zero, shared by both scripts: nobody acts without a live credential. */
async function accreditActors(
  publicClient: PublicClient,
  config: CliConfig,
): Promise<CredentialSetup> {
  const setup = await readCredentialSetup(publicClient, config);

  ui.line();
  ui.line(ui.bold('ACTO 0 — Las credenciales profesionales'));
  printSetup(config, setup);
  ui.line();
  await ensureDemoCredentials(publicClient, config, setup);

  return setup;
}

function header(config: CliConfig, subtitle: string): void {
  ui.line();
  ui.line(ui.bold('RECETA VERIFICABLE — demostración completa'));
  ui.line(ui.grey(subtitle));
  ui.info('Red', `${config.rpcUrl} (chainId ${config.chainId})`);
  ui.info('Registro', config.registryAddress);
  ui.info('Almacén off-chain', config.apiUrl);
}

export async function runDemo(config: CliConfig, options: DemoOptions = {}): Promise<number> {
  if (options.revoked === true) return runRevokedDemo(config, options);

  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const publicClient = buildPublicClient(config);
  await assertChainReachable(publicClient, config.rpcUrl);

  header(config, 'Acreditar · Emitir · Dispensar · Rechazar el segundo intento');

  await accreditActors(publicClient, config);
  await ui.pause(pauseMs);

  ui.line();
  ui.line(ui.bold('ACTO 1 — La médica emite la receta'));
  const issued = await runIssue(config, options);
  await ui.pause(pauseMs);

  ui.line();
  ui.line(ui.bold('ACTO 2 — El paciente llega a la primera farmacia'));
  const first = await runDispense(config, issued.qr, 'a');
  await ui.pause(pauseMs);

  if (!first.dispensed) {
    ui.line();
    ui.line(ui.boldRed('La demostración falló: la primera farmacia no pudo dispensar.'));
    return 1;
  }

  ui.line();
  ui.line(ui.bold('ACTO 3 — El mismo código se presenta en una segunda farmacia'));
  const second = await runDispense(config, issued.qr, 'b');

  if (second.dispensed) {
    ui.line();
    ui.line(ui.boldRed('La demostración falló: la receta se dispensó dos veces.'));
    return 1;
  }

  if (second.rejection.code !== 'AlreadyDispensed') {
    ui.line();
    ui.line(
      ui.boldRed(
        `La demostración falló: se esperaba AlreadyDispensed y el contrato devolvió ${second.rejection.code}.`,
      ),
    );
    return 1;
  }

  ui.heading('RESUMEN');
  ui.line('  0. Las tres cuentas acreditaron su credencial contra EAS.');
  ui.line('  1. La receta se cifró, se firmó y se ancló en la cadena.');
  ui.line('  2. La primera farmacia verificó, descifró y entregó el medicamento.');
  ui.line('  3. La segunda farmacia recibió un rechazo con quién dispensó y cuándo.');
  ui.line();
  ui.line(
    ui.grey(
      'Ningún identificador de paciente llegó a la cadena: solo keccak256(patientId, sal), ' +
        'con una sal distinta por receta.',
    ),
  );

  return 0;
}

/**
 * The credential rejection, end to end.
 *
 * The pharmacy holds a credential that was valid when it was registered. The
 * authority withdraws it. The very next `dispense` fails, because the contract
 * never cached the verdict: it stores a pointer and re-reads EAS every time
 * (docs/02-roles-y-permisos.md, "inmediata").
 */
async function runRevokedDemo(config: CliConfig, options: DemoOptions): Promise<number> {
  const pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const publicClient = buildPublicClient(config);
  await assertChainReachable(publicClient, config.rpcUrl);

  header(config, 'Acreditar · Emitir · Revocar la credencial · Rechazar la entrega');

  const setup = await accreditActors(publicClient, config);
  await assertLocalEas(publicClient, setup);
  await ui.pause(pauseMs);

  ui.line();
  ui.line(ui.bold('ACTO 1 — La médica emite la receta'));
  const issued = await runIssue(config, options);
  await ui.pause(pauseMs);

  const pharmacy = demoPharmacy('a', config);
  const pharmacyAccount = accountOf(pharmacy.privateKey);

  ui.line();
  ui.line(ui.bold('ACTO 2 — La autoridad retira la licencia de la farmacia'));
  ui.heading(`REVOCACIÓN — ${pharmacy.label}`);

  const before = await inspectCredential(
    publicClient,
    config,
    setup,
    pharmacyAccount.address,
    'pharmacy',
    await blockTimestamp(publicClient),
  );

  if (!before.accredited) {
    ui.line(ui.boldRed(`La demostración falló: la farmacia no estaba acreditada (${before.reason}).`));
    return 1;
  }

  ui.info('Farmacia', `${pharmacyAccount.address} (${shortAddress(pharmacyAccount.address)})`);
  ui.info('Credencial', before.uid);
  ui.ok('Credencial vigente en este momento: la farmacia puede dispensar.');

  const revocationTx = await revokeCredential(publicClient, config, setup, before.uid);
  ui.info('Revocación', revocationTx);
  ui.fail('El emisor revocó la attestation en EAS. Nada se tocó en el registro de recetas.');
  await ui.pause(pauseMs);

  ui.line();
  ui.line(ui.bold('ACTO 3 — La misma farmacia intenta entregar el medicamento'));
  const attempt = await runDispense(config, issued.qr, 'a');

  if (attempt.dispensed) {
    ui.line();
    ui.line(ui.boldRed('La demostración falló: una farmacia sin credencial dispensó la receta.'));
    return 1;
  }

  if (attempt.rejection.code !== 'NotAccreditedPharmacy') {
    ui.line();
    ui.line(
      ui.boldRed(
        `La demostración falló: se esperaba NotAccreditedPharmacy y el contrato devolvió ${attempt.rejection.code}.`,
      ),
    );
    return 1;
  }

  // Leave the chain usable: a renewal is simply a new uid.
  ui.heading('REHABILITACIÓN');
  const renewedUid = await issueAndRegister(
    publicClient,
    config,
    setup,
    pharmacy,
    'pharmacy',
    await blockTimestamp(publicClient),
  );
  ui.ok(`${pharmacy.label} — credencial renovada tras la rehabilitación.`);
  ui.note(`uid ${renewedUid}`);
  ui.note('La receta sigue emitida y sin dispensar: la revocación no la invalidó.');

  ui.heading('RESUMEN');
  ui.line('  0. Las tres cuentas acreditaron su credencial contra EAS.');
  ui.line('  1. La receta se cifró, se firmó y se ancló en la cadena.');
  ui.line('  2. El emisor revocó la credencial de la farmacia en EAS.');
  ui.line('  3. La siguiente entrega se rechazó por credencial, no por la receta.');
  ui.line();
  ui.line(
    ui.grey(
      'El contrato no guarda el veredicto de acreditación, solo el puntero a la attestation: ' +
        'por eso una revocación corta el acceso en la transacción siguiente, sin administrador ' +
        'que intervenga.',
    ),
  );

  return 0;
}
