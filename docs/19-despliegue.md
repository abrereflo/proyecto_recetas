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

```bash
# 1. EAS propio. Imprime SchemaRegistry y EAS; se niega a correr en chainId 31337,
#    donde la demo local ya usa MockEAS.
forge script script/DeployEAS.s.sol --rpc-url fuji --broadcast

# 2. Los dos esquemas de credencial. Imprime sus uids. Es idempotente: si ya
#    estaban registrados, los informa en vez de abortar.
SCHEMA_REGISTRY_ADDRESS=0x... \
forge script script/RegisterSchemas.s.sol --rpc-url fuji --broadcast

# 3. El registro, con EAS y los dos uids como argumentos de constructor.
EAS_ADDRESS=0x... PRACTITIONER_SCHEMA_UID=0x... PHARMACY_SCHEMA_UID=0x... \
ISSUER_AUTHORITY=0x... \
forge script script/Deploy.s.sol --rpc-url fuji --broadcast --verify
```

> **Los uids de los esquemas no son los de la demo local.** `contracts/script/LocalDemo.sol` usa `keccak256(declaración)` como stand-in sobre Anvil; el `SchemaRegistry` real deriva el uid de `keccak256(abi.encodePacked(schema, resolver, revocable))`. Son números distintos. Los únicos válidos en una red pública son los que imprime `RegisterSchemas.s.sol`, y son los que entran en `PRACTITIONER_SCHEMA_UID` y `PHARMACY_SCHEMA_UID`. Poner los locales por error produce un registro cuyas comprobaciones de credencial no pueden pasar nunca.

Tras desplegar, confirmar que `EAS.version()` y `SchemaRegistry.version()` devuelven `1.2.0`, y que `EAS.getSchemaRegistry()` apunta al registro desplegado junto a ella. Es la comprobación barata de que lo desplegado es lo esperado.

### Verificación de contratos en el explorador

El explorador de Fuji es `https://testnet.snowtrace.io`. **Avalanche Fuji es de tier pago en Etherscan V2**, así que la key gratuita de Etherscan no verifica aquí. `contracts/foundry.toml` apunta la verificación a **Routescan**, que expone una API compatible con Etherscan y acepta la cadena literal `verifyContract` como key:

```bash
forge verify-contract <address> <contract> --chain 43113 \
  --verifier-url 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan' \
  --etherscan-api-key verifyContract
```

> `PENDIENTE DE COMPROBACIÓN EMPÍRICA.` Ese endpoint no se ha ejercitado todavía. Confirmarlo en el primer despliegue en Fuji y corregir `contracts/foundry.toml` si difiere. No damos por buena la verificación hasta verla funcionar.

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
