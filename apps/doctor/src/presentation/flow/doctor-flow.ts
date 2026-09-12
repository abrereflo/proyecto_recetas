import type { ClinicalAlert } from '@recetas/rules';
import type { Address } from '@recetas/shared';
import type { IssueRejection, IssueResult, IssueStepId } from '../../domain/issuance';

/**
 * Navigation for the doctor SPA: a pure reducer, NOT a router.
 *
 * HARD RULE (docs/17, docs/03): no router is installed and nothing about this
 * flow reaches the URL. The draft held beside this machine carries the patient
 * identifier and the commitment salt, and the QR produced at the end of it
 * carries the raw decryption key. A router would put any of that in the address
 * bar, in the history entry, in the `Referer` header of every later request and
 * in whatever the doctor pastes into a message when something goes wrong.
 * Whoever holds the key can read the prescription, so a shareable link is a
 * clinical data leak with a pleasant name. The whole flow lives in memory and
 * dies with the tab. presentation/copy-guard.test.ts asserts the absence of a
 * router over the whole layer rather than trusting this comment.
 *
 * The transitions below are the product's hard rules expressed structurally. A
 * rule enforced by convention is a rule that survives exactly as long as the
 * next person who has not read docs/17.
 */

/** The issued outcome, narrowed. The only payload screen D6 needs. */
export type IssuedPrescription = Extract<IssueResult, { outcome: 'issued' }>;

/** Screens D1 to D7, plus the in-flight state that owns the issuing effect. */
export type FlowState =
  /** D1. */
  | { status: 'access' }
  /** D2. */
  | { status: 'patient' }
  /** D3. */
  | { status: 'medication' }
  /**
   * D4, raised over D3. It carries the RAW alert rather than its presented
   * form: `dismissAlert` and `justificationSatisfies` both take a
   * `ClinicalAlert`, and re-deriving one from a screen model would be a second
   * source of truth about an identity the core already owns.
   */
  | { status: 'critical-alert'; alert: ClinicalAlert }
  /** D5. */
  | { status: 'review' }
  /** Between D5 and D6: the issuing pipeline is running. */
  | { status: 'issuing'; completed: readonly IssueStepId[] }
  /** D6. Terminal for THIS prescription. */
  | { status: 'issued'; result: IssuedPrescription }
  /** The refusal screen. Nothing was anchored. */
  | { status: 'rejected'; reason: IssueRejection }
  /** D7. */
  | { status: 'prescriptions' };

export type FlowAction =
  /** D1 -> D2. The ONLY way out of the access screen. */
  | { type: 'credentialAccepted'; account: Address }
  /** D2 -> D3. */
  | { type: 'continueToMedication' }
  /** D3 -> D2. Editing the declared context re-runs the whole engine. */
  | { type: 'backToPatient' }
  /** D3 -> D4, when the doctor opens a critical alert to decide on it. */
  | { type: 'criticalAlertRaised'; alert: ClinicalAlert }
  /** D4 -> D3, the decision recorded with its written motive. */
  | { type: 'justificationRecorded' }
  /** D4 -> D3, the offending item withdrawn instead. */
  | { type: 'offendingItemRemoved' }
  /** D4 -> D3, closed without deciding. Escape, and the way back to editing. */
  | { type: 'closeCriticalAlert' }
  /** D3 -> D5. Never conditional on the alert set (docs/06). */
  | { type: 'continueToReview' }
  /** D5 -> D3. */
  | { type: 'backToMedication' }
  /** D5 -> issuing. The one deliberate act that starts the pipeline. */
  | { type: 'confirmSignature' }
  /** issuing progress, one completed step at a time. */
  | { type: 'issueStepCompleted'; step: IssueStepId }
  /** issuing -> D6. */
  | { type: 'issueSucceeded'; result: IssuedPrescription }
  /** issuing -> the refusal screen. */
  | { type: 'issueRejected'; reason: IssueRejection }
  /** issuing -> D5. The prescriber declined the signature; nothing happened. */
  | { type: 'issueAborted' }
  /** refusal -> D3. Nothing was anchored, so the draft is still correctable. */
  | { type: 'resumeEditing' }
  /** D6, refusal or D7 -> D2, on a NEW prescription. */
  | { type: 'startNewPrescription' }
  /** D2, D6 or the refusal -> D7. */
  | { type: 'openPrescriptions' };

/** D1 is where every session starts: the credential is checked before anything. */
export const INITIAL_FLOW_STATE: FlowState = { status: 'access' };

/**
 * Actions that `'issued'` accepts.
 *
 * HARD RULE (docs/17 D6, docs/04): D6 is TERMINAL for that prescription. The
 * content hash is already anchored and `AlreadyIssued` refuses the same
 * document a second time, so there is no edit-and-reissue path to offer: the
 * only exits are starting a NEW prescription and looking at the list. Every
 * other action is ignored, checked before the switch so no later branch can
 * grow a second way back into an editable draft.
 */
const ISSUED_ALLOWS = new Set<FlowAction['type']>(['startNewPrescription', 'openPrescriptions']);

export function doctorFlowReducer(state: FlowState, action: FlowAction): FlowState {
  if (state.status === 'issued') {
    if (!ISSUED_ALLOWS.has(action.type)) return state;
    return action.type === 'openPrescriptions' ? { status: 'prescriptions' } : { status: 'patient' };
  }

  switch (action.type) {
    // --- D1 -> D2 ---------------------------------------------------------
    case 'credentialAccepted':
      // The form is reachable from D1 only through this action, which the
      // access screen dispatches only after `checkCredential` has answered
      // (docs/17, D1). Every other state ignores it.
      return state.status === 'access' ? { status: 'patient' } : state;

    // --- D2 <-> D3 --------------------------------------------------------
    case 'continueToMedication':
      return state.status === 'patient' ? { status: 'medication' } : state;

    case 'backToPatient':
      return state.status === 'medication' ? { status: 'patient' } : state;

    // --- D3 <-> D4 --------------------------------------------------------
    case 'criticalAlertRaised':
      return state.status === 'medication'
        ? { status: 'critical-alert', alert: action.alert }
        : state;

    case 'justificationRecorded':
    case 'offendingItemRemoved':
    case 'closeCriticalAlert':
      // HARD RULE (docs/06, docs/17 "Ninguna alerta clínica bloquea la
      // emisión"): every exit from D4 lands back on D3, where `continueToReview`
      // is unconditional. The modal demands a written motive to DISMISS the
      // alert; it can never become a gate on the way forward, and closing it
      // without deciding is the way back to editing the item that raised it.
      return state.status === 'critical-alert' ? { status: 'medication' } : state;

    // --- D3 <-> D5 --------------------------------------------------------
    case 'continueToReview':
      // No branch here reads the alert set or the justifications. That absence
      // is the rule: the reducer has no way to refuse on clinical grounds.
      return state.status === 'medication' ? { status: 'review' } : state;

    case 'backToMedication':
      return state.status === 'review' ? { status: 'medication' } : state;

    // --- D5 -> issuing ----------------------------------------------------
    case 'confirmSignature':
      // HARD RULE (docs/17, D5): nothing auto-issues. This is the one and only
      // transition that starts the pipeline, so firing it always traces back to
      // a deliberate human act rather than to a form having become valid.
      return state.status === 'review' ? { status: 'issuing', completed: [] } : state;

    // --- issuing ----------------------------------------------------------
    case 'issueStepCompleted':
      return state.status === 'issuing'
        ? { status: 'issuing', completed: [...state.completed, action.step] }
        : state;

    case 'issueSucceeded':
      return state.status === 'issuing' ? { status: 'issued', result: action.result } : state;

    case 'issueRejected':
      return state.status === 'issuing' ? { status: 'rejected', reason: action.reason } : state;

    case 'issueAborted':
      // Declining the prompt wrote nothing, so the draft is exactly as it was.
      // Back to D5, not to a failure screen.
      return state.status === 'issuing' ? { status: 'review' } : state;

    // --- refusal ----------------------------------------------------------
    case 'resumeEditing':
      // Reachable ONLY from a refusal. A refusal means nothing was anchored, so
      // correcting and emitting again is safe; after D6 it would not be.
      return state.status === 'rejected' ? { status: 'medication' } : state;

    // --- onward -----------------------------------------------------------
    case 'startNewPrescription':
      return state.status === 'rejected' || state.status === 'prescriptions'
        ? { status: 'patient' }
        : state;

    case 'openPrescriptions':
      return state.status === 'patient' || state.status === 'rejected'
        ? { status: 'prescriptions' }
        : state;
  }
}
