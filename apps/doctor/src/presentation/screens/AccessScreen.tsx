import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from '@recetas/shared';
import type { CheckCredential } from '../../application/check-credential';
import { describeIssueRejection, type IssueRejection } from '../../domain/issuance';
import {
  SignerRejectedError,
  SignerUnavailableError,
  type SignerPort,
} from '../../ports/signer.port';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress } from '../format';

/**
 * D1 — Acceso.
 *
 * HARD RULE (docs/17, D1): nothing past this screen is reachable until the
 * credential check has answered. The control that opens the prescription form
 * is disabled by construction, not merely hidden, and no other control on this
 * screen leads anywhere.
 *
 * HARD RULE (docs/01, docs/17): "No aparece la palabra «wallet», ni frase
 * semilla, ni saldo." The doctor has a professional credential on a device.
 * They are not opening an account, they are not holding funds, and they have
 * nothing to write down and keep in a drawer. copy-guard.test.ts asserts the
 * absence of those words over this whole layer.
 *
 * HARD RULE (application/check-credential.ts): a registered credential is a
 * POINTER, not a verdict. The registry re-reads and re-validates the
 * attestation on every `issue`, so this screen says the credential is
 * REGISTERED and says out loud that its vigency is confirmed again at the
 * moment of each issuance. Promising "vigente" here would be a claim this check
 * cannot support.
 */

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
  const available = signer.isAvailable();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
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
  // doctor opens the application and finds the form ready.
  useEffect(() => {
    if (!available) return;
    void identify(false);
  }, [available, identify]);

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
        <div className="stack stack--tight">
          <h1 className="title-screen">Acceso del prescriptor</h1>
          <p className="text-secondary">
            Antes de escribir ninguna receta se comprueba que este equipo tiene registrada una
            credencial profesional en el registro de recetas.
          </p>
        </div>

        <dl className="kv">
          <dt>Equipo</dt>
          <dd className="mono">{account === null ? 'Sin identificar' : formatAddress(account)}</dd>
          <dt>Credencial profesional</dt>
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
          // issuance. This screen must not turn that into a promise.
          <p className="text-muted">
            La credencial está registrada en la cadena. Su vigencia se comprueba de nuevo en el
            momento de emitir cada receta.
          </p>
        )}

        {!available && (
          <div className="alert alert--warning" role="alert">
            <span aria-hidden="true" className="alert__icon">
              ⚠
            </span>
            <div>
              <p className="alert__title">Este equipo no tiene credencial profesional</p>
              <p className="alert__body">
                No se encontró ninguna credencial configurada en este navegador. Pida al
                responsable técnico de la clínica que la habilite en este equipo.
              </p>
            </div>
          </div>
        )}

        {problem !== null && (
          <div className="alert alert--danger" role="alert">
            <span aria-hidden="true" className="alert__icon">
              ✗
            </span>
            <div>
              <p className="alert__title">{problem.title}</p>
              <p className="alert__body">{problem.body}</p>
            </div>
          </div>
        )}

        <div className="stack">
          <button
            className="btn btn--primary btn--lg btn--block"
            // The structural half of the D1 rule: the only control that opens
            // the prescription form cannot be pressed until the check passed.
            disabled={status !== 'accredited' || account === null}
            onClick={() => {
              if (account !== null) onAccredited(account);
            }}
            type="button"
          >
            Escribir una receta
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

        {/* TODO (docs/01, D-04, docs/17 D1): the mockup shows this screen as a
            passkey prompt over an ERC-4337 smart account. The port boundary in
            ports/signer.port.ts is what keeps that swap a change to the signer
            adapter rather than to this screen. */}
        <p className="text-muted">
          La clave con la que firma no sale de este equipo y no se puede copiar ni enviar.
        </p>
      </div>
    </ScreenShell>
  );
}

function fromRejection(reason: IssueRejection): Problem {
  const message = describeIssueRejection(reason);
  return { title: message.headline, body: `${message.reason} ${message.action}` };
}

function fromSignerError(error: unknown, chainId: number): Problem {
  if (error instanceof SignerUnavailableError) {
    return {
      title: 'Este equipo no tiene credencial profesional',
      body:
        'No se encontró ninguna credencial configurada en este navegador. Pida al responsable ' +
        'técnico de la clínica que la habilite en este equipo.',
    };
  }

  if (error instanceof SignerRejectedError) {
    return {
      title: 'La comprobación fue cancelada en el equipo',
      body: 'Vuelva a pulsar «Comprobar credencial» y acepte la solicitud para continuar.',
    };
  }

  return {
    title: 'No se pudo comprobar la credencial',
    body:
      `El equipo debe estar conectado a la cadena ${chainId}, que es donde está registrado el ` +
      'sistema de recetas. Revise la conexión y vuelva a intentarlo.',
  };
}
