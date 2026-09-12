import { describe, expect, it } from 'vitest';
import { encodeErrorResult } from 'viem';
import { prescriptionRegistryAbi } from '@recetas/chain';
import { base64ToBytes, bytesToBase64Url, decryptDocument, saltToHex } from '@recetas/crypto';
import { decodeQrPayload, type EncryptedDocument, type PrescriptionDocument } from '@recetas/shared';
import type { ChainPort, IssuedPrescriptionLog, IssueReceipt, IssueRequest } from '../ports/chain.port';
import { ChainUnreachableError, TransactionRevertedError } from '../ports/chain.port';
import {
  DocumentStoreRejectedError,
  DocumentStoreUnreachableError,
  type DocumentPort,
  type StoredEnvelope,
  type StoreEnvelopeInput,
} from '../ports/document.port';
import {
  SignerRejectedError,
  type SignerPort,
  type SignPrescriptionInput,
} from '../ports/signer.port';
import {
  BLOCK_TIME,
  CONFIG,
  CREDENTIAL_UID,
  DEK_BYTES,
  ISSUED_AT_DATE,
  POINTER,
  PRESCRIBER,
  SALT_BYTES,
  SIGNATURE,
  TRANSACTION_HASH,
  aDraft,
  aRecord,
  anItem,
} from '../test/fixtures';
import { createIssuePrescription, type IssuePrescriptionDeps } from './issue-prescription';

/**
 * The issuing pipeline of screens D5 and D6, with fakes for every port.
 *
 * What is asserted here is not "it works": it is the ORDER of the side effects,
 * the privacy rules that must hold structurally, and one distinct outcome per
 * way the sequence can fail (docs/05, docs/17).
 */

/** Every side effect, in the order it happened. */
interface Recorder {
  calls: string[];
  signed: SignPrescriptionInput[];
  stored: StoreEnvelopeInput[];
  issued: IssueRequest[];
}

interface Overrides {
  signPrescription?: (input: SignPrescriptionInput) => Promise<`0x${string}`>;
  storeEnvelope?: (input: StoreEnvelopeInput) => Promise<StoredEnvelope>;
  issue?: (request: IssueRequest) => Promise<IssueReceipt>;
  isAvailable?: () => boolean;
}

const RECEIPT: IssueReceipt = {
  transactionHash: TRANSACTION_HASH,
  blockNumber: 42n,
  blockTimestamp: BLOCK_TIME,
};

function harness(overrides: Overrides = {}): {
  issue: ReturnType<typeof createIssuePrescription>;
  recorder: Recorder;
} {
  const recorder: Recorder = { calls: [], signed: [], stored: [], issued: [] };

  const signer: SignerPort = {
    isAvailable: overrides.isAvailable ?? ((): boolean => true),
    getAccount: async () => PRESCRIBER,
    connect: async () => PRESCRIBER,
    getChainId: async () => CONFIG.chainId,
    ensureChain: async () => undefined,
    signPrescription: async (input) => {
      recorder.calls.push('sign');
      recorder.signed.push(input);
      return overrides.signPrescription === undefined
        ? SIGNATURE
        : await overrides.signPrescription(input);
    },
  };

  const documents: DocumentPort = {
    storeEnvelope: async (input) => {
      recorder.calls.push('store');
      recorder.stored.push(input);
      return overrides.storeEnvelope === undefined
        ? { pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' }
        : await overrides.storeEnvelope(input);
    },
  };

  const chain: ChainPort = {
    blockTimestamp: async () => BLOCK_TIME,
    credentialOf: async () => CREDENTIAL_UID,
    getPrescription: async () => aRecord(),
    issuedBy: async (): Promise<IssuedPrescriptionLog[]> => [],
    issue: async (request) => {
      recorder.calls.push('anchor');
      recorder.issued.push(request);
      return overrides.issue === undefined ? RECEIPT : await overrides.issue(request);
    },
  };

  const deps: IssuePrescriptionDeps = {
    chain,
    documents,
    signer,
    config: CONFIG,
    generateSalt: () => SALT_BYTES,
    generateDek: () => DEK_BYTES,
    now: () => ISSUED_AT_DATE,
  };

  return { issue: createIssuePrescription(deps), recorder };
}

function revert(errorName: string, args: readonly unknown[]): { data: string } {
  return { data: encodeErrorResult({ abi: prescriptionRegistryAbi, errorName, args } as never) };
}

describe('the happy path', () => {
  it('returns the QR, the contentHash, the transaction and the expiry', async () => {
    const { issue } = harness();

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result.outcome).toBe('issued');
    if (result.outcome !== 'issued') return;

    expect(result.transactionHash).toBe(TRANSACTION_HASH);
    expect(result.qrPayload.pointer).toBe(POINTER);
    expect(result.qrPayload.contentHash).toBe(result.contentHash);
    expect(result.qrPayload.chainId).toBe(CONFIG.chainId);
    expect(result.qrPayload.registry).toBe(CONFIG.registryAddress);
    expect(result.qrPayload.key).toBe(bytesToBase64Url(DEK_BYTES));
    // 2026-10-11T04:00:00Z: midnight of the expiry day in Bolivia (D-13).
    expect(result.expiresAt).toBe(1_791_691_200n);
    expect(decodeQrPayload(result.qr)).toEqual(result.qrPayload);
  });

  /**
   * The ordering rule of docs/05 and apps/cli: seal, sign, store, THEN anchor.
   * The store runs before the chain write so a failed anchor leaves an orphaned
   * ciphertext — harmless — instead of an anchor pointing at nothing.
   */
  it('seals and signs before storing, and stores before anchoring', async () => {
    const { issue, recorder } = harness();

    await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(recorder.calls).toEqual(['sign', 'store', 'anchor']);
  });

  it('reports the same order through the D5 progress callback', async () => {
    const { issue } = harness();
    const steps: string[] = [];

    await issue({ draft: aDraft(), prescriber: PRESCRIBER, onStep: (id) => steps.push(id) });

    expect(steps).toEqual(['document', 'commitment', 'seal', 'sign', 'store', 'anchor', 'qr']);
  });

  it('stores an envelope that decrypts back into the prescribed document', async () => {
    const { issue, recorder } = harness();

    await issue({ draft: aDraft({ items: [anItem({ quantity: 7 })] }), prescriber: PRESCRIBER });

    const envelope = recorder.stored[0]?.document as EncryptedDocument;
    const document = await decryptDocument<PrescriptionDocument>(envelope, DEK_BYTES);

    expect(document.items[0]?.quantity).toBe(7);
    expect(document.patient.patientId).toBe('CI-0000000');
  });

  it('sends the salt to the off-chain store, where the pharmacy cannot read it back', async () => {
    const { issue, recorder } = harness();

    await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(recorder.stored[0]?.saltHex).toBe(saltToHex(SALT_BYTES));
  });
});

/**
 * HARD RULE (docs/03, docs/17): "Ningún identificador de paciente llega a la
 * cadena: ni la cédula, ni su hash, ni un seudónimo estable" and "la sal nunca
 * aparece en el QR, en la URL ni en un enlace compartible".
 */
describe('what never reaches the chain', () => {
  it('anchors only the contentHash, the commitment, the expiry and the prescriber', async () => {
    const { issue, recorder } = harness();
    const draft = aDraft();

    await issue({ draft, prescriber: PRESCRIBER });

    const request = recorder.issued[0];
    expect(Object.keys(request ?? {}).sort()).toEqual([
      'contentHash',
      'expiresAt',
      'patientCommitment',
      'prescriber',
    ]);

    const serialized = JSON.stringify(request, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(serialized).not.toContain(draft.patient.patientId);
    expect(serialized).not.toContain(draft.patient.fullName);
    expect(serialized).not.toContain(saltToHex(SALT_BYTES));
    expect(serialized).not.toContain(saltToHex(SALT_BYTES).slice(2));
  });

  it('signs a message that carries neither the patient identifier nor the salt', async () => {
    const { issue, recorder } = harness();
    const draft = aDraft();

    await issue({ draft, prescriber: PRESCRIBER });

    const message = recorder.signed[0]?.message;
    const serialized = JSON.stringify(message, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );

    expect(serialized).not.toContain(draft.patient.patientId);
    expect(serialized).not.toContain(draft.patient.fullName);
    expect(serialized).not.toContain(saltToHex(SALT_BYTES));
    expect(serialized).not.toContain(saltToHex(SALT_BYTES).slice(2));
    // Only the salted commitment stands for the patient.
    expect(message?.patientCommitment).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('keeps the salt out of the QR', async () => {
    const { issue } = harness();

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });
    expect(result.outcome).toBe('issued');
    if (result.outcome !== 'issued') return;

    const saltHex = saltToHex(SALT_BYTES);
    expect(result.qr).not.toContain(saltHex);
    expect(result.qr).not.toContain(saltHex.slice(2));
    expect(Object.keys(result.qrPayload).sort()).toEqual([
      'chainId',
      'contentHash',
      'key',
      'pointer',
      'registry',
      'v',
    ]);
  });
});

/** D-17, docs/17: the interface never simulates legal validity. */
describe('the ADSIB signature', () => {
  it('is always declared as pending-integration, with no serial and no value', async () => {
    const { issue, recorder } = harness();

    await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(recorder.stored[0]?.document.signatures.adsib).toEqual({
      certificateSerial: '',
      value: '',
      status: 'pending-integration',
    });
  });

  it('records the prescriber as the EIP-712 signer', async () => {
    const { issue, recorder } = harness();

    await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(recorder.stored[0]?.document.signatures.eip712).toEqual({
      signer: PRESCRIBER,
      value: SIGNATURE,
    });
  });
});

describe('when the prescriber declines the signature', () => {
  it('aborts without storing or anchoring anything', async () => {
    const { issue, recorder } = harness({
      signPrescription: async () => {
        throw new SignerRejectedError();
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({ outcome: 'aborted' });
    expect(recorder.calls).toEqual(['sign']);
  });

  it('aborts when the chain prompt itself is declined', async () => {
    const { issue } = harness({
      issue: async () => {
        throw new SignerRejectedError();
      },
    });

    expect(await issue({ draft: aDraft(), prescriber: PRESCRIBER })).toEqual({
      outcome: 'aborted',
    });
  });
});

describe('when this device has no signing account', () => {
  it('rejects before building the document', async () => {
    const { issue, recorder } = harness({ isAvailable: () => false });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({ outcome: 'rejected', reason: { code: 'signer-unavailable' } });
    expect(recorder.calls).toEqual([]);
  });
});

/**
 * The ordering rule, tested from the failing side: a store that fails must
 * leave the chain untouched, because an anchor without a stored envelope is a
 * receta that verifies on chain and can never be read.
 */
describe('when the off-chain store fails', () => {
  it('rejects and attempts no chain write at all', async () => {
    const { issue, recorder } = harness({
      storeEnvelope: async () => {
        throw new DocumentStoreUnreachableError(CONFIG.apiUrl);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: {
        code: 'store-failed',
        message: 'No hay respuesta del almacén de recetas, así que la receta no llegó a emitirse.',
      },
    });
    expect(recorder.calls).toEqual(['sign', 'store']);
    expect(recorder.issued).toEqual([]);
  });

  it('names the HTTP status when the store refuses the payload', async () => {
    const { issue } = harness({
      storeEnvelope: async () => {
        throw new DocumentStoreRejectedError(413);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: {
        code: 'store-failed',
        message: 'El almacén de recetas rechazó el documento cifrado (HTTP 413).',
      },
    });
  });
});

/**
 * When the anchor fails AFTER the store succeeded, the stored ciphertext is
 * orphaned. That is the acceptable half of the trade: no anchor means no
 * prescription, so nothing can be dispensed against it.
 */
describe('when the contract refuses the issuance', () => {

  /** R4-001. The anchor is broadcast, the RPC drops before the receipt, and a
   * retry that regenerates the material produces a DIFFERENT hash: nothing ever
   * fires `AlreadyIssued`, a second receta anchors, and the first is stranded
   * with no QR and no key. Retrying the SAME attempt is the repair. */
  it('recovers, rather than burns, a retried attempt whose anchor landed', async () => {
    let anchors = 0;
    const { issue } = harness({
      issue: async (request) => {
        anchors += 1;
        if (anchors === 1) throw new ChainUnreachableError(CONFIG.rpcUrl);
        throw revert('AlreadyIssued', [request.contentHash]);
      },
    });

    const first = await issue({ draft: aDraft(), prescriber: PRESCRIBER });
    if (first.outcome !== 'rejected') throw new Error('expected the first anchor to fail');
    const retry = await issue({ draft: aDraft(), prescriber: PRESCRIBER, attempt: first.attempt });

    expect(retry.outcome).toBe('issued');
    if (retry.outcome !== 'issued') return;
    expect(retry.contentHash).toBe(first.attempt?.contentHash);
    // The QR carries the RETAINED key, so the recovered code still decrypts.
    expect(decodeQrPayload(retry.qr).key).toBe(bytesToBase64Url(DEK_BYTES));
  });

  /** R1-001, R3-001. The doctor can go back to the form from a refusal and edit
   * a dose. Re-sealing THAT under the retained (dek, iv) is an AES-GCM nonce
   * reuse: the XOR of both plaintexts, and a forgeable tag. */
  it('never re-seals an edited draft under the retained nonce', async () => {
    const dropped = () => Promise.reject(new ChainUnreachableError(CONFIG.rpcUrl));
    const { issue, recorder } = harness({ issue: dropped });

    const first = await issue({ draft: aDraft(), prescriber: PRESCRIBER });
    const attempt = first.outcome === 'rejected' ? first.attempt : undefined;
    const items = [anItem({ dosageInstruction: '2 cápsulas cada 8 horas' })];
    await issue({ draft: aDraft({ items }), prescriber: PRESCRIBER, attempt });

    const [sealed, resealed] = recorder.stored;
    expect(attempt?.iv).toBeDefined();
    expect(resealed?.document.encryption.iv).not.toBe(sealed?.document.encryption.iv);
  });

  /** R4-001. A transaction that mines with `status: 'reverted'` anchored
   * nothing; reporting it as an issuance hands the patient a dead QR. */
  it('reports a reverted anchor as a refusal, never as an issuance', async () => {
    const reverted = () => Promise.reject(new TransactionRevertedError(TRANSACTION_HASH));
    const result = await harness({ issue: reverted }).issue({ draft: aDraft(), prescriber: PRESCRIBER });

    // The material survives, so a retry re-simulates the same contentHash.
    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: { code: 'transaction-reverted', transactionHash: TRANSACTION_HASH },
      attempt: { contentHash: expect.any(String) },
    });
  });

  it('maps AlreadyIssued onto its own reason, with the contentHash', async () => {
    const { issue, recorder } = harness({
      issue: async (request) => {
        throw revert('AlreadyIssued', [request.contentHash]);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason.code).toBe('already-issued');
    // The envelope was already stored: orphaned, and harmless.
    expect(recorder.stored).toHaveLength(1);
  });

  it('maps NotAccreditedPractitioner onto its own reason, with the account', async () => {
    const { issue } = harness({
      issue: async () => {
        throw revert('NotAccreditedPractitioner', [PRESCRIBER]);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: { code: 'practitioner-credential-missing', account: PRESCRIBER },
    });
  });

  it('maps InvalidExpiry onto its own reason, with the expiry instant', async () => {
    const { issue } = harness({
      issue: async (request) => {
        throw revert('InvalidExpiry', [request.expiresAt]);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toEqual({
      outcome: 'rejected',
      reason: { code: 'invalid-expiry', expiresAt: 1_791_691_200n },
    });
  });

  it('reports an unreachable node as a network failure, never as a verdict', async () => {
    const { issue } = harness({
      issue: async () => {
        throw new ChainUnreachableError(CONFIG.rpcUrl);
      },
    });

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: {
        code: 'network-error',
        message: 'No hay respuesta de la cadena, así que la receta no quedó registrada.',
      },
    });
    // R4-002: the attempt must reach the screen, or the retry burns the anchor.
    expect(result).toMatchObject({ attempt: { contentHash: expect.any(String) } });
  });

  it('rethrows a failure nobody modelled instead of inventing a refusal', async () => {
    const { issue } = harness({
      issue: async () => {
        throw new Error('el nodo devolvió algo inesperado');
      },
    });

    await expect(issue({ draft: aDraft(), prescriber: PRESCRIBER })).rejects.toThrow(
      'el nodo devolvió algo inesperado',
    );
  });
});

describe('form validation', () => {
  it('rejects an empty prescription without touching any port', async () => {
    const { issue, recorder } = harness();

    const result = await issue({ draft: aDraft({ items: [] }), prescriber: PRESCRIBER });

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason.code).toBe('document-invalid');
    expect(recorder.calls).toEqual([]);
  });
});

/**
 * HARD RULE (docs/06, docs/17): "Ninguna alerta clínica bloquea la emisión."
 * The engine is advisory, and a critical alert with no written justification
 * must still leave this use case callable.
 */
describe('clinical alerts never block the issuance', () => {
  it('issues a prescription whose item matches a declared allergy, with no justification', async () => {
    const { issue } = harness();

    const result = await issue({
      draft: aDraft({
        items: [anItem({ activeIngredient: 'amoxicilina' })],
        patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
        justifications: [],
      }),
      prescriber: PRESCRIBER,
    });

    expect(result.outcome).toBe('issued');
  });
});

describe('the DEK', () => {
  it('is the only key material in the QR, and it opens the stored envelope', async () => {
    const { issue, recorder } = harness();

    const result = await issue({ draft: aDraft(), prescriber: PRESCRIBER });
    expect(result.outcome).toBe('issued');
    if (result.outcome !== 'issued') return;

    const envelope = recorder.stored[0]?.document as EncryptedDocument;
    const document = await decryptDocument<PrescriptionDocument>(
      envelope,
      DEK_BYTES,
      result.contentHash,
    );

    expect(document.salt).toBe(saltToHex(SALT_BYTES));
    // The anchored hash covers the inner ciphertext bytes, nothing else.
    expect(base64ToBytes(envelope.ciphertext).length).toBeGreaterThan(0);
  });
});

describe('the injected clock', () => {
  it('derives the expiry from the issuing instant and never from Date.now()', async () => {
    const { issue } = harness();

    const result = await issue({
      draft: aDraft({ validityDays: 1 }),
      prescriber: PRESCRIBER,
    });

    expect(result.outcome).toBe('issued');
    if (result.outcome !== 'issued') return;
    // 2026-09-12T04:00:00Z: midnight in Bolivia of the day after the issuance.
    expect(result.expiresAt).toBe(1_789_185_600n);
  });
});
