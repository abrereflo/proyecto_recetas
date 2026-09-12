import { describe, expect, it } from 'vitest';
import { REGISTRY_ADDRESS } from '../../test/fixtures';
import { ConfigurationError, loadDoctorConfig, readDoctorConfig, type DoctorEnv } from './env';

/**
 * Configuration reading (root `env.example`).
 *
 * The rule this file exists for: validation NEVER throws during import.
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank until
 * contracts/script/Deploy.s.sol runs, and an app that crashes while loading its
 * own bundle cannot render the message explaining why.
 */

const COMPLETE: DoctorEnv = {
  VITE_API_URL: 'http://localhost:3000',
  VITE_RPC_URL: 'http://localhost:8545',
  VITE_CHAIN_ID: '31337',
  VITE_PRESCRIPTION_REGISTRY_ADDRESS: REGISTRY_ADDRESS,
};

describe('a complete environment', () => {
  it('parses into a typed configuration', () => {
    expect(loadDoctorConfig(COMPLETE)).toEqual({
      apiUrl: 'http://localhost:3000',
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
    });
  });

  it('drops a trailing slash from the store URL so no path is ever doubled', () => {
    const config = loadDoctorConfig({ ...COMPLETE, VITE_API_URL: 'http://localhost:3000/' });

    expect(config.apiUrl).toBe('http://localhost:3000');
  });
});

describe('an incomplete environment', () => {
  it('names the blank registry address, which is the expected state before deployment', () => {
    const result = readDoctorConfig({ ...COMPLETE, VITE_PRESCRIPTION_REGISTRY_ADDRESS: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.variable).toBe('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
    expect(result.error.message).toContain('Deploy.s.sol');
  });

  it('never throws: the screen gets a value it can branch on', () => {
    expect(() => readDoctorConfig({})).not.toThrow();
    expect(readDoctorConfig({}).ok).toBe(false);
  });

  it('throws a named ConfigurationError from the strict variant', () => {
    expect(() => loadDoctorConfig({})).toThrow(ConfigurationError);
  });

  it.each([
    ['VITE_API_URL', 'no es una url'],
    ['VITE_RPC_URL', 'tampoco'],
    ['VITE_CHAIN_ID', 'cero'],
    ['VITE_PRESCRIPTION_REGISTRY_ADDRESS', '0x1234'],
  ])('rejects an invalid %s and says which variable to fix', (variable, value) => {
    const result = readDoctorConfig({ ...COMPLETE, [variable]: value });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.variable).toBe(variable);
  });
});
