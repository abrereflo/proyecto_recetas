# Receta electrónica verificable sobre Ethereum — documentación del proyecto

Un médico firma una receta sin saber qué es una wallet y sin pagar gas; la farmacia la verifica escaneando un QR; el segundo intento de dispensar esa misma receta es rechazado por el contrato. Eso es lo que construimos y lo que se demuestra. Corre sobre **Base Sepolia**, un L2 público de Ethereum, con abstracción de cuenta, paymaster y credenciales profesionales emitidas como attestations.

> **Contexto: buildathon de Ethereum, Cochabamba (Bolivia).**
> Tres días de construcción y un pitch con demo de tres minutos. Esta documentación existe para sostener esa demo y ese pitch, no para describir un sistema hipotético completo. Todo lo que no sea construible y demostrable está marcado como fase posterior.

> **Estado: borrador de arquitectura y guion de ejecución.** No hay despliegue en producción. Las referencias normativas bolivianas son hallazgos preliminares que requieren asesoría legal local. Al 11 de septiembre de 2026 se verificaron tres supuestos técnicos, registrados en [16](16-plan-de-ejecucion.md), y el canal real de entrega quedó en duda ([D-28](15-track-y-entrega.md#d-28)).

## Índice

| Archivo | Qué responde | Audiencia |
|---|---|---|
| [00-vision-y-alcance.md](00-vision-y-alcance.md) | Qué problema atacamos, qué entra en el MVP de tres días y qué falta validar | Equipo, jurado |
| [01-arquitectura.md](01-arquitectura.md) | Cómo se conectan L2, smart accounts, paymaster, EAS y almacenamiento cifrado | Ingeniería |
| [02-roles-y-permisos.md](02-roles-y-permisos.md) | Quién puede hacer qué y cómo se acredita y se revoca a un profesional | Ingeniería, legal |
| [03-modelo-de-datos.md](03-modelo-de-datos.md) | Qué se escribe on-chain, qué jamás, y cómo se protege la privacidad de metadatos | Ingeniería, privacidad |
| [04-smart-contracts.md](04-smart-contracts.md) | Contratos, struct EIP-712, máquina de estados y la contradicción de cantidades resuelta | Ingeniería |
| [05-almacenamiento-y-cifrado.md](05-almacenamiento-y-cifrado.md) | Cómo se cifra la receta, quién la descifra y cómo se revoca el acceso | Ingeniería, seguridad |
| [06-validacion-clinica.md](06-validacion-clinica.md) | El motor de reglas determinístico (y por qué no lo llamamos IA) | Clínica, ingeniería |
| [07-seguridad-y-cumplimiento.md](07-seguridad-y-cumplimiento.md) | Modelo de amenazas honesto y marco legal boliviano, incluida la doble firma ADSIB | Seguridad, legal |
| [08-stack-y-entorno.md](08-stack-y-entorno.md) | Tecnología concreta, alternativas y entornos | Ingeniería |
| [09-roadmap.md](09-roadmap.md) | Las 72 horas del buildathon y las fases posteriores | Equipo, jurado |
| [10-estado-del-arte.md](10-estado-del-arte.md) | Qué hicieron los proyectos previos y qué aprendemos | Investigación, jurado |
| [11-glosario.md](11-glosario.md) | Qué significa cada término | Todos |
| [12-preguntas-de-jurado.md](12-preguntas-de-jurado.md) | Las diez preguntas difíciles con respuesta ensayada | Equipo |
| [13-pitch-y-sostenibilidad.md](13-pitch-y-sostenibilidad.md) | Orden del pitch, métricas objetivo y quién paga esto | Equipo, jurado |
| [14-trazabilidad-informe-base.md](14-trazabilidad-informe-base.md) | Qué pasó con cada afirmación del informe base: conservada, transformada, corregida o descartada, con archivo y línea | Dirección, quien defienda el pivote |
| [15-track-y-entrega.md](15-track-y-entrega.md) | Track elegido, requisitos de entrega, estado de verificación de los bounties y orden de prioridades hasta el cierre | Equipo, obligatorio antes de entregar |
| [16-plan-de-ejecucion.md](16-plan-de-ejecucion.md) | Qué se verificó, en qué orden se construye y qué sigue abierto | Equipo, ingeniería |
| [17-diseno-y-experiencia.md](17-diseno-y-experiencia.md) | Sistema de diseño, las quince pantallas de las dos aplicaciones y las reglas que la interfaz no puede romper | Ingeniería, diseño |
| [18-tareas-por-fases.md](18-tareas-por-fases.md) | La lista operativa: once fases con criterio de salida, y lo que se decide no construir | Equipo, uso diario |

## Rutas de lectura

| Perfil | Recorrido |
|---|---|
| Quien construye | [11 Glosario](11-glosario.md) → [01 Arquitectura](01-arquitectura.md) → [04 Contratos](04-smart-contracts.md) → [08 Stack](08-stack-y-entorno.md) → [09 Roadmap](09-roadmap.md) → [16 Plan de ejecución](16-plan-de-ejecucion.md) → [17 Diseño](17-diseno-y-experiencia.md) → [18 Tareas por fases](18-tareas-por-fases.md) |
| Quien presenta | [15 Track y entrega](15-track-y-entrega.md) → [16 Plan de ejecución](16-plan-de-ejecucion.md) → [00 Visión](00-vision-y-alcance.md) → [13 Pitch](13-pitch-y-sostenibilidad.md) → [12 Preguntas de jurado](12-preguntas-de-jurado.md) → [10 Estado del arte](10-estado-del-arte.md) |
| Perfil clínico | [00 Visión](00-vision-y-alcance.md) → [02 Roles](02-roles-y-permisos.md) → [06 Validación clínica](06-validacion-clinica.md) |
| Perfil legal | [07 Seguridad y cumplimiento](07-seguridad-y-cumplimiento.md) → [05 Almacenamiento y cifrado](05-almacenamiento-y-cifrado.md) → [03 Modelo de datos](03-modelo-de-datos.md) |
| Dirección y quien defiende el pivote | [00 Visión](00-vision-y-alcance.md) → [14 Trazabilidad](14-trazabilidad-informe-base.md) → [10 Estado del arte](10-estado-del-arte.md) → [09 Roadmap](09-roadmap.md) |

## Convenciones

| Marca | Significado |
|---|---|
| `SUPUESTO:` | Afirmación no respaldada por la fuente; hipótesis de trabajo que debe confirmarse |
| `VERIFICAR:` | Referencia normativa o técnica cuya redacción exacta no se pudo confirmar; no citar sin comprobar |
| `CITA REQUERIDA:` | Dato numérico tomado de la fuente del usuario que necesita referencia publicada antes de usarse en público |
| **D-XX** | Decisión pendiente, con contexto, opciones, recomendación e impacto si se difiere |

### Registro de decisiones pendientes

Identificadores únicos en todo el conjunto documental.

| ID | Título | Documento |
|---|---|---|
| D-01 | Red de destino después del buildathon | [01](01-arquitectura.md) |
| D-02 | Quién financia el paymaster en producción | [01](01-arquitectura.md) |
| D-03 | Emisor de las attestations profesionales | [02](02-roles-y-permisos.md) |
| D-04 | Recuperación social y custodia de la smart account | [02](02-roles-y-permisos.md) |
| D-05 | Vinculación entre identidad legal y smart account | [02](02-roles-y-permisos.md) |
| D-06 | Privacidad de metadatos y línea futura de ZK | [03](03-modelo-de-datos.md) |
| D-07 | Catálogo de medicamentos autorizados en Bolivia | [03](03-modelo-de-datos.md) |
| D-08 | Almacenamiento del payload cifrado: Postgres o IPFS | [05](05-almacenamiento-y-cifrado.md) |
| D-09 | Custodia y recuperación de la clave de descifrado del paciente | [05](05-almacenamiento-y-cifrado.md) |
| D-10 | Pinning y retención si se elige IPFS | [05](05-almacenamiento-y-cifrado.md) |
| D-11 | Supresión de datos y crypto-shredding | [05](05-almacenamiento-y-cifrado.md) |
| D-12 | Dispensación fraccionada y tratamiento crónico | [04](04-smart-contracts.md) |
| D-13 | Fuente de tiempo para la caducidad | [04](04-smart-contracts.md) |
| D-14 | Actualización de contratos | [04](04-smart-contracts.md) |
| D-15 | Base de conocimiento farmacológico y su licencia | [06](06-validacion-clinica.md) |
| D-16 | Umbral de alertas y fatiga | [06](06-validacion-clinica.md) |
| D-17 | Integración técnica de la firma ADSIB | [07](07-seguridad-y-cumplimiento.md) |
| D-18 | Sustancias controladas bajo Ley 913 | [07](07-seguridad-y-cumplimiento.md) |
| D-19 | Base legal del tratamiento sin ley general de protección de datos | [07](07-seguridad-y-cumplimiento.md) |
| D-20 | Farmacia sin conectividad en el momento de dispensar | [04](04-smart-contracts.md) |
| D-21 | Serialización GS1 para trazabilidad de unidades | [09](09-roadmap.md) |
| D-22 | Modelo de sostenibilidad y quién paga | [13](13-pitch-y-sostenibilidad.md) |
| D-23 | Validación del problema con profesionales de Cochabamba | [00](00-vision-y-alcance.md) |
| D-24 | Par de claves de cifrado, separado de la passkey de firma | [05](05-almacenamiento-y-cifrado.md) |
| D-25 | Procedencia del contexto clínico del paciente | [06](06-validacion-clinica.md) |
| D-26 | Integración con el software de gestión de farmacia | [09](09-roadmap.md) |
| D-27 | Desplegar también en Avalanche para el bounty | [15](15-track-y-entrega.md) |
| D-28 | Canal real de inscripción y entrega | [15](15-track-y-entrega.md) |

## Siguiente paso

Comenzar por [00-vision-y-alcance.md](00-vision-y-alcance.md).
