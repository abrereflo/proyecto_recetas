import type { Hex } from 'viem';
import {
  base64ToBytes,
  base64UrlToBytes,
  contentHashOf,
  decryptDocument,
  hexToBytes,
  patientCommitment,
} from '@recetas/crypto';
import {
  PrescriptionStatus,
  prescriptionDocumentSchema,
  type PrescriptionDocument,
  type QrPayload,
} from '@recetas/shared';
import {
  accountOf,
  assertChainReachable,
  blockTimestamp,
  buildPublicClient,
  buildWalletClient,
} from '../chain';
import { pharmacyAccount, type CliConfig, type PharmacyKey } from '../config';
import { buildMessage, isSignatureValid } from '../eip712';
import { formatDateTime, formatDay, isoToSeconds, shortAddress } from '../format';
import {
  dispenseOnChain,
  readRecord,
  readState,
  type TransactionOutcome,
} from '../registry';
import { decodeRegistryError, type RegistryRejection } from '../registry-errors';
import { assertQrMatchesDeployment } from './verify';
import { fetchEnvelope } from '../storage';
import * as ui from '../ui';

/**
 * Pharmacy flow, in the exact order of the "dispensar" sequence of
 * docs/05-almacenamiento-y-cifrado.md.
 *
 * Every check is printed as it happens, and every failure names its concrete
 * reason. Collapsing "already dispensed" and "tampered content" into a generic
 * failure turns two very different situations into the same shrug
 * (docs/17-diseno-y-experiencia.md).
 */

export type DispenseResult =
  | { dispensed: true; outcome: TransactionOutcome; document: PrescriptionDocument }
  | { dispensed: false; rejection: RegistryRejection };

const TOTAL_STEPS = 7;

function reject(rejection: RegistryRejection): DispenseResult {
  ui.verdictBox(rejection.title, 'reject');
  for (const paragraph of rejection.detail.split('\n')) {
    ui.line(ui.boldRed(paragraph));
  }
  ui.line();
  ui.line(rejection.action);
  ui.note(`Motivo técnico: ${rejection.code}`);

  return { dispensed: false, rejection };
}

export async function runDispense(
  config: CliConfig,
  qr: QrPayload,
  pharmacyKey: PharmacyKey,
): Promise<DispenseResult> {
  const publicClient = buildPublicClient(config);
  const pharmacy = pharmacyAccount(pharmacyKey);
  const account = accountOf(pharmacy.privateKey);
  const walletClient = buildWalletClient(config, pharmacy.privateKey);
  const contentHash = qr.contentHash as Hex;

  await assertChainReachable(publicClient, config.rpcUrl);
  assertQrMatchesDeployment(config, qr);

  ui.heading(`DISPENSACIÓN — ${pharmacy.label}`);
  ui.info('Farmacia', `${account.address} (${shortAddress(account.address)})`);
  ui.info('contentHash', contentHash);

  // 1. Ask the chain first. Nothing is downloaded or decrypted otherwise.
  const blockTime = await blockTimestamp(publicClient);
  const state = await readState(publicClient, config, contentHash, blockTime);

  ui.step(1, TOTAL_STEPS, 'Consulta verify() en la cadena');
  ui.info('estado', state.label);
  ui.info('dispensable', state.dispensable ? 'sí' : 'no');
  if (state.status !== PrescriptionStatus.None) {
    ui.info('prescriptor', shortAddress(state.prescriber));
    ui.info('vence', formatDay(state.expiresAt));
  }

  if (!state.dispensable) {
    // The chain is the authority on why. Sending the transaction makes the
    // contract emit its own custom error, which is what gets decoded and shown.
    ui.fail('La cadena no autoriza la entrega. Se consulta el motivo exacto al contrato.');

    try {
      await dispenseOnChain(publicClient, walletClient, account, config, contentHash);
    } catch (error) {
      const rejection = decodeRegistryError(error);
      if (rejection === undefined) throw error;
      return reject(rejection);
    }

    throw new Error(
      'Estado inconsistente: verify() informó no dispensable y dispense() no revirtió.',
    );
  }
  ui.ok('La receta está vigente y no ha sido dispensada.');

  // 2. Download the sealed envelope.
  const envelope = await fetchEnvelope(config, qr.pointer);
  ui.step(2, TOTAL_STEPS, 'Documento cifrado descargado del almacén off-chain');
  ui.info('pointer', qr.pointer);

  // 3. Integrity, BEFORE decryption.
  const storedHash = contentHashOf(base64ToBytes(envelope.ciphertext));
  ui.step(3, TOTAL_STEPS, 'Verificación de integridad keccak256(ciphertext) == contentHash');
  if (storedHash.toLowerCase() !== contentHash.toLowerCase()) {
    ui.fail(`El documento almacenado tiene la huella ${storedHash}.`);
    return reject({
      code: 'ContentHashMismatch',
      title: 'CONTENIDO ALTERADO',
      detail:
        'El documento guardado fuera de la cadena no coincide con la huella\n' +
        'que el médico registró al emitir la receta.',
      action:
        'No entregue el medicamento. Avise a la clínica emisora: el contenido fue ' +
        'modificado o sustituido después de la emisión.',
    });
  }
  ui.ok(`Huella coincidente: ${storedHash}`);

  // 4. Decrypt with the key carried in the QR.
  ui.step(4, TOTAL_STEPS, 'Descifrado con la clave del código QR');
  let document: PrescriptionDocument;
  try {
    const decrypted = await decryptDocument<unknown>(
      envelope,
      base64UrlToBytes(qr.key),
      contentHash,
    );
    document = prescriptionDocumentSchema.parse(decrypted) as PrescriptionDocument;
  } catch {
    return reject({
      code: 'DecryptionFailed',
      title: 'NO SE PUEDE DESCIFRAR',
      detail:
        'La clave que viaja en el código QR no abre este documento, o el\n' +
        'contenido descifrado no tiene la forma de una receta.',
      action:
        'No entregue el medicamento. Pida al paciente el código original emitido por el médico.',
    });
  }
  ui.ok('Documento descifrado y validado contra el esquema de receta.');

  // 5. Prescriber signature.
  ui.step(5, TOTAL_STEPS, 'Verificación de la firma EIP-712 del prescriptor');
  const record = await readRecord(publicClient, config, contentHash);
  const signer = envelope.signatures.eip712.signer as Hex;

  if (signer.toLowerCase() !== record.prescriber.toLowerCase()) {
    return reject({
      code: 'SignerMismatch',
      title: 'FIRMA NO VÁLIDA',
      detail:
        `El documento está firmado por ${shortAddress(signer)}, pero la receta\n` +
        `fue registrada por ${shortAddress(record.prescriber)}.`,
      action: 'No entregue el medicamento. Avise a la clínica emisora.',
    });
  }

  const message = buildMessage({
    contentHash,
    patientCommitment: record.patientCommitment,
    prescriber: record.prescriber,
    issuedAt: isoToSeconds(document.issuedAt),
    expiresAt: record.expiresAt,
  });

  const signatureValid = await isSignatureValid(
    config,
    record.prescriber,
    message,
    envelope.signatures.eip712.value as Hex,
  );

  if (!signatureValid) {
    return reject({
      code: 'InvalidSignature',
      title: 'FIRMA NO VÁLIDA',
      detail:
        'La firma EIP-712 no corresponde a los datos registrados en la cadena\n' +
        'para esta receta.',
      action: 'No entregue el medicamento. Avise a la clínica emisora.',
    });
  }
  ui.ok(`Firma válida de ${shortAddress(record.prescriber)} (${document.practitioner.fullName}).`);
  ui.note(
    `Firma legal ADSIB: ${envelope.signatures.adsib?.status ?? 'no incluida'} — no se simula validez jurídica.`,
  );

  // 6. Correspondence between the decrypted patient and the anchored commitment.
  ui.step(6, TOTAL_STEPS, 'Correspondencia keccak256(patientId, sal) == patientCommitment');
  const recomputed = patientCommitment(document.patient.patientId, hexToBytes(document.salt));

  if (recomputed.toLowerCase() !== record.patientCommitment.toLowerCase()) {
    return reject({
      code: 'CommitmentMismatch',
      title: 'PACIENTE NO COINCIDE',
      detail:
        'El paciente del documento descifrado no corresponde al compromiso\n' +
        'anclado en la cadena para esta receta.',
      action: 'No entregue el medicamento. Avise a la clínica emisora.',
    });
  }
  ui.ok('El paciente del documento es el mismo que se ancló al emitir.');

  // Show the prescription before the irreversible act.
  ui.heading('RECETA VERIFICADA');
  ui.info('Paciente', `${document.patient.fullName} · ${document.patient.patientId}`);
  ui.info('Nacimiento', document.patient.birthDate);
  ui.info(
    'Prescriptor',
    `${document.practitioner.fullName} · matrícula ${document.practitioner.licenseNumber}`,
  );
  for (const item of document.items) {
    ui.line(
      `  • ${item.activeIngredient} ${item.strength} (${item.doseForm}) ×${item.quantity}\n` +
        `    ${item.dosageInstruction}  [ATC ${item.atcCode}]`,
    );
  }

  // 7. The irreversible act.
  ui.step(7, TOTAL_STEPS, 'Registro de la dispensación en la cadena');
  let outcome: TransactionOutcome;
  try {
    outcome = await dispenseOnChain(publicClient, walletClient, account, config, contentHash);
  } catch (error) {
    const rejection = decodeRegistryError(error);
    if (rejection === undefined) throw error;
    return reject(rejection);
  }

  const dispensedRecord = await readRecord(publicClient, config, contentHash);

  ui.verdictBox('ENTREGA AUTORIZADA', 'accept');
  ui.line(ui.boldGreen('Comprobante de dispensación'));
  ui.info('Farmacia', `${dispensedRecord.dispensedBy} (${shortAddress(dispensedRecord.dispensedBy)})`);
  ui.info('Fecha', formatDateTime(dispensedRecord.dispensedAt));
  ui.info('contentHash', contentHash);
  ui.info('transacción', outcome.hash);
  ui.info('bloque', String(outcome.blockNumber));
  ui.note('Esta receta queda dispensada para siempre: no existe función de reapertura.');

  return { dispensed: true, outcome, document };
}
