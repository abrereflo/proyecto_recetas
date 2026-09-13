# 18 — Tareas por fases

La lista operativa del buildathon. El orden no es negociable y sale de [16](16-plan-de-ejecucion.md): cada fase existe para desbloquear la siguiente, y su **criterio de salida** es lo único que autoriza a pasar adelante. Una fase a medias no se deja atrás «para volver luego»; volver luego es exactamente lo que no va a ocurrir en setenta y dos horas.

> **Estado al 13/09/2026. Fases 0, 1, 2 y 3 cerradas.** El proyecto está desplegado en Avalanche Fuji, chainId 43113: `SchemaRegistry`, un `EAS` v1.2.0 propio, los dos esquemas de credencial y el `PrescriptionRegistry`, este último con el código fuente verificado en el explorador. Las direcciones y los uids están anotados en [19](19-despliegue.md) y en el README de la raíz. Fase 1 quedó cerrada antes: `forge test` da 34 de 34, con `test_dispense_twice_reverts` verificando el revert *con sus argumentos* y un fuzz de 256 pasadas sobre el estado absorbente. El andamiaje adelantó además parte de las fases 4 y 10 (`packages/crypto`, `shared` y `rules`, con 21 pruebas en verde): están marcadas porque existen y pasan, no porque se haya alterado el orden de prioridades.
>
> **La acreditación EAS ya no está stubbeada.** `_isAccreditedPractitioner` y `_isAccreditedPharmacy` leen la attestation en EAS en cada llamada y exigen las cinco condiciones de [04](04-smart-contracts.md). `forge test` da 34 de 34: los 13 del ciclo de la receta más 21 de acreditación. Lo que quedaba de la fase 3 era de red y ya está hecho: **no existe un despliegue oficial de EAS en Avalanche**, así que el proyecto desplegó el suyo en Fuji con `script/DeployEAS.s.sol` y registró los dos esquemas con `script/RegisterSchemas.s.sol`.
>
> **Bloqueante abierto, y es el que manda ahora: en Fuji no hay ninguna cuenta acreditada.** El registro está vivo y verificado, pero `credentialOf` está vacío para todas las cuentas, así que cualquier `issue` contra Fuji revierte y la demo no corre ahí. No es cuestión de ejecutar un script que ya exista: no hay camino de herramientas. `script/SetupCredentials.s.sol` revierte con `NotTheLocalChain` fuera de la chainId 31337 y firma con una constante de compilación (la cuenta #9 de Anvil), y `receta setup-credentials` está cerrado por tres sitios —`assertLocalChain` solo acepta 31337 y 1337, `assertLocalEas` exige el mock, e `issueAndRegister` llama a `attestWithUid`, que solo existe en `MockEAS`—. Acreditar en Fuji exige llamadas directas a `EAS.attest()` firmadas por `ISSUER_AUTHORITY` y un `registerCredential(uid)` por titular, con su propia clave. Detalle completo en [19](19-despliegue.md). La demo local sobre Anvil no está afectada.

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

> **Desplegado en Fuji el 13/09/2026, en la secuencia que la nota de arriba exige.** `PrescriptionRegistry` vive en `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`, construido contra el `EAS` propio `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A` y los dos uids reales que imprimió `RegisterSchemas.s.sol`. Se comprobó uno a uno que `registry.eas()`, `registry.issuerAuthority()`, `registry.practitionerSchema()` y `registry.pharmacySchema()` devuelven exactamente lo anotado. `ISSUER_AUTHORITY` es `0x613F14B919317b515D8804915a8E82f926C86c0C`, que es **la propia cuenta de despliegue**: el proyecto controla una sola clave, así que desplegador y autoridad emisora colapsan en una, y la separación que describe `env.example` queda como deuda declarada del MVP, no como algo hecho. Como ese valor es `immutable` y `_readCredential` rechaza cualquier attestation de otro `attester`, equivocarlo obliga a redesplegar el registro entero. Coste total del procedimiento: menos de 0,001 AVAX. Detalle y direcciones completas en [19](19-despliegue.md).

> **La verificación del código fuente está comprobada.** Fuji es de tier pago en Etherscan V2, así que la key gratuita de Etherscan no sirve y `[etherscan]` apunta a Routescan (`https://api.routescan.io/v2/network/testnet/evm/43113/etherscan`, con la key literal `verifyContract`). Esa configuración se ejercitó en el despliegue real y funcionó tal cual, sin corregir nada: el envío queda unos quince segundos en `Pending in queue` y después devuelve `Pass - Verified`. Forge envía además el código a Sourcify en paralelo por su cuenta. Los dos exploradores sirven el mismo código verificado —Snowtrace funciona hoy sobre Routescan—, así que `https://testnet.snowtrace.io` sigue siendo una referencia válida y no hay nada que cambiar en la configuración ni en el código.

> **Desplegado no es lo mismo que utilizable: en Fuji no hay ninguna cuenta acreditada.** El criterio de salida de esta fase —dirección pública y explorable— está cumplido, pero el contrato vivo no puede emitir ni dispensar todavía porque nadie tiene credencial en él, y no existe herramienta que las emita fuera de Anvil. Es el bloqueante que gobierna la demo; está descrito en el encabezado de este documento y en detalle en [19](19-despliegue.md).

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

> Cerrada en lo que depende de nosotros. `forge test` da 34 de 34, con `test_dispense_without_credential_reverts` y `test_dispense_with_revoked_credential_reverts` entre ellas. La decisión de diseño está documentada en [04](04-smart-contracts.md): `credentialOf` lo escribe cada cuenta para sí misma, porque [D-14](04-smart-contracts.md#d-14) exige un contrato sin administrador y el permiso de escritura no vale nada — un uid ajeno o firmado por otro emisor no supera las comprobaciones. La CLI acredita las tres cuentas de la demo (`receta setup-credentials`, o el acto 0 de `receta demo`) y `receta demo --revoked` enseña el rechazo: la autoridad revoca la credencial de la farmacia en EAS y la entrega siguiente muere con `NotAccreditedPharmacy`, sin que nadie toque el registro de recetas.
>
> **Eso vale en Anvil y solo en Anvil.** La acreditación automática está atada a la cadena local por diseño: `script/SetupCredentials.s.sol` revierte con `NotTheLocalChain` fuera de la chainId 31337 y firma con una constante de compilación (`LocalDemo.ISSUER_AUTHORITY_KEY`, la cuenta #9 de Anvil), y `receta setup-credentials` está cerrado por `assertLocalChain` (solo 31337 y 1337), por `assertLocalEas` (exige que el EAS sea el mock) y por `issueAndRegister`, que llama a `attestWithUid`, una función de `MockEAS` que un EAS v1.2.0 real no tiene. **En Fuji el registro desplegado tiene cero cuentas acreditadas y no hay herramienta que lo cambie**, así que la demo contra la red pública no corre hasta construir ese camino: `EAS.attest()` firmado por `ISSUER_AUTHORITY`, y un `registerCredential(uid)` por cada titular con su propia clave.

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

> **Cerrada contra Anvil, bloqueada contra Fuji.** El criterio de salida se cumple sobre el despliegue local; sobre el despliegue público del 13/09/2026 no, y el motivo no es la CLI sino que en Fuji **no hay ninguna cuenta acreditada** y ninguna herramienta actual puede acreditarla (ver la nota de la Fase 3 y [19](19-despliegue.md)). Sin credencial, el acto 1 de `receta demo` muere en el `issue`.

> Cerrada. El paquete es `apps/cli` (`@recetas/cli`, binario `receta`) y corre contra Anvil con el `PrescriptionRegistry` ya desplegado: `receta demo` completa los tres actos y el segundo intento de dispensación muestra `AlreadyDispensed` decodificado, con la farmacia y la fecha. Los nueve errores personalizados de [04](04-smart-contracts.md) tienen mensaje propio, y «Caducada» se deriva comparando `expiresAt` con la hora del bloque, nunca del enum.

## Fase 5 — Smart account P-256 y paymaster

La decisión tomada es **cuenta propia con verificación P-256**, no una cuenta de terceros. El precompilado RIP-7212 en `0x…0100` está confirmado y funcionando en Avalanche Fuji, comprobado con una firma P-256 propia.

- [ ] Smart account ERC-4337 con verificación de firma P-256 contra el precompilado
- [ ] Ruta de respaldo con verificación P-256 en Solidity si el precompilado no responde
- [ ] Registro de passkey WebAuthn con `@simplewebauthn/browser`
- [ ] Traducción de la respuesta WebAuthn al formato que espera el verificador
- [ ] Integrar bundler y paymaster del proveedor elegido
- [ ] Política de patrocinio: solo llamadas a `PrescriptionRegistry`, solo cuentas acreditadas, con límite por cuenta y ventana
- [ ] Financiar el paymaster
- [ ] Mensaje de rechazo por límite de patrocinio agotado

**Criterio de salida:** una emisión completa sin que el médico posea AVAX.

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
