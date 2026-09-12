import { useEffect, useRef, useState } from 'react';
import type { QrPayload } from '@recetas/shared';
import {
  describeCameraProblem,
  releaseVideoTracks,
  startBrowserScanner,
  type CameraProblem,
  type ScannerControls,
  type ScannerStarter,
} from '../camera/qr-scanner';
import { readQrPayload } from '../qr-payload';

/**
 * P2 — Escáner.
 *
 * HARD RULE (docs/17, P2): "Pantalla completa, sin adornos. La cámara es toda
 * la interfaz." There is deliberately no `ScreenShell` and no app bar here:
 * a bar floating over a viewfinder costs the only thing this screen is for.
 *
 * HARD RULE (docs/17): a health application must never leave the camera hot.
 * The cleanup below runs on unmount, on error and after a successful read, and
 * it stops the decode loop AND every media track, because stopping only the
 * loop leaves the device light on.
 *
 * The camera contingency (P8) is visible from the start, not hidden behind a
 * failure: the risk plan already assumes the camera fails in the room.
 */

export interface ScannerScreenProps {
  onCapture(qr: QrPayload): void;
  onManualEntry(): void;
  /** Injected in tests; the real one lives in ../camera/qr-scanner.ts. */
  startScanner?: ScannerStarter;
}

export function ScannerScreen({
  onCapture,
  onManualEntry,
  startScanner = startBrowserScanner,
}: ScannerScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const capturedRef = useRef(false);
  const [cameraProblem, setCameraProblem] = useState<CameraProblem | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    let disposed = false;
    const video = videoRef.current;

    const stopEverything = (): void => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      // Belt and braces: whatever the reader does with its own controls, the
      // tracks this element holds are released here too.
      releaseVideoTracks(video);
    };

    const begin = async (): Promise<void> => {
      if (video === null) return;

      try {
        const controls = await startScanner(video, (text) => {
          // zxing fires per frame. One code, one navigation.
          if (capturedRef.current) return;

          const read = readQrPayload(text);
          if (!read.ok) {
            setUnreadable(read.problem);
            return;
          }

          capturedRef.current = true;
          stopEverything();
          onCapture(read.qr);
        });

        if (disposed) {
          controls.stop();
          releaseVideoTracks(video);
          return;
        }

        controlsRef.current = controls;
        setTorchAvailable(controls.setTorch !== undefined);
      } catch (error) {
        if (disposed) return;
        stopEverything();
        setCameraProblem(describeCameraProblem(error));
      }
    };

    void begin();

    return () => {
      disposed = true;
      stopEverything();
    };
  }, [onCapture, startScanner]);

  const toggleTorch = async (): Promise<void> => {
    const next = !torchOn;
    setTorchOn(next);
    await controlsRef.current?.setTorch?.(next);
  };

  return (
    <div className="app-shell">
      {cameraProblem === null ? (
        <div className="scanner scanner--fullscreen">
          <video
            aria-label="Vista de la cámara para leer el código de la receta"
            className="scanner__video"
            muted
            playsInline
            ref={videoRef}
          />
          <div className="scanner__frame" />
          <span className="scanner__hint">Encuadre el código de la receta</span>
        </div>
      ) : (
        <div className="app-main app-main--narrow">
          <div className="alert alert--warning" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              <p className="alert__title">{cameraProblem.title}</p>
              <p className="alert__body">{cameraProblem.body}</p>
            </div>
          </div>
        </div>
      )}

      <div className="stack" style={{ padding: 'var(--space-4)' }}>
        <p aria-live="polite" className="sr-only">
          {unreadable ?? ''}
        </p>

        {unreadable !== null && (
          <div className="alert alert--danger" role="alert">
            <span className="alert__icon" aria-hidden="true">
              ✗
            </span>
            <div>
              <p className="alert__title">Código no reconocido</p>
              <p className="alert__body">{unreadable}</p>
            </div>
          </div>
        )}

        {torchAvailable && (
          <button
            aria-pressed={torchOn}
            className="btn btn--secondary btn--block"
            onClick={() => void toggleTorch()}
            type="button"
          >
            <span aria-hidden="true">{torchOn ? '☀' : '☾'}</span>
            {torchOn ? 'Apagar la luz' : 'Encender la luz'}
          </button>
        )}

        <button className="btn btn--secondary btn--block" onClick={onManualEntry} type="button">
          Ingresar código manualmente
        </button>
      </div>
    </div>
  );
}
