# 20 — Wallet y red de pruebas

Las dos aplicaciones web firman hoy con una extensión de navegador, y desde el «Corte 1» de [21](21-acceso-para-la-demo.md) esa extensión **ya no hay que configurarla a mano**: el código pide `wallet_switchEthereumChain` y, si la extensión responde `4902` porque no conoce la cadena, ofrece `wallet_addEthereumChain` con los parámetros que deriva de la configuración y reintenta el cambio una vez. Agregar la red a mano sigue siendo el camino de respaldo para quien rechace ese diálogo, y es lo que documenta la sección correspondiente. Este documento es el procedimiento operativo completo de ese paso y de los tres que lo acompañan: instalar la extensión, importar o crear una cuenta, conseguir AVAX de prueba en Fuji y acreditar esa cuenta contra EAS. Ninguno es opcional, y saltarse cualquiera produce un error que parece un fallo del sistema y no lo es. Lo que aquí se describe es andamiaje de desarrollo y demo, no la experiencia que [00](00-vision-y-alcance.md) promete al médico del piloto.
/
> **Estado al 12/09/2026.** Procedimiento escrito contra el código de hoy y verificado en él; la parte de Fuji —faucets, saldos, despliegue— no se ha ejercitado todavía de extremo a extremo. Las URL de faucet son las vigentes a esta fecha y cambian sin aviso: cada una lleva su marca `VERIFICAR:`. La ruta local sobre Anvil sí está completa y es la que conviene recorrer primero.

## Qué es una wallet aquí, y por qué la interfaz no la nombra

Cuatro documentos del conjunto —[00](00-vision-y-alcance.md), [01](01-arquitectura.md), [08](08-stack-y-entorno.md) y [13](13-pitch-y-sostenibilidad.md)— afirman que el médico no usa wallet ni extensión de navegador. Eso describe el **modelo objetivo**: una smart account ERC-4337 respaldada por una passkey, con el gas pagado por un paymaster. El código de hoy no hace eso todavía: exige una extensión que inyecte un proveedor EIP-1193, y el propio adaptador lo declara como estado transitorio.

```
// apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts:34-36
TODO (docs/01, D-04, Fase 5): the pilot replaces this with an ERC-4337 smart
account backed by a passkey
```

El mismo `TODO` está en `apps/pharmacy/src/infrastructure/signer/eip1193-signer.adapter.ts:17-19`. La contradicción es real y está declarada aquí para que nadie la descubra en mitad de una demo.

| Dimensión | Modelo objetivo ([01](01-arquitectura.md)) | Código de hoy |
|---|---|---|
| Custodia de la clave | Smart account ERC-4337 + passkey del dispositivo | Extensión de navegador con clave local |
| Quién paga el gas | Paymaster | La propia cuenta, con AVAX de testnet |
| Alta del profesional | Passkey y attestation, sin instalar nada | Instalar extensión, aceptar el diálogo que agrega la red, financiar cuenta |
| Cuándo llega | Fase 5 | — |

> **La interfaz nunca dice «wallet».** La regla **D1** de [17](17-diseno-y-experiencia.md) está codificada: `apps/*/src/**/copy-guard.test.ts` falla si alguna cadena de la interfaz contiene `wallet`, `frase semilla` o `saldo`. El único literal de protocolo permitido es `wallet_switchEthereumChain`, porque es el nombre de un método, no texto para el usuario. La interfaz dice «credencial profesional», «este equipo» (médico), «este dispositivo» (farmacia) y «Cadena».

> **Esa prohibición aplica al código, no a esta carpeta.** `docs/` es documentación interna de equipo y usa el vocabulario técnico preciso. Quien escriba cadenas de interfaz debe seguir D1 al pie de la letra; quien lea este documento puede leer «wallet» sin sobresalto.

### Dónde interviene la extensión, y dónde no

Las lecturas de la cadena van por HTTP público (`VITE_RPC_URL`) y no tocan la extensión. Solo las escrituras pasan por ella.

| Actor | Operación | Firma |
|---|---|---|
| Médico | Firma tipada EIP-712 de la receta | Extensión (`signPrescription`, `eip1193-signer.adapter.ts:141-171`) |
| Médico | Transacción `issue` en el registro | Extensión (`viem-chain.adapter.ts:183-225`) |
| Farmacia | Transacción `dispense` | Extensión (`viem-chain.adapter.ts:133-177`) |
| Cualquiera | Consultar el estado de una receta | RPC público, sin extensión |

El médico firma **dos veces por receta emitida**. No es un error de la aplicación ni un doble clic: son dos operaciones distintas, la firma del documento y la transacción que lo registra.

## Lo que hace falta antes de abrir la app

Cuatro prerrequisitos. Los cuatro, y en este orden.

| # | Prerrequisito | Por qué | Si falta |
|---|---|---|---|
| 1 | Extensión EIP-1193 instalada en el navegador | La aplicación busca `globalThis.window.ethereum` | La aplicación informa que no hay firmante disponible |
| 2 | Red conocida por la extensión | Si no la conoce, el código la ofrece con `wallet_addEthereumChain` tras el `4902` | Solo falla si se rechaza ese diálogo: cadena no configurada |
| 3 | Cuenta con fondos en esa red | Toda escritura paga gas | La transacción falla al estimar el gas |
| 4 | Cuenta con attestation EAS de credencial profesional | Lo exige el contrato y lo comprueba la pantalla de acceso | El botón principal queda deshabilitado |

> **Conectar la cuenta no alcanza.** `AccessScreen` deja deshabilitado por construcción el único control que abre el formulario de receta mientras la cuenta no esté acreditada (`apps/doctor/src/presentation/screens/AccessScreen.tsx:203`). No es un bloqueo cosmético que se pueda esquivar: el contrato aplica la misma comprobación y rechazaría la transacción igualmente, así que forzar la interfaz solo cambia dónde aparece el error.

La CLI de demostración es la excepción a todo lo anterior: firma con claves embebidas y no necesita extensión ninguna. Ver el recorrido completo más abajo.

## Instalar la extensión y crear una cuenta

**La palabra «MetaMask» no aparece en ninguna parte del repositorio.** El código no depende de ninguna extensión concreta: pide un proveedor EIP-1193 inyectado en `window.ethereum` y usa cuatro métodos estándar (`eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain`). Cualquier extensión que implemente ese estándar sirve. MetaMask es la referencia del equipo por ubicuidad, no por acoplamiento. La única dependencia web3 de las SPA es `viem@2.21.54`: no hay wagmi ni WalletConnect.

Pasos, una sola vez por equipo:

1. Instalar la extensión desde la tienda oficial del navegador. No instalarla desde un enlace recibido por mensaje.
2. Crear una cuenta nueva. Anotar la frase de recuperación fuera del equipo y fuera de cualquier archivo del repositorio.
3. Anotar la dirección pública resultante: es la que hay que financiar y acreditar.

> **Regla dura: el desarrollo va en un perfil de navegador separado.** Las cuentas de demostración de la sección siguiente son claves públicas que vienen dentro de toda instalación de Foundry —cualquiera las tiene—. Importarlas en un perfil de navegador que también toque una red real es una fuga de fondos garantizada, no un riesgo teórico. Usar un perfil de navegador dedicado a desarrollo, o una instalación de extensión aparte, y no mezclar jamás los dos mundos.

## Agregar la red a mano

Este paso **ya no es obligatorio**, pero conviene saber hacerlo porque es el respaldo cuando algo sale mal. El adaptador pide `wallet_switchEthereumChain`; si la cadena no está registrada, el proveedor devuelve el código **4902** (`UNRECOGNISED_CHAIN`) y el código responde ofreciendo `wallet_addEthereumChain`. Solo si ese diálogo se rechaza, o si la propia alta falla, la aplicación lanza este mensaje:

```
El dispositivo no tiene configurada la cadena ${chainId}, que es donde está
registrado el sistema de recetas.
```

(doctor: `eip1193-signer.adapter.ts:131-136`; farmacia: `:110-116`.)

> **La aplicación sí ofrece agregar la red, pero nunca la agrega a tus espaldas.** Agregar una cadena reescribe la configuración del navegador, así que la decisión queda siempre en el diálogo que muestra la extensión: el código propone los parámetros y el usuario acepta o rechaza. Si rechaza, se le dice que la cadena no está configurada en vez de insistir. El código vive en `apps/doctor/src/infrastructure/signer/eip1193-signer.adapter.ts` (`addChainThenRetrySwitch`) y en su gemelo de farmacia; los parámetros salen de `packages/chain/src/viem-chain.ts` (`addEthereumChainParams`, EIP-3085).

### Anvil local (31337)

La cadena de desarrollo. Corre en `docker-compose.yml` como servicio `anvil` (`ghcr.io/foundry-rs/foundry:latest`, con `--host 0.0.0.0 --port 8545 --chain-id ${ANVIL_CHAIN_ID:-31337} --block-time ${ANVIL_BLOCK_TIME:-2}`). No existe en `docker-compose.prod.yml`: no hay ninguna ruta de despliegue que apunte aquí.

| Campo de la extensión | Valor |
|---|---|
| Nombre de la red | `Anvil` |
| URL del RPC | `http://localhost:8545` |
| Identificador de cadena | `31337` |
| Símbolo de la moneda | `ETH` |
| Explorador de bloques | — (no hay) |

El nombre y la moneda salen de `packages/chain/src/viem-chain.ts`, que construye la cadena desde la configuración: `nativeCurrencyOf` devuelve `AVAX` para 43113 y `ETH` para todo lo demás, y el nombre es `Anvil` para 31337 o `Cadena <id>` en cualquier otro caso. Ese archivo no define `blockExplorers`, así que la extensión tampoco tiene explorador que ofrecer.

### Avalanche Fuji (43113)

La red de producción del piloto.

| Campo de la extensión | Valor |
|---|---|
| Nombre de la red | `Cadena 43113` (o `Avalanche Fuji`, el nombre es libre en la extensión) |
| URL del RPC | `https://api.avax-test.network/ext/bc/C/rpc` |
| Identificador de cadena | `43113` |
| Símbolo de la moneda | `AVAX` |
| Explorador de bloques | `https://testnet.snowtrace.io` |

> **El identificador de cadena tiene que coincidir con `VITE_CHAIN_ID`.** Las SPA validan su configuración con zod en `apps/*/src/infrastructure/config/env.ts` y piden cambiar exactamente a ese valor. Desarrollo usa `env.example` (31337); producción, `env.production.example` (43113). Una extensión configurada en 43113 contra una aplicación construida con `VITE_CHAIN_ID=31337` pedirá un cambio de cadena que nunca cuadra.

## Importar las cuentas de demostración en local

Sobre Anvil, el guion de la demo usa cuatro cuentas fijas, declaradas en `apps/cli/src/config.ts:23-48`. Son las claves públicas de desarrollo de Foundry.

| Rol | Etiqueta en la demo | Clave privada |
|---|---|---|
| Médico | Dra. Claudia Mendoza Rojas | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| Farmacia A | Farmacia Bolívar | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| Farmacia B | Farmacia San Jorge | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| Emisor de credenciales | Autoridad del piloto (Anvil #9) | `0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6` |

> **Regla dura: estas claves no son secretas y no pueden tocar una red real.** Vienen dentro de toda instalación de Foundry: las tiene cualquiera que haya instalado la herramienta. Importarlas en un perfil de navegador que también use una red real es una fuga de fondos garantizada; es cuestión de tiempo, no de suerte. Perfil de navegador separado, o instalación de extensión dedicada a desarrollo, y nada más.

El código defiende esa regla por su cuenta: `LOCAL_CHAIN_IDS` (`config.ts:139`) solo admite 31337 y 1337, y `assertLocalChain` (`config.ts:155-165`) lanza un error explícito si alguna de estas claves intenta firmar fuera de esas dos cadenas. La defensa protege a la CLI; a la extensión del navegador no la protege nadie más que quien la configura.

Para importarlas: en la extensión, «importar cuenta» → pegar la clave privada. Con la red Anvil ya agregada y `docker compose up -d` en marcha, las diez cuentas de Anvil arrancan financiadas y no hace falta ningún faucet.

## Conseguir AVAX de prueba en Fuji

En Fuji no hay cuentas prefinanciadas: el AVAX de testnet se pide a un faucet. **Hoy no existe ninguna URL de faucet en el repositorio**; la necesidad está anotada como `SUPUESTO:` en [08](08-stack-y-entorno.md) y como tarea abierta en [18](18-tareas-por-fases.md) (`- [ ] Obtener AVAX de testnet de Fuji en la cuenta de despliegue`). Esa tarea sigue abierta: este documento describe cómo cerrarla, no la cierra.

| Fuente | URL | Requisito |
|---|---|---|
| Core (oficial de Avalanche) | `https://core.app/tools/testnet-faucet/?subnet=c&token=c` | Saldo de AVAX distinto de cero en mainnet para esa misma dirección, o un código de cupón |
| Avalanche Builder Hub | `https://build.avax.network` | Cuenta creada y wallet conectada; entrega tokens de testnet sin cupón |
| QuickNode | `https://faucet.quicknode.com/avalanche/fuji` | Alternativa de terceros |

> `VERIFICAR:` los códigos de cupón del faucet oficial circulan por los canales de la comunidad de Avalanche (foro y Discord) y **caducan**. No fijar ninguno en este documento ni en ningún script: se pide uno vigente en el momento de necesitarlo. Las tres URL de la tabla se verificaron el 12/09/2026 y pueden cambiar sin aviso.

> **Regla dura: son dos cuentas distintas, cada una con su propio AVAX.** La cuenta de despliegue —la que ejecuta `forge script` y paga el despliegue de `SchemaRegistry`, `EAS`, los dos esquemas y el registro— **no es** la cuenta que firma recetas en la demo. Financiar solo una deja la otra inservible en el peor momento. Si además se va a demostrar el flujo de farmacia en Fuji, esa tercera cuenta también necesita fondos.

Cuántas cuentas financiar, según lo que se vaya a hacer:

| Escenario | Cuentas a financiar |
|---|---|
| Solo desplegar contratos en Fuji | 1 — la de despliegue |
| Desplegar y demostrar la emisión | 2 — despliegue y médico |
| Recorrido completo en Fuji | 3 — despliegue, médico y farmacia |

Comprobar el saldo en `https://testnet.snowtrace.io`, pegando la dirección en el buscador; o desde el terminal:

```bash
cast balance <direccion> --rpc-url https://api.avax-test.network/ext/bc/C/rpc
```

Sobre el despliegue, el detalle vive en [19](19-despliegue.md) y no se repite aquí. Lo que importa para esta sección: `contracts/script/Deploy.s.sol` usa `vm.broadcast()` sin argumento, así que la clave la aporta Forge por línea de órdenes (`--private-key`, `--account`, `--interactive` o `--ledger`), y `env.example:68` declara `DEPLOYER_PRIVATE_KEY=` vacío con la nota de que nunca contiene fondos reales ni se commitea. Los alias de RPC están en `contracts/foundry.toml:62-64`: `anvil = "${RPC_URL}"` y `fuji = "${FUJI_RPC_URL}"`.

## Acreditar la cuenta antes de usarla

Una cuenta con fondos y la red bien configurada sigue sin poder emitir nada. El contrato comprueba en cada llamada que quien firma tiene una attestation EAS de credencial profesional vigente, con las cinco condiciones de [04](04-smart-contracts.md); quién emite esas attestations y cómo se revocan está en [02](02-roles-y-permisos.md).

En local, la acreditación de las cuentas de la demo se emite con el script de Forge o con la CLI:

```bash
# Opción A — el script, tras desplegar el registro sobre Anvil
cd contracts
forge script script/SetupCredentials.s.sol --rpc-url anvil --broadcast

# Opción B — la CLI, equivalente para las cuentas de la demo
pnpm --filter '@recetas/cli' exec tsx src/main.ts setup-credentials
```

En Fuji, la autoridad de credenciales tiene que acreditar explícitamente cada dirección nueva: la dirección que crees en tu extensión no está acreditada por defecto y nada la acredita sola.

> **Síntoma de una cuenta sin acreditar: el botón «Escribir una receta» aparece y no se puede pulsar.** No es un fallo de carga ni un problema de red. `AccessScreen.tsx:203` lo deshabilita mientras el estado no sea `accredited`. La misma lógica gobierna la aplicación de farmacia.

## Recorrido completo, de cero a una receta emitida

La ruta local, que es la que conviene recorrer primero porque no depende de ningún faucet ni de ninguna red pública:

```bash
# 1. Infraestructura: Postgres y Anvil. Anvil financia sus diez cuentas al arrancar.
docker compose up -d
pnpm db:push

# 2. Contratos sobre la cadena local. Deploy.s.sol levanta un MockEAS en 31337,
#    porque Anvil no trae Ethereum Attestation Service.
cd contracts
forge script script/Deploy.s.sol --rpc-url anvil --broadcast
forge script script/SetupCredentials.s.sol --rpc-url anvil --broadcast

# 3. Anotar la dirección del registro que imprime Deploy.s.sol y ponerla en
#    VITE_PRESCRIPTION_REGISTRY_ADDRESS del .env, copiado de env.example.

# 4. Aplicaciones en el host: API (3000), médico (5173), farmacia (5174).
pnpm dev
```

Con eso en marcha, la lista de comprobación en el navegador:

1. Extensión instalada, en un perfil dedicado a desarrollo.
2. Red `Anvil` agregada a mano: RPC `http://localhost:8545`, identificador `31337`, moneda `ETH`.
3. Clave del médico importada (Dra. Claudia Mendoza Rojas) y seleccionada como cuenta activa.
4. Abrir `http://localhost:5173` y conectar. La aplicación pide `eth_requestAccounts` y, si hace falta, el cambio de cadena.
5. Comprobar que el botón «Escribir una receta» está habilitado. Si no lo está, falta el paso de acreditación.
6. Emitir una receta. **Aparecen dos peticiones de firma**: la firma tipada EIP-712 y la transacción `issue`.
7. Abrir `http://localhost:5174` con la clave de Farmacia Bolívar activa, escanear el QR y dispensar. Una firma.
8. Escanear el mismo QR por segunda vez: rechazo. Ese rechazo es el argumento del proyecto.

> **La CLI recorre todo esto sin extensión ninguna.** Firma con las claves embebidas de `apps/cli/src/config.ts` y no toca el navegador, así que sirve para validar que la cadena y los contratos están bien antes de pelearse con la configuración de la extensión:
>
> ```bash
> pnpm --filter '@recetas/cli' exec tsx src/main.ts demo
> ```
>
> Solo funciona en 31337 o 1337: `assertLocalChain` aborta en cualquier otra red antes de firmar nada.

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| «El dispositivo no tiene configurada la cadena N…» | Código 4902 y además el alta automática no prosperó: o se rechazó el diálogo de `wallet_addEthereumChain`, o la extensión lo negó | Reintentar aceptando el diálogo, o agregar la red a mano con los parámetros exactos de la sección correspondiente |
| La operación se cancela sin mensaje de error del sistema | Código 4001: el usuario rechazó la firma o el cambio de cadena en la extensión | Repetir la operación y aceptar en la ventana de la extensión |
| El botón «Escribir una receta» está deshabilitado | La cuenta conectada no tiene attestation EAS de credencial profesional | Acreditarla con `SetupCredentials.s.sol` o `setup-credentials`; en Fuji, pedírselo a la autoridad de credenciales |
| La aplicación insiste en cambiar de cadena y nunca queda conforme | `VITE_CHAIN_ID` de la construcción no coincide con la red que se agregó en la extensión | Alinear ambos valores: 31337 en desarrollo, 43113 en Fuji |
| La aplicación dice que no hay firmante disponible | No hay extensión instalada, o el perfil activo no la tiene | Instalar la extensión, o cambiar al perfil de navegador de desarrollo |
| El faucet oficial rechaza la solicitud | Core exige saldo de AVAX distinto de cero en mainnet para esa dirección, o un cupón vigente | Usar el Builder Hub o QuickNode, o conseguir un cupón vigente en los canales de la comunidad |
| La transacción falla al estimar el gas | La cuenta no tiene AVAX de testnet | Financiarla en un faucet y comprobar el saldo en el explorador |
| Cambiar un `VITE_*` no surte efecto | Vite los incrusta en el JavaScript durante `docker build`, no se leen en tiempo de ejecución | Reconstruir y redesplegar la imagen ([19](19-despliegue.md)); en desarrollo, reiniciar `pnpm dev` |
| La CLI aborta hablando de «una clave de demostración» | `assertLocalChain`: se apuntó `CHAIN_ID` a una red que no es 31337 ni 1337 | Es la defensa funcionando. Volver a la cadena local, o configurar una cuenta propia para la red pública |
| Anvil responde, pero el registro parece vacío tras reiniciar | Anvil no persiste estado entre arranques | Volver a ejecutar `Deploy.s.sol` y `SetupCredentials.s.sol`, y actualizar la dirección del registro |

## Siguiente paso

Recorrer la ruta local completa de la sección anterior antes de tocar Fuji: es gratis, no depende de ningún faucet y deja claro dónde falla la configuración. Cuando toque la red pública, el procedimiento de despliegue está en [19](19-despliegue.md) y la tarea de financiar la cuenta sigue abierta en [18](18-tareas-por-fases.md).
