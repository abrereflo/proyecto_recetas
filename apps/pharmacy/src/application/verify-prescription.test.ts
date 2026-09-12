import { describe, expect, it, vi } from 'vitest';
import {
  bytesToBase64,
  bytesToBase64Url,
  generateDek,
  hexToBytes,
  patientCommitment,
  saltToHex,
  sealDocument,
  utf8ToBytes,
} from '@recetas/crypto';
import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type EncryptedDocument,
  type Hex,
  type PrescriptionDocument,
  type PrescriptionRecord,
  type QrPayload,
  type VerificationResult,
} from '@recetas/shared';
import type { ChainPort } from '../ports/chain.port';
import { ChainUnreachableError } from '../ports/chain.port';
import { DocumentNotFoundError, type DocumentPort } from '../ports/document.port';
import type { PrescriberSignatureVerifier } from '../ports/signer.port';
import type { PharmacyConfig } from '../infrastructure/config/env';
import {
  BLOCK_TIME,
  CHAIN_ID,
  DISPENSED_AT,
  EXPIRES_AT,
  ISSUED_AT,
  PHARMACY_B,
  PRESCRIBER,
  REGISTRY_ADDRESS,
  aDocument,
  aRecord,
} from '../test/fixtures';
import { createVerifyPrescription, isoToSeconds } from './verify-prescription';

/**
 * End-to-end drive of screen P3 with a real sealed envelope: the ciphertext,
 * the content hash and the patient commitment are produced by @recetas/crypto,
 * so the wiring between the QR, the store and the chain is exercised for real.
 * Only the chain and the HTTP boundary are faked.
 */

const CONFIG: PharmacyConfig = {
  apiUrl: 'http://localhost:3000',
  rpcUrl: 'http://localhost:8545',
  chainId: CHAIN_ID,
  registryAddress: REGISTRY_ADDRESS,
};

const SIGNATURE = `0x${'ab'.repeat(65)}` as Hex;

interface SealedFixture {
  qr: QrPayload;
  envelope: EncryptedDocument;
  record: PrescriptionRecord;
  chainState: VerificationResult;
  document: PrescriptionDocument;
}

async function seal(
  overrides: { document?: PrescriptionDocument; signer?: Address } = {},
): Promise<SealedFixture> {
  const dek = generateDek();
  // A fixed salt keeps the commitment reproducible across runs.
  const salt = utf8ToBytes('salt-de-prueba-de-32-bytes-exact');
  const document = overrides.document ?? aDocument({ salt: saltToHex(salt) });

  const { document: envelope, contentHash } = await sealDocument(document, dek, {
    sign: () => ({
      eip712: { signer: overrides.signer ?? PRESCRIBER, value: SIGNATURE },
    }),
  });

  const commitment = patientCommitment(document.patient.patientId, hexToBytes(document.salt));

  return {
    document,
    envelope,
    qr: {
      v: 1,
      chainId: CHAIN_ID,
      registry: REGISTRY_ADDRESS,
      contentHash,
      pointer: 'PT0000000000000000000A',
      key: bytesToBase64Url(dek),
    },
    record: aRecord({ patientCommitment: commitment }),
    chainState: {
      status: PrescriptionStatus.Issued,
      dispensable: true,
      prescriber: PRESCRIBER,
      expiresAt: EXPIRES_AT,
    },
  };
}

function fakeChain(fixture: SealedFixture, overrides: Partial<ChainPort> = {}): ChainPort {
  return {
    blockTimestamp: async () => BLOCK_TIME,
    verify: async () => fixture.chainState,
    getPrescription: async () => fixture.record,
    credentialOf: async () => '0x0' as Bytes32,
    dispense: async () => {
      throw new Error('verification never dispenses');
    },
    ...overrides,
  };
}

function fakeDocuments(envelope: EncryptedDocument | Error): DocumentPort {
  return {
    fetchEnvelope: async () => {
      if (envelope instanceof Error) throw envelope;
      return envelope;
    },
  };
}

function fakeSignatures(valid: boolean): PrescriberSignatureVerifier {
  return { verify: async () => valid };
}

function build(
  fixture: SealedFixture,
  options: {
    chain?: Partial<ChainPort>;
    envelope?: EncryptedDocument | Error;
    signatureValid?: boolean;
    config?: PharmacyConfig;
  } = {},
) {
  return createVerifyPrescription({
    chain: fakeChain(fixture, options.chain ?? {}),
    documents: fakeDocuments(options.envelope ?? fixture.envelope),
    signatures: fakeSignatures(options.signatureValid ?? true),
    config: options.config ?? CONFIG,
  });
}

describe('a prescription that passes every check', () => {
  it('returns the decrypted document with all five checks passed', async () => {
    const fixture = await seal();
    const verify = build(fixture);

    const result = await verify({ qr: fixture.qr });

    expect(result.outcome).toBe('dispensable');
    if (result.outcome !== 'dispensable') throw new Error('expected a dispensable outcome');
    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(result.document.items[0]?.activeIngredient).toBe('amoxicilina');
  });

  it('asks the chain before it touches the off-chain store', async () => {
    const fixture = await seal();
    const calls: string[] = [];

    const verify = createVerifyPrescription({
      chain: fakeChain(fixture, {
        verify: async () => {
          calls.push('chain');
          return fixture.chainState;
        },
      }),
      documents: {
        fetchEnvelope: async () => {
          calls.push('store');
          return fixture.envelope;
        },
      },
      signatures: fakeSignatures(true),
      config: CONFIG,
    });

    await verify({ qr: fixture.qr });

    expect(calls).toEqual(['chain', 'store']);
  });

  it('passes the EIP-712 message without any patient identifier', async () => {
    const fixture = await seal();
    const spy = vi.fn<PrescriberSignatureVerifier['verify']>(async () => true);

    const verify = createVerifyPrescription({
      chain: fakeChain(fixture),
      documents: fakeDocuments(fixture.envelope),
      signatures: { verify: spy },
      config: CONFIG,
    });

    await verify({ qr: fixture.qr });

    const message = spy.mock.calls[0]?.[0];
    expect(JSON.stringify(message, (_key, value) => (typeof value === 'bigint' ? String(value) : value))).not.toContain(
      fixture.document.patient.patientId,
    );
    expect(message).toMatchObject({
      prescriber: PRESCRIBER,
      patientCommitment: fixture.record.patientCommitment,
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    });
  });
});

describe('the chain says no', () => {
  it('never downloads the document when the prescription was already dispensed', async () => {
    const fixture = await seal();
    const fetchSpy = vi.fn(async () => fixture.envelope);

    const verify = createVerifyPrescription({
      chain: fakeChain(fixture, {
        verify: async () => ({
          status: PrescriptionStatus.Dispensed,
          dispensable: false,
          prescriber: PRESCRIBER,
          expiresAt: EXPIRES_AT,
        }),
        getPrescription: async () =>
          aRecord({
            status: PrescriptionStatus.Dispensed,
            dispensedBy: PHARMACY_B,
            dispensedAt: DISPENSED_AT,
          }),
      }),
      documents: { fetchEnvelope: fetchSpy },
      signatures: fakeSignatures(true),
      config: CONFIG,
    });

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'already-dispensed',
      dispensedBy: PHARMACY_B,
      dispensedAt: DISPENSED_AT,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the off-chain store fails', () => {
  it('reports an incomplete verification, with nothing marked failed', async () => {
    const fixture = await seal();
    const verify = build(fixture, { envelope: new DocumentNotFoundError(fixture.qr.pointer) });

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('network-error');
    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'skipped',
      'skipped',
      'skipped',
    ]);
  });
});

describe('the node fails', () => {
  it('aborts at the first check without pretending the receta is unknown', async () => {
    const fixture = await seal();
    const verify = build(fixture, {
      chain: {
        blockTimestamp: async () => {
          throw new ChainUnreachableError(CONFIG.rpcUrl);
        },
      },
    });

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('network-error');
    expect(result.checks.every((check) => check.state === 'skipped')).toBe(true);
  });
});

describe('integrity', () => {
  it('rejects a stored envelope whose ciphertext was swapped', async () => {
    const fixture = await seal();
    const tampered: EncryptedDocument = {
      ...fixture.envelope,
      ciphertext: bytesToBase64(utf8ToBytes('otro contenido completamente distinto')),
    };

    const verify = build(fixture, { envelope: tampered });
    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('integrity-failed');
    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'failed',
      'skipped',
      'skipped',
    ]);
  });

  it('rejects when the key in the code does not open the document', async () => {
    const fixture = await seal();
    const wrongKey: QrPayload = { ...fixture.qr, key: bytesToBase64Url(generateDek()) };

    const verify = build(fixture);
    const result = await verify({ qr: wrongKey });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('integrity-failed');
  });
});

describe('the prescriber signature', () => {
  it('rejects an envelope signed by somebody else', async () => {
    const fixture = await seal({ signer: PHARMACY_B });
    const verify = build(fixture);

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'signature-failed',
      signer: PHARMACY_B,
      prescriber: PRESCRIBER,
    });
  });

  it('rejects a signature that does not verify', async () => {
    const fixture = await seal();
    const verify = build(fixture, { signatureValid: false });

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('signature-failed');
  });
});

describe('the patient commitment', () => {
  it('rejects a document whose patient is not the anchored one', async () => {
    const fixture = await seal();
    const verify = build({
      ...fixture,
      record: aRecord({
        patientCommitment:
          '0x4444444444444444444444444444444444444444444444444444444444444444' as Bytes32,
      }),
    });

    const result = await verify({ qr: fixture.qr });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({ code: 'patient-mismatch' });
    expect(result.checks.map((check) => check.state)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'failed',
    ]);
  });
});

describe('a code from another deployment', () => {
  it('refuses a QR from a different chain without querying anything', async () => {
    const fixture = await seal();
    const spy = vi.fn(async () => fixture.chainState);
    const verify = build(fixture, { chain: { verify: spy } });

    const result = await verify({ qr: { ...fixture.qr, chainId: 43113 } });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    // NOT `network-error`: nothing was asked of the network, so nothing about
    // the network failed (domain/rejection.ts, `wrong-deployment`).
    expect(result.reason).toEqual({
      code: 'wrong-deployment',
      expectedChainId: CHAIN_ID,
      actualChainId: 43113,
      expectedRegistry: REGISTRY_ADDRESS,
      actualRegistry: REGISTRY_ADDRESS,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a QR pointing at a different registry', async () => {
    const fixture = await seal();
    const verify = build(fixture);

    const result = await verify({
      qr: { ...fixture.qr, registry: '0x8888888888888888888888888888888888888888' },
    });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'wrong-deployment',
      expectedChainId: CHAIN_ID,
      actualChainId: CHAIN_ID,
      expectedRegistry: REGISTRY_ADDRESS,
      actualRegistry: '0x8888888888888888888888888888888888888888',
    });
  });

  it('marks nothing as failed, because no check ever ran', async () => {
    // `abortAt` leaves the five lines `skipped`: a code from another deployment
    // disproves nothing about the receta itself, so no line may read as red.
    const fixture = await seal();
    const verify = build(fixture);

    const result = await verify({ qr: { ...fixture.qr, chainId: 43113 } });

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.state === 'skipped')).toBe(true);
  });
});

describe('isoToSeconds', () => {
  it('converts an ISO timestamp to Unix seconds', () => {
    expect(isoToSeconds('2026-09-11T13:41:00.000Z')).toBe(ISSUED_AT);
  });

  it('returns zero for a value that is not a date, instead of NaN', () => {
    expect(isoToSeconds('no es una fecha')).toBe(0n);
  });
});
