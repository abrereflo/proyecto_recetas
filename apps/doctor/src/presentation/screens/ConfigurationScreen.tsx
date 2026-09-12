import type { ConfigurationError } from '../../infrastructure/config/env';
import { ScreenShell } from '../components/ScreenShell';

/**
 * The screen for a deployment that is not configured yet.
 *
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol has run, so this path IS the branch the
 * application takes today. It has to read as deliberate rather than broken: it
 * names the exact variable the operator must set, and it makes clear that
 * nothing about the consultation or the patient is at fault.
 *
 * No prescription can be written from this state. An application pointed at no
 * registry could assemble a document, encrypt it and even sign it, and then
 * have nowhere to anchor it — which would leave the doctor holding a code the
 * pharmacy can never verify.
 */

export interface ConfigurationScreenProps {
  error: ConfigurationError;
}

export function ConfigurationScreen({ error }: ConfigurationScreenProps) {
  return (
    <ScreenShell status={<span className="badge badge--warning">Sin configurar</span>}>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1 className="title-screen">Aplicación sin configurar</h1>
          <p className="text-secondary">
            Este equipo todavía no sabe en qué registro debe inscribir las recetas, así que no
            puede emitir ninguna. No es un problema de la receta que iba a escribir.
          </p>
        </div>

        <div className="alert alert--warning" role="alert">
          <span aria-hidden="true" className="alert__icon">
            ⚠
          </span>
          <div>
            <p className="alert__title">Falta una variable de entorno</p>
            <p className="alert__body">{error.message}</p>
          </div>
        </div>

        <dl className="kv">
          <dt>Variable</dt>
          <dd className="mono">{error.variable}</dd>
        </dl>

        <p className="text-muted">
          Entregue este dato al responsable técnico de la clínica. La aplicación quedará operativa
          en cuanto la variable esté definida y se recargue la página.
        </p>
      </div>
    </ScreenShell>
  );
}
