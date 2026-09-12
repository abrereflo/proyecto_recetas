import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { encodeQrPayload } from '@recetas/shared';
import { aQrPayload } from '../../test/fixtures';
import { ManualEntryScreen } from './ManualEntryScreen';

/** P8 — the camera contingency (docs/17), and the D-20 honesty rule. */

function renderScreen() {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(<ManualEntryScreen onCancel={onCancel} onSubmit={onSubmit} />);
  return { onSubmit, onCancel, user: userEvent.setup() };
}

function field(): HTMLElement {
  return screen.getByLabelText(/contenido del código de la receta/i);
}

describe('the pasted payload', () => {
  it('is parsed and handed to the same verification as a scanned code', async () => {
    const { onSubmit, user } = renderScreen();

    await user.click(field());
    await user.paste(encodeQrPayload(aQrPayload()));
    await user.click(screen.getByRole('button', { name: /verificar receta/i }));

    expect(onSubmit).toHaveBeenCalledWith(aQrPayload());
  });

  it('reports something that is not a prescription code without jargon', async () => {
    const { onSubmit, user } = renderScreen();

    await user.click(field());
    await user.paste('https://example.test/promo');
    await user.click(screen.getByRole('button', { name: /verificar receta/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent(/no es una receta de este sistema/i);
    expect(error.textContent).not.toMatch(/JSON|token|parse|schema|undefined/i);
  });

  it('tells a truncated paste apart from the wrong code entirely', async () => {
    const { user } = renderScreen();

    await user.click(field());
    await user.paste('{"v":1,"chainId":31337}');
    await user.click(screen.getByRole('button', { name: /verificar receta/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/incompleto/i);
  });

  it('asks for a value when the field is empty', async () => {
    const { onSubmit, user } = renderScreen();

    await user.click(screen.getByRole('button', { name: /verificar receta/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/pegue el contenido/i);
  });

  it('clears the error as soon as the pharmacist edits the field', async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole('button', { name: /verificar receta/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(field(), '{{');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('ties the label, the hint and the error to the control', async () => {
    const { user } = renderScreen();
    const control = field();

    expect(control).toHaveAccessibleName(/contenido del código de la receta/i);
    expect(control).toHaveAccessibleDescription(/pegue el contenido completo/i);

    await user.click(screen.getByRole('button', { name: /verificar receta/i }));

    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription(/pegue el contenido del código/i);
  });
});

describe('no screen promises offline operation (D-20)', () => {
  it('states that connectivity is required to verify uniqueness', () => {
    renderScreen();

    expect(screen.getByText(/se necesita conexión a internet/i)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/sin conexión no es posible comprobarlo/i);
  });

  it('never claims the application works without a network', () => {
    renderScreen();

    expect(document.body.textContent).not.toMatch(/funciona sin conexión|modo sin conexión/i);
  });
});

describe('it is a contingency, not a shortcut', () => {
  it('says the receta goes through the same checks', () => {
    renderScreen();

    expect(document.body.textContent).toMatch(/las mismas comprobaciones/i);
  });

  it('returns to the scanner without verifying anything', async () => {
    const { onCancel, onSubmit, user } = renderScreen();

    await user.click(screen.getByRole('button', { name: /volver al escáner/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
