import {
  createCheckCredential,
  type CheckCredential,
} from '../../application/check-credential';
import {
  createDispensePrescription,
  type DispensePrescription,
} from '../../application/dispense-prescription';
import {
  createVerifyPrescription,
  type VerifyPrescription,
} from '../../application/verify-prescription';
import {
  createPrescriberSignatureVerifier,
  createViemChainAdapter,
} from '../../infrastructure/chain/viem-chain.adapter';
import type { PharmacyConfig } from '../../infrastructure/config/env';
import { createHttpDocumentAdapter } from '../../infrastructure/document/http-document.adapter';
import { createEip1193Signer } from '../../infrastructure/signer/eip1193-signer.adapter';
import { createLocalKeySigner } from '../../infrastructure/signer/local-key-signer.adapter';
import type { DeviceKeyPort } from '../../ports/device-key.port';
import type { SignerPort } from '../../ports/signer.port';

/**
 * Composition root.
 *
 * The only place in the application where a concrete adapter is named. Screens
 * receive use cases and ports, never viem, never `fetch` and never
 * `window.ethereum`, which is what keeps the ERC-4337 passkey swap of D-04 a
 * change to this file and the signer adapter rather than to eight screens.
 */

export interface PharmacyServices {
  config: PharmacyConfig;
  signer: SignerPort;
  verify: VerifyPrescription;
  dispense: DispensePrescription;
  checkCredential: CheckCredential;
  /**
   * Present ONLY when this device signs with its own encrypted key (docs/23).
   * `undefined` on the injected-provider path, which is what keeps that path —
   * and the eight screens of docs/17 — exactly as they were.
   */
  deviceKey?: DeviceKeyPort;
}

export function createPharmacyServices(config: PharmacyConfig): PharmacyServices {
  const injected = createEip1193Signer({ config });
  const deviceKeySigner = createLocalKeySigner({ config });

  // Which signer, decided here and nowhere else, in this order and out loud:
  //
  //   1. A key stored on this device WINS, even with an extension present.
  //      Someone configured this device on purpose; silently preferring the
  //      extension would sign with a different account than the one the
  //      operator accredited.
  //   2. No injected provider at all -> the device-key path, which is the
  //      whole point of docs/23: a phone in plain Safari or Chrome, where the
  //      extension's in-app browser is what blocked the camera and the PWA.
  //   3. Otherwise the injected provider, unchanged (docs/20, docs/21).
  const useDeviceKey = deviceKeySigner.hasKey() || !injected.isAvailable();
  const signer: SignerPort = useDeviceKey ? deviceKeySigner : injected;
  const chain = createViemChainAdapter({ config, signer });
  const documents = createHttpDocumentAdapter({ config });
  const signatures = createPrescriberSignatureVerifier(config);

  return {
    config,
    signer,
    deviceKey: useDeviceKey ? deviceKeySigner : undefined,
    verify: createVerifyPrescription({ chain, documents, signatures, config }),
    dispense: createDispensePrescription({ chain }),
    checkCredential: createCheckCredential({ chain }),
  };
}
