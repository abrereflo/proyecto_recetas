import { parseArgs, type ParseArgsConfig } from 'node:util';
import { loadConfig, type PharmacyKey } from './config';
import { runDemo } from './commands/demo';
import { runDispense } from './commands/dispense';
import { runIssue } from './commands/issue';
import { runSetupCredentials } from './commands/setup-credentials';
import { runVerify } from './commands/verify';
import { readQrArgument } from './qr';
import * as ui from './ui';

/**
 * `receta` — demo CLI for the verifiable e-prescription MVP.
 *
 * Argument parsing uses `node:util` `parseArgs`: the whole point of this
 * deliverable is that it runs with the dependencies already in the workspace.
 *
 * LANGUAGE CONTRACT: help text and every printed line are Spanish, because this
 * output is what the jury reads. The code around it stays English.
 */

const HELP = `
receta — receta médica electrónica verificable

USO
  receta <comando> [opciones]

COMANDOS
  setup-credentials
               Acredita las cuentas de la demo contra EAS (emite y registra)
  issue        Emite una receta: cifra, firma EIP-712, guarda y registra en la cadena
  verify       Consulta el estado de una receta en la cadena
  dispense     Flujo de farmacia: verifica, descifra y dispensa
  demo         Guion completo: emitir, dispensar y rechazar el segundo intento
  help         Muestra esta ayuda

OPCIONES DE issue
  --patient <nombre>       Nombre completo del paciente
  --patient-id <cédula>    Documento de identidad del paciente
  --birth-date <AAAA-MM-DD>
  --items <ítem>           Repetible. Formato:
                           atc:principio:concentración:forma:cantidad:posología
  --days <n>               Días de vigencia (por defecto 30)
  --out <archivo>          Guarda el payload del QR en un archivo
  --no-qr                  No dibuja el QR en el terminal

OPCIONES DE verify y dispense
  --qr <json|archivo>      Payload del QR, en línea o como ruta de archivo
  --pharmacy <a|b>         Farmacia que dispensa (por defecto: a)

OPCIONES DE demo
  --pause <ms>             Pausa entre actos (por defecto 1500)
  --revoked                Variante de credencial: la autoridad revoca la
                           licencia de la farmacia y la entrega se rechaza con
                           NotAccreditedPharmacy
  Acepta además todas las opciones de issue

ENTORNO
  RPC_URL                        Nodo Ethereum (por defecto http://localhost:8545)
  CHAIN_ID                       Identificador de cadena (por defecto 31337)
  PRESCRIPTION_REGISTRY_ADDRESS  Dirección del contrato desplegado
  API_URL                        Almacén off-chain (por defecto http://localhost:3000)
  NO_COLOR                       Desactiva el color
`;

type Options = Record<string, string | boolean | string[] | undefined>;

function parse(argv: string[], options: ParseArgsConfig['options']): Options {
  const { values } = parseArgs({ args: argv, options, allowPositionals: false, strict: true });
  return values as Options;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

function asNumber(value: unknown, flag: string): number | undefined {
  const raw = asString(value);
  if (raw === undefined) return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`La opción ${flag} espera un número, se recibió "${raw}".`);
  }
  return parsed;
}

const ISSUE_OPTIONS = {
  patient: { type: 'string' },
  'patient-id': { type: 'string' },
  'birth-date': { type: 'string' },
  items: { type: 'string', multiple: true },
  days: { type: 'string' },
  out: { type: 'string' },
  'no-qr': { type: 'boolean' },
} as const satisfies ParseArgsConfig['options'];

function issueOptionsFrom(values: Options): {
  patientName?: string | undefined;
  patientId?: string | undefined;
  birthDate?: string | undefined;
  items?: string[] | undefined;
  validityDays?: number | undefined;
  out?: string | undefined;
  noQrArt?: boolean | undefined;
} {
  return {
    patientName: asString(values['patient']),
    patientId: asString(values['patient-id']),
    birthDate: asString(values['birth-date']),
    items: asStrings(values['items']),
    validityDays: asNumber(values['days'], '--days'),
    out: asString(values['out']),
    noQrArt: values['no-qr'] === true,
  };
}

function requireQr(values: Options): string {
  const raw = asString(values['qr']);
  if (raw === undefined || raw.trim() === '') {
    throw new Error('Falta --qr con el payload del código QR (JSON en línea o ruta de archivo).');
  }
  return raw;
}

function pharmacyFrom(values: Options): PharmacyKey {
  const raw = (asString(values['pharmacy']) ?? 'a').toLowerCase();
  if (raw !== 'a' && raw !== 'b') {
    throw new Error(`La opción --pharmacy solo acepta "a" o "b", se recibió "${raw}".`);
  }
  return raw;
}

async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    ui.line(HELP.trim());
    return 0;
  }

  const config = loadConfig();

  switch (command) {
    case 'issue': {
      const values = parse(rest, ISSUE_OPTIONS);
      await runIssue(config, issueOptionsFrom(values));
      return 0;
    }

    case 'verify': {
      const values = parse(rest, { qr: { type: 'string' } });
      await runVerify(config, readQrArgument(requireQr(values)));
      return 0;
    }

    case 'dispense': {
      const values = parse(rest, {
        qr: { type: 'string' },
        pharmacy: { type: 'string' },
      });
      const result = await runDispense(
        config,
        readQrArgument(requireQr(values)),
        pharmacyFrom(values),
      );
      return result.dispensed ? 0 : 1;
    }

    case 'setup-credentials': {
      parse(rest, {});
      return runSetupCredentials(config);
    }

    case 'demo': {
      const values = parse(rest, {
        ...ISSUE_OPTIONS,
        pause: { type: 'string' },
        revoked: { type: 'boolean' },
      });
      return runDemo(config, {
        ...issueOptionsFrom(values),
        pauseMs: asNumber(values['pause'], '--pause'),
        revoked: values['revoked'] === true,
      });
    }

    default:
      ui.line(ui.red(`Comando desconocido: ${command}`));
      ui.line(HELP.trim());
      return 1;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  ui.line();
  ui.line(ui.boldRed(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}
