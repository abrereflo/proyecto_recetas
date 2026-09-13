import { createCheckCredential, type CheckCredential } from '../../application/check-credential';
import {
  createIssuePrescription,
  type IssuePrescription,
} from '../../application/issue-prescription';
import {
  createListPrescriptions,
  type ListPrescriptions,
} from '../../application/list-prescriptions';
import { createViemChainAdapter } from '../../infrastructure/chain/viem-chain.adapter';
import type { DoctorConfig } from '../../infrastructure/config/env';
import { createHttpDocumentAdapter } from '../../infrastructure/document/http-document.adapter';
import { createEip1193Signer } from '../../infrastructure/signer/eip1193-signer.adapter';
import type { SignerPort } from '../../ports/signer.port';

/**
 * Composition root.
 *
 * The only place in the application where a concrete adapter is named. Screens
 * receive use cases and ports, never viem, never `fetch` and never
 * `window.ethereum`, which is what keeps the ERC-4337 passkey swap of D-04 a
 * change to this file and the signer adapter rather than to seven screens.
 *
 * Mirrors apps/pharmacy/src/presentation/composition/pharmacy-services.ts.
 */

export interface DoctorServices {
  config: DoctorConfig;
  signer: SignerPort;
  issue: IssuePrescription;
  checkCredential: CheckCredential;
  list: ListPrescriptions;
}

export function createDoctorServices(config: DoctorConfig): DoctorServices {
  const signer = createEip1193Signer({ config });
  const chain = createViemChainAdapter({ config, signer });
  const documents = createHttpDocumentAdapter({ config });

  return {
    config,
    signer,
    issue: createIssuePrescription({ chain, documents, signer, config }),
    checkCredential: createCheckCredential({ chain }),
    list: createListPrescriptions({ chain }),
  };
}
