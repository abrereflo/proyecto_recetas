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
}

export function createPharmacyServices(config: PharmacyConfig): PharmacyServices {
  const chain = createViemChainAdapter({ config });
  const documents = createHttpDocumentAdapter({ config });
  const signatures = createPrescriberSignatureVerifier(config);
  const signer = createEip1193Signer();

  return {
    config,
    signer,
    verify: createVerifyPrescription({ chain, documents, signatures, config }),
    dispense: createDispensePrescription({ chain }),
    checkCredential: createCheckCredential({ chain }),
  };
}
