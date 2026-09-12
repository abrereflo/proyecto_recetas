import {
  base64ToBytes,
  base64UrlToBytes,
  contentHashOf,
  decryptDocument,
  hexToBytes,
  patientCommitment,
} from '@recetas/crypto';
import {
  prescriptionDocumentSchema,
  type Address,
  type Bytes32,
  type EncryptedDocument,
  type Hex,
  type PrescriptionDocument,
  type PrescriptionRecord,
  type QrPayload,
} from '@recetas/shared';
import type { RejectionReason } from '../domain/rejection';
import {
  abortAt,
  evaluateChainState,
  rejectAt,
  runVerification,
  type DocumentEvidence,
  type VerificationOutcome,
} from '../domain/verification';
import { ChainUnreachableError, type ChainPort } from '../ports/chain.port';
import {
  DocumentNotFoundError,
  DocumentStoreUnreachableError,
  MalformedEnvelopeError,
  type DocumentPort,
} from '../ports/document.port';
import type { PrescriberSignatureVerifier } from '../ports/signer.port';
import type { PharmacyConfig } from '../infrastructure/config/env';

/**
 * Screen P3: verification, in the exact order of the "dispensar" sequence of
 * docs/05 and of the five lines of docs/17.
 *
 * The chain is asked FIRST. Nothing is downloaded and nothing is decrypted
 * until the chain has said the prescription exists and is still dispensable,
 * and the integrity check runs BEFORE decryption.
 *
 * This use case NEVER dispenses. Confirming the delivery is a separate,
 * deliberate human act (docs/17, P4) and lives in dispense-prescription.ts.
 *
 * HARD RULE (docs/03, docs/17): the patient identifier and the commitment salt
 * recovered here stay inside the decrypted document. They are used to recompute
 * a keccak256 and are never logged, never put in a URL and never sent to the
 * chain.
 */

export interface VerifyPrescriptionDeps {
  chain: ChainPort;
  documents: DocumentPort;
  signatures: PrescriberSignatureVerifier;
  config: PharmacyConfig;
}

export interface VerifyPrescriptionInput {
  qr: QrPayload;
}

export type VerifyPrescription = (input: VerifyPrescriptionInput) => Promise<VerificationOutcome>;

/** ISO 8601 to Unix seconds, as the EIP-712 message expects. */
export function isoToSeconds(iso: string): bigint {
  const millis = Date.parse(iso);
  return Number.isNaN(millis) ? 0n : BigInt(Math.floor(millis / 1000));
}

/**
 * A QR pointing at a different deployment would be answered by the wrong
 * contract, which is worse than not answering at all.
 *
 * It lands on `wrong-deployment`, never on `network-error`: nothing was asked
 * of the network and nothing failed, so telling the pharmacist to check the
 * connection would send them to repair something that is not broken
 * (domain/rejection.ts).
 */
function deploymentMismatch(config: PharmacyConfig, qr: QrPayload): RejectionReason | undefined {
  const sameChain = qr.chainId === config.chainId;
  const sameRegistry = qr.registry.toLowerCase() === config.registryAddress.toLowerCase();

  if (sameChain && sameRegistry) return undefined;

  return {
    code: 'wrong-deployment',
    expectedChainId: config.chainId,
    actualChainId: qr.chainId,
    expectedRegistry: config.registryAddress,
    actualRegistry: qr.registry,
  };
}

export function createVerifyPrescription(deps: VerifyPrescriptionDeps): VerifyPrescription {
  const { chain, documents, signatures, config } = deps;

  return async ({ qr }) => {
    const mismatch = deploymentMismatch(config, qr);
    if (mismatch !== undefined) return abortAt('registered', mismatch);

    const contentHash = qr.contentHash as Bytes32;

    // --- Checks 1 and 2: the chain, before anything else --------------------
    let referenceTimestamp: bigint;
    let chainState: Awaited<ReturnType<ChainPort['verify']>>;
    let record: PrescriptionRecord;

    try {
      referenceTimestamp = await chain.blockTimestamp();
      chainState = await chain.verify(contentHash);
      record = await chain.getPrescription(contentHash);
    } catch (error) {
      return abortAt('registered', {
        code: 'network-error',
        message:
          error instanceof ChainUnreachableError
            ? 'No se pudo consultar el registro de recetas en la cadena.'
            : 'La consulta a la cadena no se pudo completar.',
      });
    }

    const chainVerdict = evaluateChainState(chainState, record, referenceTimestamp);
    if (!chainVerdict.ok) {
      // Runs the pure pipeline so the five lines come out of one place.
      return runVerification({ referenceTimestamp, chain: chainState, record });
    }

    // --- Check 3: integrity, before any decryption --------------------------
    let envelope: EncryptedDocument;
    try {
      envelope = await documents.fetchEnvelope(qr.pointer);
    } catch (error) {
      return abortAt('integrity', {
        code: 'network-error',
        message: describeStoreFailure(error),
      });
    }

    const storedContentHash = contentHashOf(base64ToBytes(envelope.ciphertext));

    // --- Decryption, only once the integrity check has passed ---------------
    // `decryptDocument` re-checks the content hash before touching the key, so
    // the order of docs/05 holds even if this call site ever moves.
    let document: PrescriptionDocument;
    if (storedContentHash.toLowerCase() === contentHash.toLowerCase()) {
      try {
        const decrypted = await decryptDocument<unknown>(
          envelope,
          base64UrlToBytes(qr.key),
          contentHash,
        );
        document = prescriptionDocumentSchema.parse(decrypted) as PrescriptionDocument;
      } catch {
        // The anchored hash matched but the bytes will not open into a
        // prescription: the key in the code is not this document's key, or the
        // plaintext is not a receta. Either way the content is not what was
        // registered, which is what `integrity-failed` says at the counter.
        return rejectAt('integrity', {
          code: 'integrity-failed',
          anchoredContentHash: contentHash,
          storedContentHash,
        });
      }
    } else {
      return rejectAt('integrity', {
        code: 'integrity-failed',
        anchoredContentHash: contentHash,
        storedContentHash,
      });
    }

    // --- Checks 4 and 5: signature and patient correspondence ---------------
    const signer = envelope.signatures.eip712.signer as Address;
    const signatureValid = await signatures.verify({
      prescriber: record.prescriber,
      contentHash,
      patientCommitment: record.patientCommitment,
      issuedAt: isoToSeconds(document.issuedAt),
      expiresAt: record.expiresAt,
      signature: envelope.signatures.eip712.value as Hex,
    });

    const evidence: DocumentEvidence = {
      document,
      storedContentHash,
      anchoredContentHash: contentHash,
      signer,
      signatureValid,
      recomputedPatientCommitment: patientCommitment(
        document.patient.patientId,
        hexToBytes(document.salt),
      ),
    };

    return runVerification({ referenceTimestamp, chain: chainState, record, document: evidence });
  };
}

function describeStoreFailure(error: unknown): string {
  if (error instanceof DocumentNotFoundError) {
    return 'El almacén no tiene el documento de esta receta, así que no se pudo comprobar su contenido.';
  }
  if (error instanceof MalformedEnvelopeError) {
    return 'El documento almacenado para esta receta no se pudo leer.';
  }
  if (error instanceof DocumentStoreUnreachableError) {
    return 'No hay respuesta del almacén de recetas.';
  }
  return 'No se pudo recuperar el documento de esta receta.';
}
