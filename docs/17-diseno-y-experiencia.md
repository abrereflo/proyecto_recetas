# 17 — Diseño y experiencia

Las maquetas viven en `design/mockups/` y son HTML estático abierto en cualquier navegador, sin compilar nada. No son una ilustración del producto: comparten con las dos aplicaciones el mismo archivo de tokens, de modo que un cambio de color o de espaciado no puede aplicarse en la maqueta y olvidarse en el código. Este documento explica las decisiones que hay detrás y, sobre todo, las que la interfaz tiene prohibido romper.

## Qué hay y dónde

| Archivo | Contenido |
|---|---|
| `design/tokens.css` | Color, tipografía, espaciado, forma, elevación. Fuente única para maquetas y aplicaciones |
| `design/components.css` | Capa de componentes. Cada clase corresponde a un componente React por construir |
| `design/mockups/index.html` | Sistema de diseño: paleta, tipografía, estados, componentes y reglas duras |
| `design/mockups/doctor.html` | Siete pantallas de la aplicación del médico, escritorio |
| `design/mockups/pharmacy.html` | Ocho pantallas de la aplicación de farmacia, móvil |
| `design/mockups/board.css` | Marcos y anotaciones del tablero. No se despliega con el producto |

## Por qué solo una de las dos es PWA

| Aplicación | Formato | Motivo |
|---|---|---|
| Médico | SPA de escritorio | Se usa sentado, con teclado, en una estación de trabajo del consultorio. Instalarla no aporta nada |
| Farmacia | **PWA móvil** | Necesita cámara, se usa de pie en el mostrador y con una sola mano. El acceso desde la pantalla de inicio ahorra pasos en cada dispensación |

Convertir también la aplicación del médico en PWA añadiría manifiesto, service worker y una promesa implícita de funcionamiento sin conexión que el MVP no puede cumplir. La aplicación de farmacia es PWA por la cámara y el gesto de uso, no por instalabilidad como fin en sí mismo.

> El service worker de la PWA cachea el armazón de la aplicación, **nunca contenido clínico ni respuestas de verificación**. Una verificación cacheada mentiría sobre el estado de la receta, que es justamente lo que el sistema existe para impedir.

## Las cuatro decisiones que gobiernan el aspecto

### El color es el ciclo de vida, no decoración

Cada uno de los cuatro colores de estado está atado a un significado del dominio: `success` a *dispensada, firma válida, credencial vigente*; `danger` a *rechazo, revocación, alerta crítica*; `warning` a *alerta clínica que informa pero no bloquea*; `info` a *emitida, pendiente de confirmación*. Un componente que use rojo para algo que no sea un rechazo rompe el vocabulario y obliga al farmacéutico a leer el texto para entender qué ha pasado. En un mostrador con cola, eso es un fallo funcional.

### Todo identificador se renderiza en monoespaciada con cifras tabulares

Huellas de contenido, direcciones, códigos ATC y números de matrícula. Un jurado técnico —y un farmacéutico ante una discrepancia— tienen que poder comparar dos valores columna a columna. Con una tipográfica proporcional no se puede.

### La pantalla de rechazo está dimensionada para leerse a tres metros

El titular del veredicto negativo usa 48 px, no el tamaño de cuerpo. [00](00-vision-y-alcance.md) establece que los tres minutos de demo se construyen alrededor del segundo escaneo rechazado, y [04](04-smart-contracts.md) que ese mensaje es lo que se proyecta en el pitch. En el mostrador real cumple la misma función: el farmacéutico debe verlo sin acercarse el teléfono a la cara.

### El rechazo nombra a quién y cuándo, nunca «operación fallida»

El error `AlreadyDispensed` devuelve `dispensedBy` y `dispensedAt`, y por eso la pantalla puede decir *«ya fue dispensada el 11/09/2026 a las 09:42 por otra farmacia»*. Cada error del contrato tiene su propio mensaje y su propia acción para el farmacéutico: una receta caducada se resuelve pidiendo otra; un contenido alterado exige avisar a la clínica. Colapsar ambos en un genérico convierte dos situaciones muy distintas en el mismo encogimiento de hombros.

## Recorrido del médico

| # | Pantalla | Lo que decide el diseño |
|---|---|---|
| D1 | Acceso con passkey | No aparece la palabra «wallet», ni frase semilla, ni saldo |
| D2 | Paciente y contexto clínico | Aviso obligatorio: el motor solo evalúa lo que se escriba aquí ([D-25](16-plan-de-ejecucion.md)) |
| D3 | Medicación y alerta moderada | Toda alerta cita su evidencia y la versión del conjunto de reglas |
| D4 | Alerta crítica de alergia | Modal con motivo escrito obligatorio; el botón nace deshabilitado |
| D5 | Firma EIP-712 | Datos tipados como frases legibles, nunca un hexadecimal |
| D6 | Receta emitida y QR | Advertencia explícita: quien tiene el código puede leer la receta |
| D7 | Mis recetas | Los cuatro estados, y «Dispensada» sin ninguna acción disponible |

## Recorrido de la farmacia

| # | Pantalla | Lo que decide el diseño |
|---|---|---|
| P1 | Acceso e instalación | La credencial se comprueba antes de habilitar el escáner |
| P2 | Escáner | Pantalla completa; la cámara es toda la interfaz |
| P3 | Verificando | Las cinco comprobaciones, enumeradas. No un spinner |
| P4 | Receta verificada | Confirmar entrega es un acto humano explícito |
| P5 | Dispensada | Comprobante con la evidencia en cadena |
| P6 | **Rechazada por dispensación previa** | El veredicto del pitch, con quién y cuándo |
| P7 | Otros rechazos | Cinco motivos, cinco acciones distintas |
| P8 | Entrada manual | Contingencia si falla la cámara |

## Dos decisiones que a primera vista parecen detalles

**«Caducada» se calcula en el cliente.** No existe en el enum del contrato: el estado almacenado sigue siendo `Issued` y la caducidad se deriva comparando `expiresAt` con la hora del bloque. Una interfaz que espere un valor de enum que nunca llega mostrará «Emitida» sobre una receta vencida, y el farmacéutico descubrirá el problema cuando la transacción falle. [D-13](16-plan-de-ejecucion.md) fija la caducidad a medianoche del día indicado, de modo que la fecha se muestra por días, sin hora.

**Confirmar la entrega es un acto humano, no un efecto del escaneo.** La transición a `Dispensed` es irreversible y no existe reapertura de ningún tipo. Disparar algo irreversible con un gesto pasivo —enfocar un QR— no es una optimización de flujo, es un error de diseño.

## Reglas que la interfaz no puede romper

| Regla | Consecuencia de romperla | Fuente |
|---|---|---|
| Ningún identificador de paciente llega a la cadena: ni la cédula, ni su hash, ni un seudónimo estable | Se publica un dato personal de forma permanente e irreversible | [03](03-modelo-de-datos.md) |
| La sal nunca aparece en el QR, en la URL ni en un enlace compartible | El compromiso deja de proteger la identidad del paciente | [01](01-arquitectura.md), [03](03-modelo-de-datos.md) |
| Nunca aparece «wallet», frase semilla ni saldo | Una herramienta clínica se lee como producto cripto y pierde al usuario | [01](01-arquitectura.md) |
| No existe botón de reapertura sobre una receta dispensada | La interfaz miente sobre la única propiedad que sostiene el proyecto | [04](04-smart-contracts.md) |
| La revocación se comunica como «se revoca el acceso futuro», nunca como borrado retroactivo | Afirmación falsa con consecuencias legales | [07](07-seguridad-y-cumplimiento.md) |
| Se declara que el motor solo evalúa lo que el médico escribe | El médico confía en una cobertura que no existe | [06](06-validacion-clinica.md) |
| No se promete analítica por paciente, detección entre farmacias ni *doctor shopping* | Se promete algo que el diseño cancela de forma deliberada y permanente | [03](03-modelo-de-datos.md), [07](07-seguridad-y-cumplimiento.md) |
| Ninguna alerta clínica bloquea la emisión | Se traslada la responsabilidad clínica a un módulo de reglas | [06](06-validacion-clinica.md) |

## Accesibilidad

| Criterio | Cómo se cumple |
|---|---|
| Objetivo táctil | 44 px mínimo en todo control interactivo |
| Tamaño de cuerpo en formularios | 16 px; por debajo, el navegador móvil hace zoom al enfocar y descoloca la pantalla |
| Foco | Nunca se elimina el contorno, solo se reestiliza: anillo de 3 px con desplazamiento |
| Color como único portador de significado | Prohibido. Todo estado lleva además icono y texto |
| Modo oscuro | Soportado por tokens, por preferencia del sistema y por atributo `data-theme` |
| Movimiento | `prefers-reduced-motion` anula transiciones y animaciones |
| Contraste | Objetivo WCAG AA sobre texto de cuerpo y componentes de interfaz |

> `VERIFICAR:` los ratios de contraste de la paleta no se han medido con una herramienta todavía. Es una comprobación pendiente, no un resultado.

## Decisiones pendientes con impacto directo en pantallas

| Decisión | Qué falta | Efecto en la interfaz |
|---|---|---|
| D-04 | Recuperación si se pierde el dispositivo | Falta la pantalla de alta con registro de una segunda passkey |
| D-07 | Catálogo de medicamentos | Hoy se prescribe solo por principio activo y ATC, sin producto comercial |
| D-13 | Precisión de la caducidad | Se asume medianoche del día de vencimiento; la fecha se muestra sin hora |
| D-15 / D-16 | Alcance real de interacciones y umbrales | El MVP cubre alergias declaradas y duplicidad ATC. No prometer más |
| D-17 | Firma ADSIB | Se muestra como `pending-integration`. No se simula validez legal |
| D-20 | Farmacia sin conectividad | Ninguna pantalla promete funcionamiento sin red |
| D-24 | Clave de descifrado sin envolver en el QR | La advertencia de D6 es la mitigación honesta mientras no exista envoltura por destinatario |
| D-25 | Origen del contexto clínico | Aviso obligatorio en D2 |

## Lo que falta

El modelado en Stitch (Google) no se pudo ejecutar: el servidor MCP responde `Incompatible auth server: does not support dynamic client registration`. Es un bloqueo de autenticación, no de diseño. Las maquetas HTML de este documento cubren el mismo alcance y son la referencia vigente hasta que Stitch quede disponible.

## Siguiente paso

Estas maquetas no alteran el orden de ejecución de [16](16-plan-de-ejecucion.md): el contrato y la prueba `test_dispense_twice_reverts` siguen siendo lo primero, y la CLI de demo sigue por delante de las dos aplicaciones web. Este documento existe para que, cuando llegue el turno del frontend, no haya que improvisar la interfaz a la hora sesenta.
