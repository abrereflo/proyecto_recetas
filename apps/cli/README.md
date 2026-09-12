# @recetas/cli — `receta`

The demo deliverable. It runs the full prescription lifecycle — issue, verify,
dispense, refuse the second dispensing — against a deployed
`PrescriptionRegistry`, with no browser and no SPA involved.

Phase 4 of [docs/18](../../docs/18-tareas-por-fases.md) exists precisely so the
project is deliverable whether or not the two web apps are finished.

> **Language split.** Code, identifiers and comments are English. Everything the
> command prints is Spanish, because that output is what the jury reads.

## Requirements

- Postgres and Anvil running: `docker compose up -d`
- The API on port 3000:
  ```bash
  DATABASE_URL='postgres://recetas:recetas@localhost:5432/recetas' \
    corepack pnpm --filter '@recetas/api' exec tsx src/server.ts
  ```
- `PrescriptionRegistry` deployed. The default address is the deterministic
  first Anvil deployment, `0x5FbDB2315678afecb367f032d93F642f64180aa3`.

## Running

pnpm is not on PATH on the development machine, so every invocation goes through
`corepack`:

```bash
corepack pnpm --filter '@recetas/cli' exec tsx src/main.ts demo
```

The package also exposes a `receta` binary (`bin/receta.js`, which loads the
TypeScript sources through `tsx`), usable directly:

```bash
node apps/cli/bin/receta.js demo
```

## Commands

| Command | What it does |
|---|---|
| `receta setup-credentials` | Accredits the three demo accounts against EAS: the authority attests, each account registers its own pointer. Idempotent |
| `receta issue` | Encrypts the document, signs EIP-712, stores the ciphertext and anchors `issue()` on-chain. Prints the QR payload as JSON and as ASCII art |
| `receta verify --qr <json\|file>` | Calls `verify()` and prints status, dispensability, prescriber and expiry |
| `receta dispense --qr <json\|file> --pharmacy <a\|b>` | The seven pharmacy checks in order, then `dispense()` |
| `receta demo` | The three-minute script in one run: accredit → issue → dispense → rejected second dispense |
| `receta demo --revoked` | The credential rejection: the authority revokes the pharmacy's attestation and the next dispensing fails with `NotAccreditedPharmacy` |
| `receta help` | Usage |

### Options

```
issue / demo
  --patient <name>          Patient full name
  --patient-id <id>         National id
  --birth-date <YYYY-MM-DD>
  --items <item>            Repeatable:
                            atc:ingredient:strength:doseForm:quantity:instruction
  --days <n>                Validity window, default 30
  --out <file>              Write the QR payload to a file
  --no-qr                   Skip the ASCII QR
demo
  --pause <ms>              Pause between acts, default 1500
  --revoked                 Show the credential rejection instead of the
                            double-dispensing one
verify / dispense
  --qr <json|file>
  --pharmacy <a|b>          Dispensing pharmacy, default a
```

Exit code is `1` when a dispensing is rejected, `0` when it succeeds. `receta
demo` exits `0` when the third act is rejected with `AlreadyDispensed`, because
there the rejection is the expected outcome; `receta demo --revoked` exits `0`
when it is rejected with `NotAccreditedPharmacy`, for the same reason.

Accreditation is not a local decision: the registry re-reads the attestation in
EAS on every `issue` and every `dispense` and caches nothing but the pointer, so
a credential revoked one transaction ago is already worthless. Attesting and
revoking belong to the credential authority; this CLI only drives them against
the local `MockEAS`, and refuses to try anywhere else.

### Environment

| Variable | Default |
|---|---|
| `RPC_URL` | `http://localhost:8545` |
| `CHAIN_ID` | `31337` |
| `PRESCRIPTION_REGISTRY_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `API_URL` | `http://localhost:3000` |
| `NO_COLOR` | unset — set it to drop ANSI colour |

## What the pharmacy flow actually checks

Seven steps, in the order of the "dispensar" sequence of
[docs/05](../../docs/05-almacenamiento-y-cifrado.md):

1. `verify()` on-chain
2. download the sealed envelope by pointer
3. integrity: `keccak256(ciphertext) == contentHash`
4. decrypt with the key carried in the QR
5. verify the prescriber's EIP-712 signature against the on-chain prescriber
6. correspondence: `keccak256(patientId, salt) == patientCommitment`
7. `dispense()` on-chain

Every failure names its own reason. The nine custom errors of the registry are
decoded into nine distinct Spanish messages, each with its own next step:
collapsing "already dispensed" and "tampered content" into one generic failure
turns two very different situations into the same shrug
([docs/17](../../docs/17-diseno-y-experiencia.md)).

## Rules this package may not break

| Rule | Where it is enforced |
|---|---|
| The salt never appears in the QR payload | `src/commands/issue.ts` builds the payload with `contentHash`, `pointer` and `key` only |
| No patient identifier reaches the chain | only `keccak256(patientId, salt)` is passed to `issue()` |
| A fresh salt and a fresh DEK per prescription | `generateSalt()` / `generateDek()` on every issue |
| ADSIB legal validity is never simulated | the envelope carries `status: 'pending-integration'` |
| Crypto and domain logic live in the shared packages | this package adds none of its own; `sealDocument` was added to `@recetas/crypto` |

## Known limitations

- The Anvil development keys are checked into `src/config.ts`. They are public
  and worthless outside a local node, and they are what makes the demo run with
  zero setup. Nothing here may ever be reused on a public network.
- The EIP-712 nonce is fixed at `0`. The registry does not track per-prescriber
  nonces, and replaying an identical document already reverts with
  `AlreadyIssued`. The field stays in the type so adding a real nonce later does
  not change the type hash.
- Credential checks are stubbed in the contract
  (`_isAccreditedPractitioner` / `_isAccreditedPharmacy` return `true`), so
  `NotAccreditedPractitioner` and `NotAccreditedPharmacy` are decoded and
  worded, but cannot be triggered on Anvil yet. That is phase 3.
