import { describe, expect, it } from 'vitest';

import { doctorAccount, isLocalChain, pharmacyAccount, type CliConfig } from './config';

/**
 * The demo keys checked into `config.ts` are the public Anvil accounts: they
 * ship inside every Foundry installation, so on a public network they are not
 * secrets at all. The guard exists because the next step of the project is
 * pointing `CHAIN_ID`/`RPC_URL` at Base Sepolia, and nothing else stops these
 * keys from signing there.
 */

function config(chainId: number): CliConfig {
  return {
    rpcUrl: chainId === 31337 ? 'http://localhost:8545' : 'https://sepolia.base.org',
    chainId,
    registryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    apiUrl: 'http://localhost:3000',
  };
}

describe('isLocalChain', () => {
  it('accepts the Anvil and legacy development chain ids', () => {
    expect(isLocalChain(31337)).toBe(true);
    expect(isLocalChain(1337)).toBe(true);
  });

  it('rejects Base Sepolia and Ethereum mainnet', () => {
    expect(isLocalChain(84532)).toBe(false);
    expect(isLocalChain(1)).toBe(false);
    expect(isLocalChain(8453)).toBe(false);
  });
});

describe('doctorAccount', () => {
  it('hands out the demo prescriber on a local chain', () => {
    expect(doctorAccount(config(31337)).privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses to hand out a checked-in key on Base Sepolia', () => {
    expect(() => doctorAccount(config(84532))).toThrow(/84532/);
  });

  it('explains that the key is public rather than just failing', () => {
    expect(() => doctorAccount(config(84532))).toThrow(/p[úu]blic/i);
  });
});

describe('pharmacyAccount', () => {
  it('hands out each demo pharmacy on a local chain', () => {
    expect(pharmacyAccount('a', config(31337)).label).toContain('Bolívar');
    expect(pharmacyAccount('b', config(31337)).label).toContain('San Jorge');
  });

  it('refuses to hand out a checked-in key on a public network', () => {
    expect(() => pharmacyAccount('a', config(84532))).toThrow(/84532/);
    expect(() => pharmacyAccount('b', config(1))).toThrow(/\b1\b/);
  });
});
