import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { encodeQrPayload } from '@recetas/shared';
import { aQrPayload } from '../../test/fixtures';
import type { ScannerControls, ScannerStarter } from '../camera/qr-scanner';
import { ScannerScreen } from './ScannerScreen';

/**
 * P2 — the camera is the whole interface (docs/17), and it must never be left
 * running. The camera itself is injected, so these are behaviour tests rather
 * than a mock of zxing.
 */

interface FakeCamera {
  starter: ScannerStarter;
  /** Every track the fake stream handed to the element. */
  track: { stop: ReturnType<typeof vi.fn>; kind: string };
  controls: ScannerControls & { stop: ReturnType<typeof vi.fn> };
  emit(text: string): void;
}

function fakeCamera(options: { torch?: boolean } = {}): FakeCamera {
  const track = { stop: vi.fn(), kind: 'video' };
  const controls = {
    stop: vi.fn(),
    ...(options.torch === true ? { setTorch: vi.fn(async () => undefined) } : {}),
  } as ScannerControls & { stop: ReturnType<typeof vi.fn> };

  let emit: (text: string) => void = () => undefined;

  const starter: ScannerStarter = async (video, onText) => {
    // What a real reader does: it attaches the live stream to the element.
    // The screen is responsible for releasing it.
    (video as unknown as { srcObject: unknown }).srcObject = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
    emit = onText;
    return controls;
  };

  return { starter, track, controls, emit: (text) => emit(text) };
}

function failingCamera(name: string): ScannerStarter {
  return async () => {
    const error = new Error('camera');
    error.name = name;
    throw error;
  };
}

describe('the camera is released', () => {
  // docs/17: a health application must never leave the camera hot.
  it('stops the video track when the screen unmounts', async () => {
    const camera = fakeCamera();
    const { unmount } = render(
      <ScannerScreen onCapture={vi.fn()} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(camera.controls.stop).not.toHaveBeenCalled());
    unmount();

    expect(camera.track.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the decode loop as well as the track', async () => {
    const camera = fakeCamera();
    const { unmount } = render(
      <ScannerScreen onCapture={vi.fn()} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    unmount();

    expect(camera.controls.stop).toHaveBeenCalled();
  });

  it('stops the camera as soon as a code is read', async () => {
    const camera = fakeCamera();
    const onCapture = vi.fn();
    render(
      <ScannerScreen onCapture={onCapture} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    act(() => camera.emit(encodeQrPayload(aQrPayload())));

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(camera.track.stop).toHaveBeenCalled();
  });
});

describe('reading a code', () => {
  it('hands the parsed payload to the flow exactly once', async () => {
    const camera = fakeCamera();
    const onCapture = vi.fn();
    render(
      <ScannerScreen onCapture={onCapture} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    const payload = encodeQrPayload(aQrPayload());
    act(() => camera.emit(payload));
    act(() => camera.emit(payload));

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture).toHaveBeenCalledWith(aQrPayload());
  });

  it('keeps scanning and explains itself when the code is not a prescription', async () => {
    const camera = fakeCamera();
    const onCapture = vi.fn();
    render(
      <ScannerScreen onCapture={onCapture} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    act(() => camera.emit('https://example.test/promo'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no es una receta/i));
    expect(onCapture).not.toHaveBeenCalled();
    expect(camera.track.stop).not.toHaveBeenCalled();
  });
});

describe('the escape hatch is always visible', () => {
  it('offers manual entry without waiting for the camera to fail', async () => {
    const camera = fakeCamera();
    const onManualEntry = vi.fn();
    const user = userEvent.setup();
    render(
      <ScannerScreen
        onCapture={vi.fn()}
        onManualEntry={onManualEntry}
        startScanner={camera.starter}
      />,
    );

    await user.click(screen.getByRole('button', { name: /ingresar código manualmente/i }));

    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });
});

describe('the camera can refuse in several ways, and each one says something different', () => {
  it.each([
    ['NotAllowedError', /bloqueada para esta aplicación/i],
    ['NotFoundError', /no tiene cámara disponible/i],
    ['NotReadableError', /ocupada por otra aplicación/i],
  ])('explains %s in terms the counter can act on', async (name, expected) => {
    render(
      <ScannerScreen
        onCapture={vi.fn()}
        onManualEntry={vi.fn()}
        startScanner={failingCamera(name)}
      />,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(expected));
  });

  it('still offers manual entry after a camera failure', async () => {
    render(
      <ScannerScreen
        onCapture={vi.fn()}
        onManualEntry={vi.fn()}
        startScanner={failingCamera('NotAllowedError')}
      />,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(
      screen.getByRole('button', { name: /ingresar código manualmente/i }),
    ).toBeInTheDocument();
  });
});

describe('the torch', () => {
  it('is offered only when the device reports support for it', async () => {
    const withTorch = fakeCamera({ torch: true });
    render(
      <ScannerScreen onCapture={vi.fn()} onManualEntry={vi.fn()} startScanner={withTorch.starter} />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /encender la luz/i })).toBeInTheDocument(),
    );
  });

  it('is hidden when the device does not support it', async () => {
    const withoutTorch = fakeCamera();
    render(
      <ScannerScreen
        onCapture={vi.fn()}
        onManualEntry={vi.fn()}
        startScanner={withoutTorch.starter}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /luz/i })).not.toBeInTheDocument();
  });
});

describe('the camera owns the screen', () => {
  it('renders no app bar over the viewfinder', async () => {
    const camera = fakeCamera();
    const { container } = render(
      <ScannerScreen onCapture={vi.fn()} onManualEntry={vi.fn()} startScanner={camera.starter} />,
    );

    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    expect(container.querySelector('.app-bar')).toBeNull();
  });
});
