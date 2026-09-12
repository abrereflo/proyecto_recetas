import { describe, expect, it } from 'vitest';
import { MVP_NONCE } from '@recetas/chain';
import { CHAIN_ID, EXPIRES_AT, ISSUED_AT_DATE, PRESCRIBER, aDraft, anItem } from '../test/fixtures';
import { formatDay } from './format';
import { describePrescriptionSignature } from './typed-data';

/**
 * D5 — "Datos tipados como frases legibles, nunca un hexadecimal" (docs/17).
 */

const DRAFT = aDraft({
  patient: { patientId: 'CI-7418529', fullName: 'Lucía Vargas Antelo', birthDate: '1991-03-14' },
  practitioner: { licenseNumber: 'MED-7741-SC', fullName: 'Dr. Roberto Méndez Salazar' },
});

function describe_() {
  return describePrescriptionSignature({
    draft: DRAFT,
    prescriber: PRESCRIBER,
    expiresAt: EXPIRES_AT,
    issuedAt: ISSUED_AT_DATE,
    chainId: CHAIN_ID,
  });
}

describe('the typed message becomes sentences', () => {
  it('covers every field of the EIP-712 message', () => {
    expect(describe_().map((entry) => entry.field)).toEqual([
      'Prescriptor',
      'Contenido de la receta',
      'Paciente',
      'Fecha de emisión',
      'Vigencia',
      'Número de firma',
      'Registro',
    ]);
  });

  it('contains no hexadecimal at all', () => {
    const text = describe_()
      .map((entry) => entry.sentence)
      .join(' ');

    expect(text).not.toMatch(/0x[0-9a-fA-F]+/);
  });

  it('writes a full sentence for every field, not a value', () => {
    for (const entry of describe_()) {
      expect(entry.sentence.length).toBeGreaterThan(20);
      expect(entry.sentence).toMatch(/\.$/);
    }
  });

  it('names the prescriber and the licence the doctor typed', () => {
    const sentence = describe_()[0]?.sentence ?? '';

    expect(sentence).toContain('Dr. Roberto Méndez Salazar');
    expect(sentence).toContain('MED-7741-SC');
  });

  it('names the patient without their identifier', () => {
    const sentence = describe_().find((entry) => entry.field === 'Paciente')?.sentence ?? '';

    expect(sentence).toContain('Lucía Vargas Antelo');
    expect(sentence).not.toContain(DRAFT.patient.patientId);
  });

  it('shows the expiry as a day, with no time (D-13)', () => {
    const sentence = describe_().find((entry) => entry.field === 'Vigencia')?.sentence ?? '';

    expect(sentence).toContain(formatDay(EXPIRES_AT));
    expect(sentence).not.toMatch(/\d{2}:\d{2}/);
  });

  it('says the nonce as the number it is', () => {
    const sentence = describe_().find((entry) => entry.field === 'Número de firma')?.sentence ?? '';

    expect(sentence).toContain(MVP_NONCE.toString());
  });

  it('says the signature only counts for the configured chain', () => {
    const sentence = describe_().find((entry) => entry.field === 'Registro')?.sentence ?? '';

    expect(sentence).toContain(String(CHAIN_ID));
  });

  it('counts the medications in words that match the draft', () => {
    const two = describePrescriptionSignature({
      draft: { ...DRAFT, items: [anItem(), anItem({ atcCode: 'M01AE01' })] },
      prescriber: PRESCRIBER,
      expiresAt: EXPIRES_AT,
      issuedAt: ISSUED_AT_DATE,
      chainId: CHAIN_ID,
    });

    expect(describe_()[1]?.sentence).toContain('1 medicamento');
    expect(two[1]?.sentence).toContain('2 medicamentos');
  });
});
