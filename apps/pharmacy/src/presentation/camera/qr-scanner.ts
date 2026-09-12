/**
 * The camera, behind an interface, so P2 can be driven in a test without a
 * device and so the zxing dependency stays in one file.
 *
 * HARD RULE (docs/17): a health application must never leave the camera hot.
 * `stop()` releases the scan loop AND the underlying media tracks; the screen
 * calls it on unmount, on error and after a successful read.
 */

export interface ScannerControls {
  /** Stops the decode loop and releases every track of the preview stream. */
  stop(): void;
  /**
   * Present only when the active video track reports torch support. The screen
   * uses its presence as the condition for showing the toggle at all, so no
   * control is ever offered that the device cannot honour.
   */
  setTorch?: ((on: boolean) => Promise<void>) | undefined;
}

export type ScannerStarter = (
  video: HTMLVideoElement,
  onText: (text: string) => void,
) => Promise<ScannerControls>;

/** Why the camera did not start, in terms the counter can act on. */
export type CameraProblemKind = 'denied' | 'absent' | 'busy' | 'unsupported' | 'unknown';

export interface CameraProblem {
  kind: CameraProblemKind;
  title: string;
  body: string;
}

const CAMERA_PROBLEMS: Record<CameraProblemKind, Omit<CameraProblem, 'kind'>> = {
  denied: {
    title: 'La cámara está bloqueada para esta aplicación',
    body:
      'El dispositivo tiene denegado el permiso de cámara. Ábralo en los ajustes del ' +
      'navegador, permita la cámara para este sitio y vuelva a entrar. Mientras tanto puede ' +
      'introducir el código a mano.',
  },
  absent: {
    title: 'Este dispositivo no tiene cámara disponible',
    body:
      'No se encontró ninguna cámara que pueda leer el código. Use un dispositivo con cámara ' +
      'trasera o introduzca el código a mano.',
  },
  busy: {
    title: 'La cámara está ocupada por otra aplicación',
    body:
      'Cierre la otra aplicación que está usando la cámara y vuelva a intentarlo. Mientras ' +
      'tanto puede introducir el código a mano.',
  },
  unsupported: {
    title: 'Este navegador no permite abrir la cámara',
    body:
      'La cámara solo está disponible sobre una conexión segura y en un navegador que la ' +
      'admita. Introduzca el código a mano para continuar.',
  },
  unknown: {
    title: 'No se pudo abrir la cámara',
    body: 'Vuelva a intentarlo o introduzca el código a mano para continuar.',
  },
};

export function describeCameraProblem(error: unknown): CameraProblem {
  const kind = cameraProblemKind(error);
  return { kind, ...CAMERA_PROBLEMS[kind] };
}

function cameraProblemKind(error: unknown): CameraProblemKind {
  const name = error instanceof Error ? error.name : '';

  switch (name) {
    // The person, or a device policy, said no. Retrying changes nothing.
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    // There is no camera, or none that satisfies the requested facing mode.
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'absent';
    // Another application holds the device.
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    default:
      return error instanceof CameraUnsupportedError ? 'unsupported' : 'unknown';
  }
}

/** `navigator.mediaDevices` is absent: an insecure origin, or an old browser. */
export class CameraUnsupportedError extends Error {
  constructor() {
    super('El navegador no expone ninguna cámara.');
    this.name = 'CameraUnsupportedError';
  }
}

/**
 * Torch is in neither `MediaTrackCapabilities` nor `MediaTrackConstraintSet`
 * in the DOM lib yet, and `getCapabilities` is itself absent on some engines.
 */
type TorchCapableTrack = Omit<MediaStreamTrack, 'getCapabilities'> & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

/** Releases every track of whatever stream the preview element is holding. */
export function releaseVideoTracks(video: HTMLVideoElement | null): void {
  if (video === null) return;

  // jsdom reports `undefined` rather than `null` for an element that never
  // received a stream, and a browser that never started one reports `null`.
  const stream = video.srcObject as MediaStream | null | undefined;
  if (stream != null && typeof stream.getTracks === 'function') {
    for (const track of stream.getTracks()) track.stop();
  }

  video.srcObject = null;
}

/**
 * The real camera, over `@zxing/browser`.
 *
 * `facingMode: 'environment'` is a preference, not a constraint, so a laptop
 * with only a front camera still works at a desk during a demo.
 */
export const startBrowserScanner: ScannerStarter = async (video, onText) => {
  if (globalThis.navigator?.mediaDevices === undefined) {
    throw new CameraUnsupportedError();
  }

  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();

  const controls = await reader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    video,
    (result) => {
      // zxing calls back on every frame, with `result` undefined while it sees
      // nothing. Only a decoded text is forwarded.
      const text = result?.getText();
      if (typeof text === 'string' && text.length > 0) onText(text);
    },
  );

  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0] as unknown as
    | TorchCapableTrack
    | undefined;
  const torchSupported = track?.getCapabilities?.().torch === true;

  return {
    stop() {
      controls.stop();
      releaseVideoTracks(video);
    },
    setTorch: torchSupported
      ? async (on: boolean) => {
          await track?.applyConstraints({
            advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
          });
        }
      : undefined,
  };
};
