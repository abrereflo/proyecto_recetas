import { describe, expect, it } from 'vitest';
import {
  CHAIN_ID,
  CONTENT_HASH,
  DISPENSED_AT,
  EXPIRES_AT,
  OTHER_SIGNER,
  PHARMACY_A,
  PRESCRIBER,
  REGISTRY_ADDRESS,
  TAMPERED_CONTENT_HASH,
} from '../test/fixtures';
import {
  DEFAULT_REJECTION_FORMATTERS,
  REJECTION_COPY_ES,
  describeRejection,
  type RejectionCode,
  type RejectionReason,
} from './rejection';

/**
 * The rejection catalogue is interface copy, so the hard rules of docs/17 are
 * asserted here rather than trusted to review.
 */

/** One sample reason per code, so every `reason()` function is exercised. */
const SAMPLES: { [C in RejectionCode]: Extract<RejectionReason, { code: C }> } = {
  'already-dispensed': {
    code: 'already-dispensed',
    dispensedBy: PHARMACY_A,
    dispensedAt: DISPENSED_AT,
  },
  expired: { code: 'expired', expiresAt: EXPIRES_AT },
  cancelled: { code: 'cancelled' },
  'unknown-prescription': { code: 'unknown-prescription' },
  'pharmacy-credential-revoked': { code: 'pharmacy-credential-revoked', account: PHARMACY_A },
  'integrity-failed': {
    code: 'integrity-failed',
    anchoredContentHash: CONTENT_HASH,
    storedContentHash: TAMPERED_CONTENT_HASH,
  },
  'signature-failed': { code: 'signature-failed', signer: OTHER_SIGNER, prescriber: PRESCRIBER },
  'patient-mismatch': { code: 'patient-mismatch' },
  'wrong-deployment': {
    code: 'wrong-deployment',
    expectedChainId: CHAIN_ID,
    actualChainId: 43113,
    expectedRegistry: REGISTRY_ADDRESS,
    actualRegistry: '0x8888888888888888888888888888888888888888',
  },
  'network-error': { code: 'network-error', message: 'No hay respuesta del almacén de recetas.' },
};

const ALL_CODES = Object.keys(SAMPLES) as RejectionCode[];

function everyString(): string[] {
  return ALL_CODES.flatMap((code) => {
    const message = describeRejection(SAMPLES[code]);
    return [message.headline, message.reason, message.action];
  });
}

describe('the catalogue covers every code', () => {
  it('has copy for each of the ten reasons', () => {
    expect(Object.keys(REJECTION_COPY_ES).sort()).toEqual([...ALL_CODES].sort());
  });

  it('renders a headline, a reason and an action for every code', () => {
    for (const code of ALL_CODES) {
      const message = describeRejection(SAMPLES[code]);
      expect(message.code).toBe(code);
      expect(message.headline.length).toBeGreaterThan(0);
      expect(message.reason.length).toBeGreaterThan(0);
      expect(message.action.length).toBeGreaterThan(0);
    }
  });

  // docs/17: "Cinco motivos, cinco acciones distintas para el farmacéutico."
  // Collapsing two reasons into the same sentence is the failure this forbids.
  it('gives every code a distinct reason and a distinct action', () => {
    const reasons = ALL_CODES.map((code) => describeRejection(SAMPLES[code]).reason);
    const actions = ALL_CODES.map((code) => REJECTION_COPY_ES[code].action);

    expect(new Set(reasons).size).toBe(ALL_CODES.length);
    expect(new Set(actions).size).toBe(ALL_CODES.length);
  });
});

describe('hard rules of docs/17', () => {
  // "Nunca aparece «wallet», frase semilla ni saldo."
  it.each(['wallet', 'frase semilla', 'saldo'])('never uses the word "%s"', (forbidden) => {
    for (const text of everyString()) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });

  // "No existe botón de reapertura sobre una receta dispensada."
  it('never implies a dispensation can be reopened, undone or reverted', () => {
    const reversal = /reabr|reapertur|revertir|deshacer|anular la dispensaci|volver a dispensar/i;

    for (const text of everyString()) {
      expect(text).not.toMatch(reversal);
    }
  });

  it('states the irreversibility explicitly on the already-dispensed action', () => {
    expect(REJECTION_COPY_ES['already-dispensed'].action).toMatch(/única y definitiva/i);
  });

  // "La revocación se comunica como «se revoca el acceso futuro», nunca como
  // borrado retroactivo."
  it('frames a revoked credential as future access, never as a retroactive deletion', () => {
    const copy = REJECTION_COPY_ES['pharmacy-credential-revoked'];

    expect(copy.action).toMatch(/nuevas dispensaciones/i);
    expect(copy.action).toMatch(/siguen en la cadena/i);
    expect(`${copy.action} ${copy.reason(SAMPLES['pharmacy-credential-revoked'], DEFAULT_REJECTION_FORMATTERS)}`).not.toMatch(
      /borrad|elimina|se pierden/i,
    );
  });

  it('never uses a generic "operación fallida" anywhere', () => {
    for (const text of everyString()) {
      expect(text.toLowerCase()).not.toContain('operación fallida');
    }
  });
});

describe('already-dispensed copy — screen P6', () => {
  it('names who dispensed and when', () => {
    const message = describeRejection(SAMPLES['already-dispensed']);

    expect(message.headline).toBe('NO ENTREGAR');
    expect(message.reason).toContain(DEFAULT_REJECTION_FORMATTERS.dateTime(DISPENSED_AT));
    expect(message.reason).toContain(DEFAULT_REJECTION_FORMATTERS.address(PHARMACY_A));
  });
});

describe('expired copy', () => {
  it('shows the expiry as a day, without an hour (D-13)', () => {
    const message = describeRejection(SAMPLES.expired);
    const day = DEFAULT_REJECTION_FORMATTERS.day(EXPIRES_AT);

    expect(message.reason).toContain(day);
    expect(day).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('signature-failed copy', () => {
  it('names both addresses when the signer is not the prescriber', () => {
    const message = describeRejection(SAMPLES['signature-failed']);

    expect(message.reason).toContain(DEFAULT_REJECTION_FORMATTERS.address(OTHER_SIGNER));
    expect(message.reason).toContain(DEFAULT_REJECTION_FORMATTERS.address(PRESCRIBER));
  });

  it('says the signature does not match the chain when the signer is right', () => {
    const message = describeRejection({
      code: 'signature-failed',
      signer: PRESCRIBER,
      prescriber: PRESCRIBER,
    });

    expect(message.reason).toMatch(/no corresponde a los datos/i);
  });
});

describe('network-error copy', () => {
  it('carries the injected message verbatim and reads as incomplete, not as a verdict', () => {
    const message = describeRejection(SAMPLES['network-error']);

    expect(message.reason).toBe('No hay respuesta del almacén de recetas.');
    expect(message.headline).toBe('VERIFICACIÓN INCOMPLETA');
  });
});

describe('formatters', () => {
  it('renders addresses short enough to compare at a glance', () => {
    expect(DEFAULT_REJECTION_FORMATTERS.address(PHARMACY_A)).toBe('0x51aE…8837');
  });

  it('pins Bolivian local time so every device shows the same instant', () => {
    // 2026-09-11T13:42:00Z is 09:42 in America/La_Paz (UTC-4).
    expect(DEFAULT_REJECTION_FORMATTERS.dateTime(DISPENSED_AT)).toContain('09:42');
  });
});

describe('wrong-deployment copy', () => {
  // The tenth code exists because an environment mismatch used to land on
  // `network-error`, which told the pharmacist to check a connection that was
  // never asked anything.
  it('names both chain ids when the code comes from another chain', () => {
    const message = describeRejection(SAMPLES['wrong-deployment']);

    expect(message.headline).toBe('CÓDIGO DE OTRO SISTEMA');
    expect(message.reason).toContain('43113');
    expect(message.reason).toContain(String(CHAIN_ID));
  });

  it('says the registry is another one when only the registry differs', () => {
    const message = describeRejection({
      code: 'wrong-deployment',
      expectedChainId: CHAIN_ID,
      actualChainId: CHAIN_ID,
      expectedRegistry: REGISTRY_ADDRESS,
      actualRegistry: '0x8888888888888888888888888888888888888888',
    });

    expect(message.reason).toMatch(/otro registro de recetas/i);
  });

  it('never blames the connection, because nothing was asked of the network', () => {
    const message = describeRejection(SAMPLES['wrong-deployment']);

    expect(`${message.reason} ${message.action}`).not.toMatch(/conexi[oó]n|conectividad|vuelva a escanear/i);
  });

  it('does not read as a verdict about the prescription', () => {
    const message = describeRejection(SAMPLES['wrong-deployment']);

    expect(message.action).toMatch(/puede ser correcta/i);
  });
});
