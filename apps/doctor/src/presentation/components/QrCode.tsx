import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * The real QR of screen D6.
 *
 * The mockup draws a `.qr-fake`, a CSS grid standing in for a code. That class
 * lives in design/mockups/board.css and stays there: a pattern that looks like
 * a QR and scans as nothing is the single worst thing this screen could render,
 * because it fails at the counter rather than here.
 *
 * Rendered as an inline SVG rather than a canvas on purpose. `toCanvas` and
 * `toDataURL` both need a real 2D context, which does not exist under the test
 * environment — so the one screen whose correctness is "the pharmacy can scan
 * this" would be the one screen no test could render. The SVG renderer is pure
 * JavaScript in both the browser and the Node build of `qrcode`, and it scales
 * to whatever the screen or the printer gives it.
 *
 * ERROR CORRECTION: level M. The payload already carries the decryption key, so
 * it is long; level H would grow the module count enough to hurt scanning on a
 * phone held over a screen, and this code is read once, indoors, from a display
 * rather than from a smudged print-out.
 */

export interface QrCodeProps {
  /** The encoded payload from `IssueResult.qr`. */
  value: string;
  /** Accessible name. The code itself is an image to a screen reader. */
  label: string;
}

export function QrCode({ value, label }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    void QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      .then((rendered) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    // Never a blank frame: a doctor who cannot see the code has to know that
    // the prescription IS issued and that the problem is this screen.
    return (
      <div className="alert alert--danger" role="alert">
        <span aria-hidden="true" className="alert__icon">
          ✗
        </span>
        <div>
          <p className="alert__title">No se pudo dibujar el código en esta pantalla</p>
          <p className="alert__body">
            La receta sí quedó registrada en la cadena. Recargue la página para volver a dibujar
            el código antes de cerrar esta pantalla.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-frame">
      {svg === null ? (
        <p className="text-muted">Generando el código…</p>
      ) : (
        <div
          aria-label={label}
          // The SVG comes from the `qrcode` renderer over a string this app
          // built itself; there is no external input to sanitise.
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
        />
      )}
    </div>
  );
}
