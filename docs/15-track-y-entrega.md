# 15 — Track y entrega

**Track seleccionado: `Real-World Ethereum Applications`** (track 6 de EAG Global). `VERIFICAR:` este documento asumía que en Devfolio se elige primero `Bolivia Hackathon` y después ese track; ese flujo no se pudo confirmar y es el objeto de [D-28](#d-28). Este documento justifica la elección, lista lo que exige la entrega y define la estrategia frente a los bounties de patrocinadores.

> **Alerta de entrega — verificación del 11 de septiembre de 2026**
>
> Los datos de plataforma de este documento no se pudieron confirmar, y el sitio oficial del evento apunta a otro lugar.
>
> | Fuente | Qué dice |
> |---|---|
> | `eag-global-buildathon.devfolio.co` (y su página `/prizes`) | Un único track, "$12,500 (Open): EAG Scholarship". No menciona Bolivia, Cochabamba, ShanHaiWoo, Avalanche, Vaquita, Pollar ni Unlock Protocol. Sus fechas de registro publicadas van del 20 de julio al 30 de septiembre de 2026 |
> | `ethereumbolivia.org` (sitio oficial del evento presencial) | Buildathon en Cochabamba desde el 11 de septiembre de 2026, tres días, "200+ Hackers", "**$2,000+ En premios**", inscripción mediante **formularios de Google**, y **ningún enlace a Devfolio** |
>
> Todo indica que son dos programas distintos, y este documento asumió que eran el mismo. Devfolio renderiza su contenido en el navegador, así que podría haber bounties de patrocinadores detrás de elementos interactivos que no fueron alcanzables en esta comprobación: lo que sigue es "no se pudo confirmar", no "no existe". También vale la pena registrar que en ediciones anteriores ETH Bolivia usó TAIKAI, no Devfolio. La acción que se desprende de esto es confirmar el canal de entrega directamente con la organización antes de cualquier otra cosa: registrarse en la plataforma equivocada equivale a no ser evaluado.

## Datos del evento

| Dato | Valor |
|---|---|
| Evento | ETH Bolivia Buildathon 2026 / EAG Global, Cochabamba |
| Fechas | 11 al 13 de septiembre de 2026 |
| Cierre de entrega | `VERIFICAR:` Sábado 13, **8:30** — depende de cuál plataforma sea la real |
| Demos | 10:30 a 14:30 · **5 minutos: 3 de showcase + 2 de preguntas** |
| Anuncio de ganadores | 16:00 |
| Plataforma | `VERIFICAR:` `https://eag-global-buildathon.devfolio.co/` — el sitio oficial del evento registra por formulario de Google, no por este enlace. Ver la alerta de entrega arriba y [D-28](#d-28) |
| Premio principal | `VERIFICAR:` cifras contradictorias — Devfolio anuncia un único track, "$12,500 (Open): EAG Scholarship", **sin mencionar ShanHaiWoo en ningún momento**; el sitio oficial anuncia "**$2,000+ En premios**". No se sabe cuál rige este evento |
| Beca ShanHaiWoo | `VERIFICAR:` el programa existe, pero las fuentes consultadas lo ubican en **Singapur**, no en Shenzhen como afirmaba una versión anterior de esta tabla: alrededor de 2.500 USD de valor total, hasta 800 USD de reembolso de pasaje y 30 días de alojamiento compartido. Tampoco se pudo confirmar que se otorgue en este evento. No mencionar la ciudad en el pitch sin comprobarlo antes |

> **El reloj es el riesgo número uno.** Todo lo demás de esta documentación es preparación; lo único que se evalúa el día 13 es un demo que funcione.

## Por qué el track 6

`Real-World Ethereum Applications` pide, literalmente, aplicaciones Ethereum-nativas para usuarios reales, comunidades y ecosistemas locales, con necesidad de usuario clara, relevancia en el mundo real, foco en regiones emergentes y potencial de seguir vivas después del evento. Es la descripción del proyecto.

| Track | Encaje | Motivo |
|---|---|---|
| **6. Real-World Ethereum Applications** | **Elegido** | Usuarios reales (médicos y farmacias de Cochabamba), región emergente, necesidad verificable, camino de continuidad en [09](09-roadmap.md) y [13](13-pitch-y-sostenibilidad.md) |
| 4. Application Middleware & Open-Source Tooling | Segunda opción | Cubre abstracción de cuenta, UX de smart accounts y abstracción de gas, que sí construimos. Pero el track premia componentes reutilizables y nosotros entregamos una aplicación |
| 2. Local AI, Private AI & User-Owned Data | Descartado | Encajan el cifrado, la divulgación selectiva y las credenciales privadas, pero el track exige un componente de IA que [06](06-validacion-clinica.md) elimina a propósito. Postularse aquí obligaría a relatar como IA lo que es un motor de reglas |
| 1. AI x Ethereum & Agent Economy | Descartado | No hay agentes ni pagos entre agentes |
| 3. Smart Devices & Open Hardware | Descartado | No hay hardware |
| 5. AI-Native Creator Economy | Descartado | Sin relación con el dominio |
| HSK Chain Tracks | Descartado | Sus tracks son AI Agents, AI × Web3, DeFi, Stablecoins, Payment, RWA e infraestructura: ninguno corresponde a un registro de recetas. Exige además desplegar en HSK Chain y participar en su revisión |

### Áreas transversales

La guía declara focos que puntúan **en todos los tracks**. El proyecto toca cuatro y conviene nombrarlos en el pitch con estas mismas palabras.

| Área transversal | Dónde lo cumplimos |
|---|---|
| Privacidad, seguridad y agencia del usuario por diseño | Compromiso con sal, cero identificadores de paciente on-chain, cifrado de sobre, modelo de amenazas con lo no mitigado. Ver [03](03-modelo-de-datos.md), [05](05-almacenamiento-y-cifrado.md), [07](07-seguridad-y-cumplimiento.md) |
| Casos de uso reales en regiones emergentes y subrepresentadas | Todo el proyecto: Cochabamba, marco legal boliviano, doble firma ADSIB. Ver [07](07-seguridad-y-cumplimiento.md) |
| Potencial de crecer más allá del hackathon | Fases, pagadores candidatos y financiación puente. Ver [09](09-roadmap.md) y [13, D-22](13-pitch-y-sostenibilidad.md) |
| Datos propiedad del usuario | El paciente como destinatario de la clave y el consentimiento como condición de acceso. Ver [02](02-roles-y-permisos.md) |

## Qué exige la entrega

Los tres materiales son obligatorios. El estado es el de este documento y debe actualizarse.

| Material | Qué pide | Estado |
|---|---|---|
| **Demo funcional** | **Aplicación web, herramienta CLI, bot o agente.** Los cuatro formatos son aceptables. Tiene que funcionar | **Pendiente.** Es el bloqueante absoluto |
| **Repositorio GitHub** | README con funcionalidades, pasos de instalación, cómo ejecutarlo y **enfoque de integración técnica** | **Pendiente.** El `README.md` de la raíz hoy tiene una descripción y un enlace; le faltan instalación, ejecución e integración |
| **Documentación técnica** | Track elegido, arquitectura central, funcionalidades clave y roadmap de iteración | **Cubierto** por `docs/`, con este documento aportando el track. Enlazar desde el README |

> **Una CLI cuenta como demo funcional, y ese es el plan de contingencia.**
> La guía acepta explícitamente herramientas de línea de comandos. Si las dos aplicaciones web no llegan a estar listas, una CLI que ejecute `issue`, luego `dispense`, y después `dispense` otra vez mostrando el `revert` contra el contrato desplegado **cumple el requisito de entrega**. Es menos vistoso y sigue demostrando exactamente lo mismo. Construir la CLI primero y las interfaces después convierte el entregable en algo que no depende de terminar el frontend.

### Checklist de entrega

- [ ] Canal de inscripción y entrega confirmado con la organización ([D-28](#d-28))
- [ ] Registro en Devfolio hecho antes del envío (condicionado a que D-28 confirme que la entrega es por Devfolio)
- [ ] Seleccionado `Bolivia Hackathon` (condicionado a D-28)
- [ ] Seleccionado el track `Real-World Ethereum Applications` (condicionado a D-28)
- [ ] Contrato desplegado y verificado, con dirección anotada en el README
- [ ] Demo accesible por URL pública o ejecutable con los pasos del README
- [ ] README con funcionalidades, instalación, ejecución e integración técnica
- [ ] `docs/` enlazado desde el README como documentación técnica
- [ ] Demo ensayado en 3 minutos, con las preguntas de [12](12-preguntas-de-jurado.md) listas para los 2 de QA

## Bounties de patrocinadores

Se puede competir en el track principal y en bounties a la vez. El criterio es no poner en riesgo el entregable principal.

| Bounty | Premio declarado | Qué exige | Estado de verificación | Veredicto |
|---|---|---|---|---|
| **Avalanche** | 200 USD | Contrato desplegado **y verificado** en Avalanche, con uso relevante y justificado. Temas incluidos: identidad digital, KYC y trazabilidad | `No se pudo confirmar` para este evento. La edición 2025 (Santa Cruz, sobre TAIKAI) sí tuvo premios de Avalanche, pero con montos y requisitos distintos: 400 USD por uso de ICM-ICTT y 100 USD por un caso de negocio con eERC. Ninguno de los dos corresponde a los 200 USD que este documento asume | **Candidato real solo si se confirma que existe en esta edición.** El requisito de despliegue ya lo cumple el entregable principal: desde la migración, el proyecto corre en Avalanche Fuji. Ver [D-27](#d-27) |
| Vaquita | 100 USDC | Crear cuenta, depositar, publicar video en TikTok o Instagram, referidos. **No requiere programar** | `No se pudo confirmar`. No se encontró ningún patrocinador con ese nombre vinculado al evento; las búsquedas solo devolvieron coincidencias sin relación | **Tomarlo si se confirma.** En ese caso lo hace alguien del equipo en paralelo, sin tocar el código; no dedicarle tiempo antes de verificar que exista |
| Pollar | 200 USDC | Pollar integrado como motor de pagos con transacción real en mainnet | `Empresa confirmada, bounty no confirmado`. Pollar es una fintech boliviana real (`pollar.xyz`), pero se describe a sí misma como motor de pagos **sobre Stellar y Solana**, no EVM. Si sus rieles no son EVM, el requisito puede ser inalcanzable desde un stack EVM como el nuestro con independencia del tiempo disponible | **Descartar**, ahora reforzado por una segunda razón independiente de la original: el MVP no tiene flujo de pago, y agregar uno para calificar sería exactamente el "integrar para cumplir el requisito" que los bounties penalizan |
| Unlock Protocol | 800 USD | Plugin de WordPress, o portal de contenido token-gated para monetización de creadores | `No se pudo confirmar`. El plugin de WordPress es un producto real, pero no se encontró ningún bounty de Unlock Protocol para este evento. La única interacción documentada con la comunidad boliviana es de diciembre de 2024, para un evento distinto | **Descartar.** Ninguno de los dos bounties concretos corresponde al dominio, aunque el concepto de membresía onchain se parezca al de credencial profesional |

> Ninguno de los cuatro se pudo confirmar contra una fuente vigente para este evento, así que ninguno debería recibir tiempo de construcción solo con el respaldo de este documento. La verificación más barata y confiable es fotografiar el tablero de premios de los patrocinadores en el lugar, o preguntar en el canal del evento; es más rápido que cualquier investigación adicional por internet.

<a id="d-27"></a>

> **Decisión pendiente — D-27: presentarse al bounty de Avalanche**
>
> **Contexto.** La tensión que este documento describía desapareció con la migración: el proyecto ya corre nativamente en Avalanche Fuji, así que el contrato desplegado y verificado en Avalanche que exige el bounty **es** el entregable principal, no un añadido decorativo. Lo que el bounty penaliza —integrar Avalanche solo para cumplir el requisito— no es lo que ocurrió aquí. Lo que sigue sin confirmarse es el bounty: `VERIFICAR:` este documento afirmaba que el 40% de la puntuación es la relevancia de la integración; ese peso no se pudo confirmar contra ninguna fuente de esta edición, ni tampoco la existencia del bounty en sí.
>
> **Opciones.** (a) No presentarse y concentrarse en el track principal. (b) Presentar el entregable principal tal cual, porque el despliegue en Avalanche es el del propio MVP. (c) Reforzarlo con el argumento de subred: una subred de Avalanche permitiría a una autoridad sanitaria operar su propia red con reglas propias, que es el argumento que hoy vive como camino de producción en [01](01-arquitectura.md).
>
> **Recomendación.** (b), condicionada a confirmar que el bounty existe en esta edición, y con (c) como justificación de relevancia. No cuesta trabajo adicional: el contrato está en Avalanche porque ahí corre el proyecto. La única pieza con riesgo es el requisito de **verificación** del código fuente en el explorador, que sigue pendiente de comprobación empírica: Fuji es de tier pago en Etherscan V2, la configuración apunta a Routescan y todavía no se ha probado contra un despliegue real.
>
> **Impacto si se difiere.** Ninguno sobre el entregable principal. Se pierde la oportunidad de 200 USD.

<a id="d-28"></a>

> **Decisión pendiente — D-28: canal real de inscripción y entrega**
>
> **Contexto.** Este documento asume Devfolio con selección de "Bolivia Hackathon". El sitio oficial del evento registra por formulario de Google y no enlaza a Devfolio; el programa de Devfolio tiene su propio calendario hasta octubre y no menciona Bolivia en ningún momento. En ediciones anteriores la organización usó TAIKAI. Sea cual sea el canal real, tiene un cierre de entrega dentro del propio evento.
>
> **Opciones.** (a) Confirmar con la organización en el lugar o en el canal oficial, y registrarse donde indiquen. (b) Registrarse en ambas plataformas para cubrir la ambigüedad. (c) Mantener el supuesto de este documento.
>
> **Recomendación.** (a), de inmediato, y (b) si cuesta minutos y queda alguna duda. (c) no es viable: un entregable presentado en la plataforma equivocada no se evalúa.
>
> **Impacto si se difiere.** Total. Es la única decisión pendiente de todo el conjunto documental capaz de anular la entrega con independencia del estado del código.

## Orden de prioridades hasta el cierre

1. Confirmar el canal real de inscripción y entrega con la organización ([D-28](#d-28)).
2. Contrato `PrescriptionRegistry` desplegado y verificado, con el test que prueba que la segunda dispensación revierte.
3. Las dos aplicaciones mínimas: el médico genera un QR, la farmacia lo escanea y dispensa.
4. README de entrega completo.
5. Ensayo cronometrado del demo.
6. Todo lo demás, incluido el bounty de Avalanche.

> El orden de ejecución completo, con criterios de salida y dependencias, está en [16](16-plan-de-ejecucion.md).

> **Si algo se cae, se cae en orden inverso.** El plan de recorte está en [09](09-roadmap.md) y no se negocia el día 3.

## Siguiente paso

Volver a [09-roadmap.md](09-roadmap.md) para el plan de las horas restantes, revisar [16-plan-de-ejecucion.md](16-plan-de-ejecucion.md) para el orden de ejecución verificado, y tener [12-preguntas-de-jurado.md](12-preguntas-de-jurado.md) abierto durante los 2 minutos de QA.
