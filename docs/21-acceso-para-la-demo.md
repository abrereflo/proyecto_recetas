# 21 — Acceso para la demo

Este documento decide **cómo un médico y un farmacéutico ajenos al equipo entran a las aplicaciones en la demo y en el primer piloto**, con el código que existe hoy. La respuesta corta es que siguen usando una extensión de navegador, y que el trabajo se concentra en quitar los tres prerrequisitos que sí se pueden quitar sin abrir la abstracción de cuenta. No es el modelo objetivo que describen [00](00-vision-y-alcance.md), [01](01-arquitectura.md), [08](08-stack-y-entorno.md) y [13](13-pitch-y-sostenibilidad.md) —passkey, smart account ERC-4337 y paymaster—; es el andamiaje que lo deja alcanzable sin bloquear la demo, y uno de sus cuatro cortes existe solo para que ese modelo pueda llegar después.

Lo que este documento **no** decide: no elige proveedor de bundler ni de paymaster, no resuelve [D-02](01-arquitectura.md), no cambia el contrato, no toca el modelo de datos ni el cifrado, y no adelanta ninguna tarea de la Fase 5 de [18](18-tareas-por-fases.md) salvo la deuda estructural del Corte 2.

Su predecesor directo es [20](20-wallet-y-red-de-pruebas.md), que es el procedimiento operativo vigente. Este documento **lo sustituye en un punto y solo en uno**: el Corte 1 hace que la red se agregue sola. Ese corte **ya entró** (`f11df43`), así que la sección «Agregar la red a mano» de [20](20-wallet-y-red-de-pruebas.md) pasó a describir un camino de respaldo, no un trámite obligatorio, y su antigua afirmación de que `wallet_addEthereumChain` no se usaba en el repositorio quedó corregida allí. Todo lo demás de [20](20-wallet-y-red-de-pruebas.md) sigue vigente sin cambios.

> **Estado al 12/09/2026.** Documento de diseño escrito contra el código y verificado en él. **Los Cortes 1 y 2 ya están implementados** en la rama `feat/acceso-demo-cortes-1-2` (commit `f11df43`): el alta automática de la cadena vive en `addChainThenRetrySwitch` de los dos adaptadores de firma, y la ruta de escritura pasa por `apps/doctor/src/ports/signer.port.ts`, con `no-signer-import.test.ts` custodiando el límite. **Los Cortes 3 y 4 siguen siendo propuestas**: no existe operación de alta en Fuji, y la app del médico no tiene manifiesto ni service worker. La tabla de verificación del final dice, afirmación por afirmación, qué se comprobó y cómo.

## Por qué no el modelo objetivo todavía

El modelo objetivo se descarta para esta demo por cuatro obstáculos concretos, no por preferencia. Ninguno se resuelve escribiendo código de aplicación.

| # | Obstáculo | Evidencia |
|---|---|---|
| 1 | La disponibilidad de bundler y paymaster ERC-4337 en Fuji **no está comprobada**. El documento de arquitectura lo marca como pendiente en su propio bloque de coste honesto | `docs/01-arquitectura.md:17` — `VERIFICAR:` disponibilidad y condiciones de un proveedor de bundler y paymaster ERC-4337 en Fuji |
| 2 | No hay puntos de acceso configurados. Las dos variables existen vacías, con el motivo escrito al lado | `env.example:84-89` — `BUNDLER_RPC_URL=` y `PAYMASTER_RPC_URL=` bajo un `TODO` |
| 3 | `permissionless.js` **no está instalado**, y su ausencia es deliberada, no un olvido | `README.md:205`; `env.example:85-86` |
| 4 | [D-02](01-arquitectura.md) —quién financia el paymaster— sigue abierta, y con ella la política de patrocinio | `docs/01-arquitectura.md:150-154`; `docs/18-tareas-por-fases.md:110`, tarea «Financiar el paymaster» sin marcar |

La Fase 5 de [18](18-tareas-por-fases.md) agrupa ese trabajo en ocho tareas, todas abiertas, con criterio de salida «una emisión completa sin que el médico posea AVAX» (`docs/18-tareas-por-fases.md:100-113`). Ese criterio no se alcanza a tiempo para la demo, y forzarlo pondría en riesgo lo único que la demo tiene que demostrar: que el segundo intento de dispensar revierte.

> **La contradicción con la documentación es real y está declarada.** `docs/08-stack-y-entorno.md:16` afirma «Ningún médico instalará una extensión» como motivo de la elección de WebAuthn frente a una extensión. El código de hoy exige exactamente esa extensión, y sus dos adaptadores lo dicen en un `TODO` que apunta a D-04 y a la Fase 5 (`apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:34-36`; `apps/pharmacy/src/infrastructure/signer/eip1193-signer.adapter.ts:17-19`). Este documento no resuelve la contradicción: la acota, la fecha y le pone una condición de salida en [D-31](#d-31).

## Los cuatro prerrequisitos, y cuál mata cada corte

Los prerrequisitos son los de [20](20-wallet-y-red-de-pruebas.md), en el mismo orden.

| # | Prerrequisito | Qué lo elimina | Estado tras los cuatro cortes |
|---|---|---|---|
| 1 | Extensión EIP-1193 instalada | Nada de este documento | **Sigue en pie** |
| 2 | Red agregada a mano en la extensión | Corte 1 | Eliminado |
| 3 | Cuenta con AVAX de prueba | Corte 3 | Eliminado para el usuario; lo asume el operador |
| 4 | Cuenta con attestation EAS de credencial profesional | Corte 3 | Eliminado para el usuario; lo asume el operador |

El Corte 2 no elimina ningún prerrequisito y el Corte 4 tampoco: el primero paga deuda estructural de la Fase 5, el segundo es una paridad de formato opcional. De los cuatro prerrequisitos, los cortes quitan dos de la vista del usuario y trasladan otros dos al operador del piloto. El primero no se mueve.

## Cortes de trabajo

En orden de dependencia. El Corte 1 no depende de nada; el Corte 2 es independiente pero conviene después, porque toca los mismos dos archivos por el otro extremo; el Corte 3 no toca código de aplicación; el Corte 4 es opcional.

### Corte 1 — La red se agrega sola

**Qué cambia.** `ensureChain` deja de rendirse cuando el proveedor devuelve el código **4902**. En lugar de lanzar el mensaje de cadena no configurada, pide `wallet_addEthereumChain` con los parámetros de la cadena y reintenta el cambio. El mensaje actual queda como último recurso: si el alta también falla, o si la persona la rechaza, la aplicación dice lo mismo que hoy.

**Qué archivos.**

| Archivo | Cambio |
|---|---|
| `apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:118-139` | Rama 4902 de `ensureChain` (hoy `:131-136`) |
| `apps/pharmacy/src/infrastructure/signer/eip1193-signer.adapter.ts:97-118` | Rama 4902 de `ensureChain` (hoy `:110-116`) |
| `packages/chain/src/viem-chain.ts:40-47` | Origen de los parámetros de la cadena, ampliado con el explorador |
| `apps/doctor/src/copy-guard.test.ts:66` | Alta de `wallet_addEthereumChain` en `PROTOCOL_LITERALS` |

**De dónde salen los parámetros.** `wallet_addEthereumChain` exige `chainId`, `chainName`, `nativeCurrency` y `rpcUrls`, y admite `blockExplorerUrls`. Los cuatro primeros ya los construye `buildChain` (`packages/chain/src/viem-chain.ts:40-47`) a partir de la configuración: `id`, `name` —`Anvil` para 31337, `Cadena <id>` en cualquier otro caso—, `nativeCurrency` resuelto por `nativeCurrencyOf` (`:32-38`, `AVAX` para 43113 y `ETH` para el resto) y `rpcUrls.default.http`. **Los parámetros se derivan de ahí y no se reescriben en el adaptador**: una constante paralela sería una segunda definición de la cadena, y el primer cambio de RPC dejaría la aplicación pidiendo una red y hablando con otra.

> **El explorador es el único campo que falta y hay que agregarlo donde corresponde.** `buildChain` no define `blockExplorers` (`packages/chain/src/viem-chain.ts:40-47`), que es por lo que [20](20-wallet-y-red-de-pruebas.md) dice que la extensión no tiene explorador que ofrecer. `blockExplorerUrls` es opcional en EIP-3085, así que hay dos salidas legítimas: omitirlo, o agregar `blockExplorers` a `buildChain` para 43113 con `https://testnet.snowtrace.io` y derivarlo como todo lo demás. La segunda es preferible —el explorador es útil en la demo y el valor ya está fijado en `docs/01-arquitectura.md:14`—, pero **se agrega en `buildChain`, no en el adaptador**.

**Por qué es seguro.** El cambio vive entero dentro de una rama de error que hoy termina en excepción: cuando la cadena ya está configurada, `ensureChain` retorna antes de llegar a `wallet_switchEthereumChain` (doctor `:121`, farmacia `:100`) y no ejecuta nada nuevo. No altera el camino de firma, ni el de simulación, ni el de lectura. La única superficie de riesgo es la que [20](20-wallet-y-red-de-pruebas.md) describe como deliberada: agregar una cadena reescribe la configuración del navegador de la persona. Sigue siendo la extensión quien pregunta y quien decide; la aplicación solo propone una red que ya está fijada en su propia configuración y validada con zod.

> **Regla de copia D1: `wallet_addEthereumChain` es un nombre de método, no texto de interfaz.** La regla de `docs/17-diseno-y-experiencia.md:82` prohíbe «wallet», «frase semilla» y «saldo» en lo que el usuario lee, y está codificada. El guardián del médico recorre **todo** `src` y comprueba literal por literal (`apps/doctor/src/copy-guard.test.ts:33-45`), con una lista de excepciones que hoy contiene un solo elemento: `PROTOCOL_LITERALS = new Set(['wallet_switchEthereumChain'])` (`:66`). Agregar el literal nuevo sin agregarlo a esa lista **hace fallar la prueba**. El guardián de la farmacia solo recorre `src/presentation` (`apps/pharmacy/src/presentation/copy-guard.test.ts:23-35`), así que su adaptador no queda alcanzado; el del médico sí.

> **Hallazgo previo al corte: los dos `errorCode` no son equivalentes.** El del médico recorre la cadena de `cause` de forma recursiva (`apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:60-66`); el de la farmacia lee solo el nivel superior y devuelve `undefined` si el código viene envuelto (`apps/pharmacy/src/infrastructure/signer/eip1193-signer.adapter.ts:43-47`). Un proveedor que envuelva el 4902 en un `cause` hace que la farmacia no entre nunca en la rama, ni hoy ni después del corte. Alinear los dos es parte del Corte 1, no un extra.

**Cómo se verifica.** Prueba unitaria sobre un proveedor falso, en cada aplicación: (a) `wallet_switchEthereumChain` rechaza con 4902 → se pide `wallet_addEthereumChain` con `chainId` en hexadecimal y los parámetros derivados de `buildChain`, y luego se reintenta el cambio; (b) el alta rechaza con 4001 → `SignerRejectedError`, como hoy; (c) el alta falla por cualquier otro motivo → el mensaje de cadena no configurada, idéntico al actual; (d) el código 4902 llega envuelto en un `cause` → se detecta en las dos aplicaciones. Más `pnpm test` completo, porque el guardián de copia es una prueba y va a opinar.

### Corte 2 — La ruta de transacción pasa por el puerto

**Qué cambia.** Hoy el adaptador de cadena **esquiva el puerto de firma**. `viem-chain.adapter.ts` importa `injectedProvider` directamente del adaptador de firma y lo usa como valor por defecto para obtener el proveedor (médico `:34-39` y `:80`; farmacia `:32` y `:57`), y con él construye el `walletClient` que envía la transacción (médico `:184-193`, farmacia `:134-143`). El resultado es que la escritura —la única operación que realmente firma— **no atraviesa `SignerPort`**. Después de este corte, el proveedor —o una fábrica de cliente— llega al adaptador de cadena a través del puerto, y `injectedProvider` deja de importarse fuera del adaptador que lo define.

**Qué archivos.**

| Archivo | Cambio |
|---|---|
| `apps/doctor/src/ports/signer.port.ts:35-57` | El puerto expone lo que la escritura necesita |
| `apps/pharmacy/src/ports/signer.port.ts:13-27` | Lo mismo, con la asimetría que ya tiene |
| `apps/doctor/src/infrastructure/chain/viem-chain.adapter.ts:34-39,80,184-193` | Deja de importar y de resolver el proveedor |
| `apps/pharmacy/src/infrastructure/chain/viem-chain.adapter.ts:32,57,134-143` | Ídem |
| `apps/doctor/src/presentation/composition/doctor-services.ts:36-38` | Pasa el firmante al adaptador de cadena |
| `apps/pharmacy/src/presentation/composition/pharmacy-services.ts:40-43` | Ídem |

**Por qué el puerto está definido dos veces.** `SignerPort` no es un tipo compartido: el del médico incluye `signPrescription` (`apps/doctor/src/ports/signer.port.ts:35-57`) y el de la farmacia no lo necesita, porque la farmacia no firma recetas, solo dispensa (`apps/pharmacy/src/ports/signer.port.ts:13-27`). La divergencia es intencional y este corte **no la unifica**: unificar el puerto es una decisión aparte, con su propio coste, y mezclarla aquí convierte un cambio invisible en un cambio de arquitectura compartida.

**Por qué es seguro.** No cambia ninguna llamada a la cadena, ningún argumento, ningún mensaje, ninguna pantalla. Es un movimiento de dependencia: el mismo proveedor llega por otra puerta. Los dos composition roots son de una línea por adaptador (`doctor-services.ts:36-38`, `pharmacy-services.ts:40-43`), y ambos archivos ya declaran en su cabecera que existen precisamente para que el cambio a ERC-4337 de D-04 sea una modificación de ese archivo y del adaptador de firma, no de las siete u ocho pantallas.

> **Este es el único corte que paga deuda de la Fase 5 y no deuda de la demo.** Los tres restantes hacen la demo posible; este hace posible la migración. Mientras la escritura resuelva el proveedor por su cuenta, la afirmación de que el cambio a passkey es «un cambio de un archivo» —escrita en los dos puertos, en los dos adaptadores de firma y en los dos composition roots— es falsa: un firmante de passkey enchufado en `SignerPort` seguiría sin ser usado por la transacción. Cuesta poco, no se ve, y sin él la Fase 5 empieza con un refactor.

**Cómo se verifica.** Una prueba de arquitectura por aplicación: ningún archivo bajo `src/infrastructure/chain` importa de `src/infrastructure/signer`. Un doble de `SignerPort` en las pruebas existentes del adaptador de cadena, comprobando que la escritura usa el proveedor que entrega el puerto y ninguno más. Y el recorrido de [20](20-wallet-y-red-de-pruebas.md) sobre Anvil de punta a punta: emitir, escanear, dispensar, reescanear y ver el rechazo. Si algo de eso cambia de comportamiento, el corte está mal hecho.

### Corte 3 — Alta en un paso

**Qué cambia.** Los prerrequisitos 3 y 4 dejan de ser dos trámites separados y pasan a ser una sola operación de alta: financiar la cuenta con AVAX de prueba y emitir la attestation EAS de credencial profesional, en el mismo momento y contra la misma dirección. La persona entrega su dirección pública; recibe una cuenta con fondos y acreditada.

**Punto de partida y su límite.** `contracts/script/SetupCredentials.s.sol` ya hace la mitad acreditadora: la autoridad emite la attestation y el titular registra el puntero, dos claves distintas firmando dos transacciones (`:109-129`). Sirve como forma de la operación, y solo como forma, por dos motivos escritos en el propio archivo:

1. **Es exclusivo de Anvil.** Revierte con `NotTheLocalChain` si `block.chainid` no es el de la demo local (`:31-33`), y usa el `MockEAS` de `contracts/test/mocks/` (`:37`, `:120`), no el EAS desplegado por el proyecto.
2. **Su docstring desaconseja explícitamente extenderlo.** «There is no script for that and there should not be one: handing the authority's key to a script is how a credential authority stops being one» (`:18-22`). El corte respeta esa regla: la operación de alta se ejecuta con la clave de la autoridad en manos de la persona que la custodia, no embebida en un guion versionado.

> **Hueco ya localizado: la attestation se emite sin ningún campo del esquema.** `MockEAS.attest` no tiene parámetro de datos (`contracts/test/mocks/MockEAS.sol:41-51`): recibe esquema, destinatario, emisor, caducidad y revocación, y nada más. El `Attestation` real sí lleva `bytes data` (`contracts/src/IEAS.sol:23`), y los dos esquemas declaran campos que nadie está escribiendo: `licenseNumber` y `specialtyCode` en el de profesionales, `pharmacyLicense` y `sanitaryRegistryRef` en el de farmacias (`contracts/script/RegisterSchemas.s.sol:39,43`; los mismos literales en `contracts/script/LocalDemo.sol:20,24`). Sobre Anvil no molesta, porque el registro solo comprueba validez y no lee el contenido. Sobre EAS real, una credencial sin número de matrícula es una credencial que no dice de quién es. Este corte tiene que escribir esos campos o declarar por escrito que no los escribe; no puede dejarlo implícito.

**Por qué operado y no autoservicio.** La operación la ejecuta una persona del equipo, a mano, por cuenta de cada participante. No hay formulario, no hay cola, no hay autoservicio. Es aceptable para una demo por tres razones: el número de cuentas es de un dígito, las dos cosas que se entregan son irreversibles hacia arriba —el AVAX de prueba no vale nada y la attestation se revoca—, y el acto de acreditar **es** el control de acceso del sistema, así que automatizarlo sin una autoridad real detrás sería fingir el trámite que [02](02-roles-y-permisos.md) atribuye al Colegio Médico. No es aceptable en un piloto con volumen: allí hace falta un emisor institucional con su propio procedimiento y su propia custodia de clave, que es [D-03](02-roles-y-permisos.md) y no se decide aquí.

**Cómo se verifica.** Una cuenta recién creada, entregada por alguien ajeno al equipo, recorre el alta y termina con: saldo distinto de cero en `https://testnet.snowtrace.io`, `credentialOf` devolviendo un uid no nulo, y el botón «Escribir una receta» habilitado en la aplicación —que es el mismo control que `apps/doctor/src/presentation/screens/AccessScreen.tsx:203` deshabilita mientras el estado no sea `accredited`—. Los tres, o el alta no está hecha.

### Corte 4 — Paridad PWA del médico (opcional)

**Estado actual.** La aplicación de farmacia es PWA, hecha a mano: `apps/pharmacy/public/manifest.webmanifest`, `apps/pharmacy/public/sw.js`, `apps/pharmacy/public/icon.svg`, el enlace en `apps/pharmacy/index.html:8` y el registro en `apps/pharmacy/src/registerServiceWorker.ts:11-27`, que se salta el registro en desarrollo para que un worker viejo no tape una actualización de Vite. No hay `vite-plugin-pwa` ni Workbox en ninguna parte. La aplicación del médico no es PWA: `apps/doctor/public` está vacío y `apps/doctor/index.html` no enlaza ningún manifiesto.

**Qué haría falta.** Un manifiesto, un icono, un service worker y su registro, replicando el patrón de la farmacia. Es trabajo acotado y sin riesgo técnico. El riesgo es de promesa, y ya está razonado: `docs/17-diseno-y-experiencia.md:16-23` decide que solo una de las dos sea PWA, porque la del médico se usa sentado en una estación de trabajo, instalarla no aporta nada, y añadir un service worker añade «una promesa implícita de funcionamiento sin conexión que el MVP no puede cumplir».

> **Recomendación: diferir.** El corte solo se justifica si la demo se ejecuta desde un teléfono. Si se ejecuta desde un portátil —que es el escenario para el que está diseñada la aplicación—, convertirla en PWA cambia la documentación de diseño para no ganar nada y contradice una decisión ya tomada con motivo escrito. Si se hace, se hace con la misma regla dura del worker de la farmacia: se cachea el armazón, **nunca** contenido clínico ni respuestas de verificación (`docs/17-diseno-y-experiencia.md:25`).

## Lo que sigue en pie

La extensión. Este camino no la quita, y decirlo con claridad es parte del camino.

| Qué queda | Por qué |
|---|---|
| Instalar una extensión EIP-1193 | Las dos aplicaciones buscan `globalThis.window.ethereum` y no tienen otra ruta de firma (`apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:56-58`; farmacia `:39-41`) |
| Dos peticiones de firma por receta emitida | La firma tipada EIP-712 y la transacción `issue` son dos operaciones distintas ([20](20-wallet-y-red-de-pruebas.md)) |
| La cuenta del profesional paga su propio gas | El `walletClient` se construye sobre la cuenta del usuario (`apps/doctor/src/infrastructure/chain/viem-chain.adapter.ts:184-193`; farmacia `:134-143`). No hay paymaster |
| Un perfil de navegador separado para desarrollo | Regla dura de [20](20-wallet-y-red-de-pruebas.md), intacta |

### Si un jurado pregunta por la extensión

La pregunta es previsible y la trampa es contestar que la passkey «ya está» o que «es un detalle de configuración». Siguiendo la regla de oro de [12](12-preguntas-de-jurado.md) —si no lo sabemos, lo decimos—, la respuesta para usar tal cual:

> Todavía no. El diseño es passkey y paymaster, y esa parte está especificada, pero depende de tener bundler y paymaster comprobados en Fuji y eso no lo hemos verificado: está anotado como pendiente en nuestro propio documento de arquitectura. Para no prometer lo que no medimos, hoy firmamos con una extensión estándar y lo decimos abiertamente. Lo que la demo prueba —que la segunda dispensación revierte— no depende de cómo se firma, y la pieza que sí depende ya está aislada detrás de un puerto para que el cambio sea acotado.

Tres frases, sin adorno. Si el jurado repregunta por el plazo o por la condición de corte, la respuesta es [D-31](#d-31), y la honesta es que la condición está escrita y la fecha no.

<a id="d-31"></a>

> **Decisión pendiente — D-31: cuándo se corta el andamiaje de extensión hacia passkey**
>
> **Contexto.** El acceso de la demo y del primer piloto se apoya en una extensión de navegador, con la cuenta del propio profesional pagando el gas. El modelo objetivo —smart account ERC-4337 con passkey y paymaster— está especificado en [01](01-arquitectura.md) y planificado como Fase 5 en [18](18-tareas-por-fases.md), pero depende de tres cosas que hoy no se cumplen: la disponibilidad comprobada de bundler y paymaster en Fuji (`docs/01-arquitectura.md:17`), una resolución de [D-02](01-arquitectura.md) sobre quién financia el patrocinio, y un firmante de passkey implementado detrás de `SignerPort`. Sin una condición escrita, el andamiaje se queda por inercia: es lo que funciona, y lo que funciona no se toca.
>
> **Opciones.** (a) Migrar en la Fase 5, con alta nueva de todas las cuentas: cada profesional registra una passkey nueva y la autoridad reacredita la dirección de su smart account. (b) Sostener los dos firmantes detrás del puerto durante una ventana de transición, dejando que cada cuenta migre cuando le toque. (c) Migrar solo a los médicos y dejar la extensión en las farmacias, donde el dispositivo es compartido y estable. (d) Diferir sin condición de corte definida.
>
> **Recomendación.** (a), con la condición de corte explícita: se migra cuando las tres cosas se cumplan a la vez —bundler y paymaster verificados en Fuji, [D-02](01-arquitectura.md) resuelta al menos para el piloto, y un firmante de passkey pasando las pruebas de `SignerPort`—, y no antes. Sobre las cuentas ya dadas de alta bajo el andamiaje: **se reacreditan, no se migran**. La dirección de una smart account no es la de la cuenta externa que la controla, así que la attestation vieja no sirve y no hay forma de trasladarla; lo correcto es revocar la anterior y emitir una nueva, que es exactamente el mecanismo que [02](02-roles-y-permisos.md) ya define. Las recetas emitidas bajo la dirección vieja siguen siendo válidas y verificables: el registro guarda la dirección del emisor en el momento de emitir, no una identidad mutable. La opción (b) se descarta porque duplica la superficie de firma —dos caminos de escritura vivos a la vez— en el momento de mayor cambio; la (c) es un plan de contingencia razonable si el patrocinio solo alcanza para un lado, y conviene tenerla escrita aunque no se elija; la (d) es el estado actual y es lo que esta decisión existe para evitar.
>
> **Impacto si se difiere.** El andamiaje se vuelve permanente de hecho. Cuatro documentos —[00](00-vision-y-alcance.md), [01](01-arquitectura.md), [08](08-stack-y-entorno.md) y [13](13-pitch-y-sostenibilidad.md)— siguen prometiendo un producto sin extensión que el código no entrega, y esa distancia crece con cada pantalla nueva. Además, cada cuenta dada de alta bajo el andamiaje es una reacreditación más el día de la migración: el coste de diferir no es constante, sube con el número de participantes del piloto.

## Verificación

| Afirmación | Cómo se comprobó |
|---|---|
| `ensureChain` solo llama a `wallet_switchEthereumChain` y trata el 4902 lanzando un error | Lectura de `apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:118-139` y `apps/pharmacy/...:97-118` |
| `wallet_addEthereumChain` no aparece en el código | `rg wallet_addEthereumChain` sobre el repositorio: solo aparece en `docs/20-wallet-y-red-de-pruebas.md` |
| `buildChain` es la única definición de la cadena y no incluye explorador | Lectura de `packages/chain/src/viem-chain.ts:40-47`; `nativeCurrencyOf` en `:32-38` |
| El guardián de copia del médico recorre todo `src` y excluye un único literal de protocolo | Lectura de `apps/doctor/src/copy-guard.test.ts:33-45,48,66` |
| El guardián de la farmacia solo recorre `src/presentation` | Lectura de `apps/pharmacy/src/presentation/copy-guard.test.ts:23-35` |
| Los dos `errorCode` difieren en el tratamiento de `cause` | Comparación de `apps/doctor/...:60-66` con `apps/pharmacy/...:43-47` |
| El adaptador de cadena importa `injectedProvider` y esquiva `SignerPort` | Lectura de `apps/doctor/src/infrastructure/chain/viem-chain.adapter.ts:34-39,80,184-193` y `apps/pharmacy/...:32,57,134-143` |
| `SignerPort` está definido dos veces y solo el del médico firma recetas | Comparación de `apps/doctor/src/ports/signer.port.ts:35-57` con `apps/pharmacy/src/ports/signer.port.ts:13-27` |
| Los composition roots construyen cada adaptador en una línea | Lectura de `doctor-services.ts:36-38` y `pharmacy-services.ts:40-43` |
| `SetupCredentials.s.sol` es exclusivo de Anvil y desaconseja su extensión a red pública | Lectura de `contracts/script/SetupCredentials.s.sol:18-22,31-33,109-129` |
| La attestation se emite sin ningún campo del esquema | `MockEAS.attest` no tiene parámetro de datos (`contracts/test/mocks/MockEAS.sol:41-51`), frente a `bytes data` en `contracts/src/IEAS.sol:23` y los campos declarados en `contracts/script/RegisterSchemas.s.sol:39,43` |
| La aplicación del médico no es PWA y la de farmacia sí, hecha a mano | `apps/doctor/public` vacío y sin manifiesto en `apps/doctor/index.html`; `apps/pharmacy/public/{manifest.webmanifest,sw.js,icon.svg}`, `apps/pharmacy/index.html:8` y `apps/pharmacy/src/registerServiceWorker.ts:11-27`. `rg` no encuentra `vite-plugin-pwa` ni Workbox |
| Bundler y paymaster no están verificados ni configurados | `docs/01-arquitectura.md:17`; `env.example:84-89`; `README.md:205` |
| La Fase 5 sigue entera sin marcar | Lectura de `docs/18-tareas-por-fases.md:100-113` |
| D-31 no estaba en uso | `rg "D-31" docs/` sin resultados antes de escribir este documento |

## Siguiente paso

Ejecutar el Corte 1 y el Corte 2, en ese orden, antes de la primera alta real. El Corte 3 se prepara en paralelo, porque su parte difícil no es el guion sino la custodia de la clave de la autoridad. El Corte 4 solo si la demo se ejecuta desde un teléfono. El procedimiento manual de [20](20-wallet-y-red-de-pruebas.md) sigue siendo la referencia hasta que el Corte 1 esté en la rama principal.
