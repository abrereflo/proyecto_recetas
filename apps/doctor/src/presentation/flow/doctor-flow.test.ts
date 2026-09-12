import { describe, expect, it } from 'vitest';
import { RULESET_VERSION, type ClinicalAlert } from '@recetas/rules';
import { CONTENT_HASH, EXPIRES_AT, PRESCRIBER, TRANSACTION_HASH } from '../../test/fixtures';
import { ISSUE_STEPS } from '../../domain/issuance';
import {
  INITIAL_FLOW_STATE,
  doctorFlowReducer,
  type FlowAction,
  type FlowState,
  type IssuedPrescription,
} from './doctor-flow';

/**
 * The reducer carries the product's hard rules, so they are asserted here
 * exhaustively — every action against every state — rather than trusted to the
 * screens that happen to dispatch them today.
 *
 * Written in the style of apps/pharmacy/src/presentation/flow/pharmacy-flow.test.ts.
 */

const CRITICAL_ALERT: ClinicalAlert = {
  code: 'DECLARED_ALLERGY',
  severity: 'critical',
  evidence: ['amoxicilina', 'penicilinas'],
  rulesetVersion: RULESET_VERSION,
};

const ISSUED: IssuedPrescription = {
  outcome: 'issued',
  qr: 'RX1:eyJ2IjoxfQ',
  qrPayload: {
    v: 1,
    chainId: 31337,
    registry: PRESCRIBER,
    contentHash: CONTENT_HASH,
    pointer: 'AAAAAAAAAAAAAAAAAAAAAA',
    key: 'a2V5',
  },
  contentHash: CONTENT_HASH,
  transactionHash: TRANSACTION_HASH,
  expiresAt: EXPIRES_AT,
};

const STATES: Record<FlowState['status'], FlowState> = {
  access: { status: 'access' },
  patient: { status: 'patient' },
  medication: { status: 'medication' },
  'critical-alert': { status: 'critical-alert', alert: CRITICAL_ALERT },
  review: { status: 'review' },
  issuing: { status: 'issuing', completed: [] },
  issued: { status: 'issued', result: ISSUED },
  rejected: { status: 'rejected', reason: { code: 'signer-unavailable' } },
  prescriptions: { status: 'prescriptions' },
};

/** One sample per action type, so the matrix below covers the whole union. */
const ACTIONS: Record<FlowAction['type'], FlowAction> = {
  credentialAccepted: { type: 'credentialAccepted', account: PRESCRIBER },
  continueToMedication: { type: 'continueToMedication' },
  backToPatient: { type: 'backToPatient' },
  criticalAlertRaised: { type: 'criticalAlertRaised', alert: CRITICAL_ALERT },
  justificationRecorded: { type: 'justificationRecorded' },
  offendingItemRemoved: { type: 'offendingItemRemoved' },
  closeCriticalAlert: { type: 'closeCriticalAlert' },
  continueToReview: { type: 'continueToReview' },
  backToMedication: { type: 'backToMedication' },
  confirmSignature: { type: 'confirmSignature' },
  issueStepCompleted: { type: 'issueStepCompleted', step: 'document' },
  issueSucceeded: { type: 'issueSucceeded', result: ISSUED },
  issueRejected: { type: 'issueRejected', reason: { code: 'signer-unavailable' } },
  issueAborted: { type: 'issueAborted' },
  resumeEditing: { type: 'resumeEditing' },
  startNewPrescription: { type: 'startNewPrescription' },
  openPrescriptions: { type: 'openPrescriptions' },
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
  access: { credentialAccepted: 'patient' },
  patient: { continueToMedication: 'medication', openPrescriptions: 'prescriptions' },
  medication: {
    backToPatient: 'patient',
    criticalAlertRaised: 'critical-alert',
    continueToReview: 'review',
  },
  'critical-alert': {
    justificationRecorded: 'medication',
    offendingItemRemoved: 'medication',
    closeCriticalAlert: 'medication',
  },
  review: { backToMedication: 'medication', confirmSignature: 'issuing' },
  issuing: {
    issueStepCompleted: 'issuing',
    issueSucceeded: 'issued',
    issueRejected: 'rejected',
    issueAborted: 'review',
  },
  issued: { startNewPrescription: 'patient', openPrescriptions: 'prescriptions' },
  rejected: {
    resumeEditing: 'medication',
    startNewPrescription: 'patient',
    openPrescriptions: 'prescriptions',
  },
  prescriptions: { startNewPrescription: 'patient' },
};

describe('the transition table', () => {
  it('starts on D1, where the credential is checked before anything else', () => {
    expect(INITIAL_FLOW_STATE).toEqual({ status: 'access' });
  });

  for (const from of ALL_STATES) {
    for (const type of ALL_ACTIONS) {
      const expected = TRANSITIONS[from]?.[type];

      if (expected === undefined) {
        it(`ignores ${type} in ${from}`, () => {
          const state = STATES[from];
          expect(doctorFlowReducer(state, ACTIONS[type])).toBe(state);
        });
        continue;
      }

      it(`moves ${from} to ${expected} on ${type}`, () => {
        expect(doctorFlowReducer(STATES[from], ACTIONS[type]).status).toBe(expected);
      });
    }
  }
});

describe('D6 is terminal: nothing reissues an anchored prescription', () => {
  // docs/17 D6, docs/04: the content hash is already on chain and
  // `AlreadyIssued` refuses the same document twice, so no edit-and-reissue
  // path may exist. The assertion is over the whole action union, not a sample.
  const EXITS: FlowAction['type'][] = ['startNewPrescription', 'openPrescriptions'];

  it.each(ALL_ACTIONS.filter((type) => !EXITS.includes(type)))(
    'leaves an issued prescription untouched on %s',
    (type) => {
      const issued = STATES.issued;
      expect(doctorFlowReducer(issued, ACTIONS[type])).toBe(issued);
    },
  );

  it('never reaches an editable or issuing state from issued', () => {
    for (const type of ALL_ACTIONS) {
      const next = doctorFlowReducer(STATES.issued, ACTIONS[type]);
      expect(['medication', 'critical-alert', 'review', 'issuing']).not.toContain(next.status);
    }
  });

  it('starts the NEXT prescription on a clean D2, never back on the same draft', () => {
    expect(doctorFlowReducer(STATES.issued, ACTIONS.startNewPrescription)).toEqual({
      status: 'patient',
    });
  });

  it('keeps the issued result reachable for as long as the screen is on D6', () => {
    const state = doctorFlowReducer(STATES.issuing, ACTIONS.issueSucceeded);

    if (state.status !== 'issued') throw new Error('expected D6');
    expect(state.result).toEqual(ISSUED);
  });
});

describe('nothing auto-issues', () => {
  // docs/17, D5: "Firmar y emitir" is the explicit act.
  it('has exactly one action that starts the issuing pipeline', () => {
    const starters = ALL_ACTIONS.filter(
      (type) => doctorFlowReducer(STATES.review, ACTIONS[type]).status === 'issuing',
    );

    expect(starters).toEqual(['confirmSignature']);
  });

  it('reaches issuing from nowhere but D5', () => {
    // `issuing` itself is excluded: its own progress action keeps it there.
    const elsewhere = ALL_STATES.filter(
      (status) => status !== 'review' && status !== 'issuing',
    );

    for (const from of elsewhere) {
      for (const type of ALL_ACTIONS) {
        expect(doctorFlowReducer(STATES[from], ACTIONS[type]).status).not.toBe('issuing');
      }
    }
  });

  it('records the completed steps in order, for the D5 progress list', () => {
    const steps = ISSUE_STEPS.map((step) => step.id);
    const state = steps.reduce<FlowState>(
      (current, step) => doctorFlowReducer(current, { type: 'issueStepCompleted', step }),
      doctorFlowReducer(STATES.review, ACTIONS.confirmSignature),
    );

    if (state.status !== 'issuing') throw new Error('expected the issuing state');
    expect(state.completed).toEqual(steps);
  });
});

describe('a critical alert never gates the way forward', () => {
  // docs/06, docs/17: "Ninguna alerta clínica bloquea la emisión."
  it('leaves D4 only towards D3, whichever decision was taken', () => {
    const exits: FlowAction['type'][] = [
      'justificationRecorded',
      'offendingItemRemoved',
      'closeCriticalAlert',
    ];

    for (const type of exits) {
      expect(doctorFlowReducer(STATES['critical-alert'], ACTIONS[type])).toEqual({
        status: 'medication',
      });
    }
  });

  it('never reaches D5 or the pipeline directly from D4', () => {
    for (const type of ALL_ACTIONS) {
      const next = doctorFlowReducer(STATES['critical-alert'], ACTIONS[type]);
      expect(['review', 'issuing', 'issued']).not.toContain(next.status);
    }
  });

  it('still moves D3 to D5 after a critical alert was merely closed', () => {
    const backOnMedication = doctorFlowReducer(STATES['critical-alert'], ACTIONS.closeCriticalAlert);

    expect(doctorFlowReducer(backOnMedication, ACTIONS.continueToReview).status).toBe('review');
  });
});

describe('a refusal is correctable, an issuance is not', () => {
  it('returns to the medication form from a refusal, because nothing was anchored', () => {
    expect(doctorFlowReducer(STATES.rejected, ACTIONS.resumeEditing).status).toBe('medication');
  });

  it('offers no such return from D6', () => {
    expect(doctorFlowReducer(STATES.issued, ACTIONS.resumeEditing)).toBe(STATES.issued);
  });
});
