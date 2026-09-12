import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { encodeErrorResult } from 'viem';
import { prescriptionRegistryAbi } from '@recetas/chain';
import type { CheckCredential } from '../application/check-credential';
import { createIssuePrescription, type IssuePrescription } from '../application/issue-prescription';
import type { ListPrescriptions } from '../application/list-prescriptions';
import { ISSUE_STEPS, type IssueResult } from '../domain/issuance';
import { ChainUnreachableError, type ChainPort, type IssuedPrescriptionLog } from '../ports/chain.port';
import type { DocumentPort } from '../ports/document.port';
import type { SignerPort } from '../ports/signer.port';
import {
  BLOCK_TIME,
  CHAIN_ID,
  CONFIG,
  CONTENT_HASH,
  CREDENTIAL_UID,
  EXPIRES_AT,
  POINTER,
  PRESCRIBER,
  REGISTRY_ADDRESS,
  TRANSACTION_HASH,
  aRecord,
} from '../test/fixtures';
import type { DoctorServices } from './composition/doctor-services';
import { DoctorApp } from './DoctorApp';

/**
 * The whole journey, D1 to D6, against fake services.
 *
 * What this file is for is the rules that only exist BETWEEN screens: that a
 * justified critical alert still reaches the issuance, that nothing about the
 * flow touches the URL, and that D6 hands back a blank draft rather than the
 * one already anchored.
 */

const PATIENT_ID = 'CI-7418529';
const KEY = 'WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo';

function aSigner(): SignerPort {
  return {
    isAvailable: () => true,
    getAccount: async () => PRESCRIBER,
    connect: async () => PRESCRIBER,
    getChainId: async () => CHAIN_ID,
    ensureChain: async () => undefined,
    signPrescription: async () => `0x${'ab'.repeat(65)}`,
  };
}

const ACCREDITED: CheckCredential = async ({ account }) => ({
  accredited: true,
  account,
  uid: CREDENTIAL_UID,
});

function anIssue(): IssuePrescription {
  return vi.fn(async ({ onStep }) => {
    for (const step of ISSUE_STEPS) onStep?.(step.id);

    return {
      outcome: 'issued' as const,
      qr: `RX1:${KEY}`,
      qrPayload: {
        v: 1 as const,
        chainId: CHAIN_ID,
        registry: REGISTRY_ADDRESS,
        contentHash: CONTENT_HASH,
        pointer: POINTER,
        key: KEY,
      },
      contentHash: CONTENT_HASH,
      transactionHash: TRANSACTION_HASH,
      expiresAt: EXPIRES_AT,
    };
  });
}

function aList(): ListPrescriptions {
  return vi.fn(async () => ({
    outcome: 'listed' as const,
    items: [],
    referenceTimestamp: BLOCK_TIME,
  }));
}

function services(overrides: Partial<DoctorServices> = {}): DoctorServices {
  return {
    config: CONFIG,
    signer: aSigner(),
    checkCredential: ACCREDITED,
    issue: anIssue(),
    list: aList(),
    ...overrides,
  };
}

function renderApp(overrides: Partial<DoctorServices> = {}) {
  const deps = services(overrides);
  render(<DoctorApp now={() => new Date('2026-09-11T13:41:00.000Z')} services={deps} />);

    // `delay: null` types synchronously. The journey fills three forms; with the
  // default inter-key delay the suite spends most of its time waiting.
  return { services: deps, user: userEvent.setup({ delay: null }) };
}

/**
 * Controls are reached by id here rather than by label.
 *
 * Every label is asserted in the per-screen suites; this file is about what
 * happens BETWEEN screens, and a journey that re-verified every label would
 * fail for the wrong reason the first time one of them is reworded.
 */
function control(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`no control with id ${id}`);
  return element;
}

/** D1: waits for the credential check and walks into the form. */
async function enterForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const onward = screen.getByRole('button', { name: /escribir una receta/i });
  await waitFor(() => expect(onward).toBeEnabled());
  await user.click(onward);
}

/** D2: fills the patient block and moves on. */
async function fillPatient(
  user: ReturnType<typeof userEvent.setup>,
  allergies = '',
): Promise<void> {
  await user.type(control('patient-id'), PATIENT_ID);
  await user.type(control('patient-name'), 'Lucía Vargas Antelo');
  await user.type(control('patient-birth-date'), '1991-03-14');
  await user.type(control('practitioner-name'), 'Dr. Roberto Méndez Salazar');
  await user.type(control('practitioner-license'), 'MED-7741-SC');
  if (allergies.length > 0) {
    await user.type(control('declared-allergies'), allergies);
  }

  await user.click(screen.getByRole('button', { name: /continuar a medicación/i }));
}

/** D3: fills one item and moves on. */
async function fillMedication(
  user: ReturnType<typeof userEvent.setup>,
  ingredient = 'ibuprofeno',
): Promise<void> {
  await user.type(control('item-0-ingredient'), ingredient);
  await user.type(control('item-0-atc'), 'M01AE01');
  await user.type(control('item-0-strength'), '400 mg');
  await user.type(control('item-0-dose-form'), 'comprimido');
  await user.clear(control('item-0-quantity'));
  await user.type(control('item-0-quantity'), '20');
  await user.type(control('item-0-dosage'), '1 comprimido cada 8 horas por 5 días');
}

describe('the journey from D1 to D6', () => {
  it('walks the doctor through every screen, in order', async () => {
    const { user, services: deps } = renderApp();

    await enterForm(user);
    expect(screen.getByRole('heading', { name: /paciente y contexto clínico/i })).toBeVisible();

    await fillPatient(user);
    expect(screen.getByRole('heading', { name: /^medicación$/i })).toBeVisible();

    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    expect(screen.getByRole('heading', { name: /va a firmar esta receta/i })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(await screen.findByRole('heading', { name: /receta emitida/i })).toBeVisible();
    expect(deps.issue).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.issue).mock.calls[0]?.[0]?.prescriber).toBe(PRESCRIBER);
  });

  it('leaves the URL untouched from the first screen to the last', async () => {
    const before = window.location.href;
    const { user } = renderApp();

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /receta emitida/i });

    expect(window.location.href).toBe(before);
  });

  it('never issues without the explicit signature', async () => {
    const { user, services: deps } = renderApp();

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));

    // The form is complete and D5 is on screen; nothing has been issued.
    expect(deps.issue).not.toHaveBeenCalled();
  });
});

describe('a critical alert never blocks the issuance', () => {
  // docs/06, docs/17: "Ninguna alerta clínica bloquea la emisión."
  it('reaches D6 with the alert justified on D4', async () => {
    const { user, services: deps } = renderApp();

    await enterForm(user);
    await fillPatient(user, 'amoxicilina');
    await fillMedication(user, 'amoxicilina');

    // D3 raises the critical alert; D4 is opened deliberately.
    await user.click(screen.getByRole('button', { name: /valorar esta alerta/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      screen.getByRole('button', { name: /mantener bajo mi responsabilidad/i }),
    ).toBeDisabled();

    await user.type(
      control('critical-alert-justification'),
      'Reacción previa cutánea y leve; no hay alternativa disponible.',
    );
    await user.click(screen.getByRole('button', { name: /mantener bajo mi responsabilidad/i }));

    expect(dialog).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(await screen.findByRole('heading', { name: /receta emitida/i })).toBeVisible();
    expect(deps.issue).toHaveBeenCalledOnce();
  });

  it('reaches D6 with the alert never decided at all', async () => {
    const { user, services: deps } = renderApp();

    await enterForm(user);
    await fillPatient(user, 'amoxicilina');
    await fillMedication(user, 'amoxicilina');

    expect(screen.getByRole('alert')).toHaveTextContent(/severidad crítica/i);

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(await screen.findByRole('heading', { name: /receta emitida/i })).toBeVisible();
    expect(deps.issue).toHaveBeenCalledOnce();
  });

  it('closes D4 on Escape and leaves the way forward open', async () => {
    const { user } = renderApp();

    await enterForm(user);
    await fillPatient(user, 'amoxicilina');
    await fillMedication(user, 'amoxicilina');
    await user.click(screen.getByRole('button', { name: /valorar esta alerta/i }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /revisar y firmar/i })).toBeEnabled();
  });
});

describe('D6 is terminal for that prescription', () => {
  it('hands back a blank form, never the document already anchored', async () => {
    const { user } = renderApp();

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /receta emitida/i });

    await user.click(screen.getByRole('button', { name: /escribir otra receta/i }));

    expect(control('patient-id')).toHaveValue('');
    expect(document.body.textContent).not.toContain(PATIENT_ID);
  });

  it('offers no control that would edit or reissue it', async () => {
    const { user } = renderApp();

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /receta emitida/i });

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/editar|corregir|volver a emitir|reemitir/i);
    }
  });
});

describe('hard rules of docs/03 across the whole journey', () => {
  it('never renders the patient identifier on D5, D6 or D7', async () => {
    const { user } = renderApp();

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    expect(document.body.textContent).not.toContain(PATIENT_ID);

    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /receta emitida/i });
    expect(document.body.textContent).not.toContain(PATIENT_ID);

    await user.click(screen.getByRole('button', { name: /ver mis recetas/i }));
    await screen.findByRole('heading', { name: /mis recetas/i });
    expect(document.body.textContent).not.toContain(PATIENT_ID);
  });
});

describe('an unmodelled failure is never a verdict about the receta', () => {
  it('reports an incomplete issuance instead of crashing', async () => {
    const exploding: IssuePrescription = vi.fn(async () => {
      throw new Error('the node hung up');
    });
    const { user } = renderApp({ issue: exploding });

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(await screen.findByRole('heading', { name: /emisión incompleta/i })).toBeVisible();
    expect(document.body.textContent).toMatch(/no entregue ningún código al paciente/i);
  });

  it('returns to the form from a refusal, because nothing was anchored', async () => {
    const refused: IssuePrescription = vi.fn(async () => ({
      outcome: 'rejected' as const,
      reason: { code: 'store-failed' as const, message: 'El almacén no respondió.' },
    }));
    const { user } = renderApp({ issue: refused });

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /receta no emitida/i });

    await user.click(screen.getByRole('button', { name: /volver a la receta/i }));

    expect(screen.getByRole('heading', { name: /^medicación$/i })).toBeVisible();
    expect(control('item-0-ingredient')).toHaveValue('ibuprofeno');
  });
});

/**
 * R4-002: the recovery of an anchor that was broadcast and never observed only
 * exists if the UI hands the attempt back.
 *
 * The RPC drops after the broadcast, so nobody knows whether the transaction
 * landed. The pipeline attaches the attempt to the refusal for exactly that
 * case, and "Volver a la receta" is the ONLY control on that screen that leads
 * anywhere the doctor can issue from again. If that exit drops the attempt, the
 * retry seals fresh material, hashes to a different `contentHash`, never reaches
 * `AlreadyIssued`, and anchors a SECOND receta — while the first stays mined
 * with no QR and a key that died with the closure, and the screen reports
 * success.
 *
 * issue-prescription.test.ts covers the pipeline GIVEN the attempt. This covers
 * the only thing that can give it: the screens.
 */
describe('an anchor nobody saw land is recoverable from the refusal screen', () => {
  /** Broadcasts once and drops; from then on the contract answers `AlreadyIssued`. */
  function aChainThatLosesTheReceipt(): ChainPort {
    let anchors = 0;

    return {
      blockTimestamp: async () => BLOCK_TIME,
      credentialOf: async () => CREDENTIAL_UID,
      getPrescription: async () => aRecord(),
      issuedBy: async (): Promise<IssuedPrescriptionLog[]> => [],
      issue: async (request) => {
        anchors += 1;
        if (anchors === 1) throw new ChainUnreachableError(CONFIG.rpcUrl);
        throw {
          data: encodeErrorResult({
            abi: prescriptionRegistryAbi,
            errorName: 'AlreadyIssued',
            args: [request.contentHash],
          }),
        };
      },
    };
  }

  const aStore = (): DocumentPort => ({
    storeEnvelope: async () => ({ pointer: POINTER, createdAt: '2026-09-11T13:41:00.000Z' }),
  });

  it('retries the SAME attempt after the doctor returns to the form, and rebuilds the QR', async () => {
    const signer = aSigner();
    // The REAL pipeline, so `AlreadyIssued` is decoded rather than described.
    const pipeline = createIssuePrescription({
      chain: aChainThatLosesTheReceipt(),
      documents: aStore(),
      signer,
      config: CONFIG,
    });
    const results: IssueResult[] = [];
    const issue: IssuePrescription = vi.fn(async (input) => {
      const result = await pipeline(input);
      results.push(result);
      return result;
    });
    const { user } = renderApp({ issue, signer });

    await enterForm(user);
    await fillPatient(user);
    await fillMedication(user);
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));
    await screen.findByRole('heading', { name: /emisión incompleta/i });

    // The only control on that screen that leads back to an issuable state.
    await user.click(screen.getByRole('button', { name: /volver a la receta/i }));
    // NOTHING is edited: the same document, so the same material stays valid.
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(await screen.findByRole('heading', { name: /receta emitida/i })).toBeVisible();

    const refused = results[0];
    if (refused?.outcome !== 'rejected') throw new Error('expected the first anchor to be refused');
    expect(refused.attempt).toBeDefined();

    // The attempt the pipeline surfaced is the very object the retry received.
    expect(vi.mocked(issue).mock.calls[0]?.[0].attempt).toBeUndefined();
    expect(vi.mocked(issue).mock.calls[1]?.[0].attempt).toBe(refused.attempt);

    const recovered = results[1];
    if (recovered?.outcome !== 'issued') throw new Error('expected the retry to be recovered');
    expect(recovered.contentHash).toBe(refused.attempt?.contentHash);
    // Recovered, not re-anchored: there is no transaction of our own to show.
    expect(recovered.transactionHash).toBeUndefined();
    expect(screen.getByText(/registrada en un intento previo/i)).toBeVisible();
  });
});
