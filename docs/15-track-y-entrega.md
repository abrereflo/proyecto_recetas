# 15 — Track y entrega

**Track seleccionado: `Real-World Ethereum Applications`** (track 6 de EAG Global). En Devfolio se elige primero `Bolivia Hackathon` y después ese track. Este documento justifica la elección, lista lo que exige la entrega y define la estrategia frente a los bounties de patrocinadores.

## Datos del evento

| Dato | Valor |
|---|---|
| Evento | ETH Bolivia Buildathon 2026 / EAG Global, Cochabamba |
| Fechas | 11 al 13 de septiembre de 2026 |
| Cierre de entrega | Sábado 13, **8:30** |
| Demos | 10:30 a 14:30 · **5 minutos: 3 de showcase + 2 de preguntas** |
| Anuncio de ganadores | 16:00 |
| Plataforma | `https://eag-global-buildathon.devfolio.co/` — hay que registrarse **antes** de enviar |
| Premio principal | **Una sola** beca ShanHaiWoo: hasta 800 USD de pasaje aéreo más ~30 días de alojamiento en Shenzhen. No hay premio en efectivo en los tracks principales |

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

- [ ] Registro en Devfolio hecho antes del envío
- [ ] Seleccionado `Bolivia Hackathon`
- [ ] Seleccionado el track `Real-World Ethereum Applications`
- [ ] Contrato desplegado y verificado, con dirección anotada en el README
- [ ] Demo accesible por URL pública o ejecutable con los pasos del README
- [ ] README con funcionalidades, instalación, ejecución e integración técnica
- [ ] `docs/` enlazado desde el README como documentación técnica
- [ ] Demo ensayado en 3 minutos, con las preguntas de [12](12-preguntas-de-jurado.md) listas para los 2 de QA

## Bounties de patrocinadores

Se puede competir en el track principal y en bounties a la vez. El criterio es no poner en riesgo el entregable principal.

| Bounty | Premio | Qué exige | Veredicto |
|---|---|---|---|
| **Avalanche** | 200 USD | Contrato desplegado **y verificado** en Avalanche, con uso relevante y justificado. Temas incluidos: identidad digital, KYC y trazabilidad | **Candidato real.** Ver D-27 |
| Vaquita | 100 USDC | Crear cuenta, depositar, publicar video en TikTok o Instagram, referidos. **No requiere programar** | **Tomarlo.** Lo hace alguien del equipo en paralelo sin tocar el código |
| Pollar | 200 USDC | Pollar integrado como motor de pagos con transacción real en mainnet | **Descartar.** El MVP no tiene flujo de pago. Agregar uno para calificar sería exactamente el "integrar para cumplir el requisito" que los bounties penalizan |
| Unlock Protocol | 800 USD | Plugin de WordPress, o portal de contenido token-gated para monetización de creadores | **Descartar.** Ninguno de los dos bounties concretos corresponde al dominio, aunque el concepto de membresía onchain se parezca al de credencial profesional |

<a id="d-27"></a>

> **Decisión pendiente — D-27: desplegar también en Avalanche para el bounty**
>
> **Contexto.** Toda la arquitectura de [01](01-arquitectura.md) elige Base Sepolia por su tooling de paymaster y passkeys. El bounty de Avalanche exige un contrato desplegado y verificado en Avalanche, y advierte que agregar Avalanche solo para cumplir el requisito no califica: el 40% de su puntuación es la relevancia de la integración. `PrescriptionRegistry` es EVM y pequeño, así que desplegarlo en Avalanche es barato en tiempo.
>
> **Opciones.** (a) No participar y concentrarse en el track principal. (b) Desplegar el mismo `PrescriptionRegistry` en Avalanche y presentarlo como verificación multi-cadena de la misma receta. (c) Justificarlo por subred: una subred de Avalanche permitiría a una autoridad sanitaria operar su propia red con reglas propias, que es el argumento que hoy vive como camino de producción en [01](01-arquitectura.md).
>
> **Recomendación.** (a) hasta que el demo principal funcione de punta a punta. Si sobra tiempo el día 3, (b) con el argumento de (c): el registro de recetas no debería depender de una sola cadena, y una autoridad sanitaria que quiera su propia red tiene en las subredes de Avalanche un camino concreto. Sin ese argumento, no presentarse: un despliegue decorativo puntúa peor que no participar.
>
> **Impacto si se difiere.** Ninguno sobre el entregable principal. Se pierde la oportunidad de 200 USD.

## Orden de prioridades hasta el cierre

1. Contrato `PrescriptionRegistry` desplegado y verificado, con el test que prueba que la segunda dispensación revierte.
2. Las dos aplicaciones mínimas: el médico genera un QR, la farmacia lo escanea y dispensa.
3. README de entrega completo.
4. Ensayo cronometrado del demo.
5. Todo lo demás, incluido el bounty de Avalanche.

> **Si algo se cae, se cae en orden inverso.** El plan de recorte está en [09](09-roadmap.md) y no se negocia el día 3.

## Siguiente paso

Volver a [09-roadmap.md](09-roadmap.md) para el plan de las horas restantes, y tener [12-preguntas-de-jurado.md](12-preguntas-de-jurado.md) abierto durante los 2 minutos de QA.
