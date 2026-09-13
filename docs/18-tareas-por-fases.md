# 18 — Tareas por fases

La lista operativa del buildathon. El orden no es negociable y sale de [16](16-plan-de-ejecucion.md): cada fase existe para desbloquear la siguiente, y su **criterio de salida** es lo único que autoriza a pasar adelante. Una fase a medias no se deja atrás «para volver luego»; volver luego es exactamente lo que no va a ocurrir en setenta y dos horas.

> **Estado al 13/09/2026. Fases 0, 1, 2 y 3 cerradas.** El proyecto está desplegado en Avalanche Fuji, chainId 43113: `SchemaRegistry`, un `EAS` v1.2.0 propio, los dos esquemas de credencial y el `PrescriptionRegistry`, este último con el código fuente verificado en el explorador. Las direcciones y los uids están anotados en [19](19-despliegue.md) y en el README de la raíz. Fase 1 quedó cerrada antes con 34 de 34 en `forge test` —hoy son 141, tras la Fase 5—, con `test_dispense_twice_reverts` verificando el revert *con sus argumentos* y un fuzz de 256 pasadas sobre el estado absorbente. El andamiaje adelantó además parte de las fases 4 y 10 (`packages/crypto`, `shared` y `rules`, con 21 pruebas en verde): están marcadas porque existen y pasan, no porque se haya alterado el orden de prioridades.
>
> **La acreditación EAS ya no está stubbeada.** `_isAccreditedPractitioner` y `_isAccreditedPharmacy` leen la attestation en EAS en cada llamada y exigen las cinco condiciones de [04](04-smart-contracts.md). Esas comprobaciones aportaron 21 pruebas a las 13 del ciclo de la receta, las 34 con las que cerró la Fase 3; la Fase 5 sumó 78 de cuenta, firma P-256 y aserción WebAuthn, más 29 del paymaster, y hoy `forge test` da 141 de 141. Lo que quedaba de la fase 3 era de red y ya está hecho: **no existe un despliegue oficial de EAS en Avalanche**, así que el proyecto desplegó el suyo en Fuji con `script/DeployEAS.s.sol` y registró los dos esquemas con `script/RegisterSchemas.s.sol`.
>
> **Ese bloqueante está cerrado: Fuji ya tiene cuentas acreditadas.** El médico `0x4429d872fB9253C8516AE525b03cE06FbbbEC143` y la farmacia `0x7b33436643a681262562785C02Cba36524491042` tienen `credentialOf` apuntando a una attestation viva, emitida por `ISSUER_AUTHORITY` y con `revocationTime = 0`; comprobado por las dos caras, la cuenta acreditada simula `issue` sin revertir y una cuenta cualquiera revierte con `NotAccreditedPractitioner`. El camino de herramientas que faltaba es `script/IssueCredential.s.sol` más un `registerCredential(uid)` por titular: `script/SetupCredentials.s.sol` sigue siendo solo local —revierte con `NotTheLocalChain` fuera de la chainId 31337 y firma con una constante de compilación—, y `receta setup-credentials` sigue cerrado por `assertLocalChain`, `assertLocalEas` y `attestWithUid`, que solo existe en `MockEAS`. Procedimiento completo en [19](19-despliegue.md). Comprobado otra vez el 13/09/2026 contra el RPC público: en el registro **bueno** `0xD5F2d5aD03703a9Ee11078d86181421E2E078365` hay **cuatro** cuentas acreditadas, no dos — dos profesionales (`0x4429d872…C143` y `0x034ca8Fd…E3a5`) y dos farmacias (`0x7b334366…1042` y `0x54d1c17b…37A7`), las cuatro con `credentialOf` apuntando a una attestation de `0x613F14B9…6c0C`, con `revocationTime = 0` y caducidad hacia septiembre de 2027. El acto de rechazo de la demostración es la **segunda dispensación de la misma receta**, que no necesita ninguna cuenta sin credencial, así que **el guion en vivo ya corre sobre Fuji** ([22](22-guion-de-la-demo.md)).

> **La regla que gobierna esta lista.** Si algo no aparece aquí, no se construye. Toda idea nueva se anota en [09](09-roadmap.md) como fase posterior y se sigue con la tarea en curso.

## Fase 0 — Entorno

Prerequisito de todo lo demás. **No es progreso hacia la demo**: que Docker levante no acerca ni un minuto el pitch. Se paga una vez y se olvida.

- [x] pnpm 9.12.3 en el `PATH` del host, instalado con `npm i -g pnpm@9.12.3` — esa ruta no exige administrador, a diferencia de `corepack enable`
- [x] Foundry 1.8.1 en el host (`forge`, `cast`, `anvil` en `~/.foundry/bin`, ya en el `PATH` de usuario) — mismo commit `982849d3` que la imagen `ghcr.io/foundry-rs/foundry:latest` del servicio `anvil`, para que el bytecode salga igual se compile donde se compile
- [x] Dependencias de contratos instaladas: `forge-std`, `eas-contracts@v1.2.0` y `openzeppelin-contracts@v4.9.3`. `contracts/lib/` está en `.gitignore` y no viene con el clon, así que `forge build` falla hasta instalarlas y los scripts de EAS ni siquiera compilan
- [x] Workspace pnpm en la raíz con `apps/*`, `services/*`, `packages/*`
- [x] `tsconfig.base.json` con `strict: true` y rutas a `@recetas/shared`, `@recetas/crypto`, `@recetas/rules`
- [x] `docker compose up -d` levanta Postgres y Anvil
- [x] `env.example` con `DATABASE_URL`, `RPC_URL`, `FUJI_RPC_URL`
- [x] Obtener AVAX de testnet de Fuji en la cuenta de despliegue — la cuenta tiene 3,499 AVAX, y el despliegue completo del 13/09/2026 lo demuestra: los tres scripts y la verificación costaron juntos menos de 0,001 AVAX
- [x] Acceso al RPC público de Fuji (`https://api.avax-test.network/ext/bc/C/rpc`) comprobado el 12/09/2026: `eth_chainId` devuelve `0xa869`, que es 43113, y `eth_blockNumber`, `0x37a2d0b`
- [x] Recuperación ante un RPC que se cae a mitad del despliegue, documentada en [19](19-despliegue.md): Foundry no reintenta el broadcast, se reenvía con `--resume`

> Ningún RPC público es fiable al cien por cien, pero **Foundry no hace backoff en el broadcast y no hay flag que lo active**: `--retries` y `--delay` son reintentos del *verificador* de código fuente en el explorador, con cinco intentos por defecto, y no tocan el envío de la transacción. Lo que sí existe es `--resume`, que reenvía las transacciones que quedaron pendientes o caídas sin volver a simular el script, y `--rpc-timeout`, que impide que la espera se cuelgue sin límite. El procedimiento está en [19](19-despliegue.md).
>
> La comprobación del 12/09/2026 dice que el RPC responde, no que sea fiable: la disponibilidad sostenida **no se ha medido**, y lo que se midió en [16](16-plan-de-ejecucion.md) fue otra red y ese dato no se traslada.

**Criterio de salida:** `docker compose up -d` levanta la infraestructura y `pnpm install` termina sin errores.

## Fase 1 — El contrato y la prueba que sostiene el pitch

Nada empieza antes de esto. Ni el diseño, ni la API, ni una línea de React.

- [x] `contracts/` inicializado con Foundry
- [x] `enum PrescriptionStatus { None, Issued, Dispensed, Cancelled }` — declarado en `IPrescriptionRegistry.sol`, que `PrescriptionRegistry.sol` importa
- [x] Struct EIP-712 `Prescription` y dominio `RecetaVerificable` v1 — **no hay una sola línea de EIP-712 en `contracts/`**: vive en `packages/shared/src/eip712.ts`, porque la firma es off-chain ([01](01-arquitectura.md)) y la verificación on-chain se descartó a propósito ([04](04-smart-contracts.md)). El 43113 es el valor por defecto de `prescriptionDomain`, que `domainFor` sobrescribe siempre con la chainId del despliegue vivo, hoy 31337
- [x] `issue(contentHash, patientCommitment, expiresAt)`
- [x] `dispense(contentHash)`
- [x] `cancel(contentHash)` restringido al prescriptor y solo antes de dispensar
- [x] `verify(contentHash)` devolviendo `(status, dispensable, prescriber, expiresAt)`
- [x] Los nueve errores de ciclo de vida de [04](04-smart-contracts.md), con `AlreadyDispensed` devolviendo `dispensedBy` y `dispensedAt`. El contrato declara **dieciséis**: esos nueve más los siete de credencial que [04](04-smart-contracts.md) también exige
- [x] Eventos `PrescriptionIssued` y `PrescriptionDispensed`
- [x] **`test_dispense_twice_reverts` pasando**
- [x] Test de caducidad con `vm.warp`
- [x] Test de cancelación por quien no es el prescriptor
- [x] Fuzz acotado sobre el estado absorbente: `testFuzz_never_leaves_dispensed`, 256 pasadas. **No es un invariant test de Foundry** — no existe ninguna función `invariant_` ni `StdInvariant` en `contracts/test/` — y no prueba «ninguna secuencia»: fuzzea el llamante y el salto temporal sobre una secuencia fija `dispense` → `cancel`, nunca llama a `issue`, y el `uint16 elapsed` topea el salto en 18,2 horas contra una caducidad de 30 días, así que jamás alcanza la rama de caducada

**Criterio de salida:** `forge test` en verde, con `test_dispense_twice_reverts` incluida. Si esa prueba falla, no hay proyecto.

## Fase 2 — Despliegue en Avalanche Fuji

- [x] `script/Deploy.s.sol` — **validado contra Anvil**: despliega, y el ciclo `issue` → `dispense` → `dispense` revierte con `AlreadyDispensed` devolviendo `dispensedBy` y `dispensedAt` correctos
- [x] Desplegar con `--broadcast --verify` — hecho el 13/09/2026 en Fuji: `PrescriptionRegistry` en `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`
- [x] Verificar el código fuente en el explorador — `Pass - Verified` en Routescan, y Snowtrace sirve el mismo código porque hoy funciona sobre Routescan
- [x] Anotar la dirección en el README de la raíz — sección *Live deployment*, con las tres direcciones, los dos uids, el emisor y el enlace al explorador

**Criterio de salida:** dirección pública y explorable. Desbloquea todo lo que necesita hablar contra un contrato real.

> **El orden de esta lista ya no se sostiene: la Fase 2 no puede ir antes que la 3.** `script/Deploy.s.sol` revierte fuera de la chain 31337 si falta `EAS_ADDRESS`, cualquiera de los dos uids de esquema o `ISSUER_AUTHORITY` (`MissingEasAddress`, `MissingPractitionerSchema`, `MissingPharmacySchema`, `MissingIssuerAuthority`, líneas 57-60), y esos cuatro valores los producen `DeployEAS.s.sol` y `RegisterSchemas.s.sol`, que esta lista archiva en la Fase 3. Antes de la migración no era así: EAS venía dado por la red y la Fase 2 era autónoma. La secuencia real en Fuji es cuenta financiada → `DeployEAS` → `RegisterSchemas` → `Deploy`.

> **Desplegado en Fuji el 13/09/2026, en la secuencia que la nota de arriba exige.** `PrescriptionRegistry` vive en `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`, construido contra el `EAS` propio `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A` y los dos uids reales que imprimió `RegisterSchemas.s.sol`. Se comprobó uno a uno que `registry.eas()`, `registry.issuerAuthority()`, `registry.practitionerSchema()` y `registry.pharmacySchema()` devuelven exactamente lo anotado. `ISSUER_AUTHORITY` es `0x613F14B919317b515D8804915a8E82f926C86c0C`, que es **la propia cuenta de despliegue**: el proyecto controla una sola clave, así que desplegador y autoridad emisora colapsan en una, y la separación que describe `env.example` queda como deuda declarada del MVP, no como algo hecho. Como ese valor es `immutable` y `_hasLiveCredential` rechaza cualquier attestation de otro `attester`, equivocarlo obliga a redesplegar el registro entero. Coste total del procedimiento: menos de 0,001 AVAX. Detalle y direcciones completas en [19](19-despliegue.md).

> **La verificación del código fuente está comprobada.** Fuji es de tier pago en Etherscan V2, así que la key gratuita de Etherscan no sirve y `[etherscan]` apunta a Routescan (`https://api.routescan.io/v2/network/testnet/evm/43113/etherscan`, con la key literal `verifyContract`). Esa configuración se ejercitó en el despliegue real y funcionó tal cual, sin corregir nada: el envío queda unos quince segundos en `Pending in queue` y después devuelve `Pass - Verified`. Forge envía además el código a Sourcify en paralelo por su cuenta. Los dos exploradores sirven el mismo código verificado —Snowtrace funciona hoy sobre Routescan—, así que `https://testnet.snowtrace.io` sigue siendo una referencia válida y no hay nada que cambiar en la configuración ni en el código.

> **Desplegado y además utilizable: Fuji tiene cuatro cuentas acreditadas.** El criterio de salida de esta fase —dirección pública y explorable— está cumplido, y el bloqueante que venía detrás ya no existe: `credentialOf` devuelve un uid vivo para dos profesionales (`0x4429d872…C143`, `0x034ca8Fd…E3a5`) y dos farmacias (`0x7b334366…1042`, `0x54d1c17b…37A7`) sobre el registro `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`, verificado por `eth_call` el 13/09/2026. La herramienta que faltaba es `script/IssueCredential.s.sol` más un `registerCredential(uid)` por titular; detalle en [19](19-despliegue.md).
>
> **La trampa que queda es de dirección, no de credencial.** En Fuji hay un **segundo** `PrescriptionRegistry`, `0x71fb93b46D0aEF219a98c96fF3b182bE33425458`, **sin ninguna cuenta acreditada**: ahí todo revierte `NotAccreditedPractitioner`. Es el que quedó anotado en `contracts/broadcast/Deploy.s.sol/43113/run-latest.json` —un artefacto local, `contracts/broadcast/` está en `.gitignore`—, así que esa dirección **no** debe copiarse a ninguna variable de entorno. La buena es la del párrafo anterior y es la que está en el README.

## Fase 3 — Credenciales EAS

- [x] `IEAS.sol` con el struct `Attestation` transcrito campo a campo de EAS v1.2.0 — un desajuste de orden o de tipo decodifica `revocationTime` desde otra ranura y deja pasar una credencial revocada
- [x] `registerCredential(bytes32 uid)` — auto-registro sin administrador, con las cinco comprobaciones en el momento de registrar y un error propio por motivo
- [x] Conectar `_isAccreditedPractitioner` y `_isAccreditedPharmacy` contra EAS, releyendo la attestation en cada `issue` y cada `dispense` y sin cachear nunca el veredicto
- [x] Registrar el esquema `PractitionerCredential` (`licenseNumber`, `specialtyCode`, `issuerAuthority`, `validFrom`, `validUntil`) — en el EAS local **y en el `SchemaRegistry` propio de Fuji**
- [x] Registrar el esquema `PharmacyCredential` (`pharmacyLicense`, `sanitaryRegistryRef`, `issuerAuthority`, `validFrom`, `validUntil`) — en el EAS local **y en el `SchemaRegistry` propio de Fuji**
- [x] Emitir attestation de prueba para un médico — `script/SetupCredentials.s.sol` y `receta setup-credentials`
- [x] Emitir attestation de prueba para una farmacia — las dos farmacias de la demo
- [x] Probar los cinco motivos de rechazo: sin credencial, emisor no autorizado, revocada, caducada, dirigida a otra cuenta — para los dos roles, en el registro y en el uso
- [x] `script/Deploy.s.sol` falla ruidosamente fuera de la cadena 31337 si falta la dirección de EAS, un uid de esquema o el emisor autorizado
- [x] Desplegar EAS v1.2.0 propio en Fuji con `script/DeployEAS.s.sol`: primero `SchemaRegistry`, luego `EAS(schemaRegistry)` — hecho el 13/09/2026. `SchemaRegistry` en `0xD4aFA6F68be2eb0c99D3B421B7f52a6420217efb` y `EAS` en `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A`; las dos `version()` devuelven `1.2.0` y `EAS.getSchemaRegistry()` apunta al registro de al lado
- [x] Registrar los dos esquemas en ese `SchemaRegistry` con `script/RegisterSchemas.s.sol` y anotar los uids que imprime — `PractitionerCredential` es `0x5b8d9aff12e1409f3603c9bcca659c1e1dc8d8b4faf219b674d743f6ec54f233` y `PharmacyCredential` es `0xac44c9573bebb0b5622ea078c08bea286ad1d99566d317a32393a9e71fbff500`
- [x] Volcar el resultado al entorno: `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `PRACTITIONER_SCHEMA_UID` y `PHARMACY_SCHEMA_UID` — los cuatro valores entraron al entorno de despliegue y son los que `Deploy.s.sol` grabó como inmutables en el registro

> **No hay EAS canónico en Avalanche.** El directorio `deployments/` del repositorio de `eas-contracts` lista 26 redes y ninguna es de Avalanche, así que aquí no existe ni instancia oficial ni predeploy al que apuntar: las direcciones de EAS y del `SchemaRegistry` son **nuestras**, salidas de nuestro propio despliegue, y hay que tratarlas como tales en toda la documentación y la configuración.

> **Los uids reales no son los de la demo local.** `script/LocalDemo.sol` usa stand-ins calculados como `keccak256(declaración)`; el registro real los deriva de `keccak256(abi.encodePacked(schema, resolver, revocable))`. Los únicos válidos en una red pública son los que imprime `RegisterSchemas.s.sol`, y confundirlos deja el contrato leyendo attestations que no existen.

**Criterio de salida:** el contrato rechaza a una cuenta sin credencial. Desbloquea la CLI.

> Cerrada en lo que depende de nosotros. `forge test` daba 34 de 34 al cerrarla, con `test_dispense_without_credential_reverts` y `test_dispense_with_revoked_credential_reverts` entre ellas. La decisión de diseño está documentada en [04](04-smart-contracts.md): `credentialOf` lo escribe cada cuenta para sí misma, porque [D-14](04-smart-contracts.md#d-14) exige un contrato sin administrador y el permiso de escritura no vale nada — un uid ajeno o firmado por otro emisor no supera las comprobaciones. La CLI acredita las tres cuentas de la demo (`receta setup-credentials`, o el acto 0 de `receta demo`) y `receta demo --revoked` enseña el rechazo: la autoridad revoca la credencial de la farmacia en EAS y la entrega siguiente muere con `NotAccreditedPharmacy`, sin que nadie toque el registro de recetas.
>
> **La acreditación *automática* vale en Anvil y solo en Anvil.** Está atada a la cadena local por diseño: `script/SetupCredentials.s.sol` revierte con `NotTheLocalChain` fuera de la chainId 31337 y firma con una constante de compilación (`LocalDemo.ISSUER_AUTHORITY_KEY`, la cuenta #9 de Anvil), y `receta setup-credentials` está cerrado por `assertLocalChain` (solo 31337 y 1337), por `assertLocalEas` (exige que el EAS sea el mock) y por `issueAndRegister`, que llama a `attestWithUid`, una función de `MockEAS` que un EAS v1.2.0 real no tiene. **Lo que sigue atado a Anvil es la herramienta automática, no la acreditación en sí.** El camino manual está construido y ejercitado: `EAS.attest()` firmado por `ISSUER_AUTHORITY` con `script/IssueCredential.s.sol` (`CREDENTIAL_ROLE=practitioner|pharmacy`), y un `registerCredential(uid)` por cada titular con su propia clave. Con él, el registro `0xD5F2d5aD…8365` de Fuji tiene hoy **cuatro cuentas acreditadas** —dos profesionales y dos farmacias, comprobado por `eth_call` el 13/09/2026—, así que la demo contra la red pública sí corre.

## Fase 4 — CLI de demo

**Esta fase convierte el proyecto en un entregable válido con independencia del estado de las apps web.** [15](15-track-y-entrega.md) acepta una CLI como formato de entrega.

- [x] `packages/crypto`: AES-256-GCM con WebCrypto, generación de DEK y sal
- [x] Ciclo probado: cifrar → descifrar → verificar `keccak256(ciphertext) == contentHash`
- [x] `packages/shared`: tipos y esquemas zod del modelo de [03](03-modelo-de-datos.md)
- [x] Comando `issue` — cifra, firma EIP-712 y registra
- [x] Comando `dispense` — verifica, descifra y dispensa
- [x] Segundo `dispense` mostrando el `revert` con quién y cuándo
- [x] Comando `verify` para inspeccionar el estado
- [x] Comando `demo` — el guion completo en una sola orden, con el rechazo decodificado

**Criterio de salida:** corre de punta a punta contra el contrato desplegado.

> **Cerrada contra Anvil, y el motivo del bloqueo contra Fuji ha cambiado.** El criterio de salida se cumple sobre el despliegue local. Sobre el despliegue público no, pero **ya no es por falta de credenciales**: Fuji tiene cuatro cuentas acreditadas desde el 13/09/2026 (ver la nota de la Fase 2). Lo que queda cerrado es la **CLI misma**: `assertLocalChain` solo acepta 31337 y 1337, `assertLocalEas` exige que el EAS sea el mock, e `issueAndRegister` llama a `attestWithUid`, que un EAS v1.2.0 real no expone. Es decir, `receta demo` no corre en Fuji por su propio gating, no por el estado de la cadena — y por eso **no es plan B de la demostración** ([22](22-guion-de-la-demo.md)).

> Cerrada. El paquete es `apps/cli` (`@recetas/cli`, binario `receta`) y corre contra Anvil con el `PrescriptionRegistry` ya desplegado: `receta demo` completa los tres actos y el segundo intento de dispensación muestra `AlreadyDispensed` decodificado, con la farmacia y la fecha. Los nueve errores personalizados de [04](04-smart-contracts.md) tienen mensaje propio, y «Caducada» se deriva comparando `expiresAt` con la hora del bloque, nunca del enum.

## Fase 5 — Smart account P-256 y paymaster

La decisión tomada es **cuenta propia con verificación P-256**, no una cuenta de terceros. El precompilado RIP-7212 en `0x…0100` está confirmado y funcionando en Avalanche Fuji, comprobado con una firma P-256 propia.

- [x] Smart account ERC-4337 con verificación de firma P-256 contra el precompilado
- [x] Ruta de respaldo con verificación P-256 en Solidity si el precompilado no responde
- [ ] Registro de passkey WebAuthn con `@simplewebauthn/browser`
- [x] Verificación de la aserción WebAuthn **en el contrato**: reconstruir `sha256(authenticatorData || sha256(clientDataJSON))`, comprobar `challenge`, `type` y banderas, y verificar la firma P-256 contra ese digest
- [x] ~~Integrar bundler y paymaster del proveedor elegido~~ → **relayer propio**, sin proveedor: `services/api/src/relayer/`
- [x] Política de patrocinio: solo llamadas a `PrescriptionRegistry`, solo cuentas acreditadas, con límite por cuenta y ventana
- [ ] Financiar el paymaster
- [x] Mensaje de rechazo por límite de patrocinio agotado

**Criterio de salida:** una emisión completa sin que el médico posea AVAX.

> **Los puntos 1, 2, 4, 5, 6 y 8 están cerrados; el criterio de salida NO.** Existen `contracts/src/P256.sol`, `contracts/src/WebAuthn.sol`, `contracts/src/PasskeyAccount.sol` y `contracts/src/PasskeyAccountFactory.sol`, con 78 pruebas sobre firmas P-256 y aserciones WebAuthn reales. `forge test` pasa de 34 a 141. La cuenta apunta al **EntryPoint v0.7** (`0x0000…a032`), guarda la clave pública del médico como inmutable —de modo que la dirección de la cuenta *es* un compromiso con la passkey— y solo puede llamar al `PrescriptionRegistry`. No hay administrador, ni actualización, ni rotación de clave.
>
> **La ruta de respaldo no es código nuestro y no hay que desplegarla.** Es el verificador auditado de `daimo-eth/p256-verifier`, ya vivo en Fuji en `0xc2b78104907F722DABAc4C69f826a522B2754De4` —comprobado con `eth_call` el 13/09/2026—. El código fuente está copiado literal en `contracts/vendor/p256-verifier/` con su licencia MIT y su procedencia; no se compila ni se despliega desde aquí, y el contrato lo alcanza **por dirección**. Escribir aritmética de curva a mano estaba descartado de entrada.
>
> **Corrección a un supuesto que veníamos arrastrando: RIP-7212 NO exige `s` baja.** Medido contra el precompilado real de Fuji, una firma válida y su gemela con `s` alta devuelven ambas `0x…01`. El verificador de respaldo hace lo mismo. Es decir: sin una regla propia, cada receta tendría **dos firmas válidas**. `P256.verify` **rechaza** la mitad alta antes de consultar a ningún backend, para que la firma sea un identificador canónico y no solo una autorización. Consecuencia directa para el punto 4 de esta lista: los autenticadores WebAuthn **no** normalizan, así que aproximadamente la mitad de las aserciones reales traen `s` alta.
>
> **Dónde vive el volteo: en el cliente.** `WebAuthn.check` **no** normaliza; rechaza. Normalizar en el contrato habría costado veinte gas y habría eliminado la trampa, y aun así se descartó: dejaría a `P256.verify` sosteniendo una política que ningún llamante de producción ejerce, es decir, una regla documentada, probada y muerta. Una regla, en un sitio, para todos. **El cliente debe voltear la firma antes de enviarla —`if (s > n / 2) s = n - s`—, en el registro no, en cada aserción sí**; es lo que ya hacen los SDK de Coinbase y de daimo. Si se olvida, la mitad de los accesos falla, de forma intermitente y sin motivo visible, porque ERC-4337 solo permite responder `0` o `1`. Por eso la obligación va acompañada de un diagnóstico: **`PasskeyAccount.checkAssertion` es un `eth_call` gratuito que revierte con `AssertionRejected(HighS)`** —y con la razón exacta en las otras ocho formas de fallar—, de modo que el fallo se explica en una llamada en vez de ser un misterio. La app del médico debería consultarlo *antes* de pedir la huella.
>
> **El punto 4 estaba mal enunciado y se ha corregido.** Decía «traducción de la respuesta WebAuthn al formato que espera el verificador», que suena a trabajo de cliente. No puede serlo. Un autenticador no firma los 32 bytes que se le entregan: firma `sha256(authenticatorData || sha256(clientDataJSON))`, con el `userOpHash` dentro del JSON como `challenge` en base64url. Una firma sobre *ese* mensaje no es la misma firma en otro formato, es una firma sobre otro mensaje, y ninguna transformación en el navegador convierte una en otra sin la clave privada —que está en el enclave y no sale de ahí—. La distancia solo se cierra en cadena, reconstruyendo el mensaje que el autenticador firmó de verdad. Eso es `contracts/src/WebAuthn.sol`, y `PasskeyAccount` ya lo usa.
>
> **La cuenta ya no acepta una firma P-256 cruda, y es deliberado.** Antes verificaba `r || s` sobre el `userOpHash` directamente; mantener esa vía como segunda forma admitida habría sido gratis y habría estado mal. Un enclave seguro **no puede** producir esa firma —solo firma sobres WebAuthn—, así que la única persona capaz de usarla es alguien con la clave privada exportada, que es justo el caso que el diseño existe para impedir: una puerta por la que solo cabe un atacante. Además habría anulado en silencio la exigencia de verificación de usuario, porque una firma cruda no lleva banderas. El precio se asume: sin cliente WebAuthn no hay forma de mover esta cuenta, ni siquiera en pruebas.
>
> **La verificación de usuario (UV) es obligatoria, no opcional.** Coinbase y daimo la dejan como parámetro del que llama; aquí está fijada en el código. «Usuario presente» significa que alguien tocó el autenticador; «usuario verificado» significa que el autenticador estableció *quién*. La diferencia entre las dos es la diferencia entre «este dispositivo firmó una receta» y «este médico firmó una receta», y solo la segunda significa algo en un registro médico-legal. Conviene ser honestos sobre lo que compra: el bit UV es una afirmación del propio autenticador y este contrato no tiene attestation con la que contrastarla, así que protege frente a un descuido —un teléfono desbloqueado sobre el mostrador, una llave compartida— y no frente a quien ya tiene la clave. El descuido es lo que pasa de verdad en una sala. **Consecuencia para el cliente: cada ceremonia debe pedirse con `userVerification: "required"`,** en el registro y en cada aserción; con `"preferred"` algunos autenticadores devuelven UV=0 y esos accesos se rechazan.
>
> **El `challenge` se localiza por posición anclada, nunca buscando la subcadena.** Es la misma técnica de WebAuthnSol y de daimo: el cliente dice en qué byte empieza el campo y el contrato compara ahí la cadena completa `"challenge":"<43 caracteres>"`, **con la comilla de cierre incluida**. La versión descuidada —buscar el hash codificado en cualquier parte del `clientDataJSON`— es falsificable: el JSON admite campos arbitrarios y el `origin` lo elige quien sirve la página, así que un atacante consigue *una* aserción legítima del médico con su propio `challenge` y coloca el hash de la víctima dentro del `origin`. La búsqueda ingenua lo encuentra y acepta una autorización que el médico nunca vio. El ancla lo impide porque JSON no permite una comilla sin escapar dentro de una cadena, de modo que esos 57 bytes no pueden aparecer salvo como un campo `challenge` auténtico. Hay una prueba dedicada que monta el ataque y comprueba las dos cosas: que la búsqueda ingenua habría encontrado el hash y que la comparación anclada lo rechaza igual.
>
> **El `origin` y el `rpIdHash` no se comprueban, a propósito.** Una passkey se crea para un único Relying Party y el autenticador se niega a usarla en otro, así que la credencial ya está atada al dominio por construcción. Comprobarlo en cadena obligaría a congelar el dominio dentro de la cuenta —y la dirección de la cuenta es un compromiso CREATE2 con sus argumentos de constructor—, de modo que mover la app del médico de una URL de vista previa a su dominio real invalidaría todas las cuentas y todas las credenciales EAS emitidas a ellas.
>
> **Coste en gas, medido.** El sobre WebAuthn añade unos 17k de gas sobre la verificación cruda que sustituye: 9,1k del `abi.decode` a través de una llamada externa a sí misma —la frontera que evita que un sobre malformado *revierta* la validación, cosa que ERC-4337 prohíbe— y unos 8,1k del resto de `check`, de los que 4,7k son el base64url (eran 15,7k antes de reescribirlo en ensamblador). `validateUserOp` completo midió ~52k con un backend barato y ~393k cuando responde el verificador en Solidity. **`verificationGasLimit` se dimensiona para el respaldo, no para el precompilado**: como ya advierte `P256.sol`, la vía cara es la de la firma *rechazada*.
>
> **Sigue faltando `isValidSignature` (ERC-1271)**, que la app de farmacia necesitará en cuanto el prescriptor deje de ser una EOA.
>
> **No hay despliegue ni script de despliegue, a propósito.** La forma final de la cuenta depende del punto 4, y la dirección de una cuenta es lo que la autoridad de credenciales atestigua: desplegar ahora sería pedir attestations para direcciones que habría que abandonar.
>
> **El paymaster existe: `contracts/src/PrescriptionPaymaster.sol`, con 29 pruebas propias.** Aplica las tres reglas del punto 6 en este orden: la operación tiene que ser `execute(registry, 0, …)` y nada más; el remitente tiene que tener credencial **viva**, releída en EAS en cada operación con las mismas cinco condiciones que el registro y sin cachear nunca el veredicto; y tiene que quedarle cupo en su ventana, con un techo por operación (`maxCostPerOp`) que convierte un límite de *operaciones* en un límite de *AVAX*. Ese techo no es decorativo: `handleOps` es permissionless, así que quien envía la operación también elige el precio del gas, y sin él el contador no acota ningún coste. La política es **inmutable**: cambiarla es desplegar un segundo paymaster y apuntar `paymasterAndData` allí, porque cualquier *setter* sería un administrador sobre a quién se patrocina y este proyecto no los tiene ([D-14](04-smart-contracts.md)). La única dirección privilegiada es `funder`, fija en construcción, y su único poder es devolverse el depósito y el stake **a sí misma** —no hay parámetro de destino—; no puede emitir, cancelar, dispensar ni cambiar a quién se patrocina, exactamente el rol que [02](02-roles-y-permisos.md) ya describe.
>
> **El punto 8 se resuelve revirtiendo, no devolviendo `validationData = 1`.** Las dos vías de rechazo de ERC-4337 no son equivalentes para un paymaster: devolver `1` produce `FailedOp(opIndex, "AA34 signature error")` y usar `validAfter` produce `FailedOp(opIndex, "AA32 paymaster expired or not due")`, las dos cadenas fijas y sin argumentos; revertir produce `FailedOpWithRevert(opIndex, "AA33 reverted", inner)`, e `inner` son los bytes del error propio con su selector y sus argumentos. El cliente decodifica `SponsorshipExhausted(account, used, limit, windowEndsAt)` y con `windowEndsAt` la pantalla puede decir cuándo vuelve el patrocinio, no solo que se acabó. Las dos vías revierten `handleOps` igual, así que la diferencia es únicamente cuánta información llega. Además existe `sponsorshipOf(account)`, un `eth_call` gratuito que responde lo mismo **antes** de pedirle la huella al médico.
>
> **Límite abierto y declarado: este paymaster NO es compatible con un bundler público, ni siquiera con stake.** Dos reglas de ERC-7562 lo impiden. La primera, `[STO-033]`: leer el storage de otro contrato durante la validación solo se permite a una entidad con stake, y este paymaster lee `PrescriptionRegistry.credentialOf` y luego `EAS.getAttestation`; `addStake` existe para eso y **no se ha llamado**, porque financiar es el punto 7 y es una tarea de operación. La segunda, `[OP-011]`: `TIMESTAMP` está prohibido durante la validación, y la ventana lo usa; **el stake no arregla esa**. Lo que sí está comprobado es la vía que el proyecto usa de verdad: el EntryPoint v0.7 de Fuji expone `handleOps` como `public` y sin control de acceso, así que el relayer propio envía las operaciones directamente y ERC-7562 —que es política de mempool de bundlers, no consenso— no se aplica ahí. No se afirma en ningún sitio una compatibilidad que no se ha medido. Las alternativas que se descartaron están argumentadas en la cabecera del contrato: espejar la acreditación en el propio paymaster sería cachear el veredicto, que [04](04-smart-contracts.md) prohíbe precisamente para que una licencia revocada corte en la llamada siguiente; conformarse con `credentialOf != 0` respondería «alguna vez apuntó a una credencial», no «está acreditado ahora», y dejaría sin cumplir la regla «rechazo si la attestation está revocada» de [01](01-arquitectura.md).
>
> **Una excepción acotada, y es la que hace alcanzable el criterio de salida.** Una cuenta recién creada no tiene credencial registrada, así que una puerta estricta rechazaría justo la operación que la registra —y el médico no tiene AVAX para pagarla de otro modo—. Una cuenta sin registrar se patrocina para **una sola cosa**: `registerCredential(uid)` cuyo `uid` ya sea una credencial viva emitida por `issuerAuthority` **a esa cuenta**. La puerta no se debilita, se mueve: sin una attestation firmada por la autoridad no se pasa, que es lo mismo que protege al resto del sistema.
>
> **El punto 5 esta cerrado, y no es lo que decia el enunciado.** Decia «integrar bundler y paymaster del proveedor elegido». No hay proveedor y no hace falta: `handleOps(PackedUserOperation[], address payable)` del EntryPoint v0.7 es `public` y **sin control de acceso**, comprobado en Fuji, asi que cualquiera puede enviar. Lo que existe es un **relayer propio**, en `services/api` (`src/relayer/`), que toma una `UserOperation` firmada y la envia. Vive ahi y no en un servicio aparte porque es el **unico proceso de este repositorio que puede sostener una clave**: las dos apps son SPAs de navegador —una clave ahi es una clave publicada— y la CLI corre en un portatil. Ademas es el origen con el que la app del medico ya habla (`VITE_API_URL`, CORS ya acotado a las dos apps). El precio se asume y se escribe: el almacen cifrado y el relayer comparten proceso, y el servicio que deliberadamente no podia leer nada ahora guarda una clave. Lo acota que la clave no llegue nunca a la capa HTTP y que esa cuenta no pueda emitir, cancelar ni dispensar —`PasskeyAccount` la rechazaria—: solo paga gas.
>
> **NO ES UN BUNDLER, y decirlo importa.** No tiene mempool, no agrupa —una operacion por transaccion, siempre—, no aplica ninguna regla de ERC-7562, no tiene reputacion ni stake y no expone `eth_sendUserOperation`. Es un enviador de transacciones con politica. Precisamente por eso el paymaster de este proyecto puede existir: sus dos incompatibilidades declaradas, `[OP-011]` y `[STO-033]`, son politica de mempool de bundlers y el EntryPoint no la aplica. Llamarlo bundler seria exactamente el tipo de exageracion que [12](12-preguntas-de-jurado.md) prohibe.
>
> **El `userOpHash` no se reimplemento a ciegas.** El formato v0.7 empaqueta `accountGasLimits` y `gasFees` en una sola palabra de 32 bytes cada uno y codifica `paymasterAndData` como `paymaster (20) || paymasterVerificationGasLimit (16) || paymasterPostOpGasLimit (16) || data`; equivocarse ahi produce ABI perfectamente valido y un codigo `AA` que no nombra ningun campo. La logica vive en `packages/chain/src/user-operation.ts` —ahi y no en el relayer porque la app del medico necesita el MISMO hash: es el `challenge` que firma el autenticador— y su hash esta **contrastado con el contrato desplegado**: `getUserOpHash` llamado como `eth_call` gratuito contra `0x0000…a032` en Fuji el 13/09/2026, con tres operaciones distintas, congeladas como fixtures en `user-operation.test.ts`. `entry-point-hash.live.test.ts` vuelve a preguntarselo al contrato cuando se le pide (`ENTRY_POINT_LIVE_CHECK=1`); no corre por defecto para que `pnpm test` no dependa de la red.
>
> **Los limites de gas salen de medidas, no de intuicion.** `verificationGasLimit` = 450.000, que es lo que `WebAuthn.sol` dice literalmente —dimensionar para el respaldo, no para el precompilado, porque la via cara es la firma *rechazada*—, contrastado con 387.539 medidos aislando `test_validateUserOp_still_works_without_the_precompile`. La primera operacion ademas **despliega la cuenta**, y v0.7 mete ese coste DENTRO de `verificationGasLimit` (v0.6 tenia campo propio), asi que sube a 1.500.000: 450.000 mas los 990.367 medidos de `PasskeyAccountFactory.createAccount`. `callGasLimit` 250.000 para `issue` (medido 137.510) y 150.000 para `registerCredential` (medido 67.566), doblados porque todas esas cifras se tomaron contra `MockEAS` y el EAS real lee mas. `paymasterVerificationGasLimit` 200.000 sobre 78.815 medidos, por lo mismo. `paymasterPostOpGasLimit` **cero**, que es correcto: el paymaster devuelve contexto vacio y v0.7 no llama a `postOp`. `preVerificationGas` se **calcula**, no se fija, sobre el calldata real de `handleOps` —y con un sobre WebAuthn de tamaño realista en `signature`, porque medirlo con la firma vacia y luego firmar 512 bytes es una forma documentada de quedarse corto—.
>
> **Un hallazgo que conviene no perder: la primera operacion reserva ~1,9M de gas, no «del orden de 800k».** Esa cifra de 800k es la que usa la cabecera del paymaster para justificar `maxCostPerOp = 0.02 ether` a 25 nAVAX. Con las medidas reales, a 25 nAVAX la operacion de arranque costaria unos 0,047 AVAX y **el paymaster rechazaria su propia excepcion de bootstrap** con `CostNotSponsored`. Hoy no muerde porque la base fee de Fuji medida el 13/09/2026 es de 10 wei, nueve ordenes de magnitud mas abajo. Es una razon para elegir `maxCostPerOp` con esta aritmetica cuando el paymaster se despliegue, no para ignorarlo. Hay una prueba que lo fija.
>
> **La exposicion del endpoint abierto, hecha con el dinero y no con la intuicion.** El instinto dice que esta acotado: el paymaster solo paga a cuentas acreditadas, con cupo y con techo por operacion. Es cierto **y es sobre el bolsillo equivocado**. Cuando la operacion tiene exito el EntryPoint reembolsa al `beneficiary` desde el deposito del paymaster y el relayer queda mas o menos a cero. Cuando **falla la validacion, `handleOps` revierte**: no hay reembolso, y el relayer ha pagado igual el gas quemado hasta el revert, con su propio AVAX y sin que el atacante pague nada. Asi que no, la cadena de patrocinio **no acota el gasto del relayer**. De ahi lo que se hizo: (1) **simular siempre** antes de firmar nada, lo que convierte casi todo el ataque en una llamada RPC y ademas devuelve al cliente `SponsorshipExhausted(...)` con sus cuatro argumentos en vez de un fallo opaco; (2) **limitar por IP y por remitente**, porque simular no es incluir y una operacion puede simular limpia y revertir un bloque despues; (3) **fijar el `gas` de la transaccion**, para que un revert no queme un bloque entero; (4) **un solo paymaster**. Y lo que deliberadamente no se hizo: **no hay autenticacion**, porque no hay con que —el medico todavia no tiene cuenta y una API key en una SPA es una cadena publica— y porque el control de acceso real ya esta en cadena y es mas fuerte: sin credencial EAS viva no se patrocina nada. Autenticar acotaria quien puede *preguntar*; la credencial acota quien puede *conseguirlo*. Lo que hay que proteger es el saldo, y eso lo protege un limite.

> **Sigue faltando el punto 7 y no se ha tocado.** No se ha desplegado nada, no se ha enviado ninguna transacción y el paymaster no tiene depósito ni stake. `deposit()` es permissionless —añadir valor no puede perjudicar a nadie— y `withdraw(amount)` solo lo puede llamar `funder`.

## Fase 6 — App del médico

Siete pantallas especificadas en [17](17-diseno-y-experiencia.md) y maquetadas en `design/mockups/doctor.html`.

- [x] Vite + React + TS, consumiendo `design/tokens.css` y `design/components.css`
- [ ] **D1** Acceso con passkey — sin la palabra «wallet», sin frase semilla, sin saldo
- [x] **D2** Paciente y contexto clínico, con el aviso obligatorio de que el motor solo evalúa lo declarado
- [x] **D3** Ítems por principio activo y ATC, con alerta moderada de duplicidad en línea
- [x] **D4** Modal de alerta crítica con motivo escrito obligatorio y botón deshabilitado hasta escribirlo
- [x] **D5** Firma EIP-712 mostrada como frases legibles, con el distintivo ADSIB `pending-integration`
- [x] **D6** QR con la advertencia de que quien lo tiene puede leer la receta
- [x] **D7** Listado con los cuatro estados, «Caducada» derivada en el cliente y «Dispensada» sin acciones
- [x] Cifrado en el navegador antes de firmar
- [x] Cálculo de `contentHash` y `patientCommitment` en el cliente
- [x] Generación del QR con `qrcode`
- [x] Supresión de repetición de alertas ya desestimadas

**Criterio de salida:** QR generado y legible por la app de farmacia.

## Fase 7 — App de farmacia

Ocho pantallas, maquetadas en `design/mockups/pharmacy.html`. Es la única PWA del proyecto.

- [x] Vite + React + TS con manifiesto y modo `standalone`
- [x] Service worker que cachea **solo** el armazón, nunca contenido clínico ni respuestas de verificación
- [x] **P1** Acceso con comprobación previa de la credencial
- [x] **P2** Escáner con `@zxing/browser` a pantalla completa
- [x] **P3** Las cinco comprobaciones enumeradas, no un spinner
- [x] **P4** Receta descifrada y botón explícito de confirmar entrega
- [x] **P5** Comprobante con la evidencia en cadena
- [x] **P6** Pantalla de rechazo por dispensación previa, a 48 px, con `dispensedBy` y `dispensedAt`
- [x] **P7** Mensajes diferenciados para caducada, cancelada, no registrada, credencial revocada e integridad rota
- [x] **P8** Entrada manual del código
- [x] Verificación de correspondencia `keccak256(patientId, salt) == patientCommitment`
- [x] Verificación de la firma EIP-712 del prescriptor

**Criterio de salida:** el segundo escaneo muestra el rechazo.

## Fase 8 — Materiales de entrega

- [ ] README con funcionalidades, instalación, ejecución y enfoque de integración técnica
- [x] Dirección del contrato y enlace al explorador — sección *Live deployment* del README de la raíz, con las tres direcciones, los dos uids de esquema, el emisor autorizado y el enlace a Routescan
- [ ] Los tres materiales exigidos en [15](15-track-y-entrega.md)
- [ ] **Confirmar el canal real de entrega contra la fuente oficial del evento ([D-28](15-track-y-entrega.md))**

> Este último punto es lo único capaz de anular la entrega con independencia del estado del código. No depende de programar y sigue sin resolverse.

**Criterio de salida:** entrega enviada por el canal confirmado.

## Fase 9 — Ensayo cronometrado

- [ ] Guion de tres minutos escrito
- [ ] Grabación en vídeo del flujo completo como contingencia
- [ ] Capturas del evento y del `revert` preparadas
- [ ] Segunda cuenta configurada con un proveedor de bundler alternativo
- [ ] Entrada manual del código probada con la cámara desconectada
- [ ] Tres pasadas seguidas por debajo de tres minutos

**Criterio de salida:** tres pasadas limpias, cronometradas, asumiendo el peor tiempo de red medido.

## Fase 10 — Reglas clínicas

Última, y es deliberado. Una alerta bonita sobre una demo que no corre no vale nada.

- [x] `packages/rules` con `evaluate(draft, patientContext)`
- [x] Regla `DECLARED_ALLERGY`, severidad crítica
- [x] Regla `DUPLICATE_THERAPY` por ATC nivel 4, severidad moderada
- [x] Versionado del conjunto de reglas, visible en cada alerta
- [ ] Registro off-chain de alerta emitida y de la decisión del médico
- [x] Tests de los casos de alergia y duplicidad

**Criterio de salida:** una alerta visible durante la demo.

## Lo que no se hace

Cada punto de esta tabla es una tentación real, con su motivo para resistirla.

| Tentación | Por qué no |
|---|---|
| Montar un bundler propio | Consume el buildathon entero |
| Base de interacciones fármaco-fármaco | D-15 sin resolver; el MVP cubre alergias declaradas y duplicidad ATC |
| Catálogo de medicamentos comerciales | D-07 sin resolver; se prescribe por principio activo y ATC |
| Envoltura de la clave por destinatario | D-24, Fase 2; requiere un par de claves separado de la passkey |
| Flujo de farmacia sin conectividad | D-20 sin resolver; ninguna pantalla lo promete |
| Dispensación fraccionada | D-12, Fase 2 |
| Wallet o identidad para el paciente | Fuera del MVP por diseño |
| Integración real de la firma ADSIB | D-17; el campo existe como `pending-integration` |
| Pila completa de observabilidad | Registro estructurado y explorador bastan para un piloto |

## Siguiente paso

La fase en curso manda. Si hay duda sobre qué tocar, se mira el criterio de salida de la fase abierta y se trabaja en eso, no en lo que resulte más entretenido.
