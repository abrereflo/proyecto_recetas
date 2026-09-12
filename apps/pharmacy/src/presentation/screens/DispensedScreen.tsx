import type { DispenseReceipt } from '../../ports/chain.port';
import { ScreenShell } from '../components/ScreenShell';
import { formatAddress, formatBlockNumber, formatDateTime, shortHash } from '../format';

/**
 * P5 — Dispensada.
 *
 * The receipt of an irreversible act, with the on-chain evidence that backs it:
 * transaction, block, block time and the pharmacy the chain recorded. Every
 * identifier is rendered in a monospaced face with tabular figures so two
 * values can be compared column by column (docs/17).
 *
 * HARD RULE (docs/04, docs/17): there is NO undo here, and there never will be.
 * The only onward action is the next prescription. The contract has no
 * operation that could back a reversal, so a button offering one would lie
 * about the single property that sustains the project.
 */

export interface DispensedScreenProps {
  contentHash: string;
  receipt: DispenseReceipt;
  onScanAnother(): void;
}

export function DispensedScreen({ contentHash, receipt, onScanAnother }: DispensedScreenProps) {
  return (
    <ScreenShell
      status={
        <span className="badge badge--success">
          <span aria-hidden="true">✓</span> Dispensada
        </span>
      }
    >
      <div className="stack stack--loose">
        <section className="verdict verdict--success" role="alert">
          <span className="verdict__mark" aria-hidden="true">
            ✓
          </span>
          <h1 className="verdict__headline">Entregada</h1>
          <p className="verdict__reason">
            La entrega quedó registrada en la cadena. Esta receta ya no puede volver a
            dispensarse en ninguna farmacia.
          </p>
        </section>

        <section className="card">
          <header className="card__header">
            <h2 className="title-section">Evidencia en cadena</h2>
            <span className="badge badge--success">Confirmada</span>
          </header>
          <dl className="kv">
            <dt>Fecha de la entrega</dt>
            <dd>{formatDateTime(receipt.blockTimestamp)}</dd>
            <dt>Farmacia</dt>
            <dd className="mono">{formatAddress(receipt.dispensedBy)}</dd>
            <dt>Bloque</dt>
            <dd className="mono">{formatBlockNumber(receipt.blockNumber)}</dd>
            <dt>Receta</dt>
            <dd className="mono">{shortHash(contentHash)}</dd>
            <dt>Transacción</dt>
            {/* The full hash, not the short form: this is the value someone
                pastes into a block explorer to check the claim. */}
            <dd className="mono">{receipt.transactionHash}</dd>
          </dl>
        </section>

        {/* TODO (docs/17, P5): the mockup also offers "Ver en el explorador".
            It needs a block-explorer base URL, which PharmacyConfig does not
            carry yet; inventing one would produce a dead link at the counter. */}

        {/* There is no undo button, and there never will be: see the module
            comment. `Escanear otra receta` moves on to the NEXT prescription;
            it does not reopen this one. */}
        <button className="btn btn--primary btn--lg btn--block" onClick={onScanAnother} type="button">
          Escanear otra receta
        </button>
      </div>
    </ScreenShell>
  );
}
