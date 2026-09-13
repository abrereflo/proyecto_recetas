# 19 — Despliegue en producción

El backend y las dos SPA se despliegan como contenedores en un servidor ya existente —`server1.fassil.lat`, 203.161.56.37—, detrás del **nginx del propio host**, que ya es el reverse proxy de todo lo que esa máquina sirve. Este documento describe esa topología, el pipeline de CI/CD que la alimenta y las restricciones de capacidad que gobiernan cada decisión de memoria. La sección [08](08-stack-y-entorno.md) cubre el stack de *contratos* (Foundry, `forge script`); este documento cubre el despliegue de la *aplicación* (API, SPA, Postgres), más el procedimiento on-chain del que esa aplicación depende para arrancar: desde la migración a Avalanche Fuji, EAS ya no viene dado por la red y hay que desplegarlo, así que ese paso se documenta aquí abajo antes que la topología de servicios.

> **Estado: no hay despliegue en producción todavía.** Este documento describe el procedimiento tal como quedó preparado (imágenes, compose, pipeline, vhosts), no un sistema ya verificado en vivo. Antes de la primera ejecución real hay que leer la sección "Restricción de capacidad" entera y **crear swap en el servidor**: hoy no tiene, y la máquina no es nuestra sola.

## Qué se despliega y qué no

| Se despliega | No se despliega |
|---|---|
| API (Fastify, imagen `recetas-api`) | Anvil — es la cadena de desarrollo local únicamente ([08](08-stack-y-entorno.md)) |
| SPA de médico (imagen `recetas-doctor`) | Ningún reverse proxy propio — el servidor ya corre nginx en el host y es el que enruta todo |
| SPA de farmacia (imagen `recetas-pharmacy`) | Bundler o paymaster propios — pendientes de proveedor ([D-02](01-arquitectura.md)) |
| Postgres (payload cifrado, [D-08](05-almacenamiento-y-cifrado.md)) | Migración de esquema automática hacia atrás — un rollback nunca revierte una migración de drizzle ya aplicada |

La red de producción es **Avalanche Fuji, chainId 43113**. No existe ninguna ruta de despliegue que apunte a Anvil (chainId 31337): ese valor solo aparece en `docker-compose.yml`, el compose de desarrollo.

### EAS es un despliegue propio, no la instancia canónica

Avalanche **no tiene un despliegue oficial de EAS**: el repositorio `ethereum-attestation-service/eas-contracts` publica `deployments/` para 26 redes y ninguna es Avalanche. No hay dirección canónica ni predeploy que asumir, así que el proyecto despliega su propia instancia de **EAS v1.2.0** —la misma versión de la que está transcrito `contracts/src/IEAS.sol`— y las direcciones resultantes son un dato de *este* despliegue que hay que anotar y configurar.

El orden importa y no es una preferencia: `EAS` recibe el `SchemaRegistry` en el constructor y revierte con la dirección cero, así que el registro va primero y queda inmutable dentro de EAS. Cambiar de `SchemaRegistry` más tarde obliga a desplegar un `EAS` nuevo.

#### Antes de ejecutar nada: el `.env` de la raíz no llega solo

Este paso no es cosmético y costó tiempo real la primera vez. **Foundry carga `.env` desde la raíz del proyecto Foundry —`contracts/`, donde vive `foundry.toml`— y no desde la raíz del repositorio, que es donde este proyecto tiene su `.env`.** Y `contracts/` no tiene un `.env` propio. La consecuencia es silenciosa: `${FUJI_RPC_URL}` y `${ROUTESCAN_API_KEY}` de `[rpc_endpoints]` y `[etherscan]` se resuelven a la cadena vacía, y `--rpc-url fuji` falla sin decir en ningún momento que el problema es una variable sin valor. El arreglo es exportar el `.env` de la raíz al shell antes de llamar a `forge`:

```bash
cd contracts
set -a; . ../.env; set +a
```

Falta una segunda pieza, igual de silenciosa. Los tres scripts llaman a `vm.broadcast()` y `vm.startBroadcast()` **sin argumento de clave**, así que Foundry no deduce de ninguna parte con qué cuenta firmar: la clave del desplegador se pasa en la línea de comandos, `--private-key "$DEPLOYER_PRIVATE_KEY"`, en cada uno de los tres comandos.

```bash
# 1. EAS propio. Imprime SchemaRegistry y EAS; se niega a correr en chainId 31337,
#    donde la demo local ya usa MockEAS.
forge script script/DeployEAS.s.sol --rpc-url fuji --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# 2. Los dos esquemas de credencial. Imprime sus uids. Es idempotente: si ya
#    estaban registrados, los informa en vez de abortar.
SCHEMA_REGISTRY_ADDRESS=0x... \
forge script script/RegisterSchemas.s.sol --rpc-url fuji --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# 3. El registro, con EAS y los dos uids como argumentos de constructor.
EAS_ADDRESS=0x... PRACTITIONER_SCHEMA_UID=0x... PHARMACY_SCHEMA_UID=0x... \
ISSUER_AUTHORITY=0x... \
forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

> **Los uids de los esquemas no son los de la demo local.** `contracts/script/LocalDemo.sol` usa `keccak256(declaración)` como stand-in sobre Anvil; el `SchemaRegistry` real deriva el uid de `keccak256(abi.encodePacked(schema, resolver, revocable))`. Son números distintos. Los únicos válidos en una red pública son los que imprime `RegisterSchemas.s.sol`, y son los que entran en `PRACTITIONER_SCHEMA_UID` y `PHARMACY_SCHEMA_UID`. Poner los locales por error produce un registro cuyas comprobaciones de credencial no pueden pasar nunca.

Tras desplegar, confirmar que `EAS.version()` y `SchemaRegistry.version()` devuelven `1.2.0`, y que `EAS.getSchemaRegistry()` apunta al registro desplegado junto a ella. Es la comprobación barata de que lo desplegado es lo esperado.

### El primer despliegue real: direcciones del 13/09/2026

Los tres scripts se ejecutaron en ese orden contra Avalanche Fuji, chainId 43113. Estos son los valores que produjeron, y son los que hay que volcar al entorno:

| Pieza | Dirección o uid |
|---|---|
| `SchemaRegistry` | `0xD4aFA6F68be2eb0c99D3B421B7f52a6420217efb` |
| `EAS` v1.2.0 (propio) | `0x27781D2242a68e4D234bc0A5a15333D0CD80c58A` |
| `PrescriptionRegistry` | `0xD5F2d5aD03703a9Ee11078d86181421E2E078365` — código fuente verificado |
| `PRACTITIONER_SCHEMA_UID` | `0x5b8d9aff12e1409f3603c9bcca659c1e1dc8d8b4faf219b674d743f6ec54f233` |
| `PHARMACY_SCHEMA_UID` | `0xac44c9573bebb0b5622ea078c08bea286ad1d99566d317a32393a9e71fbff500` |
| `ISSUER_AUTHORITY` | `0x613F14B919317b515D8804915a8E82f926C86c0C` |

Explorador: <https://testnet.snowscan.xyz/address/0xd5f2d5ad03703a9ee11078d86181421e2e078365>.

Las comprobaciones de arriba pasaron todas: `EAS.version()` y `SchemaRegistry.version()` devuelven `1.2.0`, `EAS.getSchemaRegistry()` apunta al `SchemaRegistry` de la tabla, y `registry.eas()`, `registry.issuerAuthority()`, `registry.practitionerSchema()` y `registry.pharmacySchema()` coinciden uno a uno con los valores anotados.

> **El coste no era el obstáculo que la documentación suponía.** Los tres despliegues juntos, verificación incluida, costaron **menos de 0,001 AVAX**: la cuenta de despliegue pasó de 3,5 a 3,499017 AVAX. El grifo de Fuji cubre el procedimiento entero muchas veces, así que financiar la cuenta nunca fue el bloqueante real; el bloqueante era tener la cuenta y su clave.

> **`ISSUER_AUTHORITY` es hoy la propia cuenta de despliegue, y eso es deuda aceptada del MVP.** El proyecto solo controla una clave, así que desplegador y autoridad emisora colapsan en la misma dirección. `env.example` describe la separación deseada —una autoridad aparte, un multisig en el piloto— y esa separación sigue siendo el objetivo; simplemente no está en este despliegue. Conviene saberlo antes de tocar nada: `PrescriptionRegistry.issuerAuthority` es `immutable` (`contracts/src/PrescriptionRegistry.sol`, línea 50) y `_hasLiveCredential` rechaza cualquier attestation cuyo `attester` no sea exactamente esa dirección, así que un valor equivocado ahí no se corrige con una transacción de administración: se corrige redesplegando el registro entero. En la preparación de este despliegue, el `.env` de la raíz llevaba una `ISSUER_AUTHORITY` con un sufijo `est` pegado al final de una dirección por lo demás válida; la dirección resultante era sintácticamente correcta y de una clave que el proyecto no posee. Desplegar con ella habría dejado el registro sin ninguna cuenta capaz de acreditar a nadie, para siempre.

### Si el RPC se cae a mitad del despliegue

**Foundry no reintenta el envío, y no hay ninguna opción que lo active.** Conviene decirlo explícitamente porque los dos flags que lo parecen no lo son: `--retries` y `--delay` gobiernan los reintentos del *verificador* de código fuente en el explorador —cinco intentos por defecto— y no tocan el broadcast. Un RPC público que deja de responder a mitad de `forge script` corta el despliegue ahí.

Lo que sí existe son estas tres piezas, y son las que hay que usar:

| Pieza | Qué hace |
|---|---|
| `--resume` | Reenvía las transacciones que quedaron pendientes o caídas del último intento. **No vuelve a simular el script** y da por hecho que los nonces no cambiaron |
| `--rpc-timeout <segundos>` | Corta la espera de una petición RPC en vez de colgarse sin límite. También `ETH_RPC_TIMEOUT` |
| `--timeout <segundos>` | Lo mismo para la espera del broadcast. También `ETH_TIMEOUT` |

El procedimiento ante un corte es reejecutar el **mismo** comando con `--resume` añadido:

```bash
forge script script/DeployEAS.s.sol --rpc-url fuji --broadcast --resume
```

> **No se relanza un despliegue a medias sin `--resume`.** Sin él, el script se simula de cero y vuelve a enviar transacciones que quizá ya se minaron: en `DeployEAS.s.sol` eso significa un `SchemaRegistry` y un `EAS` duplicados, y una dirección anotada en el entorno que no es la que quedó viva. Y como `--resume` exige que los nonces sigan como estaban, esa cuenta de despliegue no se usa para nada más mientras haya un despliegue sin terminar.

### Verificación de contratos en el explorador

El explorador de Fuji es `https://testnet.snowtrace.io`. **Avalanche Fuji es de tier pago en Etherscan V2**, así que la key gratuita de Etherscan no verifica aquí. `contracts/foundry.toml` apunta la verificación a **Routescan**, que expone una API compatible con Etherscan y acepta la cadena literal `verifyContract` como key:

```bash
forge verify-contract <address> <contract> --chain 43113 \
  --verifier-url 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan' \
  --etherscan-api-key verifyContract
```

> **Comprobado el 13/09/2026: funciona tal como está escrito.** El endpoint se ejercitó en el primer despliegue real con `forge script ... --verify` y no hubo que corregir nada de `contracts/foundry.toml`, la key literal `verifyContract` incluida. El envío no responde de inmediato: la petición queda unos quince segundos en `Pending in queue` y después devuelve `Pass - Verified`. Un `--verify` que parece colgado durante ese rato está funcionando, no fallando. Forge envía además el código a **Sourcify** en paralelo y por su cuenta, sin configuración adicional.

> **Los dos exploradores sirven el mismo código verificado.** Snowtrace hoy funciona sobre Routescan y comparte con él la verificación, así que verificar una vez basta para ambos: consultando `module=contract&action=getsourcecode` contra `https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api` y contra `https://api-testnet.snowtrace.io/api`, las dos APIs devuelven `PrescriptionRegistry` con el código fuente presente. Las referencias a `testnet.snowtrace.io` que hay en la documentación y en la configuración siguen siendo correctas y no hay nada que cambiar.

## Acreditar cuentas en Fuji

Sin credencial no hay demo: `issue` revierte con `NotAccreditedPractitioner` y `dispense` con `NotAccreditedPharmacy`. Esta sección es el procedimiento completo para acreditar una cuenta en la red pública.

Las dos herramientas que acreditan cuentas en la demo local **no sirven aquí, y es deliberado**. `contracts/script/SetupCredentials.s.sol` revierte con `NotTheLocalChain` fuera de la chainId 31337 y firma con una constante de compilación (`LocalDemo.ISSUER_AUTHORITY_KEY`, la cuenta #9 de Anvil), que no es la `ISSUER_AUTHORITY` de Fuji; y el comando `receta setup-credentials` está cerrado por tres sitios a la vez: `assertLocalChain` solo acepta 31337 y 1337, `assertLocalEas` exige que el EAS sea el mock, y `issueAndRegister` llama a `attestWithUid`, una función que solo existe en `MockEAS` y que un EAS v1.2.0 real no expone.

### Dos transacciones, dos claves distintas, y esa es la arquitectura

Acreditar a alguien **nunca** es una sola transacción, y no por comodidad:

1. **La autoridad emite.** `ISSUER_AUTHORITY` firma un `EAS.attest()` que declara «esta dirección es un médico con matrícula vigente». Nadie más puede: `registerCredential` exige `attester == issuerAuthority`, y ese valor es `immutable` en el registro.
2. **El titular se registra.** El propio titular firma `registerCredential(uid)` con su clave. La autoridad **no puede hacerlo en su nombre**, porque el contrato compara `a.recipient == msg.sender`.

Ese segundo paso es lo que [04](04-smart-contracts.md) llama auto-registro y lo que mantiene al sistema sin administrador ([D-14](04-smart-contracts.md)): el registro nunca acepta la palabra de la autoridad sobre quién es el que llama. Un `uid` falso no sirve de nada, porque las cinco comprobaciones contra EAS lo tumban; por eso el permiso para escribir en `credentialOf` puede estar abierto a cualquiera.

### Paso 1 — la autoridad emite: `IssueCredential.s.sol`

`contracts/script/IssueCredential.s.sol` hace exactamente una cosa: una llamada a `EAS.attest()`. **No lee, deriva ni imprime ninguna clave privada.** Usa `vm.broadcast()` sin argumento, el mismo patrón que `Deploy.s.sol`, de modo que Foundry recibe el firmante en la línea de comandos (`--private-key`, `--account`, `--interactive` o `--ledger`) y la clave de la autoridad nunca entra en el repositorio. Esa es la regla que `SetupCredentials.s.sol` enuncia en sus líneas 18-22: entregarle la clave de la autoridad a un script es cómo una autoridad de credenciales deja de serlo.

Antes de gastar gas, el script se niega a correr si algo no cuadra, con errores nombrados:

| Comprobación | Error si falla |
|---|---|
| No es la chainId 31337 | `LocalChainUsesSetupCredentials` — para Anvil está `SetupCredentials.s.sol` |
| `EAS_ADDRESS` y `PRESCRIPTION_REGISTRY_ADDRESS` presentes y con código | `MissingEasAddress`, `MissingRegistryAddress`, `NoCodeAtEas`, `NoCodeAtRegistry` |
| El EAS configurado es el que el registro lleva dentro | `EasMismatch` |
| El uid de esquema del entorno coincide con el `immutable` del registro | `SchemaMismatch` |
| **La cuenta que va a firmar es `registry.issuerAuthority()`** | `NotTheIssuerAuthority`, nombrando ambas direcciones |
| `validUntil` está en el futuro | `ValidUntilAlreadyPast` |

La comprobación de la autoridad es la que más ahorra: firmar con otra cuenta produce una attestation perfectamente válida en EAS que el registro rechazará siempre, y no hay forma de arreglarla después — solo emitir otra.

Variables que lee del entorno:

| Variable | Obligatoria | Notas y valor por defecto |
|---|---|---|
| `EAS_ADDRESS`, `PRESCRIPTION_REGISTRY_ADDRESS` | Sí | — |
| `CREDENTIAL_ROLE` | Sí | `practitioner` o `pharmacy`; cualquier otra cosa aborta |
| `CREDENTIAL_HOLDER` | Sí | Dirección del titular |
| `PRACTITIONER_SCHEMA_UID` / `PHARMACY_SCHEMA_UID` | Sí, según el rol | — |
| `CREDENTIAL_VALID_UNTIL` | No | Unix absoluto; si está, manda |
| `CREDENTIAL_VALIDITY_DAYS` | No | `365`, la misma vigencia que concede la demo local |
| `PRACTITIONER_LICENSE_NUMBER`, `PRACTITIONER_SPECIALTY_CODE` | No | Vacío, con aviso en pantalla |
| `PHARMACY_LICENSE`, `PHARMACY_SANITARY_REGISTRY_REF` | No | Vacío, con aviso en pantalla |

```bash
cd contracts
set -a; . ../.env; set +a

# Ensayo primero: sin --broadcast no se envía nada. --sender basta, no hace
# falta la clave, porque la comprobación de autoridad mira quién firmaría.
CREDENTIAL_ROLE=practitioner CREDENTIAL_HOLDER=0x... \
PRACTITIONER_LICENSE_NUMBER=MP-12345 PRACTITIONER_SPECIALTY_CODE=A01 \
forge script script/IssueCredential.s.sol --rpc-url fuji \
  --sender "$ISSUER_AUTHORITY"

# De verdad. Hoy la autoridad emisora y la cuenta de despliegue son la misma
# dirección, así que la clave es DEPLOYER_PRIVATE_KEY; el día que se separen,
# aquí va la de la autoridad y no la del desplegador.
CREDENTIAL_ROLE=practitioner CREDENTIAL_HOLDER=0x... \
PRACTITIONER_LICENSE_NUMBER=MP-12345 PRACTITIONER_SPECIALTY_CODE=A01 \
forge script script/IssueCredential.s.sol --rpc-url fuji --broadcast \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

> Una autoridad que viva en una billetera de hardware o en un keystore no obliga a tocar el script: `--ledger`, `--account <nombre>` o `--interactive` en lugar de `--private-key`. Es exactamente la razón de que el firmante llegue por la línea de comandos y no por el entorno.

> **`data` no va vacío, y conviene saber por qué.** El registro nunca decodifica ese campo —lee `schema`, `recipient`, `attester`, `revocationTime` y `expirationTime`, nada más—, así que `bytes("")` pasaría hoy todas las comprobaciones. También publicaría una credencial que no dice nada: los esquemas de [03](03-modelo-de-datos.md) declaran matrícula y especialidad precisamente para que un verificador externo pueda responder «¿qué profesional es este y bajo qué matrícula?», que es la pregunta de la que [02](02-roles-y-permisos.md) cuelga toda la cadena de confianza ([D-05](02-roles-y-permisos.md)). El script codifica los campos declarados, en su orden, con `abi.encode`. Un matiz que hay que anotar: las declaraciones que registró `RegisterSchemas.s.sol` llevan delante el nombre del struct (`PractitionerCredential(string licenseNumber,...)`) en vez de la lista de campos pelada que parsea el tooling de EAS. On-chain da igual —EAS guarda la cadena y nunca la interpreta—, pero un explorador genérico de EAS no autodecodificará estas attestations.

### El uid que imprime el script **no** es el uid de la cadena

Esta es la trampa del procedimiento y hay que mirarla de frente antes de copiar nada.

EAS calcula el uid *dentro* de la transacción, y `attestation.time` —que es `uint64(block.timestamp)` en el momento de ejecutar— forma parte de la preimagen (`EAS.sol:442` y `EAS.sol:698-713`). Un `forge script` congela el calldata durante la simulación, que corre contra el bloque del que hizo fork, y la transacción se mina después, en un bloque con otro timestamp. Todo lo demás de la preimagen es calldata congelado y viaja intacto; `time` no. **Los dos uids son distintos**, y un `registerCredential` construido con el de la simulación revierte con `CredentialNotFound` cuando el gas ya se gastó.

En Anvil el problema no existe y por eso es fácil no verlo venir: `MockEAS` deriva su uid de un contador, no del reloj, que es justo lo que le permite a `SetupCredentials.s.sol` emitir y registrar en un solo script. Ese patrón no se puede trasladar a una red pública.

El uid real se lee de la cadena, del evento `Attested`, donde `uid` es el único campo no indexado y por tanto es todo el `data` del log. Sin resolver en ninguno de los dos esquemas, la transacción emite ese log y ninguno más:

```bash
# Desde contracts/, sobre el artefacto que deja el propio forge script --broadcast
jq -r --arg t '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35' \
  '.receipts[-1].logs[] | select(.topics[0]==$t) | .data' \
  broadcast/IssueCredential.s.sol/43113/run-latest.json

# O, si se tiene el hash de la transacción a mano
cast receipt <txhash> --rpc-url fuji --json | jq -r '.logs[0].data'
```

> Todos los comandos de esta sección se ejecutan desde `contracts/` y con el `.env` de la raíz exportado (`set -a; . ../.env; set +a`). El alias `fuji` de `--rpc-url` vive en `contracts/foundry.toml` y se resuelve a `${FUJI_RPC_URL}`: fuera de ese directorio, o sin esa variable, no existe.

El propio script imprime esos comandos al terminar, con la dirección del registro y del titular ya sustituidas.

### Paso 2 — el titular se registra: `cast send`, no un script

**No hay un segundo script, y es una decisión, no una omisión.** Los titulares de este proyecto son cuentas de billetera de navegador ([20](20-wallet-y-red-de-pruebas.md)): sus claves viven dentro de una extensión, no en un keystore que Foundry pueda abrir. Un script para este paso existiría solo para que alguien le exporte una clave privada, que es el mismo error con otro sombrero. Y es una llamada con un argumento, así que `cast send` es más corto y más honesto:

```bash
cast send 0xD5F2d5aD03703a9Ee11078d86181421E2E078365 \
  'registerCredential(bytes32)' <uid> \
  --rpc-url fuji --private-key <clave-del-titular>
```

Como `PrescriptionRegistry` está verificado en el explorador, hay una vía todavía más natural para una cuenta de MetaMask: abrir la pestaña **Write Contract** en <https://testnet.snowtrace.io/address/0xD5F2d5aD03703a9Ee11078d86181421E2E078365>, conectar la billetera del titular y llamar a `registerCredential` desde ahí. Misma transacción, firmada por la misma cuenta, sin exportar nada.

### Comprobar que la credencial quedó

```bash
REGISTRY=0xD5F2d5aD03703a9Ee11078d86181421E2E078365
EAS=0x27781D2242a68e4D234bc0A5a15333D0CD80c58A

# 1. El puntero. Debe devolver el uid, no ceros.
cast call $REGISTRY 'credentialOf(address)(bytes32)' <titular> --rpc-url fuji

# 2. La attestation detrás del puntero: recipient = titular,
#    attester = ISSUER_AUTHORITY, revocationTime = 0, schema = el del rol.
cast call $EAS \
  'getAttestation(bytes32)((bytes32,bytes32,uint64,uint64,uint64,bytes32,address,address,bool,bytes))' \
  <uid> --rpc-url fuji
```

Un `credentialOf` en ceros significa que el paso 2 no se ejecutó o revirtió. La prueba definitiva es funcional: con la credencial puesta, `issue` deja de revertir.

### Revocar

Revoca **la autoridad, en EAS**, no el registro. No existe función en `PrescriptionRegistry` para quitarle la credencial a nadie, y eso es intencionado ([D-14](04-smart-contracts.md)): el registro no tiene administrador.

```bash
cast send $EAS 'revoke((bytes32,(bytes32,uint256)))' "(<schema-uid>,(<uid>,0))" \
  --rpc-url fuji --private-key <clave-de-la-autoridad>
```

El efecto es **inmediato y no hay que tocar nada más**. `_hasLiveCredential` vuelve a leer la attestation en cada llamada y nunca cachea el veredicto, así que en cuanto `revocationTime` deja de ser cero la siguiente emisión o dispensación revierte. `credentialOf` sigue apuntando al uid muerto, y da igual: el puntero es un puntero, no un permiso.

Lo que la revocación **no** deshace: las recetas ya emitidas por esa cuenta siguen siendo válidas y dispensables hasta caducar. Retirar una licencia no anula las recetas escritas la semana anterior ([02](02-roles-y-permisos.md)). Renovar es emitir una attestation nueva y que el titular registre el uid nuevo, que reemplaza al anterior en `credentialOf`.

## Topología de servicios

La máquina es `server1.fassil.lat` (203.161.56.37), Ubuntu, con **nginx 1.24.0 corriendo en el host** —no en un contenedor— como reverse proxy de todo lo que ahí se sirve. No hay Traefik. nginx es dueño de los puertos 80 y 443, termina TLS con certificados de **certbot 2.9.0**, y reparte por `server_name` entre vhosts que siguen el patrón `/etc/nginx/sites-available/<nombre>.conf` + symlink en `sites-enabled/`. Ya conviven ahí `fassil.lat`, `crm360.fassil.lat`, `gym.fassil.lat`, `store.fassil.lat`, `restaurante.fassil.lat`, `appgym.fassil.lat`, `kioscogym.fassil.lat`, `pma.fassil.lat`, `imtlogv2.fassil.lat` y `pos-system`. Los dos vhosts de este proyecto son dos más, con el mismo patrón y sin tocar ninguno de los otros.

Los contenedores **no se exponen a internet**. Cada servicio público publica su puerto en `127.0.0.1` y solo el nginx del host lo alcanza:

| Servicio | Imagen | Puerto interno | Publicado en el host | Alcance |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | No | Interno — solo `api` lo alcanza |
| `api` | `ghcr.io/$GHCR_OWNER/recetas-api` | 3000 | `127.0.0.1:3100` | Solo loopback; público vía nginx en `recetas.fassil.lat/api` |
| `doctor` | `ghcr.io/$GHCR_OWNER/recetas-doctor` | 80 (nginx del contenedor) | `127.0.0.1:8181` | Solo loopback; público vía nginx en `recetas.fassil.lat` |
| `pharmacy` | `ghcr.io/$GHCR_OWNER/recetas-pharmacy` | 80 (nginx del contenedor) | `127.0.0.1:8182` | Solo loopback; público vía nginx en `farmacia.fassil.lat` |

> **El prefijo `127.0.0.1:` de cada `ports:` es toda la frontera de seguridad de este despliegue, no un detalle de estilo.** Atado así, el puerto existe únicamente en la interfaz de loopback: el nginx del host puede proxearlo y nada de internet llega a él. Escrito como `"3100:3000"` —sin la IP— Docker lo publica en todas las interfaces y el API queda sirviendo en claro, sin TLS, en un puerto alto, accesible por IP y saltándose el vhost entero. Es un error de un carácter con esa consecuencia.

Los tres puertos elegidos (3100, 8181, 8182) se comprobaron libres en el servidor con `ss -tlnp`. A fecha de esa comprobación escuchaban: 22, 53, 80, 111, 443, 2222, 3000, 3320, 8083, 8090, 8091, 14330, 18080.

> **El namespace de las imágenes no está fijo en ningún archivo.** `$GHCR_OWNER` es la cuenta de GitHub dueña del repositorio: GHCR registra cada paquete bajo el dueño del repositorio que lo publicó, y el `GITHUB_TOKEN` de los jobs de CI solo puede escribir dentro de ese namespace. Publicar bajo otro termina en `denied: permission_denied: The requested installation does not exist`, después de construir la imagen entera. En CI el valor sale de `github.repository_owner` (pasado a minúsculas, que es lo único que GHCR acepta); en el servidor sale de `GHCR_OWNER` en el `.env`. Hoy vale `abrereflo`.

`db` no publica ningún puerto, ni siquiera en loopback: es inalcanzable desde fuera de la red interna de Compose, y por tanto desde cualquiera de las otras aplicaciones que corren en la máquina.

### Los dos vhosts del host

Viven versionados en este repositorio, en `docker/nginx/`, aunque no los use ningún contenedor:

| Fichero | `server_name` | Qué enruta |
|---|---|---|
| `docker/nginx/recetas.fassil.lat.conf` | `recetas.fassil.lat` | `/api/` → `127.0.0.1:3100/`, `/` → `127.0.0.1:8181` |
| `docker/nginx/farmacia.fassil.lat.conf` | `farmacia.fassil.lat` | `/` → `127.0.0.1:8182` |

> **Detalle de enrutamiento del API: la barra final de `proxy_pass` es obligatoria.** La aplicación registra sus rutas en la raíz (`/health`, `/prescriptions`, `/relayer`; ver `services/api/src/routes/`) y no tiene ningún prefijo `/api` interno. `proxy_pass http://127.0.0.1:3100/;` —con barra— hace que nginx sustituya el `/api/` que hizo match por `/`, así que `/api/prescriptions` llega al contenedor como `/prescriptions`. Sin esa barra, todas las peticiones del navegador reciben 404. Es el equivalente exacto del middleware `stripprefix` que hacía Traefik.

> **En cambio, las dos SPA se proxean SIN barra final**, a propósito: el URI tiene que llegar intacto al contenedor para que el nginx *de la imagen* (`docker/nginx/nginx.prod.conf`) aplique su `try_files` y sus reglas de caché. El vhost del host no repite nada de eso: no añade `expires`, ni `add_header Cache-Control`, ni `proxy_cache`. En farmacia eso no es pereza sino requisito — el contenedor sirve `/sw.js` y `/manifest.webmanifest` con `no-cache` justamente para que el navegador los revalide y detecte un despliegue nuevo; una directiva de caché en el proxy del host pisaría esa cabecera y dejaría a cada cliente clavado en el service worker que instaló la primera vez.

`recetas.fassil.lat.conf` fija además `client_max_body_size 2m`, igualando el `bodyLimit: 2_000_000` del API (`services/api/src/app.ts`). El defecto de nginx es 1 MB: sin esa línea, una receta con payload cifrado grande moriría con un 413 del proxy antes de llegar al API, y el error parecería un fallo de backend.

## Dos hostnames, un solo motivo

`recetas.fassil.lat` sirve la SPA de médico y el API bajo `/api`. `farmacia.fassil.lat` sirve, por separado, la PWA de farmacia.

La razón de tener dos hostnames en vez de uno con dos rutas es el *service worker* de la PWA de farmacia (`apps/pharmacy/public/sw.js`). El alcance (`scope`) de un service worker queda atado al origen que lo sirvió; compartir origen con la SPA de médico habría significado que el service worker de farmacia intercepte también peticiones de navegación de médico, o que ambos compitan por el mismo `caches` del navegador. Un hostname propio le da a la PWA un origen aislado, sin negociar nada con la otra aplicación.

## Requisitos de DNS

| Registro | Tipo | Apunta a |
|---|---|---|
| `recetas.fassil.lat` | A | `203.161.56.37` |
| `farmacia.fassil.lat` | A | `203.161.56.37` |

**Ambos registros ya existen y ya resuelven a esa IP.** Es requisito previo de certbot: el desafío HTTP-01 sirve un fichero bajo `/.well-known/acme-challenge/` en el puerto 80 del hostname, así que sin DNS resuelto y sin el vhost de puerto 80 instalado, la emisión falla.

## Pipeline de CI/CD

`.github/workflows/deploy.yml`, disparado en cada push a `main` y en cada pull request contra `main`.

| Job | Cuándo corre | Qué hace |
|---|---|---|
| `test` | Push y PR | `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test` |
| `build-api` | Solo push a `main`, tras `test` | Resuelve el namespace de GHCR, construye y publica `recetas-api:latest` y `recetas-api:sha-<sha>` |
| `build-doctor` | Solo push a `main`, tras `test` | Igual que arriba, más los `VITE_*` como build args |
| `build-pharmacy` | Solo push a `main`, tras `test` | Igual que `build-doctor` |
| `deploy` | Solo push a `main`, tras los tres builds | Conecta por SSH al servidor y despliega |

Los tres jobs de construcción usan `docker/setup-buildx-action@v3` antes de `docker/build-push-action@v6`: sin Buildx, la caché `type=gha` que usan ambos (`cache-from`/`cache-to`, con un `scope` por imagen) no tiene dónde apoyarse y el build falla. El job `deploy` está serializado (`concurrency: production-deploy, cancel-in-progress: false`) para que dos pushes seguidos a `main` no interfieran entre sí — el segundo espera a que el primero termine.

> El servidor nunca construye imágenes. Solo hace `docker compose pull` de lo que CI ya publicó en GHCR.

### Secretos y variables que hay que crear en GitHub

| Nombre | Tipo | Dónde se crea | Para qué |
|---|---|---|---|
| `VPS_HOST` | Secret | Settings → Secrets and variables → Actions | IP o hostname del servidor (`203.161.56.37`), para `appleboy/ssh-action` |
| `VPS_USER` | Secret | Igual | Usuario SSH (`deploy`) |
| `VPS_SSH_KEY` | Secret | Igual | Clave privada SSH con acceso al servidor como `deploy` |
| `VITE_API_URL` | Variable | Settings → Secrets and variables → Actions → Variables | Base URL del API que consume el navegador |
| `VITE_RPC_URL` | Variable | Igual | Endpoint RPC de Avalanche Fuji |
| `VITE_CHAIN_ID` | Variable | Igual | `43113` |
| `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Variable | Igual | Dirección del contrato desplegado |

No hay ningún secreto para GHCR en esa lista, y no hace falta crearlo: el namespace se deriva del propio repositorio en tiempo de ejecución (`github.repository_owner`), así que un fork o un cambio de dueño publica donde corresponde sin editar el workflow.

`secrets.GITHUB_TOKEN` es automático (no se crea a mano): sirve tanto para autenticar contra GHCR en los jobs de build como, reenviado a la sesión SSH como `GHCR_TOKEN`, para que el servidor haga `docker login ghcr.io` sin guardar una credencial propia.

## Puesta en marcha inicial en el servidor

Una sola vez, antes del primer despliegue automático. El orden importa: el swap va primero, los vhosts antes que certbot, y certbot antes de que ningún navegador toque el sitio.

> **Qué puede hacer el pipeline y qué no.** El usuario SSH es `deploy`, está en el grupo `docker` y por eso maneja contenedores sin `sudo` — eso es lo que el job `deploy` automatiza. Pero **`sudo` en esta máquina pide contraseña**, así que todo lo que toque `/etc/nginx`, `nginx -t`, `systemctl reload nginx`, `certbot` o el swap es **acción humana, interactiva y obligatoria**. No hay forma de meter esos pasos en el workflow, y no se debe intentar.

### Paso 0 — swap. Obligatorio, y va antes que nada

Léase antes la sección "Restricción de capacidad": hoy el servidor **no tiene swap** y la memoria libre es escasa. Sin swap, el primer pico de memoria de este proyecto puede hacer que el OOM killer mate un contenedor de otro negocio en producción.

```bash
# Como humano, con sudo (pide contraseña)
sudo swapon --show          # hoy no imprime nada: no hay swap
free -h

sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Persistente entre reinicios
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Un servidor de contenedores no quiere paginar a la primera: el swap está de
# red de seguridad frente al OOM killer, no como memoria barata.
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -w vm.swappiness=10

sudo swapon --show          # ahora sí debe listar /swapfile
free -h
```

### Paso 1 — directorio de despliegue y `.env`

**No se usa `/opt`.** `/opt` pertenece a root y `deploy` no puede escribir ahí; la convención de esta máquina es `/home/deploy/apps/<nombre>` (por ejemplo `admingym` vive en `/home/deploy/apps/admingym`). Este proyecto va en `/home/deploy/apps/recetas`, que es exactamente la ruta a la que hace `cd` el job `deploy` de `.github/workflows/deploy.yml`.

```bash
# Como deploy, sin sudo: está en su propio home
mkdir -p /home/deploy/apps/recetas
cd /home/deploy/apps/recetas

git clone <url-del-repositorio> .

cp env.production.example .env
chmod 600 .env
# Completar cada CHANGE_ME de .env — ver la sección "Variables de entorno".
# Y confirmar que GHCR_OWNER es el dueño del repositorio en GitHub: sin esa
# variable, `docker compose pull` aborta antes de contactar al registro.
```

### Paso 2 — confirmar que los tres puertos siguen libres

```bash
ss -tlnp | grep -E ':(3100|8181|8182)\b' || echo "3100, 8181 y 8182 libres"
```

Los tres estaban libres en la comprobación previa, pero esta máquina gana servicios con el tiempo. Si alguno aparece ocupado, se cambia el número en `docker-compose.prod.yml` **y** en el `proxy_pass` del vhost correspondiente: son el mismo dato escrito en dos sitios.

### Paso 3 — instalar los dos vhosts en el nginx del host (humano, con `sudo`)

Los ficheros vienen del repositorio ya clonado, en su forma **pre-certbot** (solo `listen 80`).

```bash
cd /home/deploy/apps/recetas

sudo cp docker/nginx/recetas.fassil.lat.conf  /etc/nginx/sites-available/recetas.fassil.lat.conf
sudo cp docker/nginx/farmacia.fassil.lat.conf /etc/nginx/sites-available/farmacia.fassil.lat.conf

sudo ln -s /etc/nginx/sites-available/recetas.fassil.lat.conf  /etc/nginx/sites-enabled/recetas.fassil.lat.conf
sudo ln -s /etc/nginx/sites-available/farmacia.fassil.lat.conf /etc/nginx/sites-enabled/farmacia.fassil.lat.conf

# Valida TODA la configuración de nginx, no solo estos dos ficheros.
sudo nginx -t
```

> **`nginx -t` es el freno de emergencia y no es opcional.** nginx carga `sites-enabled/` entero; una llave sin cerrar en uno de estos dos ficheros invalida la configuración completa, y el siguiente `reload` —el nuestro o el de cualquier otro— tumbaría los diez vhosts que ya sirven negocios en producción. Si `nginx -t` falla, se arregla o se borran los symlinks. No se recarga nunca con `nginx -t` en rojo.

```bash
# Solo si `nginx -t` dijo "syntax is ok" y "test is successful".
# reload, no restart: reload recarga sin cortar conexiones en curso.
sudo systemctl reload nginx
```

### Paso 4 — certificados con certbot (humano, con `sudo`)

certbot 2.9.0 ya está instalado. El plugin `--nginx` lee el `server_name` de los vhosts recién instalados, resuelve el desafío HTTP-01 por el puerto 80, y **reescribe esos mismos ficheros**: añade el bloque `listen 443 ssl` con las rutas de los certificados emitidos y convierte el bloque de puerto 80 en un 301 a https. Por eso los vhosts del repositorio no llevan rutas de certificado escritas a mano: una ruta que todavía no existe hace fallar `nginx -t`.

```bash
sudo certbot --nginx -d recetas.fassil.lat --redirect
sudo certbot --nginx -d farmacia.fassil.lat --redirect
```

Un certificado por hostname, no uno combinado: así la renovación o la revocación de uno no arrastra al otro. (`sudo certbot --nginx -d recetas.fassil.lat -d farmacia.fassil.lat --redirect` emitiría uno solo para ambos; funciona, pero acopla los dos sitios.)

Después de certbot, comprobar que no rompió nada y que la renovación automática está sana:

```bash
sudo nginx -t
sudo certbot renew --dry-run
curl -I https://recetas.fassil.lat
curl -I https://farmacia.fassil.lat
curl -I https://fassil.lat      # el sitio que YA estaba: debe seguir en 200
```

### Paso 5 — primer despliegue

A partir de aquí el pipeline se encarga: un push a `main` dispara `deploy`, que entra por SSH como `deploy`, hace `cd /home/deploy/apps/recetas`, `git pull`, `docker compose pull`, la migración de drizzle y `up -d`. Para levantarlo a mano la primera vez, desde ese directorio:

```bash
cd /home/deploy/apps/recetas
docker compose -f docker-compose.prod.yml pull api doctor pharmacy
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @recetas/api db:migrate
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

Y el mismo smoke test que corre el pipeline:

```bash
docker compose -f docker-compose.prod.yml exec -T api wget -q -O - http://127.0.0.1:3000/health
curl -s https://recetas.fassil.lat/api/health
```

Esas dos comprobaciones no son la misma. La primera dice que el proceso arrancó; la segunda dice que además el vhost, el TLS y —sobre todo— la barra final del `proxy_pass` están bien. Un `/api/health` que devuelve 404 con el contenedor sano es exactamente el síntoma de esa barra perdida.

## Restricción de capacidad

> **Esta máquina no es nuestra. Corre más de veinte contenedores de producción de varios negocios reales, y no tiene swap.** Medido en el servidor: **5,8 GiB de RAM total, ~3,4 GiB en uso, ~2,4 GiB disponibles y `swapon --show` vacío.** Ahí conviven `pos_app`/`pos_db`, `adminvoz-store` (app, queue, scheduler, nginx, MariaDB, Redis), `admingym` (app, queue, scheduler, reverb, nginx, MySQL, Redis), `restaurante` (app, nginx, MySQL) y `crm360` (app + MSSQL). Los consumos mayores hoy: `crm360-db` 970 MiB, `admingym-db` 438 MiB, `restaurante_mysql` 400 MiB, `crm360-app` 193 MiB.
>
> Este proyecto pide un techo de **704 MB** sobre esos ~2,4 GiB libres. Sin swap, un pico de memoria no pagina: invoca directamente al **OOM killer**, que elige víctima por su propia heurística y **puede matar un contenedor de cualquiera de las otras aplicaciones** — la base de datos de un CRM en uso, el MySQL de un restaurante, el backend de un gimnasio. No son sistemas de este proyecto y no hay nada en este repositorio que los proteja. **Crear swap (Paso 0) es requisito previo al primer despliegue, no una recomendación.**

| Servicio | Límite de memoria |
|---|---|
| `db` (Postgres) | 256 MB |
| `api` | 320 MB |
| `doctor` (nginx) | 64 MB |
| `pharmacy` (nginx) | 64 MB |
| **Total `recetas`** | **704 MB** |

`mem_limit` es un techo, no una reserva: el contenedor puede usar menos, nunca más. El consumo real en reposo será bastante inferior a 704 MB, pero el techo es lo que hay que poder absorber en el peor momento. No hay límite de CPU (`cpus`) en ningún servicio: nada de esto es CPU-bound y un límite mal puesto solo añade throttling.

`VERIFICAR:` el margen real tras el despliegue. Las cifras de arriba son una foto del servidor **antes** de meter nada nuestro; no se ha medido el consumo de este stack corriendo junto a los demás. Después del primer despliegue hay que volver a mirar y decidir si los `mem_limit` están bien calibrados:

```bash
free -h
swapon --show
docker stats --no-stream
```

El disco no es un problema: 118 GB totales, 45 GB usados, 68 GB libres.

## Variables de entorno

| Variable | Tipo | Vive en |
|---|---|---|
| `POSTGRES_PASSWORD` | Secreto | `.env` en el servidor |
| `PRESCRIPTION_REGISTRY_ADDRESS`, `EAS_ADDRESS`, `PRACTITIONER_SCHEMA_UID`, `PHARMACY_SCHEMA_UID`, `ISSUER_AUTHORITY` | Secreto (específicos del despliegue) | `.env` en el servidor |
| `POSTGRES_DB`, `POSTGRES_USER`, `API_HOST`, `API_PORT`, `NODE_ENV`, `LOG_LEVEL`, `CHAIN_ID`, `RPC_URL` | Configuración | `.env` en el servidor |
| `GHCR_OWNER` | Configuración | `.env` en el servidor |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | Secreto | GitHub Actions Secrets |
| `VITE_API_URL`, `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Configuración de build | GitHub Actions Variables |

> Los `VITE_*` son el caso particular de este proyecto frente a `sigdoc`: no se leen en tiempo de ejecución ni viven en el `.env` del servidor. Vite los incrusta en el JavaScript construido durante `docker build`, en CI (ver `docker/Dockerfile.doctor.prod` y `docker/Dockerfile.pharmacy.prod`). Cambiar uno significa reconstruir y redesplegar la imagen, nunca editar un contenedor en marcha.

> `GHCR_OWNER` es la única variable de `.env` que `docker-compose.prod.yml` exige sin valor por defecto. Un servidor que ya estuviera desplegado antes de que las imágenes dejaran de tener el namespace fijo tiene que agregarla a su `.env` **antes** del próximo despliegue; si falta, `docker compose pull` falla de inmediato nombrando la variable y los contenedores en marcha siguen intactos.

`env.production.example`, en la raíz del repositorio, documenta cada variable de `.env` con su placeholder `CHANGE_ME`.

## Rollback

Cada build de CI publica dos etiquetas por imagen: `latest` y `sha-<sha del commit>`. `docker-compose.prod.yml` resuelve la etiqueta a correr desde `${RECETAS_IMAGE_TAG:-latest}`, así que volver a un commit anterior es fijar esa variable y recrear los contenedores:

```bash
cd /home/deploy/apps/recetas
export RECETAS_IMAGE_TAG="sha-<sha-del-commit-anterior>"
docker compose -f docker-compose.prod.yml pull api doctor pharmacy
docker compose -f docker-compose.prod.yml up -d
```

Esto revierte el código, no el esquema: `db:migrate` aplica los ficheros versionados de `services/api/drizzle/` y solo va hacia adelante. Si el commit al que se vuelve es anterior a una migración ya aplicada, revertir el esquema es una decisión manual y deliberada, no un paso automático de este procedimiento.

Un rollback **no toca nada del nginx del host ni de los certificados**: los vhosts apuntan a puertos de loopback, no a una versión concreta de la imagen. Nada de lo que hay en `/etc/nginx` necesita cambiar al volver atrás, y por tanto un rollback no requiere `sudo` ni puede afectar a los otros sitios de la máquina.

## Siguiente paso

El despliegue es el punto de llegada del pipeline descrito en [09](09-roadmap.md) y [16](16-plan-de-ejecucion.md), y ante cualquier cambio de infraestructura este documento es el que se actualiza primero. Lo que queda después no es una fase más, sino el manual de puesta en marcha del puesto de trabajo: [20](20-wallet-y-red-de-pruebas.md) cubre la extensión del navegador, la red que hay que agregar a mano, los AVAX de prueba de la cuenta de despliegue y la acreditación de las cuentas que firman.
