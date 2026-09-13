# 22 — Guion de la demo

Este documento es el **guion operativo de los tres minutos**: qué se levanta, en qué orden, qué pantalla se muestra en cada momento, qué se dice encima y qué queda probado. La demostración recorre una receta completa —emisión, QR, verificación contra la credencial profesional en cadena, dispensación— y termina en el único momento que sostiene el proyecto: **el segundo escaneo del mismo QR, rechazado por el contrato**.

No repite lo que ya está escrito. El despliegue vive en [19](19-despliegue.md), la extensión y los AVAX de prueba en [20](20-wallet-y-red-de-pruebas.md), el acceso de un profesional ajeno al equipo en [21](21-acceso-para-la-demo.md), las quince pantallas en [17](17-diseno-y-experiencia.md) y la estructura del pitch completo en [13](13-pitch-y-sostenibilidad.md). Aquí solo está lo que hace falta para ejecutar la demostración sin sobresaltos.

> **Estado al 13/09/2026.** Escrito contra el código del repositorio, no contra el diseño objetivo. Dos consecuencias que gobiernan todo el documento y conviene leer antes de ensayar:
>
> 1. **Se firma con una extensión de navegador, no con passkey.** El *composition root* del médico construye `createEip1193Signer` (`apps/doctor/src/presentation/composition/doctor-services.ts:36`), y el de la farmacia hace lo mismo. Los módulos WebAuthn existen y tienen pruebas (`apps/doctor/src/infrastructure/passkey/`, `apps/doctor/src/ports/passkey.port.ts`), pero **ninguna aplicación los usa todavía**. La respuesta ensayada para el jurado está en [21](21-acceso-para-la-demo.md#si-un-jurado-pregunta-por-la-extensión) y se usa tal cual.
> 2. **La cadena de la demostración en vivo es Avalanche Fuji (43113).** Decisión tomada el 13/09/2026 y es la que gobierna todo este documento: se emite, se dispensa y se rechaza sobre la red pública, y el explorador enseña **las transacciones reales**, no solo el contrato. Fuji da lo que hace falta: el registro `0xD5F2d5aD03703a9Ee11078d86181421E2E078365` tiene **cuatro cuentas acreditadas** —dos profesionales y dos farmacias, tabla en la sección siguiente— y el acto de rechazo del guion es la **segunda dispensación de la misma receta**, que no necesita ninguna cuenta sin credencial. Anvil pasa a ser **respaldo frío**, no la cadena principal (ver [Plan B](#plan-b)).

> **La trampa de la dirección equivocada.** En Fuji hay **dos** `PrescriptionRegistry`. El bueno es `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`. El otro, `0x71fb93b46D0aEF219a98c96fF3b182bE33425458`, **no tiene ninguna cuenta acreditada**: contra él todo revierte `NotAccreditedPractitioner`, incluido el primer `issue` del minuto 1:00. Y es justamente el que quedó anotado en `contracts/broadcast/Deploy.s.sol/43113/run-latest.json`, que es el fichero al que la mano va sola cuando hace falta «la dirección del despliegue». Ese fichero es un artefacto local —`contracts/broadcast/` está en `.gitignore`— y **no es la fuente de verdad**. La fuente de verdad son el [README](../README.md) y [19](19-despliegue.md). Si la aplicación del médico nace con «Escribir una receta» deshabilitado y las cuentas son las correctas, lo primero que hay que mirar es esta dirección.

---

## Antes de empezar (T-30 min)

Cada fila se comprueba con un comando que existe en el repositorio, o se delega al documento que ya la cubre. Ninguna se da por supuesta.

| # | Precondición | Cómo se comprueba | Si falla |
|---|---|---|---|
| 1 | `.env` creado y con el registro **bueno** | `cp env.example .env`; `PRESCRIPTION_REGISTRY_ADDRESS` y `VITE_PRESCRIPTION_REGISTRY_ADDRESS` tienen que valer `0xD5F2d5aD03703a9Ee11078d86181421E2E078365` | Las dos aplicaciones renderizan `ConfigurationScreen` nombrando la variable exacta que falta (`apps/doctor/src/infrastructure/config/env.ts`, `apps/pharmacy/src/infrastructure/config/env.ts`). No es un fallo de red. Si en su lugar aparece `0x71fb93b4…5458`, es la dirección equivocada: ver la advertencia de arriba |
| 2 | Las cuatro variables de red apuntando a Fuji | `CHAIN_ID=43113`, `VITE_CHAIN_ID=43113`, `RPC_URL` y `VITE_RPC_URL` = `https://api.avax-test.network/ext/bc/C/rpc`, en el `.env` de la raíz. Es el paso 1 del bloque de arranque | `VITE_CHAIN_ID` desalineado con la red de la extensión deja a la aplicación pidiendo cambio de cadena sin quedar nunca conforme ([20](20-wallet-y-red-de-pruebas.md)) |
| 3 | Postgres en marcha | `docker compose ps` | `docker compose up -d postgres`. En Fuji **no hace falta el servicio `anvil`**, aunque arrancarlo no estorba |
| 4 | Esquema de base de datos aplicado | `pnpm db:push` | Sin esquema, `POST /prescriptions` falla en la emisión |
| 5 | API viva y con Postgres al otro lado | `curl http://localhost:3000/health` → `{"status":"ok","checks":{"postgres":"ok"}}` | Un `503` con `"postgres":"unreachable"` significa contenedor caído o `DATABASE_URL` equivocada |
| 6 | Registro desplegado en la cadena de la demo | `cast code 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 --rpc-url fuji` devuelve bytecode, no `0x` | Está desplegado y verificado desde el 13/09/2026; si devuelve `0x`, lo que está mal es el RPC o la dirección, no la cadena ([19](19-despliegue.md)) |
| 7 | **Credencial del profesional viva** | `cast call 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 'credentialOf(address)(bytes32)' <profesional> --rpc-url fuji` → un uid, no ceros | Ya está emitida para las dos cuentas de la tabla siguiente. Para acreditar una nueva: `script/IssueCredential.s.sol` con `CREDENTIAL_ROLE=practitioner` más el `cast send 'registerCredential(bytes32)'` del titular — procedimiento completo en [19](19-despliegue.md#acreditar-cuentas-en-fuji) |
| 8 | **Credencial de la farmacia viva** | La misma llamada `credentialOf` con la dirección de la farmacia | Ya está emitida para las dos farmacias de la tabla siguiente. Para una nueva, `IssueCredential.s.sol` con `CREDENTIAL_ROLE=pharmacy` y el mismo segundo paso |
| 9 | Cuentas importadas en la extensión y red Fuji agregada | Abrir `http://localhost:5173` y comprobar que **«Escribir una receta» está habilitado** | El botón deshabilitado significa cuenta sin acreditar **o registro equivocado**, no fallo de carga ([20](20-wallet-y-red-de-pruebas.md)) |
| 10 | **Saldo de AVAX de prueba en las dos cuentas que firman** | `cast balance <dirección> --rpc-url https://api.avax-test.network/ext/bc/C/rpc` | Deja de ser opcional: en Fuji **cada cuenta paga su propio gas** y sin saldo la firma del minuto 1:00 muere en la estimación. Faucets y cuántas cuentas financiar: [20](20-wallet-y-red-de-pruebas.md#conseguir-avax-de-prueba-en-fuji) |
| 11 | **Passkey registrada en el navegador de la demo** | `VERIFICAR:` **no aplica al código de hoy.** Ninguna aplicación llama al adaptador WebAuthn; el firmante es EIP-1193 en las dos. No hay comando que comprobar porque no hay ruta de passkey activa | Nada que hacer: se ensaya la respuesta de [21](21-acceso-para-la-demo.md#si-un-jurado-pregunta-por-la-extensión) en lugar de prometer la passkey |
| 12 | **Saldo del relayer** | `curl http://localhost:3000/relayer` | `SUPUESTO:` hoy responde **404**, y es el comportamiento correcto: `relayerConfig` devuelve `undefined` mientras falte `PRESCRIPTION_PAYMASTER_ADDRESS`, y el paymaster no está desplegado (`services/api/src/env.ts`, `services/api/src/app.ts`, tabla de brechas del [README](../README.md)). El relayer **no participa en este guion** |
| 13 | La prueba que sostiene el pitch, en verde | `cd contracts && forge test --match-test test_dispense_twice_reverts -vvv` | Si falla, no hay demo que dar ([README](../README.md)) |
| 14 | Suite completa en verde | `cd contracts && forge test` (141/141), y en la raíz `pnpm --filter '@recetas/doctor' test` (634/634), `pnpm --filter '@recetas/api' test` (96/96), `pnpm --filter '@recetas/chain' test` (148 pasan, 3 saltados). Los filtros llevan **el nombre completo del paquete**: `doctor` o `api` a secas no filtran nada | Cifras del 13/09/2026. Los 3 saltados de `@recetas/chain` son la comprobación en vivo contra el EntryPoint, que solo corre con `ENTRY_POINT_LIVE_CHECK=1` ([18 Fase 5](18-tareas-por-fases.md)) |
| 15 | Cámara autorizada en el navegador de la farmacia | Abrir `http://localhost:5174`, acreditarse y llegar a la pantalla de escáner | Contingencia prevista en el diseño: pantalla **P8, entrada manual** ([17](17-diseno-y-experiencia.md)) |
| 16 | **Recetas frescas para cada pasada** | Que el paciente y la medicación del ensayo **no** sean los mismos que los de la demostración real | `dispense` es irreversible y no hay reset en Fuji: cada ensayo consume una receta de verdad. Rellenar D2 y D3 con datos distintos en cada pasada cambia el `contentHash` y evita llegar al escenario con una receta ya dispensada. En Anvil esto no importaba porque el nodo se reiniciaba |
| 17 | Ensayo completo cronometrado | Recorrer el guion de abajo de principio a fin, una vez, con el cronómetro y **con datos de ensayo**, no con los de la demostración | — |

### Las cuentas acreditadas en Fuji

Comprobado por `eth_call` contra `https://api.avax-test.network/ext/bc/C/rpc` el 13/09/2026, sobre el registro `0xD5F2d5aD03703a9Ee11078d86181421E2E078365`. Las cuatro attestations están vivas: emitidas por `0x613F14B919317b515D8804915a8E82f926C86c0C`, con `revocationTime = 0` y caducidad hacia septiembre de 2027.

| Papel | Dirección | `credentialOf` |
|---|---|---|
| Profesional 1 | `0x4429d872fB9253C8516AE525b03cE06FbbbEC143` | `0x08a55355aceed09bd9a62aa32814b32a8be6f6977a4776fb95e48da3da53d330` |
| Profesional 2 | `0x034ca8Fd14cd3E900c15cbaF3B5aEf2702A7E3a5` | `0xfe8139686ff35f212fa846c29cd0a72f4d5a88f3c10c75f95fd4d47b33ccf1c7` |
| Farmacia 1 | `0x7b33436643a681262562785C02Cba36524491042` | `0x79157ba589c42909ce97d1d3b2b9a26c63320591d07960051dfbf78faaf634d3` |
| Farmacia 2 | `0x54d1c17b3B13871F9f99F568FD1D9b1BE67337A7` | `0x129dab76c9ac10cfca257e35edac8a29bfa1684151b609d1769ccfc3ea14d2f5` |

La demostración usa **un profesional y una farmacia**; el par sobrante es repuesto, no parte del guion. `SUPUESTO:` cuál de los dos pares está importado en la extensión del equipo es una decisión del operador y no está anotada en el repositorio; se confirma en el ensayo, no delante del jurado.

> **Dos ventanas, dos cuentas.** El médico y la farmacia son cuentas distintas con credenciales distintas. Conviene tener la aplicación de farmacia en un dispositivo o perfil aparte, con su cuenta ya seleccionada: cambiar de cuenta en la extensión delante del jurado consume la mitad del tiempo disponible.

---

## Levantar el entorno

Los dos modos son los del [README](../README.md), sin variantes. Lo que cambia respecto al README es **a qué cadena apunta el `.env`**: la demostración corre sobre Fuji, así que las cuatro variables de red dejan de mirar a Anvil.

### Paso 1 — apuntar el `.env` de la raíz a Fuji

Las dos SPAs leen el `.env` **de la raíz del workspace** (`envDir`), no uno propio. Son exactamente cuatro líneas, y el fichero ya viene con los valores de Anvil:

```bash
# En el .env de la RAÍZ. Sustituir los valores de Anvil por estos cuatro:
CHAIN_ID=43113
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VITE_CHAIN_ID=43113
VITE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
```

**No hay que editar nada más.** `PRESCRIPTION_REGISTRY_ADDRESS` y `VITE_PRESCRIPTION_REGISTRY_ADDRESS` ya tienen que valer `0xD5F2d5aD03703a9Ee11078d86181421E2E078365` —se comprueba, no se cambia—, `VITE_API_URL` sigue en `http://localhost:3000` porque la API sigue corriendo en el host, y `DATABASE_URL` no tiene nada que ver con la cadena. Las variables `ANVIL_*` y `FUJI_*` se quedan como están: nadie las lee en este camino.

> **Un efecto colateral que conviene conocer.** `contracts/foundry.toml` define `anvil = "${RPC_URL}"` en `[rpc_endpoints]`. Foundry lee el `.env` de `contracts/`, no el de la raíz, así que el cambio de arriba no le afecta por sí solo; pero si se exporta el `.env` de la raíz a la shell (`set -a; . ../.env; set +a`, que es lo que documenta el [README](../README.md) para desplegar), **`--rpc-url anvil` pasa a apuntar a Fuji**. Durante la demostración no se despliega nada, así que no muerde; conviene saberlo antes de teclear un `forge script` a las prisas.

### Paso 2 — levantar el entorno

**Modo normal — el único que se usa en la demo:**

```bash
docker compose up -d postgres   # en Fuji la cadena es la red pública
pnpm db:push                    # crear el esquema
pnpm dev                        # api + médico + farmacia en el host
```

**Modo contenedor completo:**

```bash
docker compose --profile apps up
```

**Por qué el modo normal para la demo, y no el otro.** Vite incrusta las variables `VITE_*` en el JavaScript **durante `docker build`**, no en tiempo de ejecución ([20](20-wallet-y-red-de-pruebas.md)): en modo contenedor, corregir la dirección del registro treinta segundos antes de presentar obliga a reconstruir la imagen. En modo normal basta reiniciar `pnpm dev`. A eso se suma la razón por la que existen los dos modos —el montaje de volúmenes a través de WSL2 pierde eventos de vigilancia en Windows ([README](../README.md))—, que convierte cualquier retoque de última hora en una apuesta.

Recorrido completo desde cero sobre Fuji, si la máquina está limpia:

```bash
# 1. Las cuatro variables de red del .env de la raíz, como en el paso 1.

# 2. Infraestructura. Solo Postgres: la cadena es la red pública.
docker compose up -d postgres
pnpm db:push

# 3. Comprobar la cadena, sin desplegar nada. Todo esto ya existe.
#    Desde contracts/, porque el alias `fuji` sale de [rpc_endpoints] de
#    foundry.toml y se resuelve con FUJI_RPC_URL. Fuera de ahí, la URL entera.
cd contracts
cast code 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 --rpc-url fuji
cast call 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 \
  'credentialOf(address)(bytes32)' <profesional> --rpc-url fuji
cast call 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 \
  'credentialOf(address)(bytes32)' <farmacia> --rpc-url fuji

# 4. Aplicaciones en el host, desde la raíz.
cd ..
pnpm dev
```

**No hay paso de despliegue.** El registro, el `EAS` propio, los dos esquemas y las cuatro credenciales están en Fuji desde el 13/09/2026 y la cadena persiste: nada de esto se repite antes de la demostración. Lo que sí persiste, y en contra, es el estado de las recetas — ver la fila 16 de la lista T-30 y el [Plan B](#plan-b).

---

## Rutas de la demo

| Destino | URL | Cuándo se abre |
|---|---|---|
| Aplicación del médico | `http://localhost:5173` | Minuto 0. Ventana principal |
| Aplicación de la farmacia | `http://localhost:5174` | Minuto 1:20. Segunda ventana o teléfono |
| Salud de la API | `http://localhost:3000/health` | T-30, nunca delante del jurado |
| Explorador (Fuji) | `https://testnet.snowtrace.io/address/0xd5f2d5ad03703a9ee11078d86181421e2e078365` | Cierre, minuto 2:40 |

Las dos aplicaciones **no tienen router**: una sola URL por aplicación y la navegación es una máquina de estados (`apps/doctor/src/presentation/flow/doctor-flow.ts`, `apps/pharmacy/src/presentation/flow/pharmacy-flow.ts`). No hay ninguna dirección que copiar a mitad de la demostración, y esa ausencia es deliberada: el borrador lleva el identificador del paciente y el QR lleva la clave de descifrado, y [17](17-diseno-y-experiencia.md) prohíbe que cualquiera de los dos llegue a una barra de direcciones.

| Método y ruta | Quién la llama | Paso del guion que la dispara |
|---|---|---|
| `GET /health` | El operador | Comprobación T-30, fila 5 |
| `POST /prescriptions` | Aplicación del médico (`http-document.adapter.ts`) | 1:00 — al confirmar la firma, antes de anclar |
| `GET /prescriptions/:pointer` | Aplicación de la farmacia (`http-document.adapter.ts`) | 1:35 — al verificar el QR escaneado |
| `GET /relayer` | El operador | Ninguno. **404 hoy**, ver fila 12 |
| `POST /relayer/user-operations/prepare` | Ninguna aplicación del repositorio | Ninguno. Pertenece a la Fase 5 ([18](18-tareas-por-fases.md)) |
| `POST /relayer/user-operations` | Ninguna aplicación del repositorio | Ninguno. Pertenece a la Fase 5 ([18](18-tareas-por-fases.md)) |

---

## Guion minuto a minuto

Tres minutos, cronómetro en marcha. Los identificadores de pantalla son los de [17](17-diseno-y-experiencia.md).

| Tiempo | Pantalla | Qué se hace | Qué se dice | Qué prueba |
|---|---|---|---|---|
| 0:00-0:15 | **D1 Acceso** (médico) | Conectar. La aplicación comprueba la credencial y habilita «Escribir una receta» | «Antes de escribir nada, el sistema comprueba en la cadena que esta persona tiene matrícula vigente» | La acreditación se lee de EAS en cada carga; sin credencial el botón nace deshabilitado |
| 0:15-0:40 | **D2 Paciente** | Rellenar paciente y contexto clínico | «Lo único que el motor de reglas evalúa es lo que se escribe aquí. No adivina» | El aviso obligatorio de [06](06-validacion-clinica.md) está en pantalla, no en la letra pequeña |
| 0:40-1:00 | **D3 Medicación** y **D4 Alerta crítica** | Añadir el medicamento que dispara la alerta de alergia; escribir la justificación en el modal | «Ninguna alerta bloquea la receta. El motor obliga a dejar por escrito por qué se decidió seguir» | Regla dura de [06](06-validacion-clinica.md): el motor informa con evidencia, no decide |
| 1:00-1:20 | **D5 Revisión y firma** → **D6 Emitiendo** | Confirmar. Aparecen **dos peticiones de la extensión**: la firma tipada EIP-712 y la transacción `issue` | «Firma datos legibles, no un hexadecimal: ve qué prescribe y hasta cuándo» | EIP-712 con frases legibles ([17](17-diseno-y-experiencia.md)); el contenido cifrado va a `POST /prescriptions` y solo el hash y el compromiso salado van a la cadena |
| 1:20-1:35 | **D7 Receta emitida y QR** | Mostrar el QR en pantalla completa | «Esto es lo único que el paciente se lleva. Quien tenga este código puede leer la receta, y la aplicación lo dice» | La advertencia explícita de D6 en [17](17-diseno-y-experiencia.md); ningún identificador de paciente viaja a la cadena ([03](03-modelo-de-datos.md)) |
| 1:35-1:55 | **P2 Escáner** → **P3 Verificando** | Escanear el QR con la aplicación de farmacia | «La farmacia acaba de comprobar contra la cadena que quien firmó tiene matrícula vigente» | Las cinco comprobaciones enumeradas en pantalla, no un *spinner* ([17](17-diseno-y-experiencia.md)); el contenido cifrado se recupera con `GET /prescriptions/:pointer` |
| 1:55-2:15 | **P4 Receta verificada** → **P5 Dispensada** | Pulsar «Confirmar entrega» y firmar | «Confirmar la entrega es un acto humano. La transición es irreversible y no existe reapertura de ningún tipo» | `dispense` escribe el estado definitivo; no hay función administrativa que lo deshaga ([04](04-smart-contracts.md)) |
| 2:15-2:40 | **P6 Rechazada por dispensación previa** | **Escanear el mismo QR por segunda vez.** Silencio de dos segundos sobre la pantalla de rechazo | «Rechazada. Ya fue dispensada hace treinta segundos, por esta farmacia.» Pausa | `AlreadyDispensed` devuelve `dispensedBy` y `dispensedAt`, y la pantalla los nombra: nunca «operación fallida» ([17](17-diseno-y-experiencia.md)). **Es el argumento entero del proyecto** |
| 2:40-3:00 | Explorador | Abrir Snowtrace en el registro verificado y **enseñar la transacción de emisión que se acaba de firmar** | «Esto no lo decimos nosotros: el contrato está desplegado en una red pública, con el código verificado, y lo que acaban de ver está ahí» | Ver la sección siguiente. Corre sobre Fuji, así que las transacciones del guion son públicas y comprobables en el acto |

> **Los tiempos son de Fuji, no de Anvil.** Los dos tramos que escriben en la cadena —1:00-1:20 (`issue`) y 1:55-2:15 (`dispense`)— dependen ahora de que la red pública confirme, no de un nodo local con bloques cada dos segundos. `SUPUESTO:` los márgenes de la tabla se dan por suficientes, pero **no están cronometrados contra Fuji**: eso es exactamente lo que mide el ensayo de la fila 17 de la lista T-30. Si un tramo se pasa, lo que se recorta es el llenado del formulario, nunca la pausa de P6.

> **Si el bloque de demo tiene 80 segundos y no 180.** En la estructura de pitch de [13](13-pitch-y-sostenibilidad.md) la demostración ocupa 80 s dentro de los tres minutos totales. La compresión es: llegar con **D2 y D3 ya rellenados** y arrancar en D5, fundir D6 y D7 en un solo gesto, y no recortar jamás ni la pausa de P6 ni la vuelta al explorador. Lo que se corta es el llenado del formulario; lo que no se corta es el rechazo.

> **La palabra «passkey» en el guion.** El guion de [13](13-pitch-y-sostenibilidad.md) dice «confirma con huella». **Hoy eso no es lo que ocurre**: firma una extensión de navegador y la cuenta paga su propio gas ([21](21-acceso-para-la-demo.md)). Se presenta lo que se ve —«firma con su dispositivo»— sin afirmar passkey ni patrocinio, y si el jurado pregunta se usa la respuesta ensayada de [21](21-acceso-para-la-demo.md#si-un-jurado-pregunta-por-la-extensión). Lo que la demostración prueba no depende de cómo se firma.

---

## Qué mostrar en el explorador

Las direcciones son las del [README](../README.md), desplegadas y verificadas en Avalanche Fuji (chainId 43113) el 13/09/2026.

| Qué se abre | Enlace | Qué se señala |
|---|---|---|
| `PrescriptionRegistry` | <https://testnet.snowtrace.io/address/0xd5f2d5ad03703a9ee11078d86181421e2e078365> | La pestaña de código **verificado**: el contrato que se acaba de describir es público y legible, no una caja negra |
| `EAS` v1.2.0 propio | `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A` | Avalanche no tiene despliegue oficial de EAS; este es propio del proyecto, y decirlo es parte de la honestidad del pitch ([19](19-despliegue.md)) |
| `SchemaRegistry` | `0xD4aFA6F68be2eb0c99D3B421B7f52a6420217efb` | De aquí salen los dos uids de esquema del README, que **no** son los de la demo local |

> **Lo que se gana corriendo sobre Fuji.** Las transacciones de emisión y dispensación que el jurado acaba de ver **sí están en Snowtrace**, y esa es la razón de la decisión: el explorador deja de probar solo que el contrato existe y pasa a probar que lo que acaba de ocurrir ocurrió de verdad, en una red que no controlamos. La frase es *«esto lo pueden comprobar ustedes desde su teléfono, ahora mismo»*.
>
> `SUPUESTO:` la transacción tarda lo que tarde el RPC público en propagarla, y el explorador puede ir unos segundos por detrás. Si a los 2:40 no aparece todavía, se enseña el contrato verificado y se dice que la transacción está en camino; no se espera en silencio delante del jurado. Si la demostración hubiera caído al respaldo frío de Anvil, esta sección vuelve a su versión anterior: el explorador prueba el contrato, no el acto.

---

## Plan B

Un fallo previsto, una respuesta concreta. Todas se ensayan al menos una vez.

| Riesgo | Señal en pantalla | Respuesta |
|---|---|---|
| **La receta del ensayo ya está dispensada** | P6 aparece en el minuto 1:55, antes de tiempo | `dispense` es **irreversible y no hay reset en Fuji**: la receta se consumió en un ensayo. Es la fila 16 de la lista T-30 y se previene, no se arregla: cada pasada lleva paciente y medicación distintos, y por tanto un `contentHash` distinto. Si ya ha ocurrido, se rehace la receta con otros datos y se vuelve a D2 |
| **El RPC público de Fuji va lento o corta** | La transacción tarda, la estimación de gas falla, o el explorador no muestra todavía el hash | Reintentar una vez: es un RPC público compartido y con límite de peticiones, y ni la latencia ni el cupo están bajo nuestro control. Si corta de verdad, se cae al **respaldo frío** de la fila siguiente |
| **Fuji no responde y hay que abandonar la red pública** | Nada confirma; dos reintentos fallidos | **Respaldo frío: Anvil.** `docker compose up -d anvil`, `forge script script/Deploy.s.sol --rpc-url anvil --broadcast`, `forge script script/SetupCredentials.s.sol --rpc-url anvil --broadcast`, copiar la dirección nueva a las **dos** variables del registro, devolver las cuatro variables de red a `31337` y `http://localhost:8545`, reiniciar `pnpm dev` y cambiar de red en la extensión. **Qué se pierde:** el cierre del minuto 2:40 deja de enseñar las transacciones del acto y vuelve a enseñar solo el contrato verificado; y son entre tres y cinco minutos de trabajo, así que **no es una maniobra de último segundo**: se decide antes de entrar a la sala, no durante el guion |
| La extensión no responde o se rechaza la firma | «La operación se cancela sin mensaje del sistema» (código 4001) | Repetir la operación y aceptar en la ventana de la extensión ([20](20-wallet-y-red-de-pruebas.md)) |
| La extensión no está o el perfil no la tiene | «No hay firmante disponible» | Cambiar al perfil de navegador de desarrollo. `VERIFICAR:` **la CLI no es respaldo en Fuji**: `receta demo` está cerrado a la cadena local por `assertLocalChain` (solo 31337 y 1337), por `assertLocalEas` y por `attestWithUid`, que solo existe en `MockEAS` ([18 Fase 4](18-tareas-por-fases.md)). Solo sirve si ya se ha caído al respaldo frío de Anvil |
| La cámara falla o el QR no enfoca | El escáner no captura | **P8, entrada manual**: la pantalla existe para esto y está en el diseño desde el principio ([17](17-diseno-y-experiencia.md)) |
| La cuenta se queda sin AVAX de prueba | La transacción falla al estimar el gas | Cambiar al par de cuentas de repuesto de la tabla de acreditadas, si tiene saldo. Faucets en [20](20-wallet-y-red-de-pruebas.md#conseguir-avax-de-prueba-en-fuji), pero un faucet no se resuelve en mitad de un pitch: el saldo es la fila 10 de la lista T-30 |
| «El relayer se queda sin saldo» | — | `SUPUESTO:` **no puede ocurrir en este guion**: el relayer no está registrado (`GET /relayer` responde 404 sin `PRESCRIPTION_PAYMASTER_ADDRESS`) y ninguna aplicación lo llama. El equivalente real es la fila anterior: la cuenta del profesional paga su propio gas |
| Postgres cae a mitad de la demostración | `GET /health` responde 503; la farmacia no recupera el contenido | Reiniciar el contenedor. La receta ya anclada sigue siendo verificable en cadena: lo que se pierde es la recuperación del contenido cifrado, no la prueba |
| Las lecturas de la cadena devuelven ceros | El registro parece vacío y nadie está acreditado | Es la **dirección equivocada**: `0x71fb93b4…5458` en vez de `0xD5F2d5aD…8365`. Se corrige en las dos variables del registro y se reinicia `pnpm dev` |
| El botón «Escribir una receta» no se deja pulsar | Está visible y deshabilitado | La cuenta activa no está acreditada, o el registro es el equivocado. Son las filas 1 y 7 de la lista T-30, no un fallo de la aplicación |
| Se pregunta por la passkey o por quién paga el gas | — | La respuesta ensayada de [21](21-acceso-para-la-demo.md#si-un-jurado-pregunta-por-la-extensión), tres frases, sin adorno. La respuesta honesta cabe en una: firma una extensión de navegador y **el profesional paga su propio gas**; el patrocinio es Fase 5 y no está desplegado |

---

## Lo que NO se muestra, y por qué

La regla de [12](12-preguntas-de-jurado.md) se aplica también a lo que se enseña: si no está, se dice que no está.

| Qué no se muestra | Por qué | Referencia |
|---|---|---|
| Passkey, smart account ERC-4337 y paymaster | Las piezas existen y pasan sus pruebas, pero **nada está desplegado**: ni fábrica, ni paymaster, ni depósito. Ninguna aplicación las usa | [README](../README.md), [18 Fase 5](18-tareas-por-fases.md), [D-31](21-acceso-para-la-demo.md#d-31) |
| Una emisión sin extensión de navegador | Las dos aplicaciones buscan `globalThis.window.ethereum` y no tienen otra ruta de firma | [21](21-acceso-para-la-demo.md) |
| Un emisor de credenciales independiente | `ISSUER_AUTHORITY` es **hoy la propia cuenta de despliegue**, porque es la única clave que el proyecto tiene. Una autoridad separada (un multisig) es el objetivo del piloto, no lo desplegado | [README](../README.md), `env.example`, [D-03](02-roles-y-permisos.md) |
| El rechazo por credencial (`NotAccreditedPharmacy`) | El rechazo que sostiene el pitch es **otro**: la segunda dispensación de la misma receta (`AlreadyDispensed`, minuto 2:15), y ese sí corre en Fuji. Enseñar además el rechazo por credencial obligaría a revocar una credencial viva en mitad del guion, que es irreversible en la práctica y no cabe en tres minutos | [README](../README.md), [19](19-despliegue.md#acreditar-cuentas-en-fuji) |
| Una receta reutilizable | `dispense` es un estado absorbente y **no hay reset en Fuji**. Cada pasada del guion consume una receta de verdad; los ensayos van con datos distintos, por eso la fila 16 de la lista T-30 | [D-12](04-smart-contracts.md), [04](04-smart-contracts.md) |
| Una decodificación bonita de la credencial en un explorador de EAS | Las declaraciones registradas llevan delante el nombre del struct, así que un explorador genérico de EAS no las autodecodifica. On-chain es indiferente | [19](19-despliegue.md) |
| Envoltura de la clave de descifrado por destinatario | La clave viaja sin envolver dentro del QR. Por eso la pantalla D6 advierte que quien tiene el código puede leer la receta | [D-24](05-almacenamiento-y-cifrado.md) |
| Firma legal ADSIB | Se muestra como `pending-integration` y **nunca** se simula como válida | [D-17](07-seguridad-y-cumplimiento.md) |
| Interacciones entre fármacos | El MVP cubre alergias declaradas y duplicación ATC, nada más | [D-15](06-validacion-clinica.md) |
| Catálogo de medicamentos | Se prescribe por principio activo y código ATC | [D-07](03-modelo-de-datos.md) |
| Dispensación fraccionada y tratamiento crónico | Fuera del alcance del MVP | [D-12](04-smart-contracts.md) |
| La aplicación del médico instalada como PWA | Solo la farmacia es PWA, por decisión escrita: el médico trabaja sentado y un service worker prometería un funcionamiento sin conexión que el MVP no cumple | [17](17-diseno-y-experiencia.md), [21](21-acceso-para-la-demo.md) |

---

## Siguiente paso

Ensayar el guion completo dos veces con cronómetro, y repasar [12](12-preguntas-de-jurado.md) inmediatamente después: las preguntas difíciles llegan sobre la pantalla de rechazo, que es justo donde termina este documento.
