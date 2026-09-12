import { describe, expect, it } from 'vitest';
import type { DocumentSignatures, PrescriptionDocument } from '@recetas/shared';
import {
  AUTH_TAG_LENGTH,
  contentHashOf,
  decryptDocument,
  encryptDocument,
  generateDek,
  generateSalt,
  IV_LENGTH,
  patientCommitment,
  saltToHex,
} from './envelope';
import { base64ToBytes, bytesToBase64 } from './encoding';

const signatures: DocumentSignatures = {
  eip712: {
    signer: '0x00000000000000000000000000000000000000a1',
    value: '0xdeadbeef',
  },
  adsib: {
    certificateSerial: 'PENDING',
    value: '',
    status: 'pending-integration',
  },
};

function sampleDocument(salt: `0x${string}`): PrescriptionDocument {
  return {
    patient: {
      patientId: '1234567 CB',
      fullName: 'Paciente de prueba',
      birthDate: '1980-04-17',
    },
    salt,
    practitioner: {
      licenseNumber: 'SNS-00421',
      fullName: 'Dra. Prueba',
    },
    items: [
      {
        atcCode: 'J01CA04',
        activeIngredient: 'amoxicillin',
        strength: '500 mg',
        doseForm: 'capsule',
        quantity: 21,
        dosageInstruction: '1 capsule every 8 hours for 7 days',
      },
    ],
    issuedAt: '2026-09-11T14:02:00.000Z',
    expiresAt: '2026-10-11T04:00:00.000Z',
  };
}

describe('envelope encryption', () => {
  it('completes the encrypt -> decrypt -> verify hash cycle', async () => {
    const dek = generateDek();
    const salt = generateSalt();
    const plaintext = sampleDocument(saltToHex(salt));

    const { document, contentHash } = await encryptDocument(plaintext, dek, { signatures });

    expect(document.schemaVersion).toBe('1.0.0');
    expect(document.documentType).toBe('Prescription');
    expect(document.encryption.algorithm).toBe('AES-256-GCM');
    expect(base64ToBytes(document.encryption.iv)).toHaveLength(IV_LENGTH);
    expect(base64ToBytes(document.encryption.authTag)).toHaveLength(AUTH_TAG_LENGTH);

    // The anchored hash is keccak256 over the ciphertext bytes.
    expect(contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(contentHashOf(document.ciphertext)).toBe(contentHash);

    const roundTripped = await decryptDocument<PrescriptionDocument>(document, dek, contentHash);
    expect(roundTripped).toEqual(plaintext);
  });

  it('produces a different ciphertext for the same plaintext', async () => {
    const plaintext = sampleDocument(saltToHex(generateSalt()));

    const first = await encryptDocument(plaintext, generateDek(), { signatures });
    const second = await encryptDocument(plaintext, generateDek(), { signatures });

    expect(first.document.ciphertext).not.toBe(second.document.ciphertext);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('rejects a ciphertext that does not match the anchored hash', async () => {
    const dek = generateDek();
    const plaintext = sampleDocument(saltToHex(generateSalt()));
    const { document, contentHash } = await encryptDocument(plaintext, dek, { signatures });

    const tampered = base64ToBytes(document.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    const tamperedDocument = { ...document, ciphertext: bytesToBase64(tampered) };

    await expect(decryptDocument(tamperedDocument, dek, contentHash)).rejects.toThrow(
      /content hash mismatch/,
    );
  });

  it('fails authenticated decryption when the tag no longer matches', async () => {
    const dek = generateDek();
    const plaintext = sampleDocument(saltToHex(generateSalt()));
    const { document } = await encryptDocument(plaintext, dek, { signatures });

    const tampered = base64ToBytes(document.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    const tamperedDocument = { ...document, ciphertext: bytesToBase64(tampered) };

    // No expected hash supplied: GCM itself must reject the payload.
    await expect(decryptDocument(tamperedDocument, dek)).rejects.toThrow();
  });

  it('refuses a DEK of the wrong length', async () => {
    const plaintext = sampleDocument(saltToHex(generateSalt()));
    await expect(
      encryptDocument(plaintext, new Uint8Array(16), { signatures }),
    ).rejects.toThrow(/DEK must be 32 bytes/);
  });
});

describe('patient commitment', () => {
  it('gives a different commitment per prescription for the same patient', () => {
    const patientId = '1234567 CB';
    const first = patientCommitment(patientId, generateSalt());
    const second = patientCommitment(patientId, generateSalt());

    // Hard rule of docs/03: no stable patient pseudonym may reach the chain.
    expect(first).not.toBe(second);
  });

  it('is deterministic for the same patient id and salt', () => {
    const salt = generateSalt();
    expect(patientCommitment('1234567 CB', salt)).toBe(patientCommitment('1234567 CB', salt));
  });
});
