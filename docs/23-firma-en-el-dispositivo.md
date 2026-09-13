# 23 — Firma en el dispositivo de la farmacia

Este documento describe **cómo una farmacia entra a la aplicación desde un teléfono normal, sin extensión de navegador**: una clave de firma guardada cifrada en el propio dispositivo, protegida por una contraseña. Es el quinto corte del andamiaje que empezó [21](21-acceso-para-la-demo.md), y el primero que elimina el prerrequisito que aquel documento dio por intocable: «Extensión EIP-1193 instalada — **Sigue en pie**».

> **Esto es andamiaje deliberado, no la arquitectura final.** El modelo objetivo sigue siendo el de [01](01-arquitectura.md) y [D-04](02-roles-y-permisos.md): passkey WebAuthn sobre una smart account ERC-4337, con paymaster, sin que el farmacéutico posea ninguna clave. Lo que hay aquí es lo contrario de eso —una clave privada en un teléfono— y existe por un motivo operativo concreto que se explica abajo. La condición de corte es la misma de [D-31](21-acceso-para-la-demo.md#d-31); este camino se borra entero el día que se cumpla, no se migra.

## Por qué existe: la cámara y la PWA

La aplicación de farmacia es, ante todo, un escáner. Las quince pantallas de [17](17-diseno-y-experiencia.md) giran alrededor de P2, que es la cámara a pantalla completa, y el producto entero se apoya en que el farmacéutico escanee un QR de pie frente al mostrador.

El camino de [20](20-wallet-y-red-de-pruebas.md) y [21](21-acceso-para-la-demo.md) exige una extensión de navegador. En un teléfono eso significa el **navegador interno de la aplicación de la extensión**, y ahí se rompen las dos cosas que la farmacia necesita:

| # | Qué se rompe | Consecuencia |
|---|---|---|
| 1 | El navegador interno no da acceso a la cámara | P2 no arranca. Queda solo P8, entrada manual, que [17](17-diseno-y-experiencia.md) define explícitamente como contingencia y no como camino principal |
| 2 | El navegador interno no instala aplicaciones web | El manifiesto y el service worker de `apps/pharmacy/public/` no sirven de nada: no hay icono en la pantalla de inicio |

No es un problema de configuración ni de permisos: es lo que ese navegador hace. La salida es que la aplicación pueda firmar por sí misma en **Safari o Chrome normales**, que es exactamente lo que hace este corte.

## Qué se construyó

| Fichero | Qué hace |
|---|---|
| `apps/pharmacy/src/infrastructure/signer/keystore.ts` | Cifra y descifra la clave con la contraseña. PBKDF2-SHA256, 310 000 iteraciones, sal de 16 bytes; AES-256-GCM con IV de 12 bytes. Solo WebCrypto, sin dependencias nuevas |
| `apps/pharmacy/src/infrastructure/signer/local-key-signer.adapter.ts` | `SignerPort` sobre esa clave, más un proveedor EIP-1193 mínimo para que `viem` pueda escribir |
| `apps/pharmacy/src/ports/device-key.port.ts` | `DeviceKeyPort`: alta, desbloqueo, bloqueo y borrado. Lo usa **una sola pantalla** |
| `apps/pharmacy/src/presentation/screens/DeviceKeyScreen.tsx` | La pantalla de alta y de desbloqueo, delante de P1 |
| `apps/pharmacy/src/presentation/composition/pharmacy-services.ts` | Elige el firmante, de forma explícita y comentada |

**No se tocó ninguna de las ocho pantallas de la farmacia**, ni la máquina de estados de `pharmacy-flow.ts`, ni el adaptador de cadena. Esa es la promesa que la cabecera del *composition root* lleva escrita desde el principio, y este corte es la primera vez que se cobra.

### El formato del blob

Autodescriptivo a propósito, para poder migrarlo sin dejar ningún dispositivo fuera:

```json
{
  "version": 1,
  "kdf": "PBKDF2-SHA256",
  "iterations": 310000,
  "salt": "…base64, 16 bytes…",
  "iv": "…base64, 12 bytes…",
  "cipher": "AES-GCM-256",
  "ciphertext": "…base64…"
}
```

Se guarda en `localStorage` bajo `recetas.pharmacy.signing-key`. **La clave en claro no se escribe nunca**: ni en `localStorage`, ni en `sessionStorage`, ni en un log, ni en el estado de React más allá del campo del formulario, que se vacía en cuanto se guarda. La clave descifrada vive en una sola variable de *closure* dentro del adaptador, y `lock()` la borra.

Las 310 000 iteraciones son el mínimo de OWASP para PBKDF2-HMAC-SHA256, y el adaptador **se niega a abrir un blob que declare menos**: un blob editado a mano con 1 000 iteraciones abriría igual y con una protección nueve veces más barata de romper.

### Los dos errores que la pantalla distingue

`SignerUnavailableError` y `SignerLockedError` no son lo mismo y la diferencia importa:

- **`SignerUnavailableError`** — aquí no hay nada configurado. La respuesta es dar de alta el dispositivo, o hablar con el responsable técnico.
- **`SignerLockedError`** — la clave está aquí y está cerrada. La respuesta es escribir la contraseña.

Colapsarlos mandaría al responsable técnico de la farmacia a un farmacéutico que solo olvidó desbloquear el teléfono.

### Por qué aquí no aplica `wallet_switchEthereumChain`

El Corte 1 de [21](21-acceso-para-la-demo.md) enseñó a la extensión a darse de alta la cadena sola. Aquí **no hay extensión a la que pedirle que cambie de red**: la red son dos valores de configuración, `VITE_CHAIN_ID` y `VITE_RPC_URL`, compilados en el bundle. Así que `ensureChain` hace lo único que tiene sentido —comprobar que la cadena que pide la aplicación es la cadena para la que se configuró el dispositivo— y falla con un mensaje claro si no coinciden. Firmar en silencio sobre otra cadena sería la peor respuesta posible a un error de despliegue.

### El proveedor EIP-1193 mínimo

`viem-chain.adapter.ts` construye su `walletClient` con `custom(provider)` y llama a `writeContract`. El proveedor de este adaptador atiende exactamente cuatro métodos: `eth_accounts`, `eth_chainId`, `eth_estimateGas` y `eth_sendTransaction`. Este último firma localmente con `privateKeyToAccount` y difunde el resultado con `eth_sendRawTransaction` contra `VITE_RPC_URL`. **Cualquier otro método falla nombrándose**, nunca en silencio: un proveedor que devuelve `null` ante lo que no conoce hace que `viem` reviente en otro sitio, con un error sobre la consecuencia y no sobre la causa.

## Cómo se da de alta un teléfono

1. Abrir **Safari o Chrome** —el navegador normal del teléfono, no el de ninguna extensión— en la dirección de la aplicación de farmacia.
2. La primera pantalla es **«Configurar el acceso de la farmacia»**.
3. En **«Clave de firma de la farmacia»**, pegar la clave privada de la cuenta de farmacia acreditada. Se pega una sola vez y no vuelve a mostrarse.
4. En **«Contraseña de este dispositivo»**, escribir una contraseña de **al menos 12 caracteres**, y repetirla. No se puede recuperar: si se olvida, hay que volver a pegar la clave.
5. **«Guardar y continuar»**. A partir de ahí la aplicación comprueba la credencial en la cadena exactamente como siempre, y habilita el escáner.
6. Desde el menú del navegador, **«Añadir a la pantalla de inicio»**. Ahora sí: la PWA se instala y la cámara funciona.
7. Cada vez que se cierre la aplicación, al volver pide **solo la contraseña**.

Para quitar la clave de un teléfono, la pantalla de desbloqueo ofrece **«Borrar la clave de este dispositivo»**, con confirmación. Borra lo guardado en ese navegador y nada más: lo que ya está registrado en la cadena no cambia.

## Qué protege y qué no

Honestidad primero, que es la regla de [12](12-preguntas-de-jurado.md).

| Frente a | ¿Protege? |
|---|---|
| Alguien que mira el `localStorage` del teléfono | **Sí.** Solo hay un blob cifrado; abrirlo exige la contraseña y 310 000 iteraciones de PBKDF2 por intento |
| Alguien que se lleva el teléfono desbloqueado con la sesión abierta | **No.** La clave está descifrada en memoria y puede firmar hasta que se cierre la pestaña |
| Una contraseña débil o compartida | **No.** El mínimo de 12 caracteres es un suelo, no una garantía |
| Un XSS en la propia aplicación | **No.** Código ejecutándose en el mismo origen puede pedirle a la aplicación que firme. Es la misma superficie que tendría cualquier clave en un navegador |
| La pérdida del teléfono | **No hay recuperación.** No hay copia, no hay custodia, no hay reenvío. La respuesta operativa es revocar la credencial de esa cuenta ([02](02-roles-y-permisos.md)) y acreditar otra |

De ahí las dos reglas que la pantalla dice en voz alta y que este documento repite: **la clave vive cifrada en ese dispositivo concreto**, y **solo se usa una cuenta de prueba, nunca una cuenta con fondos reales** ([08](08-stack-y-entorno.md)).

## Cómo se compara con el modelo objetivo

| | Andamiaje (este documento) | Objetivo (D-04, Fase 5 de [18](18-tareas-por-fases.md)) |
|---|---|---|
| Qué posee la persona | Una clave privada, cifrada en un navegador | Una passkey WebAuthn en el Secure Enclave, no exportable |
| Quién paga el gas | La propia cuenta de la farmacia, con AVAX de prueba | El paymaster, mediante `PrescriptionPaymaster` |
| Qué se firma | Una transacción, directamente | Una `UserOperation`, validada por la smart account |
| Si se pierde el dispositivo | No hay recuperación; se revoca y se reacredita | Recuperación social / segunda passkey, según se resuelva [D-04](02-roles-y-permisos.md) |
| Cuánto código lo sostiene | Dos ficheros de infraestructura y una pantalla | `PasskeyAccount`, `PasskeyAccountFactory`, `WebAuthn`, `P256` y el relayer |

La pieza que hace posible la sustitución ya estaba: el Corte 2 de [21](21-acceso-para-la-demo.md) metió la ruta de escritura detrás de `SignerPort`, con `no-signer-import.test.ts` custodiando el límite. Este adaptador entra por esa puerta sin tocar el adaptador de cadena, lo que es la mejor prueba disponible de que el firmante de passkey también podrá.

## Si un jurado pregunta quién firma

La respuesta, en el mismo registro de [21](21-acceso-para-la-demo.md#si-un-jurado-pregunta-por-la-extensión):

> Firma la cuenta de la farmacia, y hoy esa cuenta es una clave que vive cifrada en el teléfono del mostrador, protegida con una contraseña. No es el diseño final y lo decimos: el diseño es passkey sobre una smart account con paymaster, y esa parte está especificada y en parte construida, pero depende de tener bundler y paymaster comprobados en Fuji. Elegimos esto por un motivo operativo muy concreto: el navegador interno de la extensión no da acceso a la cámara, y esta aplicación es un escáner. Lo que la demostración prueba —que la segunda dispensación de la misma receta revierte— no depende de cómo se firma, y el firmante está aislado detrás de un puerto para que el cambio sea acotado.

Si repreguntan por la custodia, la respuesta honesta es que **no hay custodia**: la cuenta es de prueba, sin fondos reales, y si se pierde el teléfono se revoca la credencial y se acredita otra.

## Verificación

| Afirmación | Cómo se comprobó |
|---|---|
| El adaptador de cadena obtiene el proveedor del puerto y con él construye el `walletClient` | Lectura de `apps/pharmacy/src/infrastructure/chain/viem-chain.adapter.ts:139-159` |
| El *composition root* era la única línea que nombraba el firmante concreto | Lectura de `apps/pharmacy/src/presentation/composition/pharmacy-services.ts:40` antes de este corte |
| La ida y vuelta del cifrado, la contraseña equivocada, el blob corrupto y la no repetición del ciphertext | `apps/pharmacy/src/infrastructure/signer/keystore.test.ts`, 23 pruebas |
| El proveedor firma, difunde y rechaza por nombre lo que no implementa | `apps/pharmacy/src/infrastructure/signer/local-key-signer.adapter.test.ts`, 22 pruebas; la transacción difundida se recupera a la dirección esperada con `recoverTransactionAddress` |
| El alta, el desbloqueo, el borrado y la copia de la pantalla | `apps/pharmacy/src/presentation/screens/DeviceKeyScreen.test.tsx`, 14 pruebas |
| La selección de firmante en el *composition root* | `apps/pharmacy/src/presentation/composition/pharmacy-services.test.ts`, 3 pruebas |
| El camino de la extensión no cambió | Las 380 pruebas anteriores siguen en verde, incluidas las 11 de `AccessScreen.test.tsx` y el guardián de copia |
| Ninguna pantalla dice «wallet», «frase semilla» ni «saldo» | `apps/pharmacy/src/presentation/copy-guard.test.ts`, que ahora recorre también la pantalla nueva |

No se añadió ninguna variable de entorno: el adaptador se apoya en `VITE_RPC_URL` y `VITE_CHAIN_ID`, que ya existían.

## Siguiente paso

Dar de alta el teléfono del mostrador con la cuenta de farmacia acreditada en Fuji e instalar la PWA, siguiendo los siete pasos de arriba. El procedimiento con extensión de [20](20-wallet-y-red-de-pruebas.md) sigue vigente para escritorio y no cambia: si hay una clave guardada en el dispositivo se usa esa, y si no la hay y existe una extensión se usa la extensión.
