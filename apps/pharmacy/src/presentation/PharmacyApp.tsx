import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Address, Bytes32 } from '@recetas/shared';
import type { RejectionReason } from '../domain/rejection';
import type { PharmacyServices } from './composition/pharmacy-services';
import {
  INITIAL_FLOW_STATE,
  pharmacyFlowReducer,
  type FlowState,
} from './flow/pharmacy-flow';
import { AccessScreen } from './screens/AccessScreen';
import { AlreadyDispensedScreen } from './screens/AlreadyDispensedScreen';
import { DeviceKeyScreen } from './screens/DeviceKeyScreen';
import { DispensedScreen } from './screens/DispensedScreen';
import { DispensingScreen } from './screens/DispensingScreen';
import { ManualEntryScreen } from './screens/ManualEntryScreen';
import { RejectionScreen } from './screens/RejectionScreen';
import { ScannerScreen } from './screens/ScannerScreen';
import { VerifiedPrescriptionScreen } from './screens/VerifiedPrescriptionScreen';
import { VerifyingScreen } from './screens/VerifyingScreen';
import type { ScannerStarter } from './camera/qr-scanner';

/**
 * The shell: flow machine plus screen switch, and the two async effects the
 * flow owns.
 *
 * Navigation is the reducer in ./flow/pharmacy-flow.ts and nothing else — no
 * router, nothing in the URL. See that file for the reason: the QR payload
 * carries the decryption key, and docs/17 forbids it ever reaching an address
 * bar or a shareable link.
 *
 * `verify` and `checkCredential` never throw; `dispense` returns a result for
 * every modelled revert but RETHROWS anything nobody modelled, so the call
 * below is wrapped. An unmodelled failure is reported as an incomplete
 * operation, never dressed up as a verdict about the receta (docs/17).
 */

export interface PharmacyAppProps {
  services: PharmacyServices;
  /** Injected in tests so P2 can run without a camera. */
  startScanner?: ScannerStarter;
}

export function PharmacyApp({ services, startScanner }: PharmacyAppProps) {
  const [state, dispatch] = useReducer(pharmacyFlowReducer, INITIAL_FLOW_STATE);
  const [account, setAccount] = useState<Address | null>(null);
  // docs/23: on the device-key path the key has to be opened before P1 can ask
  // the chain anything. `true` on the injected-provider path, where there is no
  // key to open, so that path renders exactly what it rendered before.
  const [deviceKeyOpen, setDeviceKeyOpen] = useState(
    () => services.deviceKey === undefined || services.deviceKey.isUnlocked(),
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { verify, dispense } = services;

  // --- P3: the verification, started by entering 'verifying' ---------------
  const verifyingQr = state.status === 'verifying' ? state.qr : null;

  useEffect(() => {
    if (verifyingQr === null) return;
    let cancelled = false;

    void (async () => {
      const outcome = await verify({ qr: verifyingQr });
      if (cancelled || !mounted.current) return;

      if (outcome.outcome === 'dispensable') {
        dispatch({
          type: 'verificationSucceeded',
          document: outcome.document,
          record: outcome.record,
          checks: outcome.checks,
        });
        return;
      }

      dispatch({
        type: 'verificationRejected',
        reason: outcome.reason,
        checks: outcome.checks,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [verify, verifyingQr]);

  // --- P4 -> P5: the single irreversible write -----------------------------
  // Reached ONLY from 'dispensing', which the reducer enters ONLY on
  // `confirmDelivery`. Verification can never fall through into this effect.
  const dispensing = state.status === 'dispensing' ? state : null;

  useEffect(() => {
    if (dispensing === null || account === null) return;
    let cancelled = false;

    void (async () => {
      const result = await runDispense(
        () =>
          dispense({
            contentHash: dispensing.qr.contentHash as Bytes32,
            pharmacy: account,
            expiresAt: dispensing.record.expiresAt,
          }),
      );
      if (cancelled || !mounted.current) return;

      switch (result.outcome) {
        case 'dispensed':
          dispatch({ type: 'dispenseSucceeded', receipt: result.receipt });
          return;
        case 'aborted':
          dispatch({ type: 'dispenseAborted' });
          return;
        case 'rejected':
          dispatch({ type: 'dispenseRejected', reason: result.reason });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account, dispense, dispensing]);

  const onAccredited = useCallback((accredited: Address) => {
    setAccount(accredited);
    dispatch({ type: 'credentialAccepted', account: accredited });
  }, []);

  const onCapture = useCallback((qr: Parameters<typeof verify>[0]['qr']) => {
    dispatch({ type: 'qrCaptured', qr });
  }, []);

  // The account is deliberately NOT taken from here: P1 re-reads it from the
  // port and runs its own credential check, so the device-key path and the
  // injected-provider path reach 'accredited' through exactly the same code.
  const onDeviceKeyOpened = useCallback(() => setDeviceKeyOpen(true), []);

  return renderScreen(state, {
    services,
    startScanner,
    dispatch,
    onAccredited,
    onCapture,
    deviceKeyOpen,
    onDeviceKeyOpened,
  });
}

interface ScreenDeps {
  services: PharmacyServices;
  startScanner?: ScannerStarter | undefined;
  dispatch: React.Dispatch<Parameters<typeof pharmacyFlowReducer>[1]>;
  onAccredited(account: Address): void;
  onCapture(qr: Parameters<PharmacyServices['verify']>[0]['qr']): void;
  /** docs/23. Always true when there is no device key to open. */
  deviceKeyOpen: boolean;
  onDeviceKeyOpened(): void;
}

function renderScreen(state: FlowState, deps: ScreenDeps) {
  const { services, startScanner, dispatch, onAccredited, onCapture } = deps;

  switch (state.status) {
    case 'access':
      // P0 before P1, and only on the device-key path (docs/23). The flow
      // machine knows nothing about it: unlocking is not a navigation step, it
      // is a precondition of the one screen that needs an account.
      if (services.deviceKey !== undefined && !deps.deviceKeyOpen) {
        return (
          <DeviceKeyScreen deviceKey={services.deviceKey} onUnlocked={deps.onDeviceKeyOpened} />
        );
      }

      return (
        <AccessScreen
          chainId={services.config.chainId}
          checkCredential={services.checkCredential}
          onAccredited={onAccredited}
          signer={services.signer}
        />
      );

    case 'scanner':
      return (
        <ScannerScreen
          onCapture={onCapture}
          onManualEntry={() => dispatch({ type: 'openManualEntry' })}
          {...(startScanner === undefined ? {} : { startScanner })}
        />
      );

    case 'manual-entry':
      return (
        <ManualEntryScreen
          onCancel={() => dispatch({ type: 'closeManualEntry' })}
          onSubmit={onCapture}
          problem={state.problem}
        />
      );

    case 'verifying':
      return <VerifyingScreen checks={state.checks} contentHash={state.qr.contentHash} />;

    case 'verified':
      return (
        <VerifiedPrescriptionScreen
          contentHash={state.qr.contentHash}
          document={state.document}
          onCancel={() => dispatch({ type: 'cancelDelivery' })}
          onConfirm={() => dispatch({ type: 'confirmDelivery' })}
          record={state.record}
        />
      );

    case 'dispensing':
      return <DispensingScreen />;

    case 'dispensed':
      return (
        <DispensedScreen
          contentHash={state.contentHash}
          onScanAnother={() => dispatch({ type: 'scanAnother' })}
          receipt={state.receipt}
        />
      );

    case 'rejected':
      // P6 is its own screen because `already-dispensed` is the verdict the
      // product exists for and it renders evidence no other code carries
      // (docs/17). Every other code goes through the single P7 component.
      return state.reason.code === 'already-dispensed' ? (
        <AlreadyDispensedScreen
          onScanAnother={() => dispatch({ type: 'scanAnother' })}
          reason={state.reason}
        />
      ) : (
        <RejectionScreen
          checks={state.checks}
          onScanAnother={() => dispatch({ type: 'scanAnother' })}
          reason={state.reason}
        />
      );
  }
}

type DispenseOutcome = Awaited<ReturnType<PharmacyServices['dispense']>>;

/**
 * The boundary around the one call that rethrows.
 *
 * `dispense` answers with a result for every revert the contract models and
 * rethrows anything else. An unmodelled error must not reach the counter as a
 * verdict, so it becomes `network-error`: an incomplete operation with an
 * explicit instruction to check the state before trying again.
 */
async function runDispense(call: () => Promise<DispenseOutcome>): Promise<DispenseOutcome> {
  try {
    return await call();
  } catch {
    const reason: RejectionReason = {
      code: 'network-error',
      message:
        'La entrega no se pudo registrar y no hay confirmación de la cadena. Vuelva a ' +
        'escanear la receta para comprobar su estado antes de entregar nada.',
    };
    return { outcome: 'rejected', reason };
  }
}
