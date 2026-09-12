import { writeFileSync } from 'node:fs';
import type { Hex } from 'viem';
import {
  bytesToBase64Url,
  generateDek,
  generateSalt,
  patientCommitment,
  saltToHex,
  sealDocument,
} from '@recetas/crypto';
import { QR_PAYLOAD_VERSION, encodeQrPayload, type QrPayload } from '@recetas/shared';
import { accountOf, assertChainReachable, buildPublicClient, buildWalletClient } from '../chain';
import { ANVIL_ACCOUNTS, type CliConfig } from '../config';
import { buildMessage, describeMessage, signPrescription } from '../eip712';
import { formatDay, isoToSeconds, shortAddress } from '../format';
import { buildDraft, type DraftOptions } from '../prescription-draft';
import { renderQrAscii } from '../qr';
import { issueOnChain } from '../registry';
import { assertStoreReachable, storeEnvelope } from '../storage';
import { decodeRegistryError } from '../registry-errors';
import * as ui from '../ui';

/**
 * Doctor flow, following the "emitir" sequence of
 * docs/05-almacenamiento-y-cifrado.md step by step.
 */

export interface IssueOptions extends DraftOptions {
  /** File to write the QR payload to, so other commands can read it back. */
  out?: string | undefined;
  /** Skip the ASCII QR when the output is being piped somewhere. */
  noQrArt?: boolean | undefined;
}

export interface IssueOutcome {
  qr: QrPayload;
  contentHash: Hex;
  patientCommitment: Hex;
  pointer: string;
  expiresAtSeconds: bigint;
}

const TOTAL_STEPS = 6;

export async function runIssue(config: CliConfig, options: IssueOptions): Promise<IssueOutcome> {
  const publicClient = buildPublicClient(config);
  const doctor = accountOf(ANVIL_ACCOUNTS.doctor.privateKey);
  const walletClient = buildWalletClient(config, ANVIL_ACCOUNTS.doctor.privateKey);

  await assertChainReachable(publicClient, config.rpcUrl);
  await assertStoreReachable(config);

  ui.heading('EMISIÓN DE RECETA — consultorio');
  ui.info('Médico', `${ANVIL_ACCOUNTS.doctor.label} · ${shortAddress(doctor.address)}`);

  // 1. The clinical document. It never leaves this process in the clear.
  const salt = generateSalt();
  const { document, expiresAtSeconds } = buildDraft(salt, options);

  ui.step(1, TOTAL_STEPS, 'Documento clínico preparado');
  ui.info('Paciente', `${document.patient.fullName} · ${document.patient.patientId}`);
  for (const item of document.items) {
    ui.info(
      'Medicamento',
      `${item.activeIngredient} ${item.strength} (${item.doseForm}) ×${item.quantity} — ${item.dosageInstruction} [ATC ${item.atcCode}]`,
    );
  }
  ui.info('Vence', formatDay(expiresAtSeconds));

  // 2. Commitment. The salt stays off-chain; only the commitment is anchored.
  const commitment = patientCommitment(document.patient.patientId, salt);
  ui.step(2, TOTAL_STEPS, 'Compromiso del paciente calculado');
  ui.info('patientCommitment', commitment);
  ui.note('keccak256(patientId, sal). La sal no viaja en el QR ni llega a la cadena.');

  // 3-4. Encrypt, then sign the resulting contentHash.
  const dek = generateDek();
  const issuedAtSeconds = isoToSeconds(document.issuedAt);

  const { document: envelope, contentHash } = await sealDocument(document, dek, {
    sign: async (hash) => {
      ui.step(3, TOTAL_STEPS, 'Documento cifrado con AES-256-GCM');
      ui.info('contentHash', hash);

      const message = buildMessage({
        contentHash: hash,
        patientCommitment: commitment,
        prescriber: doctor.address,
        issuedAt: issuedAtSeconds,
        expiresAt: expiresAtSeconds,
      });

      const signature = await signPrescription(doctor, config, message);

      ui.step(4, TOTAL_STEPS, 'Firma EIP-712 del prescriptor');
      for (const sentence of describeMessage(message)) {
        ui.note(sentence);
      }
      ui.info('firma', `${signature.slice(0, 22)}…`);

      return {
        eip712: { signer: doctor.address, value: signature },
        // ADSIB stays declared and unintegrated: the CLI must never simulate
        // legal validity (D-17, docs/17-diseno-y-experiencia.md).
        adsib: { certificateSerial: '', value: '', status: 'pending-integration' as const },
      };
    },
  });

  // 5. Off-chain store. Ciphertext and salt; the DEK never leaves the client.
  const pointer = await storeEnvelope(config, envelope, saltToHex(salt));
  ui.step(5, TOTAL_STEPS, 'Documento cifrado guardado fuera de la cadena');
  ui.info('pointer', pointer);

  // 6. Anchor on-chain.
  try {
    const outcome = await issueOnChain(publicClient, walletClient, doctor, config, {
      contentHash,
      patientCommitment: commitment,
      expiresAt: expiresAtSeconds,
    });

    ui.step(6, TOTAL_STEPS, 'Receta registrada en la cadena');
    ui.info('transacción', outcome.hash);
    ui.info('bloque', String(outcome.blockNumber));
    ui.info('gas', String(outcome.gasUsed));
  } catch (error) {
    const rejection = decodeRegistryError(error);
    if (rejection === undefined) throw error;

    ui.verdictBox(rejection.title, 'reject');
    ui.line(ui.red(rejection.detail));
    ui.line(rejection.action);
    throw new Error(`La emisión fue rechazada por el contrato (${rejection.code}).`);
  }

  const qr: QrPayload = {
    v: QR_PAYLOAD_VERSION,
    chainId: config.chainId,
    registry: config.registryAddress,
    contentHash,
    pointer,
    key: bytesToBase64Url(dek),
  };

  const encoded = encodeQrPayload(qr);

  ui.heading('CÓDIGO QR PARA EL PACIENTE');
  ui.line(encoded);
  ui.line();
  ui.line(
    ui.yellow('Advertencia: quien tenga este código puede leer la receta, igual que el papel.'),
  );

  if (options.noQrArt !== true) {
    ui.line(await renderQrAscii(encoded));
  }

  if (options.out !== undefined) {
    writeFileSync(options.out, `${encoded}\n`, 'utf8');
    ui.info('QR guardado en', options.out);
  }

  // Returned so `receta demo` can chain the pharmacy step without a file.
  return {
    qr,
    contentHash,
    patientCommitment: commitment,
    pointer,
    expiresAtSeconds,
  };
}
