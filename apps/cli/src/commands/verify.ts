import type { Hex } from 'viem';
import { PrescriptionStatus, type QrPayload } from '@recetas/shared';
import { assertChainReachable, blockTimestamp, buildPublicClient } from '../chain';
import type { CliConfig } from '../config';
import { formatDateTime, formatDay, shortAddress } from '../format';
import { readRecord, readState, type RegistryState } from '../registry';
import * as ui from '../ui';

/**
 * Read-only inspection of a prescription. No gas, no state change.
 */

/**
 * A QR pointing at a different deployment would be answered by the wrong
 * contract, which is worse than not answering at all.
 */
export function assertQrMatchesDeployment(config: CliConfig, qr: QrPayload): void {
  if (qr.chainId !== config.chainId) {
    throw new Error(
      `El QR pertenece a la cadena ${qr.chainId} y esta CLI está conectada a la ${config.chainId}.`,
    );
  }

  if (qr.registry.toLowerCase() !== config.registryAddress.toLowerCase()) {
    throw new Error(
      `El QR apunta al registro ${qr.registry} y esta CLI consulta ${config.registryAddress}.`,
    );
  }
}

export async function runVerify(config: CliConfig, qr: QrPayload): Promise<RegistryState> {
  const publicClient = buildPublicClient(config);
  await assertChainReachable(publicClient, config.rpcUrl);
  assertQrMatchesDeployment(config, qr);

  const blockTime = await blockTimestamp(publicClient);
  const state = await readState(publicClient, config, qr.contentHash as Hex, blockTime);

  ui.heading('VERIFICACIÓN EN CADENA');
  ui.info('contentHash', qr.contentHash);
  ui.info('registro', config.registryAddress);
  ui.info('estado', state.label);
  ui.info('dispensable', state.dispensable ? 'sí' : 'no');
  ui.info(
    'prescriptor',
    state.status === PrescriptionStatus.None
      ? '—'
      : `${state.prescriber} (${shortAddress(state.prescriber)})`,
  );
  ui.info('vence', state.expiresAt === 0n ? '—' : formatDay(state.expiresAt));
  ui.note(`Hora del bloque: ${formatDateTime(blockTime)}`);

  if (state.expired) {
    ui.line();
    ui.line(
      ui.yellow(
        'La receta sigue en estado Emitida en la cadena, pero ya caducó: ' +
          '"Caducada" no existe en el enum, se deriva comparando expiresAt con la hora del bloque.',
      ),
    );
  }

  if (state.status === PrescriptionStatus.Dispensed) {
    const record = await readRecord(publicClient, config, qr.contentHash as Hex);
    ui.line();
    ui.info('dispensada el', formatDateTime(record.dispensedAt));
    ui.info('dispensada por', `${record.dispensedBy} (${shortAddress(record.dispensedBy)})`);
  }

  return state;
}
