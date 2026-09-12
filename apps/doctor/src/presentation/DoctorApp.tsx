import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Address } from '@recetas/shared';
import type { PrescriptionDraft } from '../domain/draft';
import type { IssueResult } from '../domain/issuance';
import type { DoctorServices } from './composition/doctor-services';
import { CriticalAlertDialog } from './screens/CriticalAlertDialog';
import { AccessScreen } from './screens/AccessScreen';
import { IssuedScreen } from './screens/IssuedScreen';
import { IssuingScreen } from './screens/IssuingScreen';
import { MedicationScreen } from './screens/MedicationScreen';
import { PatientScreen } from './screens/PatientScreen';
import { PrescriptionsScreen } from './screens/PrescriptionsScreen';
import { RejectionScreen } from './screens/RejectionScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { emptyDraft, findOffendingItem, removeItem, withJustification } from './draft-editing';
import {
  INITIAL_FLOW_STATE,
  doctorFlowReducer,
  type FlowAction,
  type FlowState,
} from './flow/doctor-flow';

/**
 * The shell: flow machine, the draft, and the one async effect the flow owns.
 *
 * Navigation is the reducer in ./flow/doctor-flow.ts and nothing else — no
 * router, nothing in the URL. See that file for the reason: the draft below
 * holds the patient identifier and the QR at the end of it holds the decryption
 * key, and docs/17 forbids either ever reaching an address bar or a shareable
 * link.
 *
 * THE DRAFT LIVES BESIDE THE MACHINE, NOT INSIDE IT. The flow answers "which
 * screen", the draft answers "what has been written", and they change at
 * completely different rates: one transition per screen against one edit per
 * keystroke. Every mutation goes through `editDraft` (presentation/draft-editing.ts)
 * so the recorded alert decisions are re-reconciled on every single edit.
 *
 * `issue` returns a result for every modelled refusal but RETHROWS anything
 * nobody modelled, so the call below is wrapped. An unmodelled failure is
 * reported as an incomplete issuance with an explicit instruction not to hand
 * anything to the patient — never dressed up as a verdict about the receta
 * (docs/17).
 */

export interface DoctorAppProps {
  services: DoctorServices;
  /** Injected in tests so the expiry preview and D4's clock are deterministic. */
  now?: () => Date;
}

export function DoctorApp({ services, now = () => new Date() }: DoctorAppProps) {
  const [state, dispatch] = useReducer(doctorFlowReducer, INITIAL_FLOW_STATE);
  const [draft, setDraft] = useState<PrescriptionDraft>(emptyDraft);
  const [account, setAccount] = useState<Address | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { issue } = services;

  // --- D5 -> D6: the one write, started by entering 'issuing' ---------------
  // Reached ONLY from 'issuing', which the reducer enters ONLY on
  // `confirmSignature`. No form becoming valid can fall through into here.
  const issuing = state.status === 'issuing';

  useEffect(() => {
    if (!issuing || account === null) return;
    let cancelled = false;

    void (async () => {
      const result = await runIssue(() =>
        issue({
          draft,
          prescriber: account,
          onStep: (step) => {
            if (!cancelled && mounted.current) dispatch({ type: 'issueStepCompleted', step });
          },
        }),
      );
      if (cancelled || !mounted.current) return;

      switch (result.outcome) {
        case 'issued':
          dispatch({ type: 'issueSucceeded', result });
          return;
        case 'aborted':
          dispatch({ type: 'issueAborted' });
          return;
        case 'rejected':
          dispatch({ type: 'issueRejected', reason: result.reason });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `draft` is deliberately not a dependency: it is frozen the moment the
    // doctor confirms the signature, and re-running the pipeline because a
    // stray keystroke changed it would issue a different document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, issue, issuing]);

  const onAccredited = useCallback((accredited: Address) => {
    setAccount(accredited);
    dispatch({ type: 'credentialAccepted', account: accredited });
  }, []);

  /**
   * A NEW prescription starts from a blank draft.
   *
   * HARD RULE (docs/17 D6, docs/04): after an issuance the content hash is
   * anchored and `AlreadyIssued` refuses the same document twice, so carrying
   * the old draft forward would hand the doctor a form that cannot be issued.
   * The reducer refuses to go back into an editable state from `'issued'`; this
   * is the other half of the same rule.
   */
  const onNewPrescription = useCallback(() => {
    setDraft(emptyDraft());
    dispatch({ type: 'startNewPrescription' });
  }, []);

  return renderScreen(state, {
    services,
    draft,
    account,
    now,
    dispatch,
    setDraft,
    onAccredited,
    onNewPrescription,
  });
}

interface ScreenDeps {
  services: DoctorServices;
  draft: PrescriptionDraft;
  account: Address | null;
  now(): Date;
  dispatch: React.Dispatch<FlowAction>;
  setDraft: React.Dispatch<React.SetStateAction<PrescriptionDraft>>;
  onAccredited(account: Address): void;
  onNewPrescription(): void;
}

function renderScreen(state: FlowState, deps: ScreenDeps) {
  const { services, draft, account, now, dispatch, setDraft, onAccredited, onNewPrescription } =
    deps;

  switch (state.status) {
    case 'access':
      return (
        <AccessScreen
          chainId={services.config.chainId}
          checkCredential={services.checkCredential}
          onAccredited={onAccredited}
          signer={services.signer}
        />
      );

    case 'patient':
      return (
        <PatientScreen
          draft={draft}
          now={now()}
          onContinue={() => dispatch({ type: 'continueToMedication' })}
          onDraftChange={setDraft}
          onOpenPrescriptions={() => dispatch({ type: 'openPrescriptions' })}
        />
      );

    case 'medication':
      return (
        <MedicationScreen
          draft={draft}
          onBack={() => dispatch({ type: 'backToPatient' })}
          onContinue={() => dispatch({ type: 'continueToReview' })}
          onCriticalAlert={(alert) => dispatch({ type: 'criticalAlertRaised', alert })}
          onDraftChange={setDraft}
        />
      );

    case 'critical-alert': {
      // D4 is an overlay: D3 stays rendered underneath, so closing the dialog
      // puts the doctor back exactly where the alert was raised, on the item
      // that raised it (docs/17, D4).
      const offending = findOffendingItem(draft, state.alert);

      return (
        <>
          <MedicationScreen
            draft={draft}
            onBack={() => dispatch({ type: 'backToPatient' })}
            onContinue={() => dispatch({ type: 'continueToReview' })}
            onCriticalAlert={(alert) => dispatch({ type: 'criticalAlertRaised', alert })}
            onDraftChange={setDraft}
          />
          <CriticalAlertDialog
            alert={state.alert}
            justifications={draft.justifications}
            now={now}
            onClose={() => dispatch({ type: 'closeCriticalAlert' })}
            onJustify={(justifications) => {
              setDraft(withJustification(draft, justifications));
              dispatch({ type: 'justificationRecorded' });
            }}
            {...(offending === undefined
              ? {}
              : {
                  onRemoveOffendingItem: () => {
                    setDraft(removeItem(draft, offending));
                    dispatch({ type: 'offendingItemRemoved' });
                  },
                })}
          />
        </>
      );
    }

    case 'review':
      return account === null ? null : (
        <ReviewScreen
          chainId={services.config.chainId}
          draft={draft}
          now={now()}
          onBack={() => dispatch({ type: 'backToMedication' })}
          onConfirmSignature={() => dispatch({ type: 'confirmSignature' })}
          prescriber={account}
        />
      );

    case 'issuing':
      return <IssuingScreen completed={state.completed} />;

    case 'issued':
      return (
        <IssuedScreen
          chainId={services.config.chainId}
          onNewPrescription={onNewPrescription}
          onOpenPrescriptions={() => dispatch({ type: 'openPrescriptions' })}
          result={state.result}
        />
      );

    case 'rejected':
      return (
        <RejectionScreen
          onNewPrescription={onNewPrescription}
          onResumeEditing={() => dispatch({ type: 'resumeEditing' })}
          reason={state.reason}
        />
      );

    case 'prescriptions':
      return account === null ? null : (
        <PrescriptionsScreen
          list={services.list}
          onNewPrescription={onNewPrescription}
          prescriber={account}
        />
      );
  }
}

/**
 * The boundary around the one call that rethrows.
 *
 * `issue` answers with a result for every refusal the contract and the store
 * model, and rethrows anything else. An unmodelled error must not reach the
 * consulting room as a verdict, so it becomes `network-error`: an incomplete
 * issuance with an explicit instruction to hand nothing to the patient until
 * the receta shows as emitted.
 */
async function runIssue(call: () => Promise<IssueResult>): Promise<IssueResult> {
  try {
    return await call();
  } catch {
    return {
      outcome: 'rejected',
      reason: {
        code: 'network-error',
        message: 'La emisión no se pudo completar y no hay confirmación de la cadena.',
      },
    };
  }
}
