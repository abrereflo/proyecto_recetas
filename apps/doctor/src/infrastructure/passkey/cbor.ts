/**
 * Just enough CBOR (RFC 8949) to read a WebAuthn attestation object and the
 * COSE key inside it.
 *
 * WHY NOT A DEPENDENCY. This is the one place in this feature where writing
 * parsing code by hand was seriously weighed against installing someone else's,
 * and the header of `contracts/src/WebAuthn.sol` argues the general case the
 * other way: an ABI decoder is "code nobody here has to write". The answer
 * differs here for three reasons.
 *
 *   - THE SUBSET IS CLOSED AND TINY. An attestation object is a three-key map
 *     of a text string, a map and a byte string; a COSE_Key for P-256 is a
 *     five-key map of small integers and two 32-byte strings. That is six of
 *     CBOR's eight major types and none of its hard parts — no tags, no
 *     floats, no indefinite lengths, no streaming.
 *   - THE BLAST RADIUS IS SMALL. Unlike the signature envelope, nothing an
 *     attacker controls reaches this parser in a way that would grant them
 *     anything: it runs ONCE, at enrolment, on bytes the doctor's own
 *     authenticator produced, and its output is a public key that the doctor
 *     then has to get attested in EAS. A wrong answer here produces an account
 *     nobody can sign for, not an account someone else can sign for.
 *   - THE ALTERNATIVE IS NOT FREE. A general CBOR library is a browser-bundle
 *     dependency and a supply-chain surface, carried to read six bytes of map
 *     header. And this decoder does not have to be trusted alone: when the
 *     browser also offers `getPublicKey()`, `registration.ts` parses that DER
 *     key independently and refuses the credential unless the two agree, so a
 *     bug here shows up as a refusal rather than as a wrong public key.
 *
 * STRICT ON PURPOSE. Indefinite-length items, non-canonical integer widths,
 * tags and floats are all refused rather than guessed at. WebAuthn requires
 * CTAP2 canonical CBOR, so anything else is already outside the specification,
 * and a parser that quietly accepts two encodings of the same map is a parser
 * two implementations can disagree about.
 */

export type CborValue =
  | number
  | Uint8Array
  | string
  | boolean
  | null
  | CborValue[]
  | Map<CborValue, CborValue>;

export interface CborItem {
  value: CborValue;
  /** Offset just past the item — how the caller finds what follows it. */
  end: number;
}

export class CborFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CborFormatError';
  }
}

const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const MAJOR_SIMPLE = 7;

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The argument of a CBOR head: either the additional-information field itself
 * (0-23) or the 1, 2, 4 or 8 bytes that follow it.
 *
 * Rejects indefinite lengths (31) and the reserved values 28-30 outright.
 */
function readArgument(bytes: Uint8Array, offset: number): [number, number] {
  const info = bytes[offset]! & 0x1f;

  if (info < 24) return [info, offset + 1];

  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;

  if (width === 0) {
    throw new CborFormatError(
      `additional information ${info} at byte ${offset} is reserved or indefinite-length`,
    );
  }

  if (offset + 1 + width > bytes.length) {
    throw new CborFormatError(`the argument at byte ${offset} runs past the end of the input`);
  }

  let value = 0;
  for (let i = 0; i < width; i += 1) {
    value = value * 256 + bytes[offset + 1 + i]!;
  }

  if (!Number.isSafeInteger(value)) {
    throw new CborFormatError(`the integer at byte ${offset} exceeds what a JavaScript number holds`);
  }

  return [value, offset + 1 + width];
}

/** One CBOR data item starting at `offset`. */
export function decodeCborItem(bytes: Uint8Array, offset = 0): CborItem {
  if (offset >= bytes.length) {
    throw new CborFormatError(`no CBOR item at byte ${offset}: the input ends there`);
  }

  const major = bytes[offset]! >> 5;
  const [argument, afterHead] = readArgument(bytes, offset);

  switch (major) {
    case MAJOR_UNSIGNED:
      return { value: argument, end: afterHead };

    case MAJOR_NEGATIVE:
      // RFC 8949: the argument encodes -1 - n, which is how COSE writes
      // `alg: -7` as the two bytes 0x03 0x26.
      return { value: -1 - argument, end: afterHead };

    case MAJOR_BYTES:
    case MAJOR_TEXT: {
      const end = afterHead + argument;
      if (end > bytes.length) {
        throw new CborFormatError(
          `the string at byte ${offset} declares ${argument} bytes, only ${bytes.length - afterHead} remain`,
        );
      }
      const slice = bytes.slice(afterHead, end);
      return { value: major === MAJOR_BYTES ? slice : textDecoder.decode(slice), end };
    }

    case MAJOR_ARRAY: {
      const items: CborValue[] = [];
      let cursor = afterHead;
      for (let i = 0; i < argument; i += 1) {
        const item = decodeCborItem(bytes, cursor);
        items.push(item.value);
        cursor = item.end;
      }
      return { value: items, end: cursor };
    }

    case MAJOR_MAP: {
      const map = new Map<CborValue, CborValue>();
      let cursor = afterHead;
      for (let i = 0; i < argument; i += 1) {
        const key = decodeCborItem(bytes, cursor);
        const value = decodeCborItem(bytes, key.end);

        // A repeated key is invalid CBOR and, in a security-relevant map, is a
        // way to make two readers disagree about what the document said.
        if (map.has(key.value)) {
          throw new CborFormatError(`the map at byte ${offset} repeats the key ${String(key.value)}`);
        }

        map.set(key.value, value.value);
        cursor = value.end;
      }
      return { value: map, end: cursor };
    }

    case MAJOR_SIMPLE: {
      // Only the three named simple values. Floats (arguments 25-27) reach
      // here as an argument that is not 20, 21 or 22 and are refused.
      if (argument === 20) return { value: false, end: afterHead };
      if (argument === 21) return { value: true, end: afterHead };
      if (argument === 22) return { value: null, end: afterHead };
      throw new CborFormatError(`unsupported simple value ${argument} at byte ${offset}`);
    }

    case MAJOR_TAG:
    default:
      throw new CborFormatError(`unsupported CBOR major type ${major} at byte ${offset}`);
  }
}

/** One CBOR item that must be the whole input, with nothing trailing it. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, end } = decodeCborItem(bytes, 0);

  if (end !== bytes.length) {
    throw new CborFormatError(`${bytes.length - end} unexpected byte(s) after the CBOR item`);
  }

  return value;
}
