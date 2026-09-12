import { describe, expect, it } from 'vitest';
import { PRESCRIBER } from '../test/fixtures';
import { DRAFT_ISSUE_COPY_ES } from './draft';
import {
  ISSUE_REJECTION_COPY_ES,
  ISSUE_STEPS,
  describeIssueRejection,
  type IssueRejection,
  type IssueRejectionCode,
} from './issuance';

/**
 * The refusal catalogue of screens D5 and D6.
 *
 * docs/17: "Cada error del contrato tiene su propio mensaje y su propia acción.
 * Colapsar ambos en un genérico convierte dos situaciones muy distintas en el
 * mismo encogimiento de hombros."
 */

const EVERY_REASON: IssueRejection[] = [
  { code: 'document-invalid', issues: [{ code: 'items-empty', message: DRAFT_ISSUE_COPY_ES['items-empty'] }] },
  { code: 'signer-unavailable' },
  { code: 'store-failed', message: 'No hay respuesta del almacén de recetas.' },
  { code: 'already-issued', contentHash: '0x00' },
  { code: 'practitioner-credential-missing', account: PRESCRIBER },
  { code: 'invalid-expiry', expiresAt: 1_791_691_200n },
  { code: 'network-error', message: 'La consulta a la cadena no se pudo completar.' },
];

describe('the issuing sequence', () => {
  /**
   * The ordering rule of docs/05 and apps/cli, asserted on the description
   * itself: the envelope is stored BEFORE the anchor, so a failed chain write
   * leaves an orphaned ciphertext instead of an anchor pointing at nothing.
   */
  it('stores off-chain before anchoring on-chain', () => {
    const ids = ISSUE_STEPS.map((step) => step.id);

    expect(ids).toEqual(['document', 'commitment', 'seal', 'sign', 'store', 'anchor', 'qr']);
    expect(ids.indexOf('store')).toBeLessThan(ids.indexOf('anchor'));
    expect(ids.indexOf('seal')).toBeLessThan(ids.indexOf('sign'));
  });

  it('describes each step as a readable sentence, never as a hexadecimal', () => {
    for (const step of ISSUE_STEPS) {
      expect(step.label).not.toMatch(/0x/);
      expect(step.label.length).toBeGreaterThan(10);
    }
  });
});

describe('the rejection catalogue', () => {
  it('gives every code its own headline and its own action', () => {
    const headlines = EVERY_REASON.map((reason) => describeIssueRejection(reason).headline);
    const actions = EVERY_REASON.map((reason) => describeIssueRejection(reason).action);

    expect(new Set(headlines).size).toBe(headlines.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('renders every member of the union', () => {
    for (const reason of EVERY_REASON) {
      const message = describeIssueRejection(reason);

      expect(message.code).toBe(reason.code);
      expect(message.reason.length).toBeGreaterThan(0);
      expect(message.action.length).toBeGreaterThan(0);
    }
  });

  it('quotes the single form problem verbatim, and counts them when there are several', () => {
    const one = describeIssueRejection({
      code: 'document-invalid',
      issues: [{ code: 'items-empty', message: DRAFT_ISSUE_COPY_ES['items-empty'] }],
    });
    const several = describeIssueRejection({
      code: 'document-invalid',
      issues: [
        { code: 'items-empty', message: DRAFT_ISSUE_COPY_ES['items-empty'] },
        { code: 'patient-id-missing', message: DRAFT_ISSUE_COPY_ES['patient-id-missing'] },
      ],
    });

    expect(one.reason).toBe(DRAFT_ISSUE_COPY_ES['items-empty']);
    expect(several.reason).toContain('2 datos');
  });

  it('names the account whose credential is not current', () => {
    const message = describeIssueRejection({
      code: 'practitioner-credential-missing',
      account: PRESCRIBER,
    });

    expect(message.reason).toContain('0x1111…1111');
  });

  /** docs/07, docs/17: revocation revokes future access, it deletes nothing. */
  it('says the already-issued recetas remain on the chain', () => {
    const { action } = describeIssueRejection({
      code: 'practitioner-credential-missing',
      account: PRESCRIBER,
    });

    expect(action).toContain('siguen en la cadena');
  });

  it('shows the expiry as a day, without a time (D-13)', () => {
    const message = describeIssueRejection({ code: 'invalid-expiry', expiresAt: 1_791_691_200n });

    expect(message.reason).toContain('11/10/2026');
    expect(message.reason).not.toMatch(/\d{2}:\d{2}/);
  });

  it('states that a failed store left nothing registered', () => {
    expect(ISSUE_REJECTION_COPY_ES['store-failed'].action).toContain('no quedó registrada');
  });

  it('covers every declared code', () => {
    const declared: IssueRejectionCode[] = [
      'document-invalid',
      'signer-unavailable',
      'store-failed',
      'already-issued',
      'practitioner-credential-missing',
      'invalid-expiry',
      'network-error',
    ];

    expect(Object.keys(ISSUE_REJECTION_COPY_ES).sort()).toEqual([...declared].sort());
    expect(EVERY_REASON.map((reason) => reason.code).sort()).toEqual([...declared].sort());
  });
});
