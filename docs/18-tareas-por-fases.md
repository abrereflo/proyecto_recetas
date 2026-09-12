# 18 — Tareas por fases

La lista operativa del buildathon. El orden no es negociable y sale de [16](16-plan-de-ejecucion.md): cada fase existe para desbloquear la siguiente, y su **criterio de salida** es lo único que autoriza a pasar adelante. Una fase a medias no se deja atrás «para volver luego»; volver luego es exactamente lo que no va a ocurrir en setenta y dos horas.

> **Estado al 12/09/2026.** Fase 1 cerrada: `forge test` da 13 de 13, con `test_dispense_twice_reverts` verificando el revert *con sus argumentos* y un fuzz de 256 pasadas sobre el estado absorbente. Fase 0 cerrada salvo lo que depende de la red de Base Sepolia. El andamiaje adelantó además parte de las fases 4 y 10 (`packages/crypto`, `shared` y `rules`, con 21 pruebas en verde): están marcadas porque existen y pasan, no porque se haya alterado el orden de prioridades.
>
> **La acreditación EAS ya no está stubbeada.** `_isAccreditedPractitioner` y `_isAccreditedPharmacy` leen la attestation en EAS en cada llamada y exigen las cinco condiciones de [04](04-smart-contracts.md). `forge test` da 34 de 34: los 13 del ciclo de la receta más 21 de acreditación. Lo que queda de la fase 3 es de red, no de código: registrar los dos esquemas en el `SchemaRegistry` de Base Sepolia y apuntar el despliegue a la instancia canónica de EAS.

> **La regla que gobierna esta lista.** Si algo no aparece aquí, no se construye. Toda idea nueva se anota en [09](09-roadmap.md) como fase posterior y se sigue con la tarea en curso.

## Fase 0 — Entorno

Prerequisito de todo lo demás. **No es progreso hacia la demo**: que Docker levante no acerca ni un minuto el pitch. Se paga una vez y se olvida.

- [ ] Instalar pnpm — `corepack enable` requiere administrador en Windows; mientras tanto sirve `corepack pnpm <cmd>`
- [x] Workspace pnpm en la raíz con `apps/*`, `services/*`, `packages/*`
- [x] `tsconfig.base.json` con `strict: true` y rutas a `@recetas/shared`, `@recetas/crypto`, `@recetas/rules`
- [x] `docker compose up -d` levanta Postgres y Anvil
- [ ] `.env.example` con `DATABASE_URL`, `RPC_URL`, `BASE_SEPOLIA_RPC`
- [ ] Obtener ETH de testnet de Base Sepolia en la cuenta de despliegue
- [ ] Confirmar acceso a un RPC de Base Sepolia con reintentos con backoff

> El RPC público `https://sepolia.base.org` dio timeouts intermitentes durante las verificaciones de [16](16-plan-de-ejecucion.md). Todo script de despliegue debe reintentar; un fallo aislado no es evidencia de que algo esté roto.

**Criterio de salida:** `docker compose up -d` levanta la infraestructura y `pnpm install` termina sin errores.

## Fase 1 — El contrato y la prueba que sostiene el pitch

Nada empieza antes de esto. Ni el diseño, ni la API, ni una línea de React.

- [x] `contracts/` inicializado con Foundry
- [x] `PrescriptionRegistry.sol` con `enum PrescriptionStatus { None, Issued, Dispensed, Cancelled }`
- [x] Struct EIP-712 `Prescription` y dominio `RecetaVerificable` v1, chainId 84532
- [x] `issue(contentHash, patientCommitment, expiresAt)`
- [x] `dispense(contentHash)`
- [x] `cancel(contentHash)` restringido al prescriptor y solo antes de dispensar
- [x] `verify(contentHash)` devolviendo `(status, dispensable, prescriber, expiresAt)`
- [x] Los nueve errores personalizados de [04](04-smart-contracts.md), con `AlreadyDispensed` devolviendo `dispensedBy` y `dispensedAt`
- [x] Eventos `PrescriptionIssued` y `PrescriptionDispensed`
- [x] **`test_dispense_twice_reverts` pasando**
- [x] Test de caducidad con `vm.warp`
- [x] Test de cancelación por quien no es el prescriptor
- [x] Invariante con fuzzing: ninguna secuencia de llamadas saca una receta de `Dispensed`

**Criterio de salida:** `forge test` en verde, con `test_dispense_twice_reverts` incluida. Si esa prueba falla, no hay proyecto.

## Fase 2 — Despliegue en Base Sepolia

- [x] `script/Deploy.s.sol` — **validado contra Anvil**: despliega, y el ciclo `issue` → `dispense` → `dispense` revierte con `AlreadyDispensed` devolviendo `dispensedBy` y `dispensedAt` correctos
- [ ] Desplegar con `--broadcast --verify`
- [ ] Verificar el código fuente en el explorador
- [ ] Anotar la dirección en el README de la raíz

**Criterio de salida:** dirección pública y explorable. Desbloquea todo lo que necesita hablar contra un contrato real.

> El guion de despliegue ya no es un salto al vacío: se ejecutó contra un nodo real (Anvil, chainId 31337) y el ciclo completo de la demo funcionó sobre el contrato desplegado. Lo que falta para Base Sepolia es exclusivamente credenciales y fondos, no código.

## Fase 3 — Credenciales EAS

- [x] `IEAS.sol` con el struct `Attestation` transcrito campo a campo de EAS v1.2.0 — un desajuste de orden o de tipo decodifica `revocationTime` desde otra ranura y deja pasar una credencial revocada
- [x] `registerCredential(bytes32 uid)` — auto-registro sin administrador, con las cinco comprobaciones en el momento de registrar y un error propio por motivo
- [x] Conectar `_isAccreditedPractitioner` y `_isAccreditedPharmacy` contra EAS, releyendo la attestation en cada `issue` y cada `dispense` y sin cachear nunca el veredicto
- [x] Registrar el esquema `PractitionerCredential` (`licenseNumber`, `specialtyCode`, `issuerAuthority`, `validFrom`, `validUntil`) — **en el EAS local**; pendiente en el `SchemaRegistry` de Base Sepolia
- [x] Registrar el esquema `PharmacyCredential` (`pharmacyLicense`, `sanitaryRegistryRef`, `issuerAuthority`, `validFrom`, `validUntil`) — **en el EAS local**; pendiente en el `SchemaRegistry` de Base Sepolia
- [x] Emitir attestation de prueba para un médico — `script/SetupCredentials.s.sol` y `receta setup-credentials`
- [x] Emitir attestation de prueba para una farmacia — las dos farmacias de la demo
- [x] Probar los cinco motivos de rechazo: sin credencial, emisor no autorizado, revocada, caducada, dirigida a otra cuenta — para los dos roles, en el registro y en el uso
- [x] `script/Deploy.s.sol` falla ruidosamente fuera de la cadena 31337 si falta la dirección de EAS, un uid de esquema o el emisor autorizado
- [ ] Apuntar el despliegue a la instancia canónica de EAS en Base Sepolia y registrar allí los dos esquemas

**Criterio de salida:** el contrato rechaza a una cuenta sin credencial. Desbloquea la CLI.

> Cerrada en lo que depende de nosotros. `forge test` da 34 de 34, con `test_dispense_without_credential_reverts` y `test_dispense_with_revoked_credential_reverts` entre ellas. La decisión de diseño está documentada en [04](04-smart-contracts.md): `credentialOf` lo escribe cada cuenta para sí misma, porque [D-14](04-smart-contracts.md#d-14) exige un contrato sin administrador y el permiso de escritura no vale nada — un uid ajeno o firmado por otro emisor no supera las comprobaciones. La CLI acredita las tres cuentas de la demo (`receta setup-credentials`, o el acto 0 de `receta demo`) y `receta demo --revoked` enseña el rechazo: la autoridad revoca la credencial de la farmacia en EAS y la entrega siguiente muere con `NotAccreditedPharmacy`, sin que nadie toque el registro de recetas.

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

> Cerrada. El paquete es `apps/cli` (`@recetas/cli`, binario `receta`) y corre contra Anvil con el `PrescriptionRegistry` ya desplegado: `receta demo` completa los tres actos y el segundo intento de dispensación muestra `AlreadyDispensed` decodificado, con la farmacia y la fecha. Los nueve errores personalizados de [04](04-smart-contracts.md) tienen mensaje propio, y «Caducada» se deriva comparando `expiresAt` con la hora del bloque, nunca del enum.

## Fase 5 — Smart account P-256 y paymaster

La decisión tomada es **cuenta propia con verificación P-256**, no una cuenta de terceros. El precompilado RIP-7212 en `0x…0100` está confirmado y funcionando en Base Sepolia.

- [ ] Smart account ERC-4337 con verificación de firma P-256 contra el precompilado
- [ ] Ruta de respaldo con verificación P-256 en Solidity si el precompilado no responde
- [ ] Registro de passkey WebAuthn con `@simplewebauthn/browser`
- [ ] Traducción de la respuesta WebAuthn al formato que espera el verificador
- [ ] Integrar bundler y paymaster del proveedor elegido
- [ ] Política de patrocinio: solo llamadas a `PrescriptionRegistry`, solo cuentas acreditadas, con límite por cuenta y ventana
- [ ] Financiar el paymaster
- [ ] Mensaje de rechazo por límite de patrocinio agotado

**Criterio de salida:** una emisión completa sin que el médico posea ETH.

## Fase 6 — App del médico

Siete pantallas especificadas en [17](17-diseno-y-experiencia.md) y maquetadas en `design/mockups/doctor.html`.

- [ ] Vite + React + TS, consumiendo `design/tokens.css` y `design/components.css`
- [ ] **D1** Acceso con passkey — sin la palabra «wallet», sin frase semilla, sin saldo
- [ ] **D2** Paciente y contexto clínico, con el aviso obligatorio de que el motor solo evalúa lo declarado
- [ ] **D3** Ítems por principio activo y ATC, con alerta moderada de duplicidad en línea
- [ ] **D4** Modal de alerta crítica con motivo escrito obligatorio y botón deshabilitado hasta escribirlo
- [ ] **D5** Firma EIP-712 mostrada como frases legibles, con el distintivo ADSIB `pending-integration`
- [ ] **D6** QR con la advertencia de que quien lo tiene puede leer la receta
- [ ] **D7** Listado con los cuatro estados, «Caducada» derivada en el cliente y «Dispensada» sin acciones
- [ ] Cifrado en el navegador antes de firmar
- [ ] Cálculo de `contentHash` y `patientCommitment` en el cliente
- [ ] Generación del QR con `qrcode`
- [ ] Supresión de repetición de alertas ya desestimadas

**Criterio de salida:** QR generado y legible por la app de farmacia.

## Fase 7 — App de farmacia

Ocho pantallas, maquetadas en `design/mockups/pharmacy.html`. Es la única PWA del proyecto.

- [ ] Vite + React + TS con manifiesto y modo `standalone`
- [ ] Service worker que cachea **solo** el armazón, nunca contenido clínico ni respuestas de verificación
- [ ] **P1** Acceso con comprobación previa de la credencial
- [ ] **P2** Escáner con `@zxing/browser` a pantalla completa
- [ ] **P3** Las cinco comprobaciones enumeradas, no un spinner
- [ ] **P4** Receta descifrada y botón explícito de confirmar entrega
- [ ] **P5** Comprobante con la evidencia en cadena
- [ ] **P6** Pantalla de rechazo por dispensación previa, a 48 px, con `dispensedBy` y `dispensedAt`
- [ ] **P7** Mensajes diferenciados para caducada, cancelada, no registrada, credencial revocada e integridad rota
- [ ] **P8** Entrada manual del código
- [ ] Verificación de correspondencia `keccak256(patientId, salt) == patientCommitment`
- [ ] Verificación de la firma EIP-712 del prescriptor

**Criterio de salida:** el segundo escaneo muestra el rechazo.

## Fase 8 — Materiales de entrega

- [ ] README con funcionalidades, instalación, ejecución y enfoque de integración técnica
- [ ] Dirección del contrato y enlace al explorador
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
