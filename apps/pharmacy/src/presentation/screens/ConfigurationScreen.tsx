import type { ConfigurationError } from '../../infrastructure/config/env';
import { ScreenShell } from '../components/ScreenShell';

/**
 * The screen for a deployment that is not configured yet.
 *
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol has run, so this path IS reachable today. It
 * has to look deliberate rather than broken: it names the exact variable the
 * operator must set, and it makes clear that the fault is in the deployment,
 * not in the receta the pharmacist is holding.
 *
 * The application never verifies anything from this state, because a pharmacy
 * pointed at no registry could only produce answers it has no evidence for.
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
            Este dispositivo todavía no sabe a qué registro de recetas debe conectarse, así que no
            puede verificar ninguna receta. No es un problema de la receta ni de la cámara.
          </p>
        </div>

        <div className="alert alert--warning" role="alert">
          <span className="alert__icon" aria-hidden="true">
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
          Entregue este dato al responsable técnico de la farmacia. La aplicación quedará
          operativa en cuanto la variable esté definida y se recargue la página.
        </p>
      </div>
    </ScreenShell>
  );
}
