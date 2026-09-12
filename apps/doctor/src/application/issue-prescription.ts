import { buildMessage } from '@recetas/chain';
import {
  bytesToBase64Url,
  contentHashOf,
  generateDek as defaultGenerateDek,
  generateIv,
  generateSalt as defaultGenerateSalt,
  patientCommitment,
  saltToHex,
  sealDocument,
  utf8ToBytes,
} from '@recetas/crypto';
import {
  QR_PAYLOAD_VERSION,
  encodeQrPayload,
  type Address,
  type Bytes32,
  type DocumentSignatures,
  type Hex,
  type QrPayload,
} from '@recetas/shared';
import { buildPrescriptionDocument, validateDraft, type PrescriptionDraft } from '../domain/draft';
import type { IssueAttempt, IssueResult, IssueStepId } from '../domain/issuance';
import { ChainUnreachableError, TransactionRevertedError, type ChainPort } from '../ports/chain.port';
import {
  DocumentStoreRejectedError,
  DocumentStoreUnreachableError,
  MalformedStoreResponseError,
  type DocumentPort,
} from '../ports/document.port';
import { SignerRejectedError, SignerUnavailableError, type SignerPort } from '../ports/signer.port';
import { decodeIssueRejection } from '../infrastructure/chain/issue-errors';
import type { DoctorConfig } from '../infrastructure/config/env';

/**
 * Screens D5 and D6: issuing a prescription, in the browser.
 *
 * This reproduces the "emitir" sequence of docs/05-almacenamiento-y-cifrado.md
 * that apps/cli/src/commands/issue.ts follows step by step, with one difference
 * that is the whole reason this file exists: the EIP-712 signature is produced
 * through an EIP-1193 provider (`SignerPort`), not with a local private key.
 *
 * THE ORDER OF THE LAST TWO STEPS IS A CORRECTNESS PROPERTY, not a preference.
 * The envelope is stored off-chain BEFORE the on-chain anchor:
 *
 *  - store fails, nothing anchored → the receta simply does not exist. Nothing
 *    was registered, nothing can be dispensed, and retrying is safe.
 *  - anchor fails, envelope already stored → the stored ciphertext is orphaned
 *    and harmless: with no anchor there is no prescription, and an unreferenced
 *    blob nobody can decrypt is not a leak.
 *
 * Reversed, the failure is unrepairable: an anchored `contentHash` pointing at a
 * pointer that was never stored is a receta that verifies on chain and cannot be
 * read at the counter — and it cannot even be re-issued, because `AlreadyIssued`
 * refuses the same content a second time.
 *
 * HARD RULE (docs/03, docs/17): `patientId` and `salt` never reach the chain.
 * Only `patientCommitment` does. The salt goes to the off-chain store and into
 * the encrypted document, and NEVER into the QR — `QrPayload` has no field for
 * it, which is what makes the rule structural.
 *
 * HARD RULE (docs/06, docs/17): no clinical alert blocks an issuance. This
 * module does not import the rules engine, does not read
 * `draft.justifications`, and has no branch that could refuse on clinical
 * grounds. A critical alert demands a written motive on screen D4; that is a
 * property of the D4 modal, not a gate here.
 *
 * HARD RULE (D-17, docs/17): the ADSIB signature is always declared and always
 * `pending-integration`. Simulating legal validity is the one thing this file
 * must never do.
 */

/** ADSIB stays declared and unintegrated (D-17). Never a simulated validity. */
const ADSIB_PENDING = {
  certificateSerial: '',
  value: '',
  status: 'pending-integration',
} as const;

export interface IssuePrescriptionDeps {
  chain: ChainPort;
  documents: DocumentPort;
  signer: SignerPort;
  config: DoctorConfig;
  /** Injected for tests. One fresh 32-byte salt per prescription (docs/03). */
  generateSalt?: () => Uint8Array;
  /** Injected for tests. One fresh DEK per prescription, never reused. */
  generateDek?: () => Uint8Array;
  /** The issuing instant. Injected so the expiry derivation is reproducible. */
  now?: () => Date;
}

export interface IssuePrescriptionInput {
  draft: PrescriptionDraft;
  /** The account that signs and that the chain will record as `prescriber`. */
  prescriber: Address;
  /** The attempt to RETRY, surfaced on an unanswered anchor: passing it back
   * repeats the same `contentHash` instead of issuing a second receta. */
  attempt?: IssueAttempt;
  /** Progress for screen D5. Called once per completed step, in order. */
  onStep?: (step: IssueStepId) => void;
}

export type IssuePrescription = (input: IssuePrescriptionInput) => Promise<IssueResult>;

/** An attempt's material before it is bound, and the fingerprint that binds it. */
type IssueMaterial = Omit<IssueAttempt, 'documentHash' | 'contentHash'>;
const fingerprintOf = (doc: unknown): Hex => contentHashOf(utf8ToBytes(JSON.stringify(doc)));

export function createIssuePrescription(deps: IssuePrescriptionDeps): IssuePrescription {
  const { chain, documents, signer, config } = deps;
  const generateSalt = deps.generateSalt ?? defaultGenerateSalt;
  const generateDek = deps.generateDek ?? defaultGenerateDek;
  const now = deps.now ?? (() => new Date());

  const fresh = (): IssueMaterial => ({ salt: generateSalt(), dek: generateDek(), iv: generateIv(), issuedAt: now() });

  return async ({ draft, prescriber, attempt: retried, onStep }) => {
    const step = (id: IssueStepId): void => onStep?.(id);

    // --- Form validation. NOT clinical validation: the rules engine is
    // advisory and never reaches this pipeline (docs/06).
    const issues = validateDraft(draft);
    if (issues.length > 0) {
      return { outcome: 'rejected', reason: { code: 'document-invalid', issues } };
    }

    if (!signer.isAvailable()) {
      return { outcome: 'rejected', reason: { code: 'signer-unavailable' } };
    }

    // --- 1. The clinical document. It never leaves this browser in the clear.
    //
    // A RETRY REUSES `dek` AND `iv` ONLY FOR A BYTE-IDENTICAL DOCUMENT, read off
    // the document and never taken on the caller's word (R1-001, R3-001): the
    // doctor returns from a refusal, edits a dose, and re-sealing THAT under the
    // retained (key, nonce) pair is an AES-GCM nonce reuse — the XOR of both
    // plaintexts to whoever reads both envelopes, and a forgeable tag.
    // ORDERING: `salt` is a field of the document, so the fingerprint exists only
    // once one is BUILT with a candidate salt. The material therefore builds a
    // candidate FIRST and is kept only if it hashes to the stored fingerprint.
    const build = (material: IssueMaterial) => {
      const doc = buildPrescriptionDocument({ draft, salt: material.salt, issuedAt: material.issuedAt });
      return { ...doc, attempt: { ...material, documentHash: fingerprintOf(doc.document) } };
    };

    let built = build(retried ?? fresh());
    if (retried !== undefined && built.attempt.documentHash !== retried.documentHash) built = build(fresh());
    const { document, issuedAtSeconds, expiresAtSeconds, attempt } = built;
    const { salt } = attempt;
    step('document');

    // --- 2. Commitment. The salt stays off-chain; only this is anchored.
    const commitment = patientCommitment(document.patient.patientId, salt) as Bytes32;
    step('commitment');

    // --- 3 and 4. Encrypt, then sign the resulting contentHash.
    // The prescriber signs the anchored `contentHash`, so the signature cannot
    // exist before the ciphertext does; `sealDocument` owns that ordering.
    const { dek } = attempt;

    let envelope;
    let contentHash: Bytes32;
    try {
      const sealed = await sealDocument(document, dek, {
        iv: attempt.iv,
        sign: async (hash): Promise<DocumentSignatures> => {
          step('seal');

          const message = buildMessage({
            contentHash: hash,
            patientCommitment: commitment as Hex,
            prescriber,
            issuedAt: issuedAtSeconds,
            expiresAt: expiresAtSeconds,
          });

          const signature = await signer.signPrescription({ prescriber, message });
          step('sign');

          return {
            eip712: { signer: prescriber, value: signature },
            // D-17: declared, unintegrated, never simulated as legally valid.
            adsib: { ...ADSIB_PENDING },
          };
        },
      });

      envelope = sealed.document;
      contentHash = sealed.contentHash as Bytes32;
    } catch (error) {
      if (error instanceof SignerRejectedError) return { outcome: 'aborted' };
      if (error instanceof SignerUnavailableError) {
        return { outcome: 'rejected', reason: { code: 'signer-unavailable' } };
      }
      throw error;
    }

    // --- 5. Off-chain store, BEFORE the anchor. The DEK never leaves this
    // browser; the salt is written here and never read back (docs/03).
    let pointer: string;
    try {
      const stored = await documents.storeEnvelope({ document: envelope, saltHex: saltToHex(salt) });
      pointer = stored.pointer;
    } catch (error) {
      // Nothing was anchored, so nothing exists. Returning here — instead of
      // anchoring anyway — is what keeps the failure repairable.
      return { outcome: 'rejected', reason: { code: 'store-failed', message: storeFailure(error) } };
    }
    step('store');

    // --- 6. Anchor on chain. Only the commitment, the hash and the expiry.
    let transactionHash: Hex | undefined;
    try {
      const receipt = await chain.issue({
        contentHash,
        patientCommitment: commitment,
        expiresAt: expiresAtSeconds,
        prescriber,
      });
      transactionHash = receipt.transactionHash;
    } catch (error) {
      if (error instanceof SignerRejectedError) return { outcome: 'aborted' };

      // Mined and refused: the receipt arrived, the anchor did not (R4-001). A
      // refusal like any other revert, keeping the material so a retry
      // re-simulates the same hash and the contract names the reason.
      if (error instanceof TransactionRevertedError) {
        const reason = { code: 'transaction-reverted', transactionHash: error.transactionHash } as const;
        return { outcome: 'rejected', attempt: { ...attempt, contentHash }, reason };
      }

      // The contract is the authority on why. `AlreadyIssued` carries the hash,
      // `NotAccreditedPractitioner` the account, `InvalidExpiry` the instant.
      const rejection = decodeIssueRejection(error);
      // `AlreadyIssued` for the hash of the attempt BEING RETRIED is the
      // contract confirming the unobserved broadcast landed: rebuild the QR.
      const reused = retried?.documentHash === attempt.documentHash;
      const recovered =
        rejection?.code === 'already-issued' && reused && retried?.contentHash === rejection.contentHash;
      if (rejection !== undefined && !recovered) return { outcome: 'rejected', reason: rejection };

      if (error instanceof ChainUnreachableError) {
        return {
          outcome: 'rejected',
          attempt: { ...attempt, contentHash },
          reason: {
            code: 'network-error',
            message: 'No hay respuesta de la cadena, así que la receta no quedó registrada.',
          },
        };
      }

      // An error nobody modelled must not be dressed up as a verdict for the
      // consulting room (docs/17: never a generic "operación fallida").
      if (!recovered) throw error;
    }
    step('anchor');

    // --- 7. The QR the patient carries.
    // It carries the DEK (D-24) and NEVER the salt: `QrPayload` has no salt
    // field, and adding one would break the commitment's only protection.
    const qrPayload: QrPayload = {
      v: QR_PAYLOAD_VERSION,
      chainId: config.chainId,
      registry: config.registryAddress,
      contentHash,
      pointer,
      key: bytesToBase64Url(dek),
    };

    const qr = encodeQrPayload(qrPayload);
    step('qr');

    return {
      outcome: 'issued',
      qr,
      qrPayload,
      contentHash,
      transactionHash,
      expiresAt: expiresAtSeconds,
    };
  };
}

/** One distinct sentence per way the store can fail (docs/17). */
function storeFailure(error: unknown): string {
  if (error instanceof DocumentStoreUnreachableError) {
    return 'No hay respuesta del almacén de recetas, así que la receta no llegó a emitirse.';
  }
  if (error instanceof DocumentStoreRejectedError) {
    return `El almacén de recetas rechazó el documento cifrado (HTTP ${error.status}).`;
  }
  if (error instanceof MalformedStoreResponseError) {
    return 'El almacén de recetas no devolvió un puntero válido para este documento.';
  }
  return 'No se pudo guardar el documento cifrado de esta receta.';
}
