# 08 — Stack y entorno

Foundry para los contratos, Avalanche Fuji como red, React para las dos aplicaciones y Postgres para el payload cifrado. La abstracción de cuenta ERC-4337 está construida —cuenta con verificación P-256, paymaster, cliente de passkey y un relayer propio en lugar de un bundler de terceros— pero sin desplegar y sin cablear: hoy las dos aplicaciones firman con una wallet inyectada EIP-1193 (`eip1193-signer.adapter.ts`), no con una smart account. La regla que gobierna cada elección es la misma: si no se puede montar y demostrar en setenta y dos horas, no entra.

## Stack recomendado

| Capa | Elección | Alternativas | Por qué esta |
|---|---|---|---|
| Red | Avalanche Fuji (chainId 43113) | Base Sepolia, Arbitrum Sepolia, Scroll Sepolia | Cadena EVM pública con RIP-7212 comprobado en vivo. Es una L1 independiente, no una L2 de Ethereum: ver la tabla de decisión de [01](01-arquitectura.md) |
| Contratos | Solidity 0.8.x | — | Estándar del EVM |
| Tooling de contratos | **Foundry** | Hardhat | `forge test` es rápido, el fuzzing viene incluido y las pruebas se escriben en Solidity, sin cambiar de lenguaje |
| Cuenta | Smart account ERC-4337 con verificación P-256 — **construida, sin desplegar ni cablear**: `PasskeyAccount.sol` y `PasskeyAccountFactory.sol` existen y pasan sus pruebas, pero no hay despliegue y hoy se firma con una wallet inyectada EIP-1193 | EIP-7702 | El médico no tiene wallet previa; 4337 no la exige |
| Relayer y paymaster | **Propios**: `services/api/src/relayer/` y `contracts/src/PrescriptionPaymaster.sol` — **construidos, sin desplegar**: no hay paymaster en la cadena, ni depósito, ni stake | Proveedor de infraestructura de account abstraction | No hace falta un bundler ni un proveedor: `handleOps` del EntryPoint v0.7 es `public` y sin control de acceso —comprobado en Fuji—, así que el relayer envía cada operación directamente. No tiene mempool, ni agrupación, ni ERC-7562, ni reputación, ni stake, y por eso no se le llama bundler |
| Credenciales | EAS v1.2.0 **desplegado por el propio proyecto** | Registro propio en Solidity | Avalanche no tiene despliegue oficial de EAS, así que lo desplegamos nosotros. Aun así gana al registro propio: esquema tipado, revocación y herramientas que ya existen, sin escribir contrato nuevo |
| Frontend | React con TypeScript y Vite | Next.js | Dos SPA sencillas; no necesitamos renderizado en servidor |
| Firma del usuario | WebAuthn del navegador (passkeys) — **construido, sin cablear**: el cliente está en `apps/doctor/src/infrastructure/passkey/` y la verificación en `WebAuthn.sol`, pero ninguna pantalla llama al puerto y hoy se firma con `window.ethereum` a través de `eip1193-signer.adapter.ts` | Wallet de extensión | Ningún médico instalará una extensión |
| QR | Biblioteca de generación y lectura en el navegador | App nativa | La cámara del navegador basta |
| Backend | Node con TypeScript | Go, Python | Comparte tipos con el frontend y acelera el desarrollo |
| Almacenamiento del payload | Postgres | IPFS (Kubo), almacenamiento de objetos | Ver [D-08](05-almacenamiento-y-cifrado.md) |
| Motor de reglas | Módulo TypeScript con reglas versionadas | Motor de reglas externo | Son pocas reglas y deben ser auditables |
| Observabilidad | Registro estructurado más explorador de bloques | Pila completa de observabilidad | Suficiente para un piloto |

> La decisión pendiente D-21, sobre trazabilidad de unidades, se documenta en [09 Roadmap](09-roadmap.md): no corresponde a esta capa.

## Foundry frente a Hardhat

| Criterio | Foundry | Hardhat |
|---|---|---|
| Lenguaje de pruebas | Solidity | JavaScript o TypeScript |
| Velocidad de ejecución | Muy alta | Media |
| Fuzzing e invariantes | Integrado (`forge fuzz`, invariant testing) | Requiere complementos |
| Manipulación de tiempo | `vm.warp`, `vm.prank` nativos | Vía helpers de red |
| Integración con frontend TypeScript | Menor | Mayor |
| Curva de aprendizaje si el equipo viene de JavaScript | Mayor | Menor |

**Recomendación: Foundry.** El invariante que debemos demostrar ("ninguna secuencia de llamadas saca una receta de `Dispensed`") se escribe en tres líneas con invariant testing y en bastante más con Hardhat. Si el equipo no tiene experiencia en Solidity para pruebas, Hardhat es una elección defendible.

## Estructura del repositorio

```
proyecto_recetas/
├─ contracts/                # Foundry project
│  ├─ src/
│  │  ├─ PrescriptionRegistry.sol
│  │  ├─ PrescriptionPaymaster.sol
│  │  ├─ PasskeyAccount.sol
│  │  ├─ PasskeyAccountFactory.sol
│  │  ├─ WebAuthn.sol
│  │  └─ P256.sol
│  ├─ test/
│  │  ├─ PrescriptionRegistry.t.sol
│  │  └─ invariants/
│  ├─ script/
│  │  ├─ DeployEAS.s.sol       # EAS v1.2.0 propio: SchemaRegistry + EAS
│  │  ├─ RegisterSchemas.s.sol # los dos esquemas de credencial
│  │  └─ Deploy.s.sol
│  └─ foundry.toml
├─ apps/
│  ├─ doctor/                # React SPA; incluye el cliente de passkey (infrastructure/passkey)
│  └─ pharmacy/              # React SPA
├─ services/
│  └─ api/                   # Node + TypeScript BFF; incluye el relayer (src/relayer)
├─ packages/
│  ├─ crypto/                # envelope encryption helpers
│  ├─ rules/                 # deterministic clinical rules
│  └─ shared/                # shared types, EIP-712 domain
└─ docs/
```

> Que un archivo esté en el árbol significa que existe y pasa sus pruebas, no que esté desplegado. De `contracts/src/`, lo único desplegado en Fuji es `PrescriptionRegistry.sol`, con el EAS propio y los dos esquemas de credencial ([19](19-despliegue.md)). `PrescriptionPaymaster.sol`, `PasskeyAccount.sol` y su fábrica no tienen dirección en ninguna cadena, y el relayer solo se registra cuando el entorno le da una clave, un registro y un paymaster (`env.example`).

## Entornos

| Entorno | Red | Propósito | Datos |
|---|---|---|---|
| Local | Anvil | Desarrollo de contratos y pruebas | Sintéticos |
| Integración | Avalanche Fuji | Demo del buildathon, pruebas de extremo a extremo | Sintéticos |
| Piloto | Avalanche Fuji o una cadena EVM en mainnet | Uso con una clínica y una farmacia reales | Reales, con consentimiento |

> **Nunca datos de pacientes reales fuera del entorno de piloto**, y en él solo con consentimiento explícito documentado.

## Gestión de secretos

| Secreto | Dónde vive | Nunca |
|---|---|---|
| Clave del emisor de credenciales | Multifirma o gestor de secretos | En el repositorio |
| Clave del operador del paymaster | Gestor de secretos | En variables de entorno del frontend |
| Sales de los compromisos | Almacén off-chain cifrado | On-chain, ni en registros de log |
| DEK de cada receta | MVP: viaja en el QR sin envoltura; Fase 2: envuelta por destinatario ([05, D-24](05-almacenamiento-y-cifrado.md)) | En claro en la base de datos |
| Passkeys | Enclave seguro del dispositivo | Nunca salen del dispositivo |

## Estrategia de pruebas por capa

| Capa | Tipo de prueba | Herramienta | Prioridad |
|---|---|---|---|
| Contratos | Unitarias por transición de estado | `forge test` | **Máxima** |
| Contratos | Invariantes con fuzzing | `forge test` | **Máxima** |
| Contratos | Simulación de credencial revocada | Mock de EAS | Alta |
| Criptografía | Ciclo cifrar, descifrar, verificar hash | Vitest | Alta |
| Reglas clínicas | Casos de alergia y duplicidad | Vitest | Media |
| Aplicaciones | Camino feliz de extremo a extremo | Playwright | Media |
| Demo | Ensayo completo del guion del pitch | Manual, cronometrado | **Máxima** |

> **La prueba `test_dispense_twice_reverts` es la que respalda el argumento del pitch.** Si falla, no hay proyecto. Se escribe primero.

### Ensayo de la demo

| Riesgo de la demo | Contingencia |
|---|---|
| Sin conectividad en la sala | Grabación en vídeo del flujo completo, lista para reproducir |
| El explorador de bloques va lento | Capturas de pantalla preparadas del evento y del `revert` |
| El RPC de Fuji responde lento o no responde | Segundo punto de acceso RPC configurado. No hay proveedor de bundler que pueda fallar: el relayer es propio y la demo de hoy ni siquiera lo usa |
| La cámara del portátil no lee el QR | Código introducible a mano en la aplicación de farmacia |
| La transacción tarda más de lo previsto | Ensayar el guion asumiendo el peor tiempo medido |

## Despliegue

```bash
# contracts
forge build
forge test -vvv

# EAS es propio del proyecto: primero se despliega, después se registran los
# esquemas, y solo entonces el registro. Detalle completo en 19-despliegue.md.
forge script script/DeployEAS.s.sol       --rpc-url fuji --broadcast
forge script script/RegisterSchemas.s.sol --rpc-url fuji --broadcast
forge script script/Deploy.s.sol          --rpc-url fuji --broadcast --verify

# apps
pnpm -C apps/doctor build
pnpm -C apps/pharmacy build
```

El alias `fuji` sale de `[rpc_endpoints]` en `contracts/foundry.toml` y se resuelve con `FUJI_RPC_URL`.

`SUPUESTO:` el equipo dispone de una URL de RPC para Avalanche Fuji y de AVAX de testnet suficiente para desplegar y financiar el paymaster. Ahora el despliegue son tres transacciones más que antes —`SchemaRegistry`, `EAS` y los dos registros de esquema—, porque la instancia de EAS ya no viene dada por la red.

## Siguiente paso

Continuar con [09-roadmap.md](09-roadmap.md).
