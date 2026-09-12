import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../infrastructure/config/env';
import { ConfigurationScreen } from './ConfigurationScreen';

/**
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until the deploy script has
 * run, so this screen IS the one the app shows today. It has to look
 * deliberate.
 */

const ERROR = new ConfigurationError(
  'VITE_PRESCRIPTION_REGISTRY_ADDRESS',
  'Falta la variable de entorno VITE_PRESCRIPTION_REGISTRY_ADDRESS. Debe ser la dirección del ' +
    'contrato PrescriptionRegistry ya desplegado.',
);

describe('a deployment that is not configured yet', () => {
  it('names the exact variable the operator has to set', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.getByText('VITE_PRESCRIPTION_REGISTRY_ADDRESS')).toBeInTheDocument();
  });

  it('renders the message the configuration layer wrote, verbatim', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.getByRole('alert')).toHaveTextContent(ERROR.message);
  });

  it('makes clear the fault is in the deployment, not in the receta', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(document.body.textContent).toMatch(/no es un problema de la receta/i);
  });

  it('offers no way to verify anything from here', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
