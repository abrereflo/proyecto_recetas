import type {
  Address,
  Bytes32,
  PrescriptionDocument,
  PrescriptionRecord,
  QrPayload,
} from '@recetas/shared';
import type { RejectionReason } from '../../domain/rejection';
import { pendingChecks, type CheckResult } from '../../domain/verification';
import type { DispenseReceipt } from '../../ports/chain.port';

/**
 * Navigation for the pharmacy PWA: a pure reducer, NOT a router.
 *
 * HARD RULE (docs/17, docs/03, packages/shared/src/qr.ts): nothing about this
 * flow may reach the URL, and no router is installed. The QR payload carries
 * `key` — the raw decryption DEK — alongside `contentHash` and `pointer`.
 * A router would put that key in the address bar, in the history entry, in the
 * `Referer` header of every later request and in whatever the pharmacist
 * pastes into a message when something goes wrong. Whoever holds the key can
 * read the prescription, so a shareable link is a clinical data leak with a
 * pleasant name. The whole flow therefore lives in memory and dies with the
 * tab.
 *
 * The transitions below are the product's hard rules expressed structurally.
 * A rule enforced by convention is a rule that survives exactly as long as the
 * next person who has not read docs/17.
 */

/** Screens P1 to P8, plus the two in-flight states that own an async effect. */
export type FlowState =
  /** P1. */
  | { status: 'access' }
  /** P2. */
  | { status: 'scanner' }
  /** P3. */
  | { status: 'verifying'; qr: QrPayload; checks: CheckResult[] }
  /** P4. */
  | {
      status: 'verified';
      qr: QrPayload;
      document: PrescriptionDocument;
      record: PrescriptionRecord;
      checks: CheckResult[];
    }
  /** Between P4 and P5: the transaction is in flight. */
  | {
      status: 'dispensing';
      qr: QrPayload;
      document: PrescriptionDocument;
      record: PrescriptionRecord;
      checks: CheckResult[];
    }
  /** P5. Terminal. */
  | { status: 'dispensed'; contentHash: Bytes32; receipt: DispenseReceipt }
  /** P6 when the reason is `already-dispensed`, P7 otherwise. */
  | { status: 'rejected'; reason: RejectionReason; checks: CheckResult[] }
  /** P8. */
  | { status: 'manual-entry'; problem?: string };

export type FlowAction =
  /** P1 -> P2. The ONLY way into the scanner from the access screen. */
  | { type: 'credentialAccepted'; account: Address }
  /** P2 -> P8, the camera contingency. */
  | { type: 'openManualEntry' }
  /** P8 -> P2. */
  | { type: 'closeManualEntry' }
  /** P8 stays put and reports a payload it could not read. */
  | { type: 'manualEntryFailed'; problem: string }
  /** P2 or P8 -> P3. Both entry points land on the same verification. */
  | { type: 'qrCaptured'; qr: QrPayload }
  /** P3 progress, one checklist snapshot at a time. */
  | { type: 'checksAdvanced'; checks: CheckResult[] }
  /** P3 -> P4. */
  | {
      type: 'verificationSucceeded';
      document: PrescriptionDocument;
      record: PrescriptionRecord;
      checks: CheckResult[];
    }
  /** P3 -> P6/P7. */
  | { type: 'verificationRejected'; reason: RejectionReason; checks: CheckResult[] }
  /** P4 -> dispensing. The only action that may start an irreversible write. */
  | { type: 'confirmDelivery' }
  /** P4 -> P2, without registering anything. */
  | { type: 'cancelDelivery' }
  /** dispensing -> P5. */
  | { type: 'dispenseSucceeded'; receipt: DispenseReceipt }
  /** dispensing -> P6/P7. */
  | { type: 'dispenseRejected'; reason: RejectionReason }
  /** dispensing -> P4. The person declined the prompt; nothing was written. */
  | { type: 'dispenseAborted' }
  /** P5, P6 or P7 -> P2. The only way out of a terminal screen. */
  | { type: 'scanAnother' };

/** P1 is where every session starts: the credential is checked before anything. */
export const INITIAL_FLOW_STATE: FlowState = { status: 'access' };

/**
 * Actions that `'dispensed'` accepts.
 *
 * HARD RULE (docs/04, docs/17, "No existe botón de reapertura sobre una receta
 * dispensada"): `'dispensed'` is terminal. `scanAnother` moves on to the NEXT
 * prescription; it does not reopen, undo, revert or reverse this one, and no
 * other action is honoured from that state. The contract has no operation that
 * could back such a transition, so an interface offering one would lie about
 * the only property that sustains the project. This is asserted exhaustively in
 * pharmacy-flow.test.ts rather than trusted to review.
 */
const DISPENSED_ALLOWS = new Set<FlowAction['type']>(['scanAnother']);

export function pharmacyFlowReducer(state: FlowState, action: FlowAction): FlowState {
  // Checked before the switch so no later branch can ever grow a second way
  // out of a completed dispensation.
  if (state.status === 'dispensed') {
    return DISPENSED_ALLOWS.has(action.type) ? { status: 'scanner' } : state;
  }

  switch (action.type) {
    // --- P1 -> P2 ---------------------------------------------------------
    case 'credentialAccepted':
      // The scanner is reachable from P1 only through this action, which the
      // access screen dispatches only after `checkCredential` has answered
      // (docs/17, P1: "La credencial se comprueba antes de habilitar el
      // escáner"). Every other state ignores it.
      return state.status === 'access' ? { status: 'scanner' } : state;

    // --- P2 <-> P8 --------------------------------------------------------
    case 'openManualEntry':
      return state.status === 'scanner' ? { status: 'manual-entry' } : state;

    case 'closeManualEntry':
      return state.status === 'manual-entry' ? { status: 'scanner' } : state;

    case 'manualEntryFailed':
      return state.status === 'manual-entry'
        ? { status: 'manual-entry', problem: action.problem }
        : state;

    // --- P2 or P8 -> P3 ---------------------------------------------------
    case 'qrCaptured':
      // Manual entry is a contingency for a broken camera, never a shortcut:
      // it re-enters the SAME verification with the same five checks
      // (docs/17, P8).
      return state.status === 'scanner' || state.status === 'manual-entry'
        ? { status: 'verifying', qr: action.qr, checks: pendingChecks() }
        : state;

    // --- P3 ---------------------------------------------------------------
    case 'checksAdvanced':
      return state.status === 'verifying' ? { ...state, checks: action.checks } : state;

    case 'verificationSucceeded':
      return state.status === 'verifying'
        ? {
            status: 'verified',
            qr: state.qr,
            document: action.document,
            record: action.record,
            checks: action.checks,
          }
        : state;

    case 'verificationRejected':
      return state.status === 'verifying'
        ? { status: 'rejected', reason: action.reason, checks: action.checks }
        : state;

    // --- P4 ---------------------------------------------------------------
    case 'confirmDelivery':
      // HARD RULE (docs/17): verification NEVER auto-dispenses. This is the one
      // and only transition that starts the irreversible write, and it exists
      // so that firing it always traces back to a deliberate human act rather
      // than to a camera having pointed at a code.
      return state.status === 'verified'
        ? {
            status: 'dispensing',
            qr: state.qr,
            document: state.document,
            record: state.record,
            checks: state.checks,
          }
        : state;

    case 'cancelDelivery':
      return state.status === 'verified' ? { status: 'scanner' } : state;

    // --- dispensing -> P5 / P6 / P7 / back to P4 --------------------------
    case 'dispenseSucceeded':
      return state.status === 'dispensing'
        ? {
            status: 'dispensed',
            contentHash: state.qr.contentHash as Bytes32,
            receipt: action.receipt,
          }
        : state;

    case 'dispenseRejected':
      return state.status === 'dispensing'
        ? { status: 'rejected', reason: action.reason, checks: state.checks }
        : state;

    case 'dispenseAborted':
      // Declining the prompt wrote nothing, so the verified prescription is
      // still exactly as verified. Back to P4, not to a failure screen.
      return state.status === 'dispensing'
        ? {
            status: 'verified',
            qr: state.qr,
            document: state.document,
            record: state.record,
            checks: state.checks,
          }
        : state;

    // --- terminal screens -> P2 -------------------------------------------
    case 'scanAnother':
      return state.status === 'rejected' ? { status: 'scanner' } : state;
  }
}
