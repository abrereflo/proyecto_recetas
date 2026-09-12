import { ScreenShell } from '../components/ScreenShell';

/**
 * Between P4 and P5: the transaction is in flight.
 *
 * It has no cancel button on purpose. Once the write is sent, the chain decides
 * — an interface offering to call it back would be describing an operation the
 * contract does not have (docs/04, docs/17).
 */
export function DispensingScreen() {
  return (
    <ScreenShell status={<span className="badge badge--info">Registrando</span>}>
      <div className="stack stack--loose">
        <h1 className="title-screen">Registrando la entrega</h1>
        <p aria-live="polite" className="text-secondary" role="status">
          Se está registrando la dispensación en la cadena. Espere la confirmación antes de
          cerrar la aplicación.
        </p>
        <p className="text-muted">
          Confirme la solicitud en el dispositivo si se la pide. Si la rechaza, no se registra
          nada y la receta sigue pendiente de entrega.
        </p>
      </div>
    </ScreenShell>
  );
}
