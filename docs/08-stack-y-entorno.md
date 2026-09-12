# 08 — Stack y entorno

Foundry para los contratos, Base Sepolia como red, un proveedor de infraestructura ERC-4337 para bundler y paymaster, React para las dos aplicaciones y Postgres para el payload cifrado. La regla que gobierna cada elección es la misma: si no se puede montar y demostrar en setenta y dos horas, no entra.

## Stack recomendado

| Capa | Elección | Alternativas | Por qué esta |
|---|---|---|---|
| Red | Base Sepolia | Arbitrum Sepolia, Scroll Sepolia | Mejor tooling de paymaster y passkeys en el plazo disponible |
| Contratos | Solidity 0.8.x | — | Estándar del EVM |
| Tooling de contratos | **Foundry** | Hardhat | `forge test` es rápido, el fuzzing viene incluido y las pruebas se escriben en Solidity, sin cambiar de lenguaje |
| Cuenta | Smart account ERC-4337 con verificación P-256 | EIP-7702 | El médico no tiene wallet previa; 4337 no la exige |
| Bundler y paymaster | Proveedor de infraestructura de account abstraction | Bundler propio | Montar un bundler propio consume el buildathon entero |
| Credenciales | EAS en Base Sepolia | Registro propio en Solidity | Ya desplegado, con esquema, revocación y exploradores |
| Frontend | React con TypeScript y Vite | Next.js | Dos SPA sencillas; no necesitamos renderizado en servidor |
| Firma del usuario | WebAuthn del navegador (passkeys) | Wallet de extensión | Ningún médico instalará una extensión |
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
│  │  └─ PrescriptionPaymaster.sol
│  ├─ test/
│  │  ├─ PrescriptionRegistry.t.sol
│  │  └─ invariants/
│  ├─ script/
│  │  └─ Deploy.s.sol
│  └─ foundry.toml
├─ apps/
│  ├─ doctor/                # React SPA
│  └─ pharmacy/              # React SPA
├─ services/
│  └─ api/                   # Node + TypeScript BFF
├─ packages/
│  ├─ crypto/                # envelope encryption helpers
│  ├─ rules/                 # deterministic clinical rules
│  └─ shared/                # shared types, EIP-712 domain
└─ docs/
```

## Entornos

| Entorno | Red | Propósito | Datos |
|---|---|---|---|
| Local | Anvil | Desarrollo de contratos y pruebas | Sintéticos |
| Integración | Base Sepolia | Demo del buildathon, pruebas de extremo a extremo | Sintéticos |
| Piloto | Base Sepolia o L2 en mainnet | Uso con una clínica y una farmacia reales | Reales, con consentimiento |

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
| El proveedor de bundler falla | Segunda cuenta configurada con un proveedor alternativo |
| La cámara del portátil no lee el QR | Código introducible a mano en la aplicación de farmacia |
| La transacción tarda más de lo previsto | Ensayar el guion asumiendo el peor tiempo medido |

## Despliegue

```bash
# contracts
forge build
forge test -vvv
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify

# apps
pnpm -C apps/doctor build
pnpm -C apps/pharmacy build
```

`SUPUESTO:` el equipo dispone de una URL de RPC para Base Sepolia y de ETH de testnet suficiente para desplegar y financiar el paymaster.

## Siguiente paso

Continuar con [09-roadmap.md](09-roadmap.md).
