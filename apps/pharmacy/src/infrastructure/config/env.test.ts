import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadPharmacyConfig, readPharmacyConfig } from './env';

/**
 * `VITE_PRESCRIPTION_REGISTRY_ADDRESS` is blank in env.example until
 * contracts/script/Deploy.s.sol runs, so a missing address has to be a value
 * the UI can render — never a crash while the bundle is loading.
 */

const VALID = {
  VITE_API_URL: 'http://localhost:3000',
  VITE_RPC_URL: 'http://localhost:8545',
  VITE_CHAIN_ID: '31337',
  VITE_PRESCRIPTION_REGISTRY_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
};

describe('a complete environment', () => {
  it('parses every variable into its own type', () => {
    expect(loadPharmacyConfig(VALID)).toEqual({
      apiUrl: 'http://localhost:3000',
      rpcUrl: 'http://localhost:8545',
      chainId: 31337,
      registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    });
  });

  it('strips trailing slashes from the API url so paths never double up', () => {
    const config = loadPharmacyConfig({ ...VALID, VITE_API_URL: 'http://localhost:3000///' });
    expect(config.apiUrl).toBe('http://localhost:3000');
  });
});

describe('a missing registry address', () => {
  it('is a typed, catchable error that names the variable', () => {
    const result = readPharmacyConfig({ ...VALID, VITE_PRESCRIPTION_REGISTRY_ADDRESS: '' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error).toBeInstanceOf(ConfigurationError);
    expect(result.error.variable).toBe('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
    expect(result.error.message).toContain('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
    expect(result.error.message).toContain('Deploy.s.sol');
  });

  it('is reported the same way when the variable is absent altogether', () => {
    const { VITE_PRESCRIPTION_REGISTRY_ADDRESS: _omitted, ...withoutAddress } = VALID;
    const result = readPharmacyConfig(withoutAddress);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error.variable).toBe('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
  });

  it('rejects a value that is not a 20-byte address', () => {
    const result = readPharmacyConfig({
      ...VALID,
      VITE_PRESCRIPTION_REGISTRY_ADDRESS: '0x1234',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error.variable).toBe('VITE_PRESCRIPTION_REGISTRY_ADDRESS');
  });
});

describe('the other variables', () => {
  it.each([
    ['VITE_API_URL', ''],
    ['VITE_RPC_URL', 'no-es-una-url'],
    ['VITE_CHAIN_ID', 'cero'],
    ['VITE_CHAIN_ID', '0'],
    ['VITE_CHAIN_ID', '-1'],
  ])('reports %s when it is %s', (variable, value) => {
    const result = readPharmacyConfig({ ...VALID, [variable]: value });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error.variable).toBe(variable);
  });

  it('reports the first gap only, so the message stays actionable', () => {
    const result = readPharmacyConfig({
      VITE_API_URL: '',
      VITE_RPC_URL: '',
      VITE_CHAIN_ID: '',
      VITE_PRESCRIPTION_REGISTRY_ADDRESS: '',
    });

    if (result.ok) throw new Error('expected a configuration error');
    expect(result.error.variable).toBe('VITE_API_URL');
  });
});

describe('the throwing variant', () => {
  it('throws a ConfigurationError rather than a bare Error', () => {
    expect(() => loadPharmacyConfig({ ...VALID, VITE_RPC_URL: '' })).toThrow(ConfigurationError);
  });
});
