import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@recetas/shared';
import { describeRejection, type RejectionReason } from '../../domain/rejection';
import type { CheckCredential } from '../../application/check-credential';
import { SignerRejectedError, SignerUnavailableError, type SignerPort } from '../../ports/signer.port';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress } from '../format';

/**
 * P1 — Acceso e instalación.
 *
 * HARD RULE (docs/17, P1): "La credencial de farmacia se comprueba antes de
 * habilitar el escáner." The scan button is therefore disabled by construction
 * until `checkCredential` has answered; it is not merely hidden, and no other
 * control on this screen opens the camera.
 *
 * HARD RULE (docs/01, docs/17): this screen never uses crypto-product
 * vocabulary. The pharmacist has a "credencial de farmacia" on a device, not an
 * account with a balance and a recovery phrase.
 *
 * HARD RULE (application/check-credential.ts): a registered credential is a
 * POINTER, not a verdict. The registry re-validates the attestation on every
 * `dispense`, so this screen says the credential is REGISTERED and says out
 * loud that vigency is confirmed at the moment of each delivery. Promising
 * "vigente" here would be a claim this check cannot support.
 */

/** The event Chromium fires when the app qualifies for installation. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export interface AccessScreenProps {
  signer: SignerPort;
  checkCredential: CheckCredential;
  /** The chain the registry is deployed on; the device is moved to it. */
  chainId: number;
  /** Dispatched only once the credential check has passed. */
  onAccredited(account: Address): void;
}

type AccessStatus = 'idle' | 'working' | 'accredited' | 'blocked';

interface Problem {
  title: string;
  body: string;
}

export function AccessScreen({ signer, checkCredential, chainId, onAccredited }: AccessScreenProps) {
  const [status, setStatus] = useState<AccessStatus>('idle');
  const [account, setAccount] = useState<Address | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const available = signer.isAvailable();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // docs/17: the pharmacy app is the only PWA of the two, because it is used
  // standing at a counter. The affordance appears only when the browser has
  // actually offered installation.
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const runCheck = useCallback(
    async (target: Address): Promise<void> => {
      const credential = await checkCredential({ account: target });
      if (!mounted.current) return;

      if (credential.accredited) {
        setStatus('accredited');
        setProblem(null);
        return;
      }

      setStatus('blocked');
      setProblem(fromRejection(credential.reason));
    },
    [checkCredential],
  );

  const identify = useCallback(
    async (connect: boolean): Promise<void> => {
      setStatus('working');
      setProblem(null);

      try {
        const known = connect ? await signer.connect() : await signer.getAccount();
        if (!mounted.current) return;

        if (known === null) {
          setStatus('idle');
          return;
        }

        setAccount(known);
        await signer.ensureChain(chainId);
        if (!mounted.current) return;

        await runCheck(known);
      } catch (error) {
        if (!mounted.current) return;
        setStatus('blocked');
        setProblem(fromSignerError(error, chainId));
      }
    },
    [chainId, runCheck, signer],
  );

  // An already-authorised device goes straight to the credential check, so the
  // pharmacist opens the app and finds the scanner ready.
  useEffect(() => {
    if (!available) return;
    void identify(false);
  }, [available, identify]);

  const install = async (): Promise<void> => {
    const event = installEvent;
    setInstallEvent(null);
    await event?.prompt();
  };

  return (
    <ScreenShell
      status={
        status === 'accredited' ? (
          <span className="badge badge--success">
            <span aria-hidden="true">✓</span> Credencial registrada
          </span>
        ) : (
          <span className="badge badge--neutral">Sin comprobar</span>
        )
      }
    >
      <div className="stack stack--loose">
        <div className="stack">
          <h1 className="title-screen">Acceso de farmacia</h1>
          <p className="text-secondary">
            Antes de escanear ninguna receta se comprueba que este dispositivo tiene una
            credencial de farmacia registrada en la cadena.
          </p>
        </div>

        <dl className="kv">
          <dt>Dispositivo</dt>
          <dd className="mono">{account === null ? 'Sin identificar' : formatAddress(account)}</dd>
          <dt>Credencial</dt>
          <dd>
            {status === 'accredited' ? (
              <span className="badge badge--success">
                <span aria-hidden="true">✓</span> Registrada
              </span>
            ) : status === 'blocked' ? (
              <span className="badge badge--danger">
                <span aria-hidden="true">✗</span> No disponible
              </span>
            ) : (
              <span className="badge badge--neutral">
                {status === 'working' ? 'Comprobando…' : 'Pendiente'}
              </span>
            )}
          </dd>
          <dt>Cadena</dt>
          <dd className="mono">{chainId}</dd>
        </dl>

        {status === 'accredited' && (
          // The distinction the core makes explicit: `credentialOf` returns a
          // pointer, and the contract re-reads the attestation on every
          // dispense. This screen must not turn that into a promise.
          <p className="text-muted">
            La credencial está registrada en la cadena. Su vigencia se comprueba de nuevo en el
            momento de registrar cada entrega.
          </p>
        )}

        {!available && (
          <div className="alert alert--warning" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              <p className="alert__title">Este dispositivo no tiene credencial de farmacia</p>
              <p className="alert__body">
                No se encontró ninguna credencial configurada en este navegador. Pida al
                responsable técnico de la farmacia que la habilite en este dispositivo.
              </p>
            </div>
          </div>
        )}

        {problem !== null && (
          <div className="alert alert--danger" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ✗
            </span>
            <div>
              <p className="alert__title">{problem.title}</p>
              <p className="alert__body">{problem.body}</p>
            </div>
          </div>
        )}

        {installEvent !== null && (
          <div className="alert alert--info">
            <span className="alert__icon" aria-hidden="true">
              ℹ
            </span>
            <div>
              <p className="alert__title">Instale la aplicación en la pantalla de inicio</p>
              <p className="alert__body">
                Se abre en un toque y la cámara queda lista sin pasar por el navegador.
              </p>
              <p className="alert__body">
                <button className="btn btn--ghost" onClick={() => void install()} type="button">
                  Añadir a la pantalla de inicio
                </button>
              </p>
            </div>
          </div>
        )}

        <div className="stack">
          <button
            className="btn btn--primary btn--lg btn--block"
            // The structural half of the P1 rule: the only control that opens
            // the camera cannot be pressed until the check has passed.
            disabled={status !== 'accredited' || account === null}
            onClick={() => {
              if (account !== null) onAccredited(account);
            }}
            type="button"
          >
            Escanear receta
          </button>

          {status !== 'accredited' && available && (
            <button
              className="btn btn--secondary btn--block"
              disabled={status === 'working'}
              onClick={() => void identify(true)}
              type="button"
            >
              {status === 'working' ? 'Comprobando credencial…' : 'Comprobar credencial'}
            </button>
          )}
        </div>

        {/* TODO (docs/17, P1): the mockup also offers manual entry here. It is
            reachable from P2 instead, because the flow machine only allows
            manual entry once the credential check has passed — the same gate
            the scanner is behind. */}
        <p className="text-muted">
          Si la cámara falla, la pantalla del escáner permite introducir el código a mano.
        </p>
      </div>
    </ScreenShell>
  );
}

function fromRejection(reason: RejectionReason): Problem {
  const message = describeRejection(reason);
  return { title: message.headline, body: `${message.reason} ${message.action}` };
}

function fromSignerError(error: unknown, chainId: number): Problem {
  if (error instanceof SignerUnavailableError) {
    return {
      title: 'Este dispositivo no tiene credencial de farmacia',
      body:
        'No se encontró ninguna credencial configurada en este navegador. Pida al responsable ' +
        'técnico de la farmacia que la habilite en este dispositivo.',
    };
  }

  if (error instanceof SignerRejectedError) {
    return {
      title: 'La comprobación fue cancelada en el dispositivo',
      body: 'Vuelva a pulsar «Comprobar credencial» y acepte la solicitud para continuar.',
    };
  }

  return {
    title: 'No se pudo comprobar la credencial',
    body:
      `El dispositivo debe estar conectado a la cadena ${chainId}, que es donde está ` +
      'registrado el sistema de recetas. Revise la conexión y vuelva a intentarlo.',
  };
}
