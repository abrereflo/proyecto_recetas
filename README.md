# proyecto_recetas
Blockchain Solutions for Secure E-Prescription Systems

A verifiable e-prescription system built on Avalanche Fuji (chainId 43113), the testnet of Avalanche's EVM-compatible C-Chain. Avalanche is an independent L1, not an Ethereum L2; what the project borrows from Ethereum are its standards, which run on any EVM. Doctors sign prescriptions with a passkey — no wallet, no seed phrase, no AVAX — thanks to ERC-4337 smart accounts and a sponsoring paymaster. Pharmacies scan a QR code, verify the prescriber's credential on-chain through the Ethereum Attestation Service, and dispense. A second attempt to dispense the same prescription reverts. Clinical content stays encrypted off-chain; only a content hash and a per-prescription salted commitment go on-chain.

Built for an Ethereum buildathon in Cochabamba, Bolivia.

**Architecture documentation: [docs/README.md](docs/README.md)**

---

## Live deployment

Deployed and source-verified on **Avalanche Fuji, chainId 43113**, on 13 September 2026.

| Contract / value | Address or uid |
|---|---|
| `PrescriptionRegistry` | [`0xD5F2d5aD03703a9Ee11078d86181421E2E078365`](https://testnet.snowtrace.io/address/0xd5f2d5ad03703a9ee11078d86181421e2e078365) — verified |
| `EAS` v1.2.0 (this project's own) | `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A` |
| `SchemaRegistry` | `0xD4aFA6F68be2eb0c99D3B421B7f52a6420217efb` |
| `PRACTITIONER_SCHEMA_UID` | `0x5b8d9aff12e1409f3603c9bcca659c1e1dc8d8b4faf219b674d743f6ec54f233` |
| `PHARMACY_SCHEMA_UID` | `0xac44c9573bebb0b5622ea078c08bea286ad1d99566d317a32393a9e71fbff500` |
| Issuer authority | `0x613F14B919317b515D8804915a8E82f926C86c0C` |
| Accredited practitioner #1 | `0x4429d872fB9253C8516AE525b03cE06FbbbEC143` — `credentialOf` = `0x08a55355aceed09bd9a62aa32814b32a8be6f6977a4776fb95e48da3da53d330` |
| Accredited pharmacy #1 | `0x7b33436643a681262562785C02Cba36524491042` — `credentialOf` = `0x79157ba589c42909ce97d1d3b2b9a26c63320591d07960051dfbf78faaf634d3` |
| Accredited practitioner #2 | `0x034ca8Fd14cd3E900c15cbaF3B5aEf2702A7E3a5` — `credentialOf` = `0xfe8139686ff35f212fa846c29cd0a72f4d5a88f3c10c75f95fd4d47b33ccf1c7` |
| Accredited pharmacy #2 | `0x54d1c17b3B13871F9f99F568FD1D9b1BE67337A7` — `credentialOf` = `0x129dab76c9ac10cfca257e35edac8a29bfa1684151b609d1769ccfc3ea14d2f5` |

Four accounts are accredited on Fuji — two practitioners and two pharmacies.
Re-checked by `eth_call` on 13 September 2026: every one of those four uids
resolves to a live attestation, attested by the issuer authority above, with
`revocationTime = 0` and expiry around September 2027. Fuji issues and
dispenses today; it is the chain the live demo runs on ([docs/22](docs/22-guion-de-la-demo.md)).

> **There is a second registry on Fuji, and it is the wrong one.**
> `0x71fb93b46D0aEF219a98c96fF3b182bE33425458` is an earlier
> `PrescriptionRegistry` with **no accredited account at all**: every call
> reverts with `NotAccreditedPractitioner`. It is the address recorded in
> `contracts/broadcast/Deploy.s.sol/43113/run-latest.json` — a local artifact,
> since `contracts/broadcast/` is gitignored — so never copy an address from
> that file into `PRESCRIPTION_REGISTRY_ADDRESS` or
> `VITE_PRESCRIPTION_REGISTRY_ADDRESS`. The only valid one is
> `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`, the row at the top of this table.

Avalanche has no official EAS deployment, so the `SchemaRegistry`, the `EAS` and
both credential schemas above are this project's own. The issuer authority is
currently the deployer account itself — a separate authority is the pilot
target, not what is deployed today. Deployment procedure, sanity checks and open
items: [docs/19](docs/19-despliegue.md).

---

## Quick start

### Requirements

| Tool | Version | Notes |
|---|---|---|
| Node | 22 or newer | `.nvmrc` pins the major |
| pnpm | 9.12.3 | `corepack enable` installs the pinned version |
| Docker Desktop | current | WSL2 backend on Windows |
| Foundry | current | `forge`, `cast`, `anvil` — only needed for the contracts |

```bash
cp env.example .env
pnpm install
```

### Two run modes, and why

Both exist for one technical reason: on Windows, bind mounts reach a container through WSL2, where file watching is slow and drops events — Vite HMR and `tsx watch` inside a container observing a Windows-mounted folder is the textbook pathological case. Postgres and Anvil watch no project files, so they stay containerised in both modes.

**Normal mode (recommended)** — infrastructure in Docker, applications on the host, where hot reload is native:

```bash
docker compose up -d    # postgres + anvil only
pnpm db:push            # create the schema
pnpm dev                # api + doctor + pharmacy on the host
```

**Full-container mode** — for a clean run or to reproduce an environment problem:

```bash
docker compose --profile apps up
```

### Ports

| Service | Port | Mode |
|---|---|---|
| Postgres | 5432 | both |
| Anvil (local chain) | 8545 | both |
| API (Fastify) | 3000 | host, or `apps` profile |
| Doctor SPA | 5173 | host, or `apps` profile |
| Pharmacy PWA | 5174 | host, or `apps` profile |

Health check: `curl http://localhost:3000/health`.

### Contracts

Foundry is not bundled with this repository and is not installed by
`pnpm install`. Pin it to **v1.8.1** (commit `982849d3`), the exact build the
`anvil` service image ships, so a contract compiled on the host and one
compiled in the container are byte for byte the same — `foundry.toml` sets
`bytecode_hash = "none"` and pins solc precisely for that reason.

On macOS, Linux or WSL, install `foundryup` from <https://getfoundry.sh> and
pin the toolchain to `v1.8.1`. On Windows there is no installer: take
`foundry_v1.8.1_win32_amd64.zip` from the release page, check it against the
`.sha256` published beside it, extract `forge.exe`, `cast.exe` and `anvil.exe`
into `%USERPROFILE%\.foundry\bin`, and add that directory to the user `PATH`.

<https://github.com/foundry-rs/foundry/releases/tag/v1.8.1>

Dependencies are not vendored (`contracts/lib/` is gitignored), so install them
once. `--no-git` keeps them out of the index: this repository tracks no
submodules.

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install ethereum-attestation-service/eas-contracts@v1.2.0 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v4.9.3 --no-git
forge build
forge test -vvv
```

EAS v1.2.0 is the release `src/IEAS.sol` was transcribed from, and OpenZeppelin
4.9.3 is what EAS itself depends on. Both are needed only by
`script/DeployEAS.s.sol` and `script/RegisterSchemas.s.sol`, because Avalanche
has no official EAS deployment and this project therefore deploys its own.

> **Two compilers, on purpose.** EAS v1.2.0 pins `pragma solidity 0.8.19` while
> everything this project writes is pinned to 0.8.24. A file and its imports
> must share one compiler, so `foundry.toml` uses per-path
> `compilation_restrictions` instead of one global `solc_version`, and the two
> EAS scripts are `^0.8.19` and never import `LocalDemo.sol`. The bytecode of
> `PrescriptionRegistry` is unchanged by this.

The test that backs the pitch is `test_dispense_twice_reverts`. If it fails, there is no project.

```bash
forge test --match-test test_dispense_twice_reverts -vvv
```

Deploy to the local chain, with Anvil already running from Compose:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url anvil --broadcast
forge script script/SetupCredentials.s.sol --rpc-url anvil --broadcast
```

`Deploy.s.sol` brings up a `MockEAS` on chainId 31337, because Anvil has no
Ethereum Attestation Service of its own. Off that chain it refuses to run
without `EAS_ADDRESS`, `PRACTITIONER_SCHEMA_UID`, `PHARMACY_SCHEMA_UID` and
`ISSUER_AUTHORITY`: a registry deployed with those at zero can never accredit
anyone.

On Avalanche Fuji those four values do not come from the network — **there is no
official EAS deployment on Avalanche**, so the project deploys its own EAS
v1.2.0 first and the three scripts run in order. Two details that are easy to
miss: Foundry loads `.env` from `contracts/`, where `foundry.toml` lives, and
**not** from the repository root where this project keeps its `.env`, so export
it into the shell first; and the scripts call `vm.broadcast()` with no key
argument, so the deployer key is passed on the command line. Full procedure in
[docs/19](docs/19-despliegue.md).

```bash
cd contracts
set -a; . ../.env; set +a

# 1. SchemaRegistry, then EAS(schemaRegistry). Prints both addresses.
#    Refuses to run on chainId 31337, where MockEAS already exists.
forge script script/DeployEAS.s.sol --rpc-url fuji --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# 2. The two credential schemas. Prints their uids. Idempotent.
SCHEMA_REGISTRY_ADDRESS=0x... \
forge script script/RegisterSchemas.s.sol --rpc-url fuji --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# 3. The registry itself.
EAS_ADDRESS=0x... PRACTITIONER_SCHEMA_UID=0x... PHARMACY_SCHEMA_UID=0x... \
ISSUER_AUTHORITY=0x... \
forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Those schema uids are **not** the ones `LocalDemo.sol` uses on Anvil: the real
`SchemaRegistry` derives a uid from
`keccak256(abi.encodePacked(schema, resolver, revocable))`, while the local
stand-ins hash the declaration. Only the ones `RegisterSchemas.s.sol` prints are
valid on a public network. See [docs/19](docs/19-despliegue.md).

`SetupCredentials.s.sol` then accredits the three demo accounts — the authority
attests in EAS, and each account registers the pointer itself. Nobody issues or
dispenses without a live credential.

> **That script is Anvil only.** `SetupCredentials.s.sol` reverts with
> `NotTheLocalChain` off chainId 31337 and signs with a compile-time Anvil key,
> and `receta setup-credentials` is gated to a local chain and to a
> `MockEAS`-only call. On Fuji the same two steps are split across the two keys
> that own them: the authority attests with
> `script/IssueCredential.s.sol` — which reads no key, takes its signer from the
> command line and refuses to run unless that signer is
> `registry.issuerAuthority()` — and each holder then registers its own pointer
> with a single `cast send 'registerCredential(bytes32)'`. Full procedure,
> including how to read the real uid out of the `Attested` event and how
> revocation works: [docs/19](docs/19-despliegue.md).

### Workspace scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API and both SPAs in watch mode |
| `pnpm build` | Type-check and build every package |
| `pnpm test` | Vitest across the workspace |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm db:push` | Apply the Drizzle schema to Postgres |

### Demo CLI

The buildathon deliverable runs without either SPA. With Postgres, Anvil and the
API up:

```bash
corepack pnpm --filter '@recetas/cli' exec tsx src/main.ts demo
```

Issue, dispense, and a second dispensing rejected with the decoded
`AlreadyDispensed` error — who dispensed it and when. Act zero accredits the
three accounts against EAS, so the command also works on a chain where
`SetupCredentials.s.sol` has not been run; `receta setup-credentials` does that
step alone.

```bash
corepack pnpm --filter '@recetas/cli' exec tsx src/main.ts demo --revoked
```

The other rejection worth showing: the authority withdraws the pharmacy's
credential in EAS, and the next dispensing dies with `NotAccreditedPharmacy`.
The registry re-reads EAS on every call, so the revocation bites immediately and
no administrator is involved. See [apps/cli/README.md](apps/cli/README.md).

---

## Repository layout

```
contracts/          Foundry project: PrescriptionRegistry + tests
apps/cli/           `receta`: end-to-end demo CLI (issue, verify, dispense)
apps/doctor/        React 19 SPA, desktop
apps/pharmacy/      React 19 PWA, mobile, camera + QR
services/api/       Fastify BFF over Postgres (encrypted payload store)
packages/shared/    Domain types, zod schemas, EIP-712 domain
packages/crypto/    AES-256-GCM envelope encryption over WebCrypto
packages/rules/     Deterministic clinical rules engine
design/             Design tokens, component layer, static mockups
docs/               Architecture documentation
```

## Rules the code may not break

These come from the architecture documents and a review that finds one violated should block the merge.

| Rule | Source |
|---|---|
| No patient identifier on-chain: not the id, not its hash, not a stable pseudonym. Only `keccak256(patientId, salt)` with a different salt per prescription | [docs/03](docs/03-modelo-de-datos.md) |
| The salt never appears on-chain, in the QR, in a URL or in a log line | [docs/03](docs/03-modelo-de-datos.md), [docs/17](docs/17-diseno-y-experiencia.md) |
| No reopen function over a dispensed prescription — not administrative, not emergency, not multisig | [docs/04](docs/04-smart-contracts.md) |
| The pharmacy service worker caches the app shell only, never clinical content and never verification responses | [docs/17](docs/17-diseno-y-experiencia.md) |
| No clinical alert blocks issuance; the engine only returns alerts with their evidence | [docs/06](docs/06-validacion-clinica.md) |
| The words "wallet", "seed phrase" and "balance" never appear in the interface | [docs/01](docs/01-arquitectura.md), [docs/17](docs/17-diseno-y-experiencia.md) |
| Real patient data only in the pilot environment, with documented consent | [docs/08](docs/08-stack-y-entorno.md) |

## What is deliberately not built yet

| Gap | Decision |
|---|---|
| A `NotAccreditedPharmacy` rejection on Fuji. Two practitioners and two pharmacies are accredited there, which is enough to issue and dispense and enough for the rejection the demo actually shows — a second dispensing of the same prescription. What Fuji has no ready-made account for is the OTHER rejection, the one that needs a pharmacy WITHOUT a credential; Anvil accredits three accounts in one script and keeps that act available offline | docs/19, ["Acreditar cuentas en Fuji"](docs/19-despliegue.md) |
| ERC-4337 end to end. The pieces exist and pass their own tests — `PasskeyAccount`, its factory, `PrescriptionPaymaster`, and a relayer in `services/api` that packs a v0.7 operation, hashes it the way the deployed EntryPoint does and submits it through `handleOps` — but NOTHING IS DEPLOYED: no factory, no paymaster, no deposit, no stake. The relayer is **not a bundler**: no mempool, no bundling, no ERC-7562, no reputation, no stake. `permissionless.js` is still not installed, deliberately | docs/01, docs/08, [docs/18 Fase 5](docs/18-tareas-por-fases.md) |
| DEK wrapping per recipient; the key travels unwrapped in the QR | D-24, [docs/05](docs/05-almacenamiento-y-cifrado.md) |
| Drug-drug interactions; the MVP covers declared allergies and ATC duplication only | D-15, [docs/06](docs/06-validacion-clinica.md) |
| Medication catalogue; prescribing is by active ingredient and ATC code | D-07, [docs/03](docs/03-modelo-de-datos.md) |
| Chronic treatment and partial dispensing | D-12, [docs/04](docs/04-smart-contracts.md) |
| ADSIB legal signature; shown as `pending-integration`, never simulated as valid | D-17, [docs/07](docs/07-seguridad-y-cumplimiento.md) |
