import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  describeRejection,
  type RejectionCode,
  type RejectionReason,
} from '../../domain/rejection';
import { pendingChecks } from '../../domain/verification';
import {
  CHAIN_ID,
  CONTENT_HASH,
  DISPENSED_AT,
  EXPIRES_AT,
  OTHER_SIGNER,
  PHARMACY_A,
  PRESCRIBER,
  REGISTRY_ADDRESS,
  TAMPERED_CONTENT_HASH,
} from '../../test/fixtures';
import { RejectionScreen } from './RejectionScreen';

/**
 * docs/17, P7: "Cinco motivos, cinco acciones distintas para el farmacéutico."
 * One component drives every code, so the test iterates the whole catalogue
 * instead of sampling it.
 */

const SAMPLES: { [C in RejectionCode]: Extract<RejectionReason, { code: C }> } = {
  'already-dispensed': {
    code: 'already-dispensed',
    dispensedBy: PHARMACY_A,
    dispensedAt: DISPENSED_AT,
  },
  expired: { code: 'expired', expiresAt: EXPIRES_AT },
  cancelled: { code: 'cancelled' },
  'unknown-prescription': { code: 'unknown-prescription' },
  'pharmacy-credential-revoked': { code: 'pharmacy-credential-revoked', account: PHARMACY_A },
  'integrity-failed': {
    code: 'integrity-failed',
    anchoredContentHash: CONTENT_HASH,
    storedContentHash: TAMPERED_CONTENT_HASH,
  },
  'signature-failed': { code: 'signature-failed', signer: OTHER_SIGNER, prescriber: PRESCRIBER },
  'patient-mismatch': { code: 'patient-mismatch' },
  'wrong-deployment': {
    code: 'wrong-deployment',
    expectedChainId: CHAIN_ID,
    actualChainId: 43113,
    expectedRegistry: REGISTRY_ADDRESS,
    actualRegistry: '0x8888888888888888888888888888888888888888',
  },
  'network-error': { code: 'network-error', message: 'No hay respuesta del almacén de recetas.' },
};

const ALL_CODES = Object.keys(SAMPLES) as RejectionCode[];

function renderFor(code: RejectionCode) {
  const onScanAnother = vi.fn();
  render(<RejectionScreen onScanAnother={onScanAnother} reason={SAMPLES[code]} />);
  return { onScanAnother };
}

describe('every rejection code gets its own screen', () => {
  it.each(ALL_CODES)('renders the headline and the action of %s', (code) => {
    renderFor(code);
    const message = describeRejection(SAMPLES[code]);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(message.headline);
    expect(document.body.textContent).toContain(message.action);
  });

  it('gives no two codes the same headline', () => {
    const headlines = ALL_CODES.map((code) => {
      renderFor(code);
      const headline = screen.getByRole('heading', { level: 1 }).textContent ?? '';
      cleanup();
      return headline;
    });

    expect(new Set(headlines).size).toBe(ALL_CODES.length);
  });

  it('gives no two codes the same recommended action', () => {
    // Read straight off what the screen renders, not off the catalogue, so a
    // screen that silently dropped the action would fail here.
    const actions = ALL_CODES.map((code) => {
      renderFor(code);
      const action = screen.getByText(/qué hacer ahora/i).parentElement?.textContent ?? '';
      cleanup();
      return action;
    });

    expect(new Set(actions).size).toBe(ALL_CODES.length);
  });

  it('never falls back to a generic message', () => {
    for (const code of ALL_CODES) {
      renderFor(code);
      const text = document.body.textContent?.toLowerCase() ?? '';
      expect(text).not.toContain('operación fallida');
      expect(text).not.toContain('error desconocido');
      cleanup();
    }
  });
});

describe('the tone matches what actually happened', () => {
  it('treats a revoked credential as future access, never as a deletion', () => {
    renderFor('pharmacy-credential-revoked');

    expect(document.body.textContent).toMatch(/siguen en la cadena/i);
    expect(document.body.textContent).not.toMatch(/borrad|elimina/i);
  });

  it.each(['network-error', 'wrong-deployment'] as const)(
    'presents %s as an incomplete verification, not as a verdict',
    (code) => {
      renderFor(code);

      // Warning, not refusal: nothing about the receta was disproved.
      expect(screen.getByText(/sin verificar/i)).toBeInTheDocument();
    },
  );

  it('presents a real refusal as a rejection', () => {
    renderFor('expired');

    expect(screen.getByText(/rechazada/i)).toBeInTheDocument();
  });
});

describe('there is no way back', () => {
  it('renders no control that reopens, undoes, voids or reverts', () => {
    for (const code of ALL_CODES) {
      renderFor(code);
      for (const button of screen.getAllByRole('button')) {
        expect(button).not.toHaveAccessibleName(/reabrir|deshacer|anular|revertir/i);
      }
      cleanup();
    }
  });
});

describe('the checklist that produced the verdict', () => {
  it('is shown when the verification actually ran', () => {
    render(
      <RejectionScreen
        checks={pendingChecks()}
        onScanAnother={vi.fn()}
        reason={SAMPLES.expired}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('is omitted when there is none', () => {
    renderFor('expired');

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
