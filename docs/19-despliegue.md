# 19 — Despliegue en producción

El backend y las dos SPA se despliegan como contenedores en un droplet ya existente, detrás de un Traefik que también ya existe. Este documento describe esa topología, el pipeline de CI/CD que la alimenta y las restricciones de capacidad que gobiernan cada decisión de memoria. La sección [08](08-stack-y-entorno.md) cubre el stack de *contratos* (Foundry, `forge script`); este documento cubre el despliegue de la *aplicación* (API, SPA, Postgres), más el procedimiento on-chain del que esa aplicación depende para arrancar: desde la migración a Avalanche Fuji, EAS ya no viene dado por la red y hay que desplegarlo, así que ese paso se documenta aquí abajo antes que la topología de servicios.

> **Estado: no hay despliegue en producción todavía.** Este documento describe el procedimiento tal como quedó preparado (imágenes, compose, pipeline), no un sistema ya verificado en vivo. Antes de la primera ejecución real, revisar la sección "Restricción de capacidad" y confirmar que el swap del droplet está configurado.

## Qué se despliega y qué no

| Se despliega | No se despliega |
|---|---|
| API (Fastify, imagen `recetas-api`) | Anvil — es la cadena de desarrollo local únicamente ([08](08-stack-y-entorno.md)) |
| SPA de médico (imagen `recetas-doctor`) | Un Traefik propio — el droplet ya corre uno, compartido con otra aplicación |
| SPA de farmacia (imagen `recetas-pharmacy`) | Bundler o paymaster propios — pendientes de proveedor ([D-02](01-arquitectura.md)) |
| Postgres (payload cifrado, [D-08](05-almacenamiento-y-cifrado.md)) | Migración de esquema automática hacia atrás — un rollback nunca revierte `drizzle-kit push` |

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

> **`ISSUER_AUTHORITY` es hoy la propia cuenta de despliegue, y eso es deuda aceptada del MVP.** El proyecto solo controla una clave, así que desplegador y autoridad emisora colapsan en la misma dirección. `env.example` describe la separación deseada —una autoridad aparte, un multisig en el piloto— y esa separación sigue siendo el objetivo; simplemente no está en este despliegue. Conviene saberlo antes de tocar nada: `PrescriptionRegistry.issuerAuthority` es `immutable` (`contracts/src/PrescriptionRegistry.sol`, línea 50) y `_readCredential` rechaza cualquier attestation cuyo `attester` no sea exactamente esa dirección, así que un valor equivocado ahí no se corrige con una transacción de administración: se corrige redesplegando el registro entero. En la preparación de este despliegue, el `.env` de la raíz llevaba una `ISSUER_AUTHORITY` con un sufijo `est` pegado al final de una dirección por lo demás válida; la dirección resultante era sintácticamente correcta y de una clave que el proyecto no posee. Desplegar con ella habría dejado el registro sin ninguna cuenta capaz de acreditar a nadie, para siempre.

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

| Servicio | Imagen | Puerto interno | Expuesto por Traefik | Alcance |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | No | Interno — solo `api` lo alcanza |
| `api` | `ghcr.io/$GHCR_OWNER/recetas-api` | 3000 | Sí — `recetas.devrafaseros.com/api` | Público |
| `doctor` | `ghcr.io/$GHCR_OWNER/recetas-doctor` | 80 (nginx) | Sí — `recetas.devrafaseros.com` | Público |
| `pharmacy` | `ghcr.io/$GHCR_OWNER/recetas-pharmacy` | 80 (nginx) | Sí — `farmacia.devrafaseros.com` | Público |

> **El namespace de las imágenes no está fijo en ningún archivo.** `$GHCR_OWNER` es la cuenta de GitHub dueña del repositorio: GHCR registra cada paquete bajo el dueño del repositorio que lo publicó, y el `GITHUB_TOKEN` de los jobs de CI solo puede escribir dentro de ese namespace. Publicar bajo otro termina en `denied: permission_denied: The requested installation does not exist`, después de construir la imagen entera. En CI el valor sale de `github.repository_owner` (pasado a minúsculas, que es lo único que GHCR acepta); en el droplet sale de `GHCR_OWNER` en el `.env`. Hoy vale `abrereflo`.

`db` no publica ningún puerto al host y no está en la red `traefik-public`: es inalcanzable desde fuera del droplet y desde cualquier otra aplicación que corra en él.

> **Detalle de enrutamiento del API.** La regla de Traefik para `api` es `Host(recetas.devrafaseros.com) && PathPrefix(/api)`. La aplicación en sí registra sus rutas en la raíz (`/health`, `/prescriptions`, sin el prefijo `/api`; ver `services/api/src/routes/`), así que el router lleva además un middleware `stripprefix` que quita `/api` antes de reenviar la petición al contenedor (`docker-compose.prod.yml`). Sin ese middleware, toda petición del navegador recibiría 404.

## Dos hostnames, un solo motivo

`recetas.devrafaseros.com` sirve la SPA de médico y el API bajo `/api`. `farmacia.devrafaseros.com` sirve, por separado, la PWA de farmacia.

La razón de tener dos hostnames en vez de uno con dos rutas es el *service worker* de la PWA de farmacia (`apps/pharmacy/public/sw.js`). El alcance (`scope`) de un service worker queda atado al origen que lo sirvió; compartir origen con la SPA de médico habría significado que el service worker de farmacia intercepte también peticiones de navegación de médico, o que ambos compitan por el mismo `caches` del navegador. Un hostname propio le da a la PWA un origen aislado, sin negociar nada con la otra aplicación.

## Requisitos de DNS

| Registro | Tipo | Apunta a |
|---|---|---|
| `recetas.devrafaseros.com` | A | IP del droplet |
| `farmacia.devrafaseros.com` | A | IP del droplet |

Traefik obtiene los certificados TLS de ambos hostnames mediante el resolver ACME `letsencrypt` (HTTP-01, ya configurado en el droplet). Ambos registros deben resolver antes del primer despliegue o la emisión del certificado falla.

## Pipeline de CI/CD

`.github/workflows/deploy.yml`, disparado en cada push a `main` y en cada pull request contra `main`.

| Job | Cuándo corre | Qué hace |
|---|---|---|
| `test` | Push y PR | `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test` |
| `build-api` | Solo push a `main`, tras `test` | Resuelve el namespace de GHCR, construye y publica `recetas-api:latest` y `recetas-api:sha-<sha>` |
| `build-doctor` | Solo push a `main`, tras `test` | Igual que arriba, más los `VITE_*` como build args |
| `build-pharmacy` | Solo push a `main`, tras `test` | Igual que `build-doctor` |
| `deploy` | Solo push a `main`, tras los tres builds | Conecta por SSH al droplet y despliega |

Los tres jobs de construcción usan `docker/setup-buildx-action@v3` antes de `docker/build-push-action@v6`: sin Buildx, la caché `type=gha` que usan ambos (`cache-from`/`cache-to`, con un `scope` por imagen) no tiene dónde apoyarse y el build falla. El job `deploy` está serializado (`concurrency: production-deploy, cancel-in-progress: false`) para que dos pushes seguidos a `main` no interfieran entre sí — el segundo espera a que el primero termine.

> El droplet nunca construye imágenes. Solo hace `docker compose pull` de lo que CI ya publicó en GHCR.

### Secretos y variables que hay que crear en GitHub

| Nombre | Tipo | Dónde se crea | Para qué |
|---|---|---|---|
| `VPS_HOST` | Secret | Settings → Secrets and variables → Actions | IP o hostname del droplet, para `appleboy/ssh-action` |
| `VPS_USER` | Secret | Igual | Usuario SSH (`devrafaseros`) |
| `VPS_SSH_KEY` | Secret | Igual | Clave privada SSH con acceso al droplet |
| `VITE_API_URL` | Variable | Settings → Secrets and variables → Actions → Variables | Base URL del API que consume el navegador |
| `VITE_RPC_URL` | Variable | Igual | Endpoint RPC de Avalanche Fuji |
| `VITE_CHAIN_ID` | Variable | Igual | `43113` |
| `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Variable | Igual | Dirección del contrato desplegado |

No hay ningún secreto para GHCR en esa lista, y no hace falta crearlo: el namespace se deriva del propio repositorio en tiempo de ejecución (`github.repository_owner`), así que un fork o un cambio de dueño publica donde corresponde sin editar el workflow.

`secrets.GITHUB_TOKEN` es automático (no se crea a mano): sirve tanto para autenticar contra GHCR en los jobs de build como, reenviado a la sesión SSH como `GHCR_TOKEN`, para que el droplet haga `docker login ghcr.io` sin guardar una credencial propia.

## Puesta en marcha inicial en el droplet

Una sola vez, antes del primer despliegue automático:

```bash
sudo mkdir -p /opt/docker/apps/recetas
sudo chown devrafaseros:devrafaseros /opt/docker/apps/recetas
cd /opt/docker/apps/recetas

git clone <url-del-repositorio> .

cp env.production.example .env
chmod 600 .env
# Completar cada CHANGE_ME de .env — ver la sección "Variables de entorno".
# Y confirmar que GHCR_OWNER es el dueño del repositorio en GitHub: sin esa
# variable, `docker compose pull` aborta antes de contactar al registro.

docker network inspect traefik-public >/dev/null 2>&1 \
  && echo "traefik-public existe" \
  || echo "FALTA: crear/levantar el Traefik del droplet primero"
```

`docker-compose.prod.yml` depende de la red externa `traefik-public`; si no existe, `docker compose up` falla al primer intento con un error de red no encontrada.

## Restricción de capacidad

> **El droplet tiene 1 vCPU y 2 GB de RAM, y ya corre otra aplicación completa** (Postgres, MinIO, Gotenberg, API y nginx de `sigdoc`, más el propio Traefik). La memoria es el recurso que se agota primero en esta máquina, no la CPU. Por eso cada servicio de `recetas` lleva un límite explícito de memoria (`mem_limit`), y por eso conviene verificar que el droplet tenga swap configurado **antes** del primer despliegue: un pico de memoria sin swap termina en el OOM killer eligiendo qué contenedor matar, de cualquiera de las dos aplicaciones.

| Servicio | Límite de memoria |
|---|---|
| `db` (Postgres) | 256 MB |
| `api` | 320 MB |
| `doctor` (nginx) | 64 MB |
| `pharmacy` (nginx) | 64 MB |
| **Total `recetas`** | **704 MB** |

`mem_limit` es un techo, no una reserva: el contenedor puede usar menos, nunca más. No hay límite de CPU (`cpus`) en ningún servicio — con un solo vCPU, ese límite o no hace nada (a 1.0) o Docker lo rechaza (por encima de 1.0).

```bash
# Verificar que hay swap configurado, antes del primer despliegue
swapon --show
free -h
```

## Variables de entorno

| Variable | Tipo | Vive en |
|---|---|---|
| `POSTGRES_PASSWORD` | Secreto | `.env` en el droplet |
| `PRESCRIPTION_REGISTRY_ADDRESS`, `EAS_ADDRESS`, `PRACTITIONER_SCHEMA_UID`, `PHARMACY_SCHEMA_UID`, `ISSUER_AUTHORITY` | Secreto (específicos del despliegue) | `.env` en el droplet |
| `POSTGRES_DB`, `POSTGRES_USER`, `API_HOST`, `API_PORT`, `NODE_ENV`, `LOG_LEVEL`, `CHAIN_ID`, `RPC_URL` | Configuración | `.env` en el droplet |
| `GHCR_OWNER` | Configuración | `.env` en el droplet |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | Secreto | GitHub Actions Secrets |
| `VITE_API_URL`, `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Configuración de build | GitHub Actions Variables |

> Los `VITE_*` son el caso particular de este proyecto frente a `sigdoc`: no se leen en tiempo de ejecución ni viven en el `.env` del droplet. Vite los incrusta en el JavaScript construido durante `docker build`, en CI (ver `docker/Dockerfile.doctor.prod` y `docker/Dockerfile.pharmacy.prod`). Cambiar uno significa reconstruir y redesplegar la imagen, nunca editar un contenedor en marcha.

> `GHCR_OWNER` es la única variable de `.env` que `docker-compose.prod.yml` exige sin valor por defecto. Un droplet que ya estuviera desplegado antes de que las imágenes dejaran de tener el namespace fijo tiene que agregarla a su `.env` **antes** del próximo despliegue; si falta, `docker compose pull` falla de inmediato nombrando la variable y los contenedores en marcha siguen intactos.

`env.production.example`, en la raíz del repositorio, documenta cada variable de `.env` con su placeholder `CHANGE_ME`.

## Rollback

Cada build de CI publica dos etiquetas por imagen: `latest` y `sha-<sha del commit>`. `docker-compose.prod.yml` resuelve la etiqueta a correr desde `${RECETAS_IMAGE_TAG:-latest}`, así que volver a un commit anterior es fijar esa variable y recrear los contenedores:

```bash
cd /opt/docker/apps/recetas
export RECETAS_IMAGE_TAG="sha-<sha-del-commit-anterior>"
docker compose -f docker-compose.prod.yml pull api doctor pharmacy
docker compose -f docker-compose.prod.yml up -d
```

Esto revierte el código, no el esquema: `drizzle-kit push` solo aplica hacia adelante. Si el commit al que se vuelve es anterior a una migración ya aplicada, revertir el esquema es una decisión manual y deliberada, no un paso automático de este procedimiento.

## Siguiente paso

El despliegue es el punto de llegada del pipeline descrito en [09](09-roadmap.md) y [16](16-plan-de-ejecucion.md), y ante cualquier cambio de infraestructura este documento es el que se actualiza primero. Lo que queda después no es una fase más, sino el manual de puesta en marcha del puesto de trabajo: [20](20-wallet-y-red-de-pruebas.md) cubre la extensión del navegador, la red que hay que agregar a mano, los AVAX de prueba de la cuenta de despliegue y la acreditación de las cuentas que firman.
