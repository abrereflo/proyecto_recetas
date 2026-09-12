import { describe, expect, it } from 'vitest';
import { CHECK_ORDER, pendingChecks, type CheckResult } from '../../domain/verification';
import type { DispenseReceipt } from '../../ports/chain.port';
import {
  DISPENSED_AT,
  EXPIRES_AT,
  PHARMACY_A,
  PHARMACY_B,
  aDocument,
  aQrPayload,
  aRecord,
} from '../../test/fixtures';
import {
  INITIAL_FLOW_STATE,
  pharmacyFlowReducer,
  type FlowAction,
  type FlowState,
} from './pharmacy-flow';

/**
 * The reducer carries the product's hard rules, so they are asserted here
 * exhaustively — every action against every state — rather than trusted to the
 * screens that happen to dispatch them today.
 */

const QR = aQrPayload();
const DOCUMENT = aDocument();
const RECORD = aRecord();

const RECEIPT: DispenseReceipt = {
  transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
  blockNumber: 4_210_001n,
  blockTimestamp: DISPENSED_AT,
  dispensedBy: PHARMACY_A,
};

const ALL_PASSED: CheckResult[] = CHECK_ORDER.map((id) => ({ id, state: 'passed' as const }));

const STATES: Record<FlowState['status'], FlowState> = {
  access: { status: 'access' },
  scanner: { status: 'scanner' },
  verifying: { status: 'verifying', qr: QR, checks: pendingChecks() },
  verified: {
    status: 'verified',
    qr: QR,
    document: DOCUMENT,
    record: RECORD,
    checks: ALL_PASSED,
  },
  dispensing: {
    status: 'dispensing',
    qr: QR,
    document: DOCUMENT,
    record: RECORD,
    checks: ALL_PASSED,
  },
  dispensed: { status: 'dispensed', contentHash: QR.contentHash as `0x${string}`, receipt: RECEIPT },
  rejected: {
    status: 'rejected',
    reason: { code: 'already-dispensed', dispensedBy: PHARMACY_B, dispensedAt: DISPENSED_AT },
    checks: ALL_PASSED,
  },
  'manual-entry': { status: 'manual-entry' },
};

/** One sample per action type, so the matrix below covers the whole union. */
const ACTIONS: Record<FlowAction['type'], FlowAction> = {
  credentialAccepted: { type: 'credentialAccepted', account: PHARMACY_A },
  openManualEntry: { type: 'openManualEntry' },
  closeManualEntry: { type: 'closeManualEntry' },
  manualEntryFailed: { type: 'manualEntryFailed', problem: 'no se pudo leer' },
  qrCaptured: { type: 'qrCaptured', qr: QR },
  checksAdvanced: { type: 'checksAdvanced', checks: ALL_PASSED },
  verificationSucceeded: {
    type: 'verificationSucceeded',
    document: DOCUMENT,
    record: RECORD,
    checks: ALL_PASSED,
  },
  verificationRejected: {
    type: 'verificationRejected',
    reason: { code: 'expired', expiresAt: EXPIRES_AT },
    checks: ALL_PASSED,
  },
  confirmDelivery: { type: 'confirmDelivery' },
  cancelDelivery: { type: 'cancelDelivery' },
  dispenseSucceeded: { type: 'dispenseSucceeded', receipt: RECEIPT },
  dispenseRejected: {
    type: 'dispenseRejected',
    reason: { code: 'expired', expiresAt: EXPIRES_AT },
  },
  dispenseAborted: { type: 'dispenseAborted' },
  scanAnother: { type: 'scanAnother' },
};

const ALL_STATES = Object.keys(STATES) as FlowState['status'][];
const ALL_ACTIONS = Object.keys(ACTIONS) as FlowAction['type'][];

/**
 * The complete transition table. Every (state, action) pair not listed here is
 * asserted to be a no-op, so adding a state or an action without deciding what
 * it does everywhere fails the suite instead of silently doing something.
 */
const TRANSITIONS: Partial<
  Record<FlowState['status'], Partial<Record<FlowAction['type'], FlowState['status']>>>
> = {
  access: { credentialAccepted: 'scanner' },
  scanner: { openManualEntry: 'manual-entry', qrCaptured: 'verifying' },
  'manual-entry': {
    closeManualEntry: 'scanner',
    manualEntryFailed: 'manual-entry',
    qrCaptured: 'verifying',
  },
  verifying: {
    checksAdvanced: 'verifying',
    verificationSucceeded: 'verified',
    verificationRejected: 'rejected',
  },
  verified: { confirmDelivery: 'dispensing', cancelDelivery: 'scanner' },
  dispensing: {
    dispenseSucceeded: 'dispensed',
    dispenseRejected: 'rejected',
    dispenseAborted: 'verified',
  },
  dispensed: { scanAnother: 'scanner' },
  rejected: { scanAnother: 'scanner' },
};

describe('the transition table', () => {
  it('starts on P1, where the credential is checked before anything else', () => {
    expect(INITIAL_FLOW_STATE).toEqual({ status: 'access' });
  });

  for (const from of ALL_STATES) {
    for (const type of ALL_ACTIONS) {
      const expected = TRANSITIONS[from]?.[type];

      if (expected === undefined) {
        it(`ignores ${type} in ${from}`, () => {
          const state = STATES[from];
          expect(pharmacyFlowReducer(state, ACTIONS[type])).toBe(state);
        });
        continue;
      }

      it(`moves ${from} to ${expected} on ${type}`, () => {
        expect(pharmacyFlowReducer(STATES[from], ACTIONS[type]).status).toBe(expected);
      });
    }
  }
});

describe('P5 is terminal: no reversal exists', () => {
  // docs/04, docs/17: "No existe botón de reapertura sobre una receta
  // dispensada." The assertion is the whole action union, not a sample, so a
  // future action cannot quietly become an escape hatch.
  it.each(ALL_ACTIONS.filter((type) => type !== 'scanAnother'))(
    'leaves a dispensed prescription untouched on %s',
    (type) => {
      const dispensed = STATES.dispensed;
      expect(pharmacyFlowReducer(dispensed, ACTIONS[type])).toBe(dispensed);
    },
  );

  it('never reaches verified, dispensing or verifying from dispensed', () => {
    for (const type of ALL_ACTIONS) {
      const next = pharmacyFlowReducer(STATES.dispensed, ACTIONS[type]);
      expect(['verified', 'dispensing', 'verifying']).not.toContain(next.status);
    }
  });

  it('only ever moves on to the NEXT prescription, with a clean scanner', () => {
    expect(pharmacyFlowReducer(STATES.dispensed, ACTIONS.scanAnother)).toEqual({
      status: 'scanner',
    });
  });

  it('keeps the receipt reachable for as long as the screen is on P5', () => {
    const state = pharmacyFlowReducer(STATES.dispensing, ACTIONS.dispenseSucceeded);

    if (state.status !== 'dispensed') throw new Error('expected P5');
    expect(state.receipt).toEqual(RECEIPT);
    expect(state.contentHash).toBe(QR.contentHash);
  });
});

describe('verification never auto-dispenses', () => {
  // docs/17: "Confirmar la entrega es un acto humano, no un efecto del
  // escaneo."
  it('lands on P4 and stays there when verification succeeds', () => {
    const verifying = pharmacyFlowReducer(STATES.scanner, ACTIONS.qrCaptured);
    const verified = pharmacyFlowReducer(verifying, ACTIONS.verificationSucceeded);

    expect(verified.status).toBe('verified');
  });

  it('has exactly one action that starts the irreversible write', () => {
    const starters = ALL_ACTIONS.filter(
      (type) => pharmacyFlowReducer(STATES.verified, ACTIONS[type]).status === 'dispensing',
    );

    expect(starters).toEqual(['confirmDelivery']);
  });

  it('returns to P4 intact when the person declines the prompt', () => {
    const dispensing = pharmacyFlowReducer(STATES.verified, ACTIONS.confirmDelivery);
    const back = pharmacyFlowReducer(dispensing, ACTIONS.dispenseAborted);

    expect(back).toEqual(STATES.verified);
  });
});

describe('the scanner is gated on the credential', () => {
  // docs/17, P1: "La credencial se comprueba antes de habilitar el escáner."
  it('has exactly one action that opens the scanner from P1', () => {
    const openers = ALL_ACTIONS.filter(
      (type) => pharmacyFlowReducer(STATES.access, ACTIONS[type]).status === 'scanner',
    );

    expect(openers).toEqual(['credentialAccepted']);
  });

  it('cannot be entered by capturing a code while still on P1', () => {
    expect(pharmacyFlowReducer(STATES.access, ACTIONS.qrCaptured).status).toBe('access');
  });
});

describe('manual entry is a contingency, not a shortcut', () => {
  it('enters the same verification as the camera, with the same five checks', () => {
    const fromCamera = pharmacyFlowReducer(STATES.scanner, ACTIONS.qrCaptured);
    const fromKeyboard = pharmacyFlowReducer(STATES['manual-entry'], ACTIONS.qrCaptured);

    expect(fromKeyboard).toEqual(fromCamera);
    if (fromKeyboard.status !== 'verifying') throw new Error('expected P3');
    expect(fromKeyboard.checks).toEqual(pendingChecks());
  });

  it('keeps the pharmacist on P8 when the payload cannot be read', () => {
    const state = pharmacyFlowReducer(STATES['manual-entry'], ACTIONS.manualEntryFailed);

    expect(state).toEqual({ status: 'manual-entry', problem: 'no se pudo leer' });
  });

  it('is reachable only from the scanner', () => {
    const openers = ALL_STATES.filter(
      (from) => pharmacyFlowReducer(STATES[from], ACTIONS.openManualEntry) !== STATES[from],
    );

    expect(openers).toEqual(['scanner']);
  });
});

describe('a rejection is not a dead end', () => {
  it('returns to the scanner, carrying nothing forward', () => {
    expect(pharmacyFlowReducer(STATES.rejected, ACTIONS.scanAnother)).toEqual({
      status: 'scanner',
    });
  });

  it('keeps the checklist that produced the verdict', () => {
    const verifying = pharmacyFlowReducer(STATES.scanner, ACTIONS.qrCaptured);
    const rejected = pharmacyFlowReducer(verifying, ACTIONS.verificationRejected);

    if (rejected.status !== 'rejected') throw new Error('expected a rejection');
    expect(rejected.checks).toEqual(ALL_PASSED);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    for (const from of ALL_STATES) {
      for (const type of ALL_ACTIONS) {
        const state = STATES[from];
        const before = JSON.stringify(state, bigintReplacer);
        pharmacyFlowReducer(state, ACTIONS[type]);
        expect(JSON.stringify(state, bigintReplacer)).toBe(before);
      }
    }
  });
});

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
