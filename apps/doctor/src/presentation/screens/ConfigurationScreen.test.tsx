import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, readDoctorConfig } from '../../infrastructure/config/env';
import { ConfigurationScreen } from './ConfigurationScreen';

/**
 * The branch this application takes today.
 *
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol has run, so this screen is not a rare edge — it
 * is the first thing anyone sees, and it has to read as deliberate.
 */

const ERROR = new ConfigurationError(
  'VITE_PRESCRIPTION_REGISTRY_ADDRESS',
  'Falta la variable de entorno VITE_PRESCRIPTION_REGISTRY_ADDRESS.',
);

describe('a deployment that is not configured yet', () => {
  it('names the exact variable the operator has to set', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.getByText('VITE_PRESCRIPTION_REGISTRY_ADDRESS')).toBeVisible();
  });

  it('renders the message the configuration reader produced', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.getByRole('alert')).toHaveTextContent(ERROR.message);
  });

  it('says the fault is the deployment, not the prescription', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(document.body.textContent).toMatch(/no es un problema de la receta/i);
  });

  it('offers no way to write a prescription from here', () => {
    render(<ConfigurationScreen error={ERROR} />);

    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('the configuration reader never throws on import', () => {
  it('reports a blank registry address as a result the UI can branch on', () => {
    const result = readDoctorConfig({
      VITE_API_URL: 'http://localhost:3000',
      VITE_RPC_URL: 'http://localhost:8545',
      VITE_CHAIN_ID: '31337',
      VITE_PRESCRIPTION_REGISTRY_ADDRESS: '',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error.variable).toBe('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
  });
});
