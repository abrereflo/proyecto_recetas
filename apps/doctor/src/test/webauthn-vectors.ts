/**
 * WebAuthn test vectors this repository did NOT produce.
 *
 * WHY THEY MATTER MORE THAN THE MOCKS. Every other test of this feature builds
 * its own input, so a client and its tests can agree on a misunderstanding and
 * both be wrong together — and the thing on the other side of this client is a
 * Solidity contract with no way to say why it refused. These vectors close that
 * gap from both ends: the assertions below were produced by real secure
 * enclaves in real browsers, and the expected values were published by other
 * people for other implementations.
 *
 * PROVENANCE, in two groups.
 *
 *   COINBASE / base/webauthn-sol (MIT). One credential, asserted twice — once
 *   in Safari and once in Chrome, which serialise `clientDataJSON` differently.
 *   These are the same bytes `contracts/test/WebAuthn.t.sol` feeds
 *   `WebAuthn.check`, copied from there rather than re-derived, so a
 *   disagreement between this client and that contract shows up as a failing
 *   test in this suite.
 *
 *   SIMPLEWEBAUTHN (MIT), github.com/MasterKale/SimpleWebAuthn, from the test
 *   suites of `@simplewebauthn/server`. A real registration attestation and
 *   three real DER signatures, chosen for the shapes a synthetic fixture never
 *   produces: leading-zero INTEGERs in both halves, a high `s`, and a
 *   `clientDataJSON` that puts `challenge` first and `type` last.
 *
 * HARD RULE (docs/08): no real patient data anywhere in this repository. None
 * of these vectors contains any; they are public keys, signatures and browser
 * metadata from published test suites.
 */

/* --------------------------------------------------------------------------
 * Coinbase, base/webauthn-sol — one credential, two browsers
 * ----------------------------------------------------------------------- */

/** The credential's public key, X. `VECTOR_X` in contracts/test/WebAuthn.t.sol. */
export const VECTOR_PUBLIC_KEY_X =
  28573233055232466711029625910063034642429572463461595413086259353299906450061n;

export const VECTOR_PUBLIC_KEY_Y =
  39367742072897599771788408398752356480431855827262528811857788332151452825281n;

/** What both assertions authorise. `VECTOR_CHALLENGE` in the Solidity suite. */
export const VECTOR_CHALLENGE =
  '0xf631058a3ba1116acce12396fad0a125b5041c43f8e15723709f81aa8d5f4ccf' as const;

/**
 * The base64url of that challenge, as the browser actually wrote it into
 * `clientDataJSON` — not as any encoder in this repository produces it.
 */
export const VECTOR_CHALLENGE_B64URL = '9jEFijuhEWrM4SOW-tChJbUEHEP44VcjcJ-Bqo1fTM8';

export interface PublishedAssertion {
  /** base64url, as `@simplewebauthn/browser` reports it. */
  authenticatorData: string;
  clientDataJSON: string;
  /** The document as a string, for readability in assertions. */
  clientDataJSONText: string;
  /** ASN.1 DER, base64url. See the note below. */
  signature: string;
  r: bigint;
  s: bigint;
  challengeIndex: number;
  typeIndex: number;
  /** `abi.encode(assertion)` — the blob `userOp.signature` carries. */
  envelope: `0x${string}`;
}

/**
 * SAFARI, iCloud Keychain, `http://localhost:3005`. Flags 0x05: User Present
 * and User Verified, which is why requiring UV costs nothing on the hardware
 * doctors actually carry.
 *
 * ONE HONEST CAVEAT ABOUT `signature`. Coinbase published this assertion as the
 * integers `r` and `s`, not as the DER blob the browser returned, so the DER
 * below was re-encoded from those integers according to X9.62. The INTEGERS are
 * real; their container is reconstructed. That is enough for what this vector
 * is for — proving the envelope this client builds matches the one the Solidity
 * tests feed the contract — and the DER decoder is separately pinned against
 * three UNMODIFIED signatures further down this file.
 */
export const SAFARI_ASSERTION: PublishedAssertion = {
  authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAABAQ',
  clientDataJSON:
    'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiOWpFRmlqdWhFV3JNNFNPVy10Q2hKYlVFSEVQNDRWY2pjSi1CcW8xZlRNOCIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzAwNSJ9',
  clientDataJSONText:
    '{"type":"webauthn.get","challenge":"9jEFijuhEWrM4SOW-tChJbUEHEP44VcjcJ-Bqo1fTM8","origin":"http://localhost:3005"}',
  signature:
    'MEQCIGCUYIFlBSOsrRPI7_lJlqQJse1g6SPJD542aq1hmt_6AiAyFqI3tzdl0BuDnggy1zR0vH5j9Mhu8F-7v76zSzVgKw',
  r: 43684192885701841787131392247364253107519555363555461570655060745499568693242n,
  s: 22655632649588629308599201066602670461698485748654492451178007896016452673579n,
  challengeIndex: 23,
  typeIndex: 1,
  envelope:
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000017000000000000000000000000000000000000000000000000000000000000000160946081650523acad13c8eff94996a409b1ed60e923c90f9e366aad619adffa3216a237b73765d01b839e0832d73474bc7e63f4c86ef05fbbbfbeb34b35602b000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000010100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000727b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303035227d0000000000000000000000000000',
};

/**
 * CHROME, same credential, same challenge, a longer document: Chrome appends
 * `"crossOrigin":false`, so the signature is over different bytes. The envelope
 * is 512 bytes — the figure `WebAuthn.sol` quotes its gas measurements against.
 */
export const CHROME_ASSERTION: PublishedAssertion = {
  authenticatorData: 'SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAABCg',
  clientDataJSON:
    'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiOWpFRmlqdWhFV3JNNFNPVy10Q2hKYlVFSEVQNDRWY2pjSi1CcW8xZlRNOCIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzAwNSIsImNyb3NzT3JpZ2luIjpmYWxzZX0',
  clientDataJSONText:
    '{"type":"webauthn.get","challenge":"9jEFijuhEWrM4SOW-tChJbUEHEP44VcjcJ-Bqo1fTM8","origin":"http://localhost:3005","crossOrigin":false}',
  signature:
    'MEQCIEHAHKXs3-sj73DWzCFv1JGsOqPUDEgHUfNhijqe9ntBAiBllVaav3bCd36DKpJSuuFO_bd_69D6O5GaoW9iCEaehg',
  r: 29739767516584490820047863506833955097567272713519339793744591468032609909569n,
  s: 45947455641742997809691064512762075989493430661170736817032030660832793108102n,
  challengeIndex: 23,
  typeIndex: 1,
  envelope:
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000017000000000000000000000000000000000000000000000000000000000000000141c01ca5ecdfeb23ef70d6cc216fd491ac3aa3d40c480751f3618a3a9ef67b416595569abf76c2777e832a9252bae14efdb77febd0fa3b919aa16f6208469e86000000000000000000000000000000000000000000000000000000000000002549960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000010a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000867b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22396a4546696a75684557724d34534f572d7443684a625545484550343456636a634a2d42716f3166544d38222c226f726967696e223a22687474703a2f2f6c6f63616c686f73743a33303035222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000000000',
};

/**
 * The Chrome assertion with `s` put back into the UPPER half of the group.
 *
 * Coinbase publishes both vectors already normalised, so neither of them can
 * prove the flip on its own. `n - s` is the twin signature the same enclave
 * would have produced had its nonce landed the other way: equally valid, over
 * the same message, by the same key — and refused by `WebAuthn.check` with
 * `Rejection.HighS`. A client that forgets to flip it fails half its logins.
 *
 * Note the DER is 71 bytes rather than 70: the high half starts with a byte
 * above 0x7f, so X9.62 requires a 0x00 pad. The length change is itself the
 * reason `decodeEcdsaSignature` may not assume fixed offsets.
 */
export const CHROME_ASSERTION_HIGH_S_SIGNATURE =
  'MEUCIEHAHKXs3-sj73DWzCFv1JGsOqPUDEgHUfNhijqe9ntBAiEAmmqpZECJPYmBfNVtrUUesL8vesHWHWLzWRhbYPQchss';

/** The high twin, as an integer: `n - s` of `CHROME_ASSERTION.s`. */
export const CHROME_ASSERTION_HIGH_S =
  69844633568613250953006382436645497540503524562965023525390228400235718936267n;

/* --------------------------------------------------------------------------
 * SimpleWebAuthn — a real registration
 * ----------------------------------------------------------------------- */

/**
 * A genuine `none`-attestation registration, ES256, from the
 * `verifyRegistrationResponse` suite of `@simplewebauthn/server`.
 *
 * Its `authenticatorData` carries flags 0x45 — User Present, User Verified and
 * Attested Credential Data — which is exactly the shape `publicKeyFromRegistration`
 * has to read: an AAGUID, a 65-byte credential id and a CBOR COSE_Key.
 */
export const REAL_REGISTRATION = {
  rawId:
    'AdKXJEch1aV5Wo7bj7qLHskVY4OoNaj9qu8TPdJ7kSAgUeRxWNngXlcNIGt4gexZGKVGcqZpqqWordXb_he1izY',
  attestationObject:
    'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjFPdxHEOnAiLIp26idVjIguzn3Ipr_RlsKZWsa-5qK-KBFAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQHSlyRHIdWleVqO24-6ix7JFWODqDWo_arvEz3Se5EgIFHkcVjZ4F5XDSBreIHsWRilRnKmaaqlqK3V2_4XtYs2pQECAyYgASFYID5PQTZQQg6haZFQWFzqfAOyQ_ENsMH8xxQ4GRiNPsqrIlggU8IVUOV8qpgk_Jh-OTaLuZL52KdX1fTht07X4DiQPow',
  clientDataJSON:
    'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiYUVWalkxQlhkWHBwVURBd1NEQndOV2Q0YURKZmRUVmZVRU0wVG1WWloyUSIsIm9yaWdpbiI6Imh0dHBzOlwvXC9kZXYuZG9udG5lZWRhLnB3IiwiYW5kcm9pZFBhY2thZ2VOYW1lIjoib3JnLm1vemlsbGEuZmlyZWZveCJ9',
  /** `getAuthenticatorData()` would have returned this. */
  authenticatorData:
    'PdxHEOnAiLIp26idVjIguzn3Ipr_RlsKZWsa-5qK-KBFAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQHSlyRHIdWleVqO24-6ix7JFWODqDWo_arvEz3Se5EgIFHkcVjZ4F5XDSBreIHsWRilRnKmaaqlqK3V2_4XtYs2pQECAyYgASFYID5PQTZQQg6haZFQWFzqfAOyQ_ENsMH8xxQ4GRiNPsqrIlggU8IVUOV8qpgk_Jh-OTaLuZL52KdX1fTht07X4DiQPow',
  publicKeyX: '0x3e4f413650420ea1699150585cea7c03b243f10db0c1fcc7143819188d3ecaab',
  publicKeyY: '0x53c21550e57caa9824fc987e39368bb992f9d8a757d5f4e1b74ed7e038903e8c',
} as const;

/** The SPKI DER `getPublicKey()` returns for `REAL_REGISTRATION`'s key. */
export const REAL_REGISTRATION_SPKI =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPk9BNlBCDqFpkVBYXOp8A7JD8Q2wwfzHFDgZGI0-yqtTwhVQ5XyqmCT8mH45Nou5kvnYp1fV9OG3TtfgOJA-jA';

/* --------------------------------------------------------------------------
 * SimpleWebAuthn — real DER signatures, for the shapes that hurt
 * ----------------------------------------------------------------------- */

export interface PublishedSignature {
  /** base64url of the UNMODIFIED bytes the browser returned. */
  signature: string;
  r: bigint;
  s: bigint;
  /** `n - s` when `s` is in the upper half, otherwise `s` itself. */
  normalisedS: bigint;
  /** Total DER length, which is the point of having three of these. */
  length: number;
}

/** 32-byte r, 33-byte s (leading zero), and `s` in the UPPER half. */
export const SIGNATURE_SHORT_R_PADDED_S: PublishedSignature = {
  signature:
    'MEUCIByFAVGfkoKPEzynp-37BX_HOXSaC6-58-ELjB7BG9opAiEAyD_1mN9YAPrphcwpzK3ym2Xx8EjAapgQ326mKgQ1pW0',
  r: 12899759522253935911739072620495803550083144638790824054866146761952596843049n,
  s: 90575576131022016699804461730473173174462064896817803918489619932635463001453n,
  normalisedS: 25216513079334232062892985218934400355534890327317956423932639128433049042916n,
  length: 71,
};

/** 33-byte r AND 33-byte s, both padded. The longest a P-256 signature gets. */
export const SIGNATURE_BOTH_PADDED: PublishedSignature = {
  signature:
    'MEYCIQDlRuxY7cYre0sb3T6TovQdfYIUb72cRZYOQv_zS9wN_wIhAOvN-fwjtyIhWRceqJV4SX74-z6oALERbC7ohk8EdVPO',
  r: 103704952829756174596168733089959378790075197256388145610094585714197248347647n,
  s: 106657448397855347914759350010180531897675568447479171802027699099053197710286n,
  normalisedS: 9134640812500900847938096939227041632321386776656588540394559962015314334083n,
  length: 72,
};

/** 33-byte r, 32-byte s, and an `s` that was already in the low half. */
export const SIGNATURE_PADDED_R_SHORT_S: PublishedSignature = {
  signature:
    'MEUCIQDYXBOpCWSWq2Ll4558GJKD2RoWg958lvJSB_GdeokxogIgWuEVQ7ee6AswQY0OsuQ6y8Ks6jhd45bDx92wjXKs900',
  r: 97862260914345917371595820974149808986035089272467258546582438932758286381474n,
  s: 41105843724396340413905593821093836789369229370035854781597622471820411991885n,
  normalisedS: 41105843724396340413905593821093836789369229370035854781597622471820411991885n,
  length: 71,
};

/* --------------------------------------------------------------------------
 * SimpleWebAuthn — clientDataJSON documents no synthetic fixture would write
 * ----------------------------------------------------------------------- */

/**
 * A legacy Firefox document that puts `challenge` FIRST and `type` LAST, with
 * two fields in between that this project has never heard of.
 *
 * `challengeIndex` is 1 and `typeIndex` is 136 here, against 23 and 1 in every
 * modern browser. Any client that hard-coded those offsets — or assumed the
 * ordering of the W3C's own example — produces an envelope the contract refuses
 * with `WrongCeremonyType`, on one browser, for one kind of user.
 */
export const REORDERED_CLIENT_DATA_JSON =
  'eyJjaGFsbGVuZ2UiOiJkRzkwWVd4c2VWVnVhWEYxWlZaaGJIVmxSWFpsY25sVWFXMWwiLCJjbGllbnRFeHRlbnNpb25zIjp7fSwiaGFzaEFsZ29yaXRobSI6IlNIQS0yNTYiLCJvcmlnaW4iOiJodHRwczovL2Rldi5kb250bmVlZGEucHciLCJ0eXBlIjoid2ViYXV0aG4uZ2V0In0';

export const REORDERED_CLIENT_DATA_JSON_TEXT =
  '{"challenge":"dG90YWxseVVuaXF1ZVZhbHVlRXZlcnlUaW1l","clientExtensions":{},"hashAlgorithm":"SHA-256","origin":"https://dev.dontneeda.pw","type":"webauthn.get"}';

/**
 * A webauthn.io document carrying a field whose VALUE is a sentence about
 * clientDataJSON. Real, published, and a reminder that the document is
 * open-ended: nothing may be assumed about what follows the fields we read.
 */
export const EXTRA_FIELD_CLIENT_DATA_JSON_TEXT =
  '{"type":"webauthn.get","challenge":"Ji15971jSESa9haCUYb7s_pMhV8DNNwYT8Wb5zbEo151Ab7s_MuT-_MIjnousfaF2Q3emFAx7GkpXkTUmMicTQ","origin":"https://webauthn.io","crossOrigin":false,"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}';

/**
 * A real Firefox/Android document that escapes its solidus:
 * `"origin":"https:\/\/dev.dontneeda.pw"`.
 *
 * Legal JSON, and `JSON.parse` followed by `JSON.stringify` drops both
 * backslashes — which changes `sha256(clientDataJSON)` and fails a signature
 * that was never wrong. It is the clearest published example of why
 * `WebAuthn.Assertion.clientDataJSON` says "send the bytes you got".
 *
 * Taken from `REAL_REGISTRATION`, whose ceremony type is `webauthn.create`;
 * the byte-fidelity property it demonstrates is the same either way.
 */
export const ESCAPED_SOLIDUS_CLIENT_DATA_JSON = REAL_REGISTRATION.clientDataJSON;
