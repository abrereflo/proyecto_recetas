# 22 — Preflight del primer despliegue

El procedimiento de servidor está en [19](19-despliegue.md), el de wallet y AVAX de prueba en [20](20-wallet-y-red-de-pruebas.md), y el acceso de médico y farmacéutico en [21](21-acceso-para-la-demo.md). Nada de eso se repite aquí.

Este documento es un acta: **qué se comprobó del entorno el 13 de septiembre de 2026**, para que quien ejecute el primer despliegue no vuelva a verificarlo, y qué quedó sin poder comprobarse.

## Comprobado, no hace falta repetirlo

| Comprobación | Resultado |
|---|---|
| DNS de los dos hostnames | `recetas.devrafaseros.com` y `farmacia.devrafaseros.com` resuelven a `192.241.246.175`, que es exactamente lo que exigen las reglas `Host()` de `docker-compose.prod.yml` |
| Acceso SSH al droplet | Funciona como `devrafaseros`: `ubuntu-s-1vcpu-2gb-70gb-intel-nyc2`, Linux 6.8.0-134 |
| Red `traefik-public` | Existe; el contenedor `traefik` lleva dos meses en marcha |
| **Swap** | **2 GB configurados**, 248 MB en uso. Era el requisito que [19](19-despliegue.md#restricción-de-capacidad) dejaba abierto antes del primer despliegue |
| Memoria disponible | 1,1 GB libres con la aplicación vecina corriendo. Los topes de este proyecto suman 704 MB, así que entra, con el swap como margen |
| Disco | 58 GB libres de 67 GB |
| Pipeline de CI sobre `main` | `Test`, `Contracts` y `Build & Push API Image` pasan |

> **El pipeline funciona y el droplet está preparado.** Lo que falta no es infraestructura: es el contrato y la configuración que depende de su dirección.

## Lo que falta, y en qué orden

Los builds de las dos aplicaciones web y el job de despliegue quedan saltados en cada push porque el guard `Check VITE_*` falla. Y una de esas cuatro variables es la dirección del contrato, así que el orden no es negociable.

1. **Desplegar en Fuji.** Los tres scripts, en el orden y con las variables de [19](19-despliegue.md#qué-se-despliega-y-qué-no). El AVAX de prueba y la acreditación de la cuenta están en [20](20-wallet-y-red-de-pruebas.md#conseguir-avax-de-prueba-en-fuji).
2. **Bootstrap del droplet.** `/opt/docker/apps/` hoy contiene solo la aplicación vecina; falta crear `recetas`, clonar y colocar el `.env` a 600, con el bloque de [19](19-despliegue.md#puesta-en-marcha-inicial-en-el-droplet). La comprobación de `traefik-public` que ese bloque incluye ya está hecha y va a pasar.
3. **Cargar secretos y variables en GitHub**, según la tabla de [19](19-despliegue.md#secretos-y-variables-que-hay-que-crear-en-github). Para este despliegue, los cuatro valores son:

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://recetas.devrafaseros.com/api` |
| `VITE_RPC_URL` | `https://api.avax-test.network/ext/bc/C/rpc` |
| `VITE_CHAIN_ID` | `43113` |
| `VITE_PRESCRIPTION_REGISTRY_ADDRESS` | La dirección que imprime el paso 1 |

4. **Empujar a `main`.** No hay paso manual adicional: el push dispara los tres builds y el despliegue por SSH.

> El guard `Check VITE_*` detecta que una variable esté vacía, no que esté equivocada. Una mal cargada produce un build verde, un despliegue verde y dos aplicaciones apuntando a `localhost` en producción.

## Lo que no se pudo comprobar

**Si existen los secretos `VPS_HOST`, `VPS_USER` y `VPS_SSH_KEY`.** La cuenta con la que se revisó es colaboradora sin permiso de administración, y `gh secret list` devuelve vacío tanto si no están cargados como si no se pueden leer: los dos casos son indistinguibles desde afuera. **Confirmarlo en Settings antes de empujar**, porque sin ellos el job de despliegue falla con todo lo demás correcto.

**La verificación de contratos en Routescan.** `contracts/foundry.toml` marca su endpoint como pendiente de comprobación empírica: la API responde, pero nunca se ejercitó un envío de código fuente real. Si `--verify` falla, el despliegue en sí es válido —la verificación solo afecta al explorador— y conviene corregir la URL con lo que se aprenda.

## Siguiente paso

El paso 1. Todo lo demás depende de la dirección que imprime.
