import { describe, expect, it } from 'vitest';
import { buildChain, buildPublicClient } from './viem-chain';

/**
 * The chain is built from configuration, never from an imported `avalancheFuji`.
 * A hardcoded chain is how a client ends up quietly talking to the wrong
 * network, so the configured values have to survive intact (docs/08).
 */

const ANVIL = { chainId: 31337, rpcUrl: 'http://localhost:8545' };
const FUJI = { chainId: 43113, rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc' };

describe('buildChain', () => {
  it('uses the configured chain id and rpc url', () => {
    const chain = buildChain(FUJI);

    expect(chain.id).toBe(43113);
    expect(chain.rpcUrls.default.http).toEqual(['https://api.avax-test.network/ext/bc/C/rpc']);
  });

  it('names the local development chain Anvil', () => {
    expect(buildChain(ANVIL).name).toBe('Anvil');
  });

  it('names any other chain by its id', () => {
    expect(buildChain(FUJI).name).toBe('Cadena 43113');
  });

  it('uses ETH as the native currency on the local chain', () => {
    expect(buildChain(ANVIL).nativeCurrency).toEqual({
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    });
  });

  // Avalanche is an independent L1, not an Ethereum L2: its C-Chain pays gas in
  // AVAX, so a client that says "ETH" is naming a currency the chain does not
  // have.
  it('uses AVAX as the native currency on Fuji', () => {
    expect(buildChain(FUJI).nativeCurrency).toEqual({
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18,
    });
  });
});

describe('buildPublicClient', () => {
  it('is bound to the configured chain', () => {
    expect(buildPublicClient(FUJI).chain?.id).toBe(43113);
  });

  it('transports over the configured rpc url', () => {
    expect(buildPublicClient(ANVIL).transport['url']).toBe('http://localhost:8545');
  });
});
