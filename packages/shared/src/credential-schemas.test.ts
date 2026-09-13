import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guard over the credential schema declarations.
 *
 * The two declarations live twice, byte for byte:
 *
 *   contracts/script/RegisterSchemas.s.sol  as the string that is registered
 *                                           in the EAS SchemaRegistry
 *   contracts/script/LocalDemo.sol          inside keccak256(), as the stand-in
 *                                           uid the Anvil demo attests against
 *
 * Both files carry a comment saying they must stay identical, and until now
 * nothing enforced it. The uid of an EAS schema derives from a hash over the
 * declaration string, so a one-sided edit — even a space after a comma — points
 * one of the two paths at a different schema. Nothing fails loudly when that
 * happens: the demo keeps passing against its own stand-in and the public
 * network keeps registering its own declaration, each self-consistent, and the
 * credential a pharmacy holds simply stops satisfying the check it was issued
 * for.
 *
 * This guard lives in TypeScript rather than in Foundry on purpose. A Solidity
 * test cannot read `RegisterSchemas`'s `internal constant` without inheriting a
 * Script into a Test, and writing the declaration as a literal inside the test
 * would only add a third copy — a copy checked against a copy. Reading both
 * files is what makes this a guard over the real sources.
 *
 * It sits in `@recetas/shared` because that workspace owns the cross-cutting
 * contracts of the system: the EIP-712 domain and the prescription types. The
 * credential schema declaration is the same kind of thing.
 */

const CONTRACTS = new URL('../../../contracts/script/', import.meta.url);

function read(file: string): string {
  return readFileSync(new URL(file, CONTRACTS), 'utf8');
}

/** The `string internal constant NAME = "...";` form of RegisterSchemas. */
function declarationConstant(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(source);
  return match?.[1];
}

/** The `keccak256("...")` form of LocalDemo. */
function hashedDeclaration(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*keccak256\\(\\s*"([^"]+)"`).exec(source);
  return match?.[1];
}

const registerSchemas = read('RegisterSchemas.s.sol');
const localDemo = read('LocalDemo.sol');

const PAIRS = [
  {
    role: 'practitioner',
    registered: declarationConstant(registerSchemas, 'PRACTITIONER_DECLARATION'),
    demo: hashedDeclaration(localDemo, 'PRACTITIONER_SCHEMA'),
    type: 'PractitionerCredential',
  },
  {
    role: 'pharmacy',
    registered: declarationConstant(registerSchemas, 'PHARMACY_DECLARATION'),
    demo: hashedDeclaration(localDemo, 'PHARMACY_SCHEMA'),
    type: 'PharmacyCredential',
  },
] as const;

describe('credential schema declarations', () => {
  /**
   * Without this, a rename in either .sol file would make both regexes match
   * nothing, both sides would be `undefined`, and the equality test below would
   * pass while guarding nothing at all.
   */
  it.each(PAIRS)('finds both copies of the $role declaration', ({ registered, demo, type }) => {
    expect(registered).toBeDefined();
    expect(demo).toBeDefined();
    expect(registered).toContain(`${type}(`);
    expect(demo).toContain(`${type}(`);
  });

  it.each(PAIRS)('keeps the $role declaration identical in both files', ({ registered, demo }) => {
    expect(demo).toBe(registered);
  });

  /**
   * A space after a comma is a different string and therefore a different uid.
   * The declarations are quoted verbatim in docs/02-roles-y-permisos.md for
   * exactly this reason, so the shape is worth asserting on its own.
   */
  it.each(PAIRS)('keeps the $role declaration free of incidental spacing', ({ registered }) => {
    expect(registered).not.toMatch(/,\s/);
    expect(registered).not.toMatch(/\(\s|\s\)/);
  });
});
