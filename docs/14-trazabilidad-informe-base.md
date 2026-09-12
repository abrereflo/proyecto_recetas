# 14 — Trazabilidad respecto al informe base

Cada afirmación del informe técnico original tiene aquí una fila que dice qué pasó con ella: dónde vive ahora, si se conservó, se transformó, se corrigió o se descartó, y con qué motivo. El documento existe para defender el pivote con archivo y línea, no con adjetivos: cuando alguien pregunte "¿por qué ya no hay IPFS?" o "¿dónde quedó el rol del gobierno?", la respuesta está en una fila y en un enlace. Es también el registro de los huecos que la revisión de trazabilidad encontró y de cómo se cerraron.

Las referencias `archivo:línea` apuntan al estado de los documentos tras esta actualización. Cuando una sección o una decisión es más estable que un número de línea, se cita la sección o el identificador de decisión.

## Veredictos

| Veredicto | Definición | En la revisión | Tras el cierre |
|---|---|---|---|
| CONSERVADO | La afirmación se mantiene con el mismo sentido, aunque cambie la redacción o se amplíe | 15 | 15 |
| TRANSFORMADO | La intención sobrevive con otro mecanismo, alcance o fase | 24 | 25 |
| CORREGIDO | La afirmación se declara errónea de forma explícita y se explica por qué | 7 | 7 |
| DESCARTADO | La afirmación se retira con constancia escrita del motivo | 8 | 13 |
| PERDIDO | La afirmación desapareció sin que ningún documento lo dijera | 6 | 0 |

| Veredicto tras el cierre | Ítems |
|---|---|
| CONSERVADO | 1, 3, 6, 7, 12, 18, 20, 24, 25, 32, 39, 40, 52, 54, 59 |
| TRANSFORMADO | 2, 4, 8, 9, 10, 17, 19, 21, 26, 27, 34, 35, 36, 37, 41, 42, 43, 45, 46, 49, 50, 51, 56, 57, 60 |
| CORREGIDO | 5, 11, 13, 14, 33, 38, 55 |
| DESCARTADO | 15, 16, 22, 23, 28, 29, 30, 31, 44, 47, 48, 53, 58 |

Las seis filas que la revisión marcó como PERDIDO conservan la marca original seguida del veredicto que reciben tras el cierre, para que se vea qué cambió y por qué.

## Matriz

Rutas relativas a `docs/`. La columna "Afirmación" cita la sección del informe base entre paréntesis cuando ayuda a localizarla.

| # | Afirmación del informe base | Veredicto | Dónde | Nota |
|---|---|---|---|---|
| 1 | Crisis de integridad de la receta en papel (§1) | CONSERVADO | `00-vision-y-alcance.md:11-16` | Reformulado como tabla problema, manifestación y qué resuelve el MVP |
| 2 | Convergencia Blockchain + IA + IPFS como respuesta (§1) | TRANSFORMADO | `01-arquitectura.md:3`, `06-validacion-clinica.md:3`, `05-almacenamiento-y-cifrado.md:7` | De las tres patas queda blockchain (cadena pública sin permisos, hoy Avalanche Fuji); la IA pasa a motor de reglas y IPFS a opción no elegida |
| 3 | Laboratorio LIRE, Universidad de Constantine 2 (§1) | CONSERVADO | `00-vision-y-alcance.md:22`; también `10-estado-del-arte.md:29` | Se cita tal cual, degradado a investigación argelina sin aplicabilidad boliviana establecida |
| 4 | EMR unificado desde bases hospitalarias dispersas (§1) | TRANSFORMADO | `10-estado-del-arte.md:29`, `03-modelo-de-datos.md:13` | La agregación de historial se traslada a off-chain con consentimiento ([D-25](06-validacion-clinica.md)); la historia clínica completa queda fuera de alcance (`00:98`) |
| 5 | Doctor shopping (§1) | CORREGIDO | `06-validacion-clinica.md:15`; también `10:65`, `11:74`, `00:22` | Pasa de capacidad prometida a imposibilidad declarada: el modelo de privacidad impide correlacionar recetas del mismo paciente |
| 6 | Recetas apócrifas como problema (§1) | CONSERVADO | `00-vision-y-alcance.md:13`; glosario `11:75` | Es uno de los dos problemas núcleo del MVP |
| 7 | Errores de transcripción e ilegibilidad (§1) | CONSERVADO | `00-vision-y-alcance.md:15`; también `13:101` | Mismo sentido; se resuelve con receta estructurada, no con OCR |
| 8 | Eliminar silos y falta de interoperabilidad (§1) | TRANSFORMADO | `03-modelo-de-datos.md:209-222`, `10:63` | La interoperabilidad se concreta en recursos HL7 FHIR R4 y se admite que hoy no existe integración real |
| 9 | Eliminar intermediarios centralizados (§1) | TRANSFORMADO | `02-roles-y-permisos.md:3` y `02:84`; `07-seguridad-y-cumplimiento.md:16` | Se conserva como principio (sin administrador, sin lista blanca) y se admite que el emisor de credenciales es el punto único de confianza restante |
| 10 | Soberanía del dato en el paciente; el paciente controla el acceso (§1) | TRANSFORMADO | `03-modelo-de-datos.md:148`; `02:15`, `05:71`, `05:169` | Se reduce a "quien tiene el QR lee la receta"; el paciente no tiene wallet ni clave en el MVP y el control real vuelve en Fase 2 |
| 11 | Raíz de confianza desde el laboratorio farmacéutico (§2) | CORREGIDO | `00-vision-y-alcance.md:103-104`; `03:119`, `09` D-21, `10:67`, `12:61` | Declarado error conceptual: ATC clasifica, GS1 rastrea. La raíz de confianza pasa a ser la credencial profesional, no el laboratorio |
| 12 | Códigos ATC y principios activos, uso clínico (§2.1) | CONSERVADO | `03-modelo-de-datos.md:113-114`, `06:23`, `00:65` | ATC se mantiene para duplicidad terapéutica; la prescripción por principio activo se vuelve recomendación explícita (D-07) |
| 13 | ATC como habilitador de trazabilidad del medicamento (§2.1) | CORREGIDO | `03-modelo-de-datos.md:118-119`; `00:103-104`, `09:105` | Contradicción explícita con explicación del error |
| 14 | Blockchain de consorcio tipo SPChain (§2.1) | CORREGIDO | `01-arquitectura.md:3` y `01:16`; `00:99`, `10:30` | Decisión revertida a cadena pública sin permisos con motivo (no hay comité ni gobernanza en 72 horas); SPChain se menciona solo por trazabilidad histórica |
| 15 | Consenso por reputación entre nodos validadores (§2.1) | DESCARTADO | `01-arquitectura.md:16`, `12-preguntas-de-jurado.md:43` | Cae con el consorcio; `12:43` lo dice con todas las letras: el laboratorio no necesita correr ningún nodo |
| 16 | Consorcio superior por eficiencia frente a PoW (§2.1) | DESCARTADO | `01-arquitectura.md:15-21` | El argumento de eficiencia se sustituye por tooling, coste y verificabilidad pública de una cadena pública sin permisos |
| 17 | Privacidad controlada: datos privados y públicos para auditoría (§2.1) | TRANSFORMADO | `01-arquitectura.md:240-254`; `03:5-16`, `07:18` | La privacidad ya no viene de la red permisionada sino de cifrado más compromiso con sal; se admite la fuga del grafo de transacciones (D-06) |
| 18 | Rol prescriptor: genera y firma digitalmente (§2.2) | CONSERVADO | `02-roles-y-permisos.md:9`; `07:94-136` | Firma EIP-712 con passkey más doble firma ADSIB prevista |
| 19 | El prescriptor valida el historial agregado en la blockchain (§2.2) | TRANSFORMADO | `03-modelo-de-datos.md:13-14`, `06-validacion-clinica.md:43-66` ([D-25](06-validacion-clinica.md)) | No hay historial on-chain. El contexto lo declara el médico en la receta en el MVP; el historial off-chain del establecimiento es Fase 2 y el portable del paciente, Fase 3 |
| 20 | Rol farmacéutico: verifica vigencia y cierra la transacción (§2.2) | CONSERVADO | `02-roles-y-permisos.md:10`, `04:75-92` | `dispense` hace exactamente eso |
| 21 | Rol paciente: propietario central, otorga y revoca permisos (§2.2) | TRANSFORMADO | `02-roles-y-permisos.md:11` y `02:15`; `05:141-149` | Sin identidad técnica en el MVP; la revocación se acota a acceso futuro, nunca retroactivo |
| 22 | Gobierno y aseguradoras: tendencias de salud pública (§2.2) | PERDIDO → DESCARTADO | `03-modelo-de-datos.md:16`; `02-roles-y-permisos.md:17-26`; `13:106`, `13:136` | La sal única por receta imposibilita la analítica poblacional por paciente y ahora se dice. Quedan agregados por prescriptor, farmacia, ATC y periodo, sin identidad de paciente |
| 23 | Gobierno y aseguradoras: reembolsos (§2.2) | DESCARTADO | `00-vision-y-alcance.md:95`; `02:25`, `13:99` | Fuera del MVP por depender de acuerdos comerciales; reaparece solo como pagador candidato con evidencia por receta |
| 24 | Principio de privilegio mínimo (§2.2) | CONSERVADO | `02-roles-y-permisos.md:101-109` | Ampliado con matriz de permisos explícita |
| 25 | Almacenamiento híbrido: no saturar la cadena (§3) | CONSERVADO | `03-modelo-de-datos.md:3`, `05:50-56`, `01:256-264` | Es la regla estructural del modelo de datos |
| 26 | IPFS como almacenamiento off-chain (§3.1) | TRANSFORMADO | `05-almacenamiento-y-cifrado.md:7-8`, `05:10-22` (D-08) | Degradado a opción; Postgres recomendado. Se añade la advertencia de pinning (`05:26-33`, D-10) |
| 27 | CIDs como identificador de contenido (§3.1) | TRANSFORMADO | `05-almacenamiento-y-cifrado.md:26-27`, `11:55` | Sustituido por `contentHash` más `pointer` opaco; el CID sobrevive como advertencia ("un CID no es almacenamiento") y con nota de término heredado en el glosario |
| 28 | Fragmentación de los datos en IPFS (§3.1) | PERDIDO → DESCARTADO | Esta matriz | Detalle de implementación que muere con IPFS (D-08). No hay nada que documentar en el diseño; queda registrado aquí. `05:170` habla de fragmentación de secretos, que es otra cosa |
| 29 | IPLD para estructuras interoperables (§3.1) | PERDIDO → DESCARTADO | `11-glosario.md:57` | La entrada del glosario ya dice que es término del informe base sin uso en el diseño actual y remite a D-08 |
| 30 | IPNS para actualizar registros (§3.1) | DESCARTADO | `05-almacenamiento-y-cifrado.md:16`; `03:145`, `11:58` | Excluido explícitamente por lentitud e inestabilidad |
| 31 | DHT para localizar fragmentos entre nodos del consorcio (§3.1) | PERDIDO → DESCARTADO | `11-glosario.md:59` | La entrada del glosario ya dice que es término del informe base, huérfano sin consorcio ni IPFS, y remite a D-08 |
| 32 | Inmutabilidad técnica: alterar el archivo cambia el identificador (§3.1) | CONSERVADO | `05-almacenamiento-y-cifrado.md:8`; `03:199`, `07:14` | Mismo mecanismo, con `contentHash` y keccak256 en vez de CID |
| 33 | Cifrado con la clave del paciente (§3.2) | CORREGIDO | `05-almacenamiento-y-cifrado.md:3`; `12:21-23` | Contradicción explícita: rompe la lectura por la farmacia. Se sustituye por DEK por receta más envelope encryption (D-24) |
| 34 | Solo el CID se registra en Ethereum (§3.2) | TRANSFORMADO | `05-almacenamiento-y-cifrado.md:50-55`; `04:57`, `03:86-91` | On-chain van `contentHash`, `patientCommitment`, prescriptor y dos marcas de tiempo; en la C-Chain de Avalanche, no en Ethereum |
| 35 | Los smart contracts eliminan la autoridad central de validación (§4) | TRANSFORMADO | `02-roles-y-permisos.md:3`, `04:143`; `07:16` | Se conserva (sin administrador, sin reapertura) y se matiza: el emisor de credenciales sigue siendo autoridad |
| 36 | `Contract_user`: mapeo de identidades certificadas (§4.1) | TRANSFORMADO | `04-smart-contracts.md:11` y `04:100-119`; `02:46-55` | Su función la absorbe EAS (attestations más `issuerAuthority`). El nombre no aparece en la tabla de correspondencias de `04:149-157` |
| 37 | `Contract_prescription` con `New_prescription`, `Verify_prescription` y `Close_transaction` (§4.1) | TRANSFORMADO | `04-smart-contracts.md:155-157` | Correspondencia uno a uno con `issue`, `verify` (view, sin gas) y `dispense` |
| 38 | `quantity_left` y `max_claim` (§4.1) | CORREGIDO | `04-smart-contracts.md:147`, `04:151-152` | Se señala la incompatibilidad con `Close_transaction` y se eliminan; reaparecen solo en la extensión de crónicos (D-12) |
| 39 | `expiration_day` (§4.1) | CONSERVADO | `04-smart-contracts.md:153`; `04:190-205` (D-13) | Pasa a `expiresAt` uint64 con discusión de fuente de tiempo |
| 40 | `status` (§4.1) | CONSERVADO | `04-smart-contracts.md:21` y `04:154`; `03:90` | `PrescriptionStatus{None,Issued,Dispensed,Cancelled}` |
| 41 | Estado "Cerrado" como barrera antirreutilización (§4.1) | TRANSFORMADO | `04-smart-contracts.md:136-143`; `00:113`, `08:96` | El estado absorbente pasa a llamarse `Dispensed`; `Closed` solo existe en la extensión (`04:154`, `04:168`) |
| 42 | La IA como capa de seguridad cognitiva que no sustituye al médico (§5) | TRANSFORMADO | `06-validacion-clinica.md:3`, `06:5-16` | Misma intención, sin IA: motor de reglas determinístico, con autocrítica explícita al informe |
| 43 | Integración con software de gestión de farmacia, citado con marcas españolas (§5.1) | PERDIDO → TRANSFORMADO | `09-roadmap.md:76-88` ([D-26](09-roadmap.md)); `01:266-275`; `10:11`, `10:38` | Las marcas se retiran con constancia; el concepto sobrevive: aplicación independiente en el MVP, API para el software existente en Fase 2, relevamiento en Fase 1 |
| 44 | Visión por computador y NLP sobre recetas (§5.1) | DESCARTADO | `06-validacion-clinica.md:13`; `00:97` | Eliminado con motivo: es contradictorio aplicar OCR a recetas que el sistema emite en digital |
| 45 | "Auditoría en tiempo real" de anomalías y errores de dosificación (§5.1) | TRANSFORMADO | `06-validacion-clinica.md:14`, `06:25` | Se sustituye por reglas con umbrales explícitos; dosis fuera de rango pasa a Fase 2 |
| 46 | Cruce con el historial para interacciones fármaco-fármaco y alergias (§5.1) | TRANSFORMADO | `06-validacion-clinica.md:22-24`; `06:78-84` (D-15); `06:43-66` (D-25) | Alergia y duplicidad ATC sí, sobre lo que el médico declara en la receta; interacciones condicionadas a licencia de base de datos. El cruce contra un historial en la blockchain es estructuralmente imposible aquí |
| 47 | Biometría y telemedicina con un proveedor concreto (§5.1) | DESCARTADO | `00-vision-y-alcance.md:94`; `09:96`, `02:98`; constancia en `10:39` | El caso de uso se difiere a Fase 3 y la biometría se rechaza por falta de marco de protección de datos. El proveedor queda registrado como referencia retirada |
| 48 | Consultora de LOPD como gestión de riesgos (§5.1) | PERDIDO → DESCARTADO | `10-estado-del-arte.md:40` | Registrado como referencia retirada: jurisdicción y servicio profesional que no aplican a un piloto boliviano. El hueco regulatorio se trata en `07` |
| 49 | AI Act y clasificación de alto riesgo (§6) | TRANSFORMADO | `07-seguridad-y-cumplimiento.md:175`; `07:180` | Sigue citado como marco no aplicable; la clasificación decae porque el motor es determinístico |
| 50 | RGPD (§6) | TRANSFORMADO | `07-seguridad-y-cumplimiento.md:174`; `07:58`, `07:62`, `13:133` | De obligación a referencia voluntaria; se prohíbe explícitamente decir "cumple el RGPD" |
| 51 | DEA y Ley Ryan Haight (§6) | TRANSFORMADO | `07-seguridad-y-cumplimiento.md:176-177`; `07:180` | Degradadas a referencia de diseño estadounidense, no aplicables al piloto |
| 52 | Ley 164 y ADSIB (§6) | CONSERVADO | `07-seguridad-y-cumplimiento.md:45-47`; ampliado en `07:78-142` (doble firma, D-17) | Es el ítem más amplificado del informe: pasa de proyección estratégica a eje técnico central |
| 53 | Plan Nacional de Salud 2026-2030 (§6) | DESCARTADO | `07-seguridad-y-cumplimiento.md:53`; `10:41` | Eliminado deliberadamente: referencia no verificable. Registrado en `07` y repetido en la tabla de referencias retiradas de `10` |
| 54 | Tabla comparativa Prescrypto, PAGR, MediLedger, VigilRx y SecureRx (§7) | CONSERVADO | `10-estado-del-arte.md:9-16` | Las cuatro primeras columnas se reproducen sin alterar; se añade la columna "Qué aprendemos" |
| 55 | Fila "Propuesta Actual" con "Interoperabilidad: Máxima" (§7) | CORREGIDO | `10-estado-del-arte.md:18-19` | Columna eliminada con explicación ("no es análisis, es publicidad"); se admite que hoy sería la puntuación más baja |
| 56 | PAGR: de 171 a 63 segundos (§7) | TRANSFORMADO | `10-estado-del-arte.md:21-23` | El dato se conserva marcado `CITA REQUERIDA:` y prohibido en el pitch sin referencia |
| 57 | Recomendación: estandarización rigurosa con ATC (§8) | TRANSFORMADO | `03-modelo-de-datos.md:111-125`, `06:185` | Sobrevive como codificación para duplicidad y como métrica de cobertura; se le quita la justificación de auditoría de la IA y la de trazabilidad |
| 58 | Recomendación: validación y gobernanza de nodos del consorcio (§8) | DESCARTADO | `01-arquitectura.md:16`, `12:43` | Sustituida por gobernanza del emisor de credenciales (D-03) al desaparecer los nodos |
| 59 | Recomendación: supervisión humana obligatoria (§8) | CONSERVADO | `06-validacion-clinica.md:124-152`; `06:121`, `11:77` | Mismo sentido y reforzado (doble registro de alerta y decisión), justificado en fatiga de alertas y no en el AI Act |
| 60 | Auditoría gubernamental (§2.1, §2.2) | TRANSFORMADO | `07-seguridad-y-cumplimiento.md:157-164`; `00:125`, `02:17-26`, `13:102` | De acceso privilegiado del Estado a verificabilidad pública más registros off-chain y agregados sin identidad de paciente; el interés estatal se reorienta a sustancias controladas (con D-18 excluyéndolas del piloto) |

## Huecos detectados y cómo se cerraron

La revisión de trazabilidad encontró seis afirmaciones perdidas y seis inconsistencias silenciosas. Todas se cerraron en la misma actualización que incorporó este documento. La tabla dice dónde.

### Afirmaciones perdidas

| # | Afirmación | Gravedad según la revisión | Cómo se cerró |
|---|---|---|---|
| 22 | Tendencias de salud pública para gobierno y aseguradoras | Hueco real: la sal única por receta la vuelve imposible y nadie lo decía | Callout en la regla dura de [03](03-modelo-de-datos.md) que declara la cancelación y lo que queda posible; sección "Autoridad sanitaria y pagadores" en [02](02-roles-y-permisos.md); frase y fila en [13](13-pitch-y-sostenibilidad.md) |
| 28 | Fragmentación de datos en IPFS | Omisión razonable | Sin cambio en el diseño: es un detalle que muere con IPFS (D-08). Queda registrado en esta matriz |
| 29 | IPLD | Hueco menor: el glosario le atribuía una función que el diseño no implementa | Nota de término heredado en la entrada de [11](11-glosario.md), con remisión a D-08 |
| 31 | DHT | Omisión razonable en sustancia, inconsistente en forma | Nota de término heredado en la entrada de [11](11-glosario.md), con remisión a D-08 |
| 43 | Integración con el software de gestión de farmacia | Hueco real: el concepto desapareció junto con las marcas | [D-26](09-roadmap.md) en el roadmap; puerto `PharmacySoftwarePort` en la capa de integraciones de [01](01-arquitectura.md); enlace desde el diagnóstico de Prescrypto en [10](10-estado-del-arte.md) |
| 48 | Consultora de LOPD | Omisión razonable sin constancia | Fila en la tabla de referencias retiradas de [10](10-estado-del-arte.md) |

### Inconsistencias silenciosas

| # | Inconsistencia | Cómo se cerró |
|---|---|---|
| 1 | Procedencia del contexto clínico del paciente: el motor cruzaba alergias y medicación activa sin que ningún documento dijera de dónde salían | [D-25](06-validacion-clinica.md): en el MVP todo el contexto lo declara el médico en la receta; historial off-chain del establecimiento en Fase 2; historial portable del paciente en Fase 3. Se ajustaron la apertura, la tabla de reglas, la nota del diagrama de secuencia y el criterio de severidad crítica de [06](06-validacion-clinica.md), la respuesta 7 y una pregunta trampa nueva en [12](12-preguntas-de-jurado.md) |
| 2 | IPLD en el glosario con una función que el diseño no usa | Nota en [11](11-glosario.md); ver fila 29 |
| 3 | DHT en el glosario sin nada que lo use | Nota en [11](11-glosario.md); ver fila 31 |
| 4 | Analítica poblacional imposibilitada sin que `03` ni `01` lo dijeran | Callout en [03](03-modelo-de-datos.md) y frase ampliada en la sección de privacidad de metadatos de [01](01-arquitectura.md); ver fila 22 |
| 5 | Integración con software de farmacia: `10` la diagnostica como causa del fracaso de Prescrypto y `09` no la contemplaba | [D-26](09-roadmap.md), riesgo nuevo en la tabla de riesgos del programa, relevamiento añadido a la Fase 1; ver fila 43 |
| 6 | Asimetría de criterio al depurar referencias: el Plan Nacional se retiró con constancia, otras referencias sin ella | Tabla "Referencias del informe base retiradas" en [10](10-estado-del-arte.md), con las cuatro referencias y el motivo de cada una |

## Cómo mantener esta matriz

| Situación | Qué hacer |
|---|---|
| Un documento cambia y desplaza líneas | Actualizar la columna "Dónde" de las filas afectadas, o sustituir la línea por la sección o el identificador de decisión si es más estable |
| Se retira una nueva referencia del informe base | Añadir la fila a la tabla de referencias retiradas de [10](10-estado-del-arte.md) y cambiar aquí su veredicto a DESCARTADO |
| Una afirmación descartada vuelve en una fase posterior | Cambiar el veredicto a TRANSFORMADO y enlazar la decisión que la recupera |
| Alguien detecta una afirmación del informe base que no está en la matriz | Añadirla como fila 61 en adelante; el conteo debe seguir sumando el total de filas |

## Siguiente paso

Volver al [índice](README.md). Este es el último documento del conjunto.
