import { useEffect, useId, useRef, useState } from 'react';
import type { Address } from '@recetas/shared';
import type { DeviceKeyPort } from '../../ports/device-key.port';
import { ScreenShell } from '../components/ScreenShell';

/**
 * P0 — Desbloqueo del dispositivo.
 *
 * The screen that exists ONLY when the pharmacy signs with a key this device
 * holds (docs/23-firma-en-el-dispositivo.md). It sits before P1 and changes
 * nothing about it: once the key is open, the access screen runs exactly the
 * credential check it always ran, and the eight screens of docs/17 are
 * untouched.
 *
 * HARD RULE (docs/01, docs/17): no crypto-product vocabulary. What the person
 * has is a "clave de firma" on a device, protected by a "contraseña".
 *
 * HARD RULE (docs/08, docs/23): this screen must say out loud where the key
 * ends up and what kind of account may be used here. A person who pastes a key
 * without reading that has been misled by the interface, not by themselves.
 */

/** Mirrors MINIMUM_PASSPHRASE_LENGTH; the keystore refuses anything shorter. */
const MINIMUM_PASSPHRASE_LENGTH = 12;

export interface DeviceKeyScreenProps {
  deviceKey: DeviceKeyPort;
  /** Dispatched once the key is open; carries the account it derives. */
  onUnlocked(account: Address): void;
}

export function DeviceKeyScreen({ deviceKey, onUnlocked }: DeviceKeyScreenProps) {
  const fieldId = useId();
  const [stored, setStored] = useState(() => deviceKey.hasKey());
  const [signingKey, setSigningKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmingErase, setConfirmingErase] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearFields = (): void => {
    // The pasted key leaves React state the moment it is no longer needed.
    setSigningKey('');
    setPassphrase('');
    setConfirmation('');
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (working) return;

    if (!stored) {
      if (passphrase.length < MINIMUM_PASSPHRASE_LENGTH) {
        setProblem(`La contraseña debe tener al menos ${MINIMUM_PASSPHRASE_LENGTH} caracteres.`);
        return;
      }
      if (passphrase !== confirmation) {
        setProblem('Las dos contraseñas no coinciden. Vuelva a escribirlas.');
        return;
      }
    }

    setProblem(null);
    setWorking(true);

    void (async () => {
      try {
        const account = stored
          ? await deviceKey.unlock(passphrase)
          : await deviceKey.enrol(signingKey.trim(), passphrase);

        if (!mounted.current) return;
        clearFields();
        setWorking(false);
        onUnlocked(account);
      } catch (error) {
        if (!mounted.current) return;
        setWorking(false);
        setProblem(describe(error));
      }
    })();
  };

  const erase = (): void => {
    deviceKey.forget();
    setConfirmingErase(false);
    setProblem(null);
    clearFields();
    setStored(deviceKey.hasKey());
  };

  return (
    <ScreenShell status={<span className="badge badge--neutral">Sin desbloquear</span>}>
      <form className="stack stack--loose" onSubmit={submit}>
        <div className="stack stack--tight">
          <h1 className="title-screen">
            {stored ? 'Desbloquear el acceso de la farmacia' : 'Configurar el acceso de la farmacia'}
          </h1>
          <p className="text-secondary">
            {stored
              ? 'Este dispositivo ya tiene guardada la clave de firma de la farmacia, cifrada ' +
                'con una contraseña. Introdúzcala para comprobar la credencial y abrir el escáner.'
              : 'Este dispositivo todavía no puede firmar. Pegue una sola vez la clave de firma ' +
                'de la farmacia y elija una contraseña: la clave se guarda cifrada y solo se ' +
                'abre cuando se escribe esa contraseña.'}
          </p>
        </div>

        {!stored && (
          <>
            <div className="alert alert--warning">
              <span className="alert__icon" aria-hidden="true">
                ⚠
              </span>
              <div>
                <p className="alert__title">La clave se guarda cifrada en este dispositivo</p>
                <p className="alert__body">
                  No se envía a ningún servidor, pero quien tenga este dispositivo y la contraseña
                  puede firmar en nombre de la farmacia. Use únicamente una cuenta de prueba:
                  nunca una cuenta con fondos reales.
                </p>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${fieldId}-key`}>
                Clave de firma de la farmacia
              </label>
              <input
                aria-describedby={`${fieldId}-key-hint`}
                autoComplete="off"
                className="field__control mono"
                id={`${fieldId}-key`}
                onChange={(event) => {
                  setSigningKey(event.target.value);
                  setProblem(null);
                }}
                type="password"
                value={signingKey}
              />
              <span className="field__hint" id={`${fieldId}-key-hint`}>
                Se pega una sola vez. Después de guardarla no vuelve a mostrarse en la pantalla.
              </span>
            </div>
          </>
        )}

        <div className="field">
          <label className="field__label" htmlFor={`${fieldId}-passphrase`}>
            Contraseña de este dispositivo
          </label>
          <input
            aria-describedby={`${fieldId}-passphrase-hint`}
            autoComplete={stored ? 'current-password' : 'new-password'}
            className="field__control"
            id={`${fieldId}-passphrase`}
            onChange={(event) => {
              setPassphrase(event.target.value);
              setProblem(null);
            }}
            type="password"
            value={passphrase}
          />
          <span className="field__hint" id={`${fieldId}-passphrase-hint`}>
            {stored
              ? 'Es la contraseña que se eligió al configurar este dispositivo.'
              : `Al menos ${MINIMUM_PASSPHRASE_LENGTH} caracteres. No se puede recuperar: si se ` +
                'olvida, hay que configurar el dispositivo otra vez con la clave de firma.'}
          </span>
        </div>

        {!stored && (
          <div className="field">
            <label className="field__label" htmlFor={`${fieldId}-confirmation`}>
              Repita la contraseña
            </label>
            <input
              autoComplete="new-password"
              className="field__control"
              id={`${fieldId}-confirmation`}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setProblem(null);
              }}
              type="password"
              value={confirmation}
            />
          </div>
        )}

        {problem !== null && (
          <div className="alert alert--danger" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ✗
            </span>
            <div>
              <p className="alert__title">No se pudo abrir la clave de este dispositivo</p>
              <p className="alert__body">{problem}</p>
            </div>
          </div>
        )}

        <div className="stack">
          <button className="btn btn--primary btn--lg btn--block" disabled={working} type="submit">
            {stored
              ? working
                ? 'Desbloqueando…'
                : 'Desbloquear'
              : working
                ? 'Guardando…'
                : 'Guardar y continuar'}
          </button>

          {stored &&
            (confirmingErase ? (
              <div className="alert alert--warning">
                <span className="alert__icon" aria-hidden="true">
                  ⚠
                </span>
                <div className="stack stack--tight">
                  <p className="alert__title">¿Borrar la clave guardada en este dispositivo?</p>
                  <p className="alert__body">
                    Para volver a usar este dispositivo habrá que pegar la clave de firma otra
                    vez. Lo que ya está registrado en la cadena no cambia.
                  </p>
                  <div className="row">
                    <button
                      className="btn btn--danger"
                      onClick={erase}
                      type="button"
                    >
                      Sí, borrar la clave
                    </button>
                    <button
                      className="btn btn--ghost"
                      onClick={() => setConfirmingErase(false)}
                      type="button"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                className="btn btn--ghost btn--block"
                onClick={() => setConfirmingErase(true)}
                type="button"
              >
                Borrar la clave de este dispositivo
              </button>
            ))}
        </div>
      </form>
    </ScreenShell>
  );
}

/**
 * Every error this screen can receive already carries a sentence written for
 * the counter: the keystore and the signer adapter own that vocabulary. The
 * fallback covers only the genuinely unexpected.
 */
function describe(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;

  return (
    'No se pudo abrir la clave de firma de este dispositivo. Vuelva a intentarlo y, si ' +
    'continúa, configure el dispositivo otra vez.'
  );
}
