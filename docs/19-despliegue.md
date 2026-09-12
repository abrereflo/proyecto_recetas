# 19 — Despliegue en producción

El backend y las dos SPA se despliegan como contenedores en un droplet ya existente, detrás de un Traefik que también ya existe. Este documento describe esa topología, el pipeline de CI/CD que la alimenta y las restricciones de capacidad que gobiernan cada decisión de memoria. La sección [08](08-stack-y-entorno.md) cubre el despliegue de los *contratos* (Foundry, `forge script`); este documento cubre el despliegue de la *aplicación* (API, SPA, Postgres).

> **Estado: no hay despliegue en producción todavía.** Este documento describe el procedimiento tal como quedó preparado (imágenes, compose, pipeline), no un sistema ya verificado en vivo. Antes de la primera ejecución real, revisar la sección "Restricción de capacidad" y confirmar que el swap del droplet está configurado.

## Qué se despliega y qué no

| Se despliega | No se despliega |
|---|---|
| API (Fastify, imagen `recetas-api`) | Anvil — es la cadena de desarrollo local únicamente ([08](08-stack-y-entorno.md)) |
| SPA de médico (imagen `recetas-doctor`) | Un Traefik propio — el droplet ya corre uno, compartido con otra aplicación |
| SPA de farmacia (imagen `recetas-pharmacy`) | Bundler o paymaster propios — pendientes de proveedor ([D-02](01-arquitectura.md)) |
| Postgres (payload cifrado, [D-08](05-almacenamiento-y-cifrado.md)) | Migración de esquema automática hacia atrás — un rollback nunca revierte `drizzle-kit push` |

La red de producción es **Base Sepolia, chainId 84532**. No existe ninguna ruta de despliegue que apunte a Anvil (chainId 31337): ese valor solo aparece en `docker-compose.yml`, el compose de desarrollo.

## Topología de servicios

| Servicio | Imagen | Puerto interno | Expuesto por Traefik | Alcance |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | No | Interno — solo `api` lo alcanza |
| `api` | `ghcr.io/rafaseros/recetas-api` | 3000 | Sí — `recetas.devrafaseros.com/api` | Público |
| `doctor` | `ghcr.io/rafaseros/recetas-doctor` | 80 (nginx) | Sí — `recetas.devrafaseros.com` | Público |
| `pharmacy` | `ghcr.io/rafaseros/recetas-pharmacy` | 80 (nginx) | Sí — `farmacia.devrafaseros.com` | Público |

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
| `build-api` | Solo push a `main`, tras `test` | Construye y publica `recetas-api:latest` y `recetas-api:sha-<sha>` en GHCR |
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
| `VITE_RPC_URL` | Variable | Igual | Endpoint RPC de Base Sepolia |
| `VITE_CHAIN_ID` | Variable | Igual | `84532` |
| `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Variable | Igual | Dirección del contrato desplegado |

`secrets.GITHUB_TOKEN` es automático (no se crea a mano): sirve tanto para autenticar contra GHCR en los jobs de build como, reenviado a la sesión SSH como `GHCR_TOKEN`, para que el droplet haga `docker login ghcr.io` sin guardar una credencial propia.

## Puesta en marcha inicial en el droplet

Una sola vez, antes del primer despliegue automático:

```bash
sudo mkdir -p /opt/docker/apps/recetas
sudo chown devrafaseros:devrafaseros /opt/docker/apps/recetas
cd /opt/docker/apps/recetas

git clone <url-del-repositorio> .

cp .env.production.example .env
chmod 600 .env
# Completar cada CHANGE_ME de .env — ver la sección "Variables de entorno".

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
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | Secreto | GitHub Actions Secrets |
| `VITE_API_URL`, `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | Configuración de build | GitHub Actions Variables |

> Los `VITE_*` son el caso particular de este proyecto frente a `sigdoc`: no se leen en tiempo de ejecución ni viven en el `.env` del droplet. Vite los incrusta en el JavaScript construido durante `docker build`, en CI (ver `docker/Dockerfile.doctor.prod` y `docker/Dockerfile.pharmacy.prod`). Cambiar uno significa reconstruir y redesplegar la imagen, nunca editar un contenedor en marcha.

`.env.production.example`, en la raíz del repositorio, documenta cada variable de `.env` con su placeholder `CHANGE_ME`.

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

No hay una fase posterior a esta en la documentación: el despliegue es el punto de llegada del pipeline descrito en [09](09-roadmap.md) y [16](16-plan-de-ejecucion.md). Ante cualquier cambio de infraestructura, este documento es el que se actualiza primero.
