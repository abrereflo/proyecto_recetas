/**
 * The two DER structures a WebAuthn ceremony hands back, decoded into the
 * integers `PasskeyAccount` was constructed with and `WebAuthn.Assertion`
 * carries.
 *
 * WHY THIS FILE EXISTS AT ALL. `contracts/src/WebAuthn.sol` wants `r` and `s`
 * as two `uint256`, and `contracts/src/PasskeyAccount.sol` wants the public key
 * as `(x, y)`, also two `uint256`. WebAuthn gives neither: the signature
 * arrives as an ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` and the public
 * key, when the browser offers `getPublicKey()`, as a DER `SubjectPublicKeyInfo`.
 * Nothing in between does the conversion, so it is done here, once, with tests.
 *
 * WHY THE PARSING IS STRICT RATHER THAN TOLERANT. Both decoders refuse
 * anything that is not the exact encoding the specification prescribes —
 * non-minimal integers, long-form lengths that did not need to be long, a
 * trailing byte, a curve that is not P-256. A lenient decoder here would not
 * "work anyway": it would silently produce an `(r, s)` or an `(x, y)` that the
 * contract then rejects with `InvalidSignature`, which is the single least
 * informative failure this system can produce. A parse error naming the byte
 * that was wrong is worth more than a signature that fails on chain.
 *
 * THE CLASSIC BUG THIS FILE IS WRITTEN AGAINST: assuming `r` and `s` are 32
 * bytes each and slicing at fixed offsets. A DER INTEGER is signed, so a value
 * whose top bit is set gets a 0x00 byte prepended — which happens for roughly
 * half of all `r` and half of all `s`, independently. Real signatures are
 * therefore 70, 71 or 72 bytes long, and a fixed-offset reader is wrong about
 * three quarters of the time. Every length combination has a test.
 */

/** Order of the P-256 group, from SEC 2 §2.4.2. */
export const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/** DER tag for an ASN.1 SEQUENCE, constructed. */
const TAG_SEQUENCE = 0x30;

/** DER tag for an ASN.1 INTEGER, primitive. */
const TAG_INTEGER = 0x02;

/**
 * The complete `SubjectPublicKeyInfo` header for an uncompressed P-256 point.
 *
 * SEQUENCE {
 *   SEQUENCE { OID 1.2.840.10045.2.1 (ecPublicKey),
 *              OID 1.2.840.10045.3.1.7 (prime256v1) }
 *   BIT STRING (0 unused bits) 04 || X || Y
 * }
 *
 * Compared byte for byte rather than walked field by field. The encoding of
 * this particular key type is fully determined — there is exactly one valid
 * byte sequence — so a comparison is both simpler and stricter than a parser,
 * and it cannot be talked into accepting a key on another curve by a cleverly
 * shaped length byte.
 */
const P256_SPKI_HEADER = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/** Uncompressed elliptic-curve point marker, SEC 1 §2.3.3. */
const UNCOMPRESSED_POINT = 0x04;

const COORDINATE_LENGTH = 32;

/** The parse refused the bytes, and says which byte and why. */
export class DerFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerFormatError';
  }
}

export interface EcdsaSignature {
  r: bigint;
  s: bigint;
}

export interface P256PublicKey {
  x: bigint;
  y: bigint;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/**
 * One DER INTEGER at `offset`, as a non-negative bigint bounded by the P-256
 * group order.
 *
 * @returns the value and the offset just past it.
 */
function readInteger(der: Uint8Array, offset: number, label: string): [bigint, number] {
  if (offset + 2 > der.length) {
    throw new DerFormatError(`${label}: the signature ends before its INTEGER header`);
  }

  if (der[offset] !== TAG_INTEGER) {
    throw new DerFormatError(
      `${label}: expected an INTEGER (0x02) at byte ${offset}, found 0x${der[offset]!.toString(16)}`,
    );
  }

  const length = der[offset + 1]!;

  // Long-form lengths are legal ASN.1 and illegal here: no P-256 integer needs
  // more than 33 content bytes, so a length that announced itself as long form
  // is either a different structure or an attempt to confuse the reader.
  if (length === 0 || length > 0x7f) {
    throw new DerFormatError(`${label}: length byte 0x${length.toString(16)} is not a short form`);
  }

  const start = offset + 2;
  const end = start + length;

  if (end > der.length) {
    throw new DerFormatError(`${label}: declared ${length} content bytes, only ${der.length - start} remain`);
  }

  const content = der.subarray(start, end);
  const first = content[0]!;

  // DER INTEGERs are two's-complement and therefore signed. A leading 1 bit
  // would make this a negative number; ECDSA values never are.
  if ((first & 0x80) !== 0) {
    throw new DerFormatError(`${label}: encoded as a negative INTEGER`);
  }

  // The 0x00 pad is REQUIRED when the next byte has its top bit set and
  // FORBIDDEN otherwise. Accepting a gratuitous pad would let one value have
  // several encodings, which is the malleability this project spent a whole
  // contract rule removing.
  if (length > 1 && first === 0x00 && (content[1]! & 0x80) === 0) {
    throw new DerFormatError(`${label}: non-minimal encoding, a leading zero that was not needed`);
  }

  if (length > COORDINATE_LENGTH + 1) {
    throw new DerFormatError(`${label}: ${length} content bytes is too long for a P-256 scalar`);
  }

  const value = bytesToBigInt(content);

  // [1, n-1] is what SEC 1 §4.1.4 requires of both halves. Out of range is a
  // signature no verifier will ever accept, so it is caught here rather than
  // becoming an anonymous on-chain rejection.
  if (value === 0n || value >= P256_ORDER) {
    throw new DerFormatError(`${label}: outside [1, n-1] for P-256`);
  }

  return [value, end];
}

/**
 * `AuthenticatorAssertionResponse.signature` — an ASN.1 DER
 * `SEQUENCE { INTEGER r, INTEGER s }` — as the pair `WebAuthn.Assertion` wants.
 *
 * @remarks Does NOT normalise `s`. That belongs to `assertion-envelope.ts`,
 *          where it is one decision next to its explanation, rather than a
 *          silent side effect of a parser.
 */
export function decodeEcdsaSignature(der: Uint8Array): EcdsaSignature {
  if (der.length < 8) {
    throw new DerFormatError(`a DER ECDSA signature cannot be ${der.length} bytes`);
  }

  if (der[0] !== TAG_SEQUENCE) {
    throw new DerFormatError(`expected a SEQUENCE (0x30) at byte 0, found 0x${der[0]!.toString(16)}`);
  }

  const declared = der[1]!;

  if (declared === 0x80 || declared > 0x7f) {
    throw new DerFormatError(
      `the SEQUENCE length 0x${declared.toString(16)} is not a short form; a P-256 signature never needs one`,
    );
  }

  if (declared !== der.length - 2) {
    throw new DerFormatError(
      `the SEQUENCE declares ${declared} bytes but ${der.length - 2} follow the header`,
    );
  }

  const [r, afterR] = readInteger(der, 2, 'r');
  const [s, afterS] = readInteger(der, afterR, 's');

  // Anything after `s` is not part of an ECDSA signature. Tolerating it would
  // make the same signature reachable through several encodings.
  if (afterS !== der.length) {
    throw new DerFormatError(`${der.length - afterS} unexpected byte(s) after s`);
  }

  return { r, s };
}

/**
 * `AuthenticatorAttestationResponse.getPublicKey()` — a DER
 * `SubjectPublicKeyInfo` — as the `(x, y)` `PasskeyAccount` is constructed with.
 *
 * @throws DerFormatError if the key is on any curve other than P-256, is
 *         point-compressed, or is not exactly 91 bytes.
 */
export function decodeSpkiP256PublicKey(spki: Uint8Array): P256PublicKey {
  const expected = P256_SPKI_HEADER.length + 1 + COORDINATE_LENGTH * 2;

  if (spki.length !== expected) {
    throw new DerFormatError(
      `a P-256 SubjectPublicKeyInfo is ${expected} bytes; this one is ${spki.length}`,
    );
  }

  for (let i = 0; i < P256_SPKI_HEADER.length; i += 1) {
    if (spki[i] !== P256_SPKI_HEADER[i]!) {
      throw new DerFormatError(
        `byte ${i} of the SubjectPublicKeyInfo header is 0x${spki[i]!.toString(16)}, ` +
          `expected 0x${P256_SPKI_HEADER[i]!.toString(16)}: this is not an uncompressed P-256 key`,
      );
    }
  }

  const body = spki.subarray(P256_SPKI_HEADER.length);

  if (body[0] !== UNCOMPRESSED_POINT) {
    throw new DerFormatError(
      `the point is tagged 0x${body[0]!.toString(16)}; only uncompressed (0x04) points carry both coordinates`,
    );
  }

  return {
    x: bytesToBigInt(body.subarray(1, 1 + COORDINATE_LENGTH)),
    y: bytesToBigInt(body.subarray(1 + COORDINATE_LENGTH)),
  };
}
