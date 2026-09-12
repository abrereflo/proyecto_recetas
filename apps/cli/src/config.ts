import { readFileSync } from 'node:fs';

import type { Address, Hex } from 'viem';

/**
 * Runtime configuration.
 *
 * Defaults target the local stack described in docs/08-stack-y-entorno.md:
 * Anvil on 8545 with chain id 31337, the Fastify store on 3000, and the
 * PrescriptionRegistry already deployed by contracts/script/Deploy.s.sol.
 *
 * The keys below are the public, well-known Anvil development keys. They are
 * worthless outside a local node and are checked in deliberately so the demo
 * runs with zero setup. Nothing here may ever be reused on a public network.
 */

export const ANVIL_ACCOUNTS = {
  doctor: {
    label: 'Dra. Claudia Mendoza Rojas',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex,
  },
  pharmacyA: {
    label: 'Farmacia Bolívar (Farmacia A)',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex,
  },
  pharmacyB: {
    label: 'Farmacia San Jorge (Farmacia B)',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as Hex,
  },
  /**
   * The credential authority (Anvil account #9).
   *
   * A multisig in the pilot, a single key here. It attests and revokes
   * professional credentials in EAS and never touches PrescriptionRegistry:
   * the contract has no administrator, and this account is not one
   * (docs/02-roles-y-permisos.md, D-14).
   */
  credentialIssuer: {
    label: 'Emisor de credenciales (autoridad del piloto)',
    privateKey: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as Hex,
  },
} as const;

export type PharmacyKey = 'a' | 'b';

export interface CliConfig {
  rpcUrl: string;
  chainId: number;
  registryAddress: Address;
  apiUrl: string;
}

const DEFAULT_RPC_URL = 'http://localhost:8545';
const DEFAULT_CHAIN_ID = 31337;
const DEFAULT_API_URL = 'http://localhost:3000';

/**
 * Resolve the registry address from the last broadcast of Deploy.s.sol for this
 * chain.
 *
 * A hardcoded constant was tried first and is a trap: Anvil's first deployment
 * address is deterministic, so the constant keeps resolving after a redeploy
 * moves the contract, and the CLI then talks to a stale contract that answers
 * some calls and reverts on others. Reading the broadcast artifact means a
 * redeploy is picked up with no edit anywhere.
 */
function registryFromBroadcast(chainId: number): Address | undefined {
  const artifact = new URL(
    `../../../contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`,
    import.meta.url,
  );
  try {
    const run = JSON.parse(readFileSync(artifact, 'utf8')) as {
      transactions?: { contractName?: string; contractAddress?: string }[];
    };
    // Last match wins: a redeploy appends to the same artifact.
    const deployments = (run.transactions ?? []).filter(
      (tx): tx is { contractName: string; contractAddress: string } =>
        tx.contractName === 'PrescriptionRegistry' && typeof tx.contractAddress === 'string',
    );
    return deployments.at(-1)?.contractAddress as Address | undefined;
  } catch {
    return undefined;
  }
}

function readAddress(value: string | undefined, fallback: Address | undefined): Address {
  if (value === undefined || value.trim() === '') {
    if (fallback === undefined) {
      throw new Error(
        'No se pudo determinar la dirección de PrescriptionRegistry.\n' +
          'Despliegue el contrato con contracts/script/Deploy.s.sol o defina\n' +
          'PRESCRIPTION_REGISTRY_ADDRESS en el entorno.',
      );
    }
    return fallback;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(
      `PRESCRIPTION_REGISTRY_ADDRESS no es una dirección válida de 20 bytes: ${value}`,
    );
  }
  return value as Address;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): CliConfig {
  const chainId = Number(source['CHAIN_ID'] ?? DEFAULT_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`CHAIN_ID no es un entero válido: ${String(source['CHAIN_ID'])}`);
  }

  return {
    rpcUrl: source['RPC_URL'] ?? DEFAULT_RPC_URL,
    chainId,
    registryAddress: readAddress(
      source['PRESCRIPTION_REGISTRY_ADDRESS'],
      registryFromBroadcast(chainId),
    ),
    apiUrl: (source['API_URL'] ?? DEFAULT_API_URL).replace(/\/+$/, ''),
  };
}

export interface DemoActor {
  /** Shown in the terminal; never used as an on-chain identity. */
  label: string;
  privateKey: Hex;
}

export function pharmacyAccount(key: PharmacyKey): DemoActor {
  return key === 'a' ? ANVIL_ACCOUNTS.pharmacyA : ANVIL_ACCOUNTS.pharmacyB;
}
