import { describe, expect, it } from 'vitest';

import * as configModule from './config';
import {
  credentialIssuerAccount,
  demoHolderAccounts,
  doctorAccount,
  isLocalChain,
  pharmacyAccount,
  type CliConfig,
} from './config';

/**
 * The demo keys checked into `config.ts` are the public Anvil accounts: they
 * ship inside every Foundry installation, so on a public network they are not
 * secrets at all. The guard exists because the next step of the project is
 * pointing `CHAIN_ID`/`RPC_URL` at Avalanche Fuji, and nothing else stops these
 * keys from signing there.
 */

function config(chainId: number): CliConfig {
  return {
    rpcUrl: chainId === 31337 ? 'http://localhost:8545' : 'https://api.avax-test.network/ext/bc/C/rpc',
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

  it('rejects Avalanche Fuji and Ethereum mainnet', () => {
    expect(isLocalChain(43113)).toBe(false);
    expect(isLocalChain(1)).toBe(false);
    expect(isLocalChain(43114)).toBe(false);
  });
});

describe('doctorAccount', () => {
  it('hands out the demo prescriber on a local chain', () => {
    expect(doctorAccount(config(31337)).privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('refuses to hand out a checked-in key on Avalanche Fuji', () => {
    expect(() => doctorAccount(config(43113))).toThrow(/43113/);
  });

  it('explains that the key is public rather than just failing', () => {
    expect(() => doctorAccount(config(43113))).toThrow(/p[úu]blic/i);
  });
});

describe('pharmacyAccount', () => {
  it('hands out each demo pharmacy on a local chain', () => {
    expect(pharmacyAccount('a', config(31337)).label).toContain('Bolívar');
    expect(pharmacyAccount('b', config(31337)).label).toContain('San Jorge');
  });

  it('refuses to hand out a checked-in key on a public network', () => {
    expect(() => pharmacyAccount('a', config(43113))).toThrow(/43113/);
    expect(() => pharmacyAccount('b', config(1))).toThrow(/\b1\b/);
  });
});

describe('credentialIssuerAccount', () => {
  it('hands out the credential authority on both local chain ids', () => {
    expect(credentialIssuerAccount(config(31337)).privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(credentialIssuerAccount(config(1337)).privateKey).toBe(
      credentialIssuerAccount(config(31337)).privateKey,
    );
    expect(credentialIssuerAccount(config(31337)).label).toContain('Emisor');
  });

  it('refuses to hand out the authority key on Avalanche Fuji, naming the network', () => {
    expect(() => credentialIssuerAccount(config(43113))).toThrow(/43113/);
    expect(() => credentialIssuerAccount(config(43113))).toThrow(/p[úu]blic/i);
  });
});

describe('demoHolderAccounts', () => {
  it('hands out the three accredited demo accounts on both local chain ids', () => {
    for (const chainId of [31337, 1337]) {
      const holders = demoHolderAccounts(config(chainId));
      expect(holders.doctor.label).toContain('Claudia');
      expect(holders.pharmacyA.label).toContain('Bolívar');
      expect(holders.pharmacyB.label).toContain('San Jorge');
    }
  });

  it('returns the same keys the single-account accessors return', () => {
    const holders = demoHolderAccounts(config(31337));
    expect(holders.doctor).toEqual(doctorAccount(config(31337)));
    expect(holders.pharmacyA).toEqual(pharmacyAccount('a', config(31337)));
    expect(holders.pharmacyB).toEqual(pharmacyAccount('b', config(31337)));
  });

  it('refuses to hand out the demo holders on Avalanche Fuji, naming the network', () => {
    expect(() => demoHolderAccounts(config(43113))).toThrow(/43113/);
    expect(() => demoHolderAccounts(config(43113))).toThrow(/p[úu]blic/i);
  });
});

/**
 * The guard is worth no more than the narrowest way around it.
 *
 * Every accessor above takes a `CliConfig` precisely so a new command cannot
 * sign without declaring a chain — but that only holds while the raw key table
 * stays inside this module. Asserting on the module namespace is what makes
 * re-exporting it (under any name) a failing test rather than a code review
 * someone may or may not run.
 */
describe('the demo keys as module state', () => {
  it('does not export ANVIL_ACCOUNTS', () => {
    expect(Object.keys(configModule)).not.toContain('ANVIL_ACCOUNTS');
  });

  it('exports no value at all that carries a private key', () => {
    // Functions serialise to `undefined`, so only data exports are inspected:
    // the accessors are supposed to hand keys out, the module is not.
    const leaking = Object.entries(configModule)
      .filter(([, value]) => /0x[0-9a-fA-F]{64}/.test(JSON.stringify(value ?? null) ?? ''))
      .map(([name]) => name);

    expect(leaking).toEqual([]);
  });
});
