# 10 — Estado del arte

Seis proyectos previos intentaron poner la receta médica en una blockchain. Ninguno llegó a ser infraestructura de un sistema de salud. La conclusión que sacamos no es que nosotros lo haremos mejor, sino que los obstáculos rara vez fueron técnicos: fueron de adopción, de identidad legal y de incentivos.

## Tabla comparativa

Las cuatro primeras columnas reproducen la tabla del informe base sin alterarla. La última es nuestra lectura.

| Proyecto | Tecnología | Almacenamiento | Enfoque principal | Qué aprendemos |
|---|---|---|---|---|
| Prescrypto | Blockchain | Base de datos | Emisión y rastreo (México) | Un despliegue latinoamericano real: el obstáculo fue la integración con los flujos existentes de clínicas y farmacias, no el consenso. Ese obstáculo es el que [D-26](09-roadmap.md) aborda |
| PAGR | Blockchain | Descentralizado | Monitoreo de opioides | La métrica que lo hizo notable fue de eficiencia operativa, no criptográfica. El valor percibido está en ahorrar tiempo al profesional |
| MediLedger | Consorcio | Blockchain | Trazabilidad de suministro | Es un problema distinto al nuestro: rastrear unidades físicas exige serialización, no clasificación. Ver [03](03-modelo-de-datos.md) |
| VigilRx | Ethereum público | Centralizado | Control de opioides | Cadena pública con almacenamiento centralizado: el mismo modelo híbrido que adoptamos. El riesgo es que el componente central vuelva a ser el punto de fallo |
| SecureRx | Ethereum | Descentralizado | Legitimidad farmacológica | Demuestra que el anclaje en Ethereum de la legitimidad de una receta es viable. No resolvió la identidad legal del prescriptor |
| **Propuesta actual** | **Ethereum L2 público (Base)** | **Cifrado off-chain, hash on-chain** | **Unicidad de dispensación y credenciales verificables** | **Ver la sección siguiente** |

> **La columna "Interoperabilidad" del informe base fue eliminada.**
> En la tabla original, nuestra propuesta se autoasignaba "Máxima" sin criterio. Calificarse a uno mismo por encima de todos los demás en una dimensión sin definir no es análisis, es publicidad. Si se quisiera reintroducir la columna, tendría que puntuarse con criterios verificables: adopción de HL7 FHIR R4, uso de codificación estándar, existencia de una API pública documentada y despliegues en producción. Bajo esos criterios, nuestra propuesta hoy tendría la puntuación más baja de la tabla, porque no está desplegada.

### Nota sobre PAGR

> `CITA REQUERIDA:` el informe base afirma que PAGR redujo el tiempo de emisión de recetas de 171 a 63 segundos. **Este dato proviene de la fuente del usuario y no ha sido verificado contra una publicación.** No debe presentarse en el pitch sin localizar la referencia original. No es un resultado de este proyecto ni una meta comprometida.

### Referencias heredadas de la fuente

| Referencia | Cómo aparece en la fuente | Nuestro tratamiento |
|---|---|---|
| Laboratorio LIRE, Universidad de Constantine 2 (Argelia) | Identifica como desafío crítico la dificultad de generar un registro EMR unificado a partir de bases de datos hospitalarias dispersas | Se cita tal como aparece. Es investigación argelina; su aplicabilidad al contexto boliviano está por establecer |
| Protocolo SPChain | Referencia del modelo de blockchain de consorcio del informe base | Se menciona por trazabilidad histórica. Nosotros **no** adoptamos el modelo de consorcio: corremos sobre un L2 público. Ver [01](01-arquitectura.md) |

### Referencias del informe base retiradas

El criterio es uniforme: toda referencia del informe base que no aparece en el diseño deja constancia aquí de qué era y por qué se retira. Son referencias que no aplican al contexto boliviano, no errores del informe. La correspondencia completa entre el informe base y esta documentación está en [14](14-trazabilidad-informe-base.md).

| Referencia | Qué era | Por qué se retira |
|---|---|---|
| Farmatic y Nixfarma | Software de gestión de farmacia del mercado español, citado como socio de validación clínica | Sin presencia conocida en Bolivia. El concepto de integrarse con el software que la farmacia ya usa sobrevive, sin marcas, en [D-26](09-roadmap.md) |
| Didit | Proveedor de verificación biométrica y prueba de vivacidad para telemedicina | El caso de uso se difiere a la Fase 3 de [09](09-roadmap.md) y la biometría se descarta en esta etapa por falta de marco de protección de datos ([02, D-05](02-roles-y-permisos.md)). Ningún proveedor se nombra hasta entonces |
| Atico34 LOPD | Consultora española de cumplimiento de la ley de protección de datos de España; no es software | Referencia a una jurisdicción y a un servicio profesional que no aplican a un piloto boliviano. El hueco regulatorio local se trata en [07](07-seguridad-y-cumplimiento.md) |
| Plan Nacional de Salud 2026-2030 | Plan de digitalización sanitaria citado como objetivo a apoyar | Referencia sin fuente verificable. Ya registrado en [07](07-seguridad-y-cumplimiento.md); se repite aquí para que el registro sea uniforme |

## Qué nos diferencia

No en capacidades prometidas, sino en decisiones concretas que un jurado puede verificar en la demo.

| Decisión | Lo que hace la mayoría | Lo que hacemos |
|---|---|---|
| Fricción para el médico | Wallet, frase semilla, comprar ETH | Passkey y paymaster: cero pasos de criptomoneda |
| Identidad profesional | Lista blanca administrada por el operador | Attestations EAS con emisor y revocación públicos |
| Identificador de paciente | Seudónimo estable on-chain | Compromiso con sal única por receta; nada correlacionable |
| Validez legal | Se omite o se da por resuelta | Doble firma ADSIB más anclaje on-chain. Ver [07](07-seguridad-y-cumplimiento.md) |
| Validación clínica | Se llama "IA" | Motor determinístico, y lo decimos. Ver [06](06-validacion-clinica.md) |

## Dónde nuestra propuesta todavía no está probada

Esta sección existe para que la escriba el equipo y no el jurado.

| Afirmación que **no** podemos sostener | Por qué |
|---|---|
| "Resolvemos el fraude de recetas" | Impedimos la reutilización y verificamos al emisor. No impedimos que un médico corrupto emita recetas válidas ni la colusión con una farmacia. Ver [07](07-seguridad-y-cumplimiento.md) |
| "Tiene validez legal en Bolivia" | Todavía no. La integración de firma ADSIB está diseñada, no implementada. Ver [D-17](07-seguridad-y-cumplimiento.md) |
| "Es interoperable" | Adoptamos la forma de los recursos FHIR R4. No hay servidor FHIR ni integración con SNIS |
| "Cumple con la protección de datos" | Aplicamos minimización y cifrado por decisión propia. No hay marco general que verificar en Bolivia. Ver [07](07-seguridad-y-cumplimiento.md) |
| "Detecta doctor shopping" | Imposible con nuestro modelo de privacidad: sin seudónimo estable no se correlacionan recetas del mismo paciente. Es un compromiso consciente |
| "Es privado" | El contenido está cifrado. El grafo de transacciones es público y filtra metadatos. Ver [D-06](03-modelo-de-datos.md) |
| "Trazamos el medicamento desde el laboratorio" | Requiere serialización GS1 que no tenemos. Ver [D-21](09-roadmap.md) |
| "Hay demanda para esto en Cochabamba" | No lo hemos validado. Ver [D-23](00-vision-y-alcance.md) |
| "Escala" | No hemos medido nada. Cero pruebas de carga |

> **Lo que sí podemos demostrar en tres minutos:** que un médico sin ETH y sin wallet firma una receta, que la farmacia la verifica contra Ethereum y que el segundo intento de dispensarla es rechazado por el contrato. Eso es verdad, es verificable en vivo y es más de lo que muchas propuestas pueden mostrar.

## Siguiente paso

Continuar con [11-glosario.md](11-glosario.md), o saltar a [12-preguntas-de-jurado.md](12-preguntas-de-jurado.md) si se está preparando el pitch.
