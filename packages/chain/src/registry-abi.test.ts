import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prescriptionRegistryAbi } from './registry-abi';

/**
 * ABI parity with the Solidity source.
 *
 * This test is what makes review finding read-001 stay fixed. The ABI is a hand
 * transcription of contracts/src/IPrescriptionRegistry.sol, and a transcription
 * with nothing checking it is a copy waiting to drift: a custom error added in
 * Solidity and forgotten here turns a named verdict ("already dispensed on X by
 * Y") back into "transaction reverted" at the counter, with no test failing.
 *
 * So the source of truth is parsed, not restated. The pinned lists below exist
 * only for what the interface file cannot tell us: the public getters declared
 * on the implementation contract.
 */

const INTERFACE_SOURCE = new URL(
  '../../../contracts/src/IPrescriptionRegistry.sol',
  import.meta.url,
);

/**
 * Public getters declared on contracts/src/PrescriptionRegistry.sol rather than
 * on the interface (`public` state variables compile to view functions). The
 * CLI reads all four back when it inspects a credential setup.
 */
const IMPLEMENTATION_GETTERS = ['eas', 'practitionerSchema', 'pharmacySchema', 'issuerAuthority'];

/** Solidity value types map 1:1 onto ABI types except for the enum and struct. */
const SOLIDITY_TO_ABI_TYPE: Record<string, string> = {
  PrescriptionStatus: 'uint8',
};

interface SolidityMember {
  name: string;
  args: { name: string; type: string; indexed: boolean }[];
}

function source(): string {
  return readFileSync(INTERFACE_SOURCE, 'utf8');
}

/** Comments and newlines removed, so a multi-line declaration parses as one. */
function normalised(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');
}

function parseArgs(raw: string): SolidityMember['args'] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];

  return trimmed.split(',').map((argument) => {
    const parts = argument.trim().split(/\s+/);
    const type = parts[0] ?? '';
    const indexed = parts.includes('indexed');
    const name = parts.filter((part) => part !== 'indexed').slice(1).join(' ');

    return {
      name,
      type: SOLIDITY_TO_ABI_TYPE[type] ?? type,
      indexed,
    };
  });
}

/** Every `error`, `event` or `function` declaration of the interface file. */
function declarationsOf(keyword: 'error' | 'event' | 'function'): SolidityMember[] {
  const pattern = new RegExp(`\\b${keyword}\\s+(\\w+)\\s*\\(([^)]*)\\)`, 'g');
  const found: SolidityMember[] = [];

  for (const match of normalised(source()).matchAll(pattern)) {
    found.push({ name: match[1] ?? '', args: parseArgs(match[2] ?? '') });
  }

  return found;
}

interface AbiParameter {
  name?: string;
  type: string;
  indexed?: boolean;
  components?: readonly AbiParameter[];
}

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: readonly AbiParameter[];
  outputs?: readonly AbiParameter[];
}

/** The literal is `as const` for viem's benefit; the test only needs the shape. */
const ABI = prescriptionRegistryAbi as unknown as readonly AbiEntry[];

function abiEntriesOfType(type: 'error' | 'event' | 'function'): AbiEntry[] {
  return ABI.filter((entry) => entry.type === type);
}

function abiEntry(type: 'error' | 'event' | 'function', name: string): AbiEntry | undefined {
  return abiEntriesOfType(type).find((entry) => entry.name === name);
}

function inputsOf(entry: AbiEntry | undefined): readonly AbiParameter[] {
  return entry?.inputs ?? [];
}

describe('parsing the Solidity source', () => {
  // A regex that silently matches nothing would make every parity assertion
  // below vacuously true, so the parser is checked before it is trusted.
  it('finds the declarations the interface is known to hold', () => {
    expect(declarationsOf('error')).toHaveLength(16);
    expect(declarationsOf('event')).toHaveLength(4);
    expect(declarationsOf('function')).toHaveLength(7);
  });

  it('reads AlreadyDispensed with its three arguments in order', () => {
    expect(declarationsOf('error').find((entry) => entry.name === 'AlreadyDispensed')).toEqual({
      name: 'AlreadyDispensed',
      args: [
        { name: 'contentHash', type: 'bytes32', indexed: false },
        { name: 'dispensedBy', type: 'address', indexed: false },
        { name: 'dispensedAt', type: 'uint64', indexed: false },
      ],
    });
  });
});

describe('custom errors', () => {
  it('declares exactly the errors the interface declares, and no others', () => {
    expect(
      abiEntriesOfType('error')
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(
      declarationsOf('error')
        .map((entry) => entry.name)
        .sort(),
    );
  });

  it.each(declarationsOf('error').map((entry) => [entry.name, entry] as const))(
    '%s carries the same arguments, in the same order',
    (name, declaration) => {
      const entry = abiEntry('error', name);
      expect(entry).toBeDefined();
      expect(inputsOf(entry).map((input) => ({ name: input.name, type: input.type }))).toEqual(
        declaration.args.map((arg) => ({ name: arg.name, type: arg.type })),
      );
    },
  );
});

describe('events', () => {
  it('declares every event of the interface', () => {
    const abiNames = abiEntriesOfType('event').map((entry) => entry.name);
    for (const declaration of declarationsOf('event')) {
      expect(abiNames).toContain(declaration.name);
    }
  });

  it.each(declarationsOf('event').map((entry) => [entry.name, entry] as const))(
    '%s carries the same arguments, in the same order, with the same indexing',
    (name, declaration) => {
      const entry = abiEntry('event', name);
      expect(entry).toBeDefined();
      expect(
        inputsOf(entry).map((input) => ({
          name: input.name,
          type: input.type,
          indexed: input.indexed === true,
        })),
      ).toEqual(declaration.args);
    },
  );
});

describe('functions', () => {
  it('declares every function of the interface', () => {
    const abiNames = abiEntriesOfType('function').map((entry) => entry.name);
    for (const declaration of declarationsOf('function')) {
      expect(abiNames).toContain(declaration.name);
    }
  });

  it.each(declarationsOf('function').map((entry) => [entry.name, entry] as const))(
    '%s takes the same arguments, in the same order',
    (name, declaration) => {
      const entry = abiEntry('function', name);
      expect(entry).toBeDefined();
      expect(inputsOf(entry).map((input) => ({ name: input.name, type: input.type }))).toEqual(
        declaration.args.map((arg) => ({ name: arg.name, type: arg.type })),
      );
    },
  );

  // The union of what all three consumers need: the pharmacy reads `verify`,
  // `getPrescription` and `credentialOf` and writes `dispense`; the CLI and the
  // doctor app also `issue`, `cancel` and `registerCredential`.
  it.each([
    'issue',
    'dispense',
    'cancel',
    'verify',
    'getPrescription',
    'credentialOf',
    'registerCredential',
  ])('exposes %s', (name) => {
    expect(abiEntry('function', name)).toBeDefined();
  });

  it.each(IMPLEMENTATION_GETTERS)('exposes the %s getter of the implementation', (name) => {
    expect(abiEntry('function', name)).toBeDefined();
  });
});

describe('return shapes the consumers destructure', () => {
  it('verify returns status, dispensable, prescriber and expiresAt in that order', () => {
    expect(abiEntry('function', 'verify')?.outputs).toEqual([
      { name: 'status', type: 'uint8' },
      { name: 'dispensable', type: 'bool' },
      { name: 'prescriber', type: 'address' },
      { name: 'expiresAt', type: 'uint64' },
    ]);
  });

  // Field order of struct PrescriptionRecord in IPrescriptionRegistry.sol.
  it('getPrescription returns the record fields in declaration order', () => {
    const outputs = abiEntry('function', 'getPrescription')?.outputs ?? [];

    expect(outputs[0]?.components).toEqual([
      { name: 'prescriber', type: 'address' },
      { name: 'patientCommitment', type: 'bytes32' },
      { name: 'issuedAt', type: 'uint64' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'dispensedBy', type: 'address' },
      { name: 'dispensedAt', type: 'uint64' },
      { name: 'status', type: 'uint8' },
    ]);
  });
});
