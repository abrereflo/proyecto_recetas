# 02 — Roles y permisos

La autorización se resuelve con una pregunta: ¿esta dirección tiene una attestation profesional vigente y no revocada? El contrato la responde consultando EAS antes de permitir emitir o dispensar. No hay listas blancas mantenidas a mano, no hay roles en base de datos y no hay administrador que pueda emitir recetas.

## Actores

| Actor | Identidad técnica | Acreditado por | Puede |
|---|---|---|---|
| Médico | Smart account ERC-4337 con passkey | Attestation `PractitionerCredential` | Firmar recetas (EIP-712, off-chain) |
| Farmacia | Smart account ERC-4337 | Attestation `PharmacyCredential` | Enviar la transacción de dispensación |
| Paciente | Ninguna en el MVP | No aplica | Recibir y presentar el QR |
| Emisor de credenciales | Cuenta multifirma | Constitución del piloto | Emitir y revocar attestations |
| Operador del paymaster | Cuenta de servicio | Equipo del proyecto | Definir y financiar la política de patrocinio |

> **El paciente no tiene wallet en el MVP.** Es una decisión de producto, no una limitación técnica: añadir gestión de claves al paciente multiplica la fricción y no aporta nada a la demo. Vuelve en [Fase 2](09-roadmap.md), cuando el paciente necesite controlar quién lee su historial.

> **La fila "Farmacia" dice menos de lo que parece.** La credencial acredita al establecimiento, no a la persona que atiende el mostrador, y el esquema no distingue una farmacia independiente de una sucursal de cadena o de la farmacia de un centro de salud. Ambas cosas son huecos del modelo, no detalles de implementación: ver [D-29](#d-29) y [D-30](#d-30).

## Autoridad sanitaria y pagadores: qué reciben

El informe base asignaba a gobierno y aseguradoras la función de "supervisar tendencias de salud pública y procesar reembolsos mediante accesos auditables". Ninguno de los dos actores existe en el MVP y, cuando aparezcan, lo que pueden recibir está acotado por la regla dura de [03](03-modelo-de-datos.md).

| Lo que el informe base prometía | Lo que el diseño permite | Por qué |
|---|---|---|
| Tendencias de salud pública por paciente o por cohorte | **No.** Ni ahora ni en fases posteriores | La sal única por receta impide agrupar las recetas de una persona; es el objetivo de la regla, no un efecto secundario |
| Supervisión agregada | Agregados por prescriptor, por farmacia, por código ATC y por periodo, sin identidad de paciente | Se calculan a partir de eventos on-chain, que ya son públicos, y del registro off-chain con acceso autorizado |
| Reembolsos | Evidencia verificable de emisión y dispensación por receta, presentada por la farmacia o por el paciente | Fuera del MVP; depende de acuerdos con cada pagador. Ver [13](13-pitch-y-sostenibilidad.md) |
| Accesos auditables | Todo acceso al documento cifrado queda registrado off-chain | Ver [07](07-seguridad-y-cumplimiento.md) |

## Matriz de permisos

Leyenda: ✅ permitido, ⚠️ con condición, ❌ prohibido.

| Operación | Médico | Farmacia | Emisor | Operador paymaster | Paciente |
|---|---|---|---|---|---|
| Firmar receta (EIP-712) | ⚠️ con credencial vigente | ❌ | ❌ | ❌ | ❌ |
| `issue` on-chain | ⚠️ opcional, ver nota | ⚠️ al dispensar | ❌ | ❌ | ❌ |
| `dispense` | ❌ | ⚠️ con credencial vigente y receta no dispensada | ❌ | ❌ | ❌ |
| `cancel` | ⚠️ solo el emisor de esa receta y antes de dispensar | ❌ | ❌ | ❌ | ❌ |
| Emitir attestation | ❌ | ❌ | ✅ | ❌ | ❌ |
| Revocar attestation | ❌ | ❌ | ✅ | ❌ | ❌ |
| Descifrar el contenido de la receta | ⚠️ la que emitió | ⚠️ la que le presentan | ❌ | ❌ | ⚠️ vía QR, ver [05](05-almacenamiento-y-cifrado.md) |
| Cambiar la política del paymaster | ❌ | ❌ | ❌ | ✅ | ❌ |
| Actualizar el contrato | ❌ | ❌ | ❌ | ❌ | ❌ |

> **Nota sobre `issue`.** El médico firma off-chain. El registro on-chain puede hacerse en ese momento (el médico emite, patrocinado por el paymaster) o diferirse a la dispensación (la farmacia presenta firma y datos, y el contrato verifica la firma EIP-712). El MVP implementa el registro en el momento de la emisión porque hace la demo más legible; la variante diferida queda documentada en [04](04-smart-contracts.md).

## Condiciones evaluadas en el contrato

| Condición | Dónde se evalúa |
|---|---|
| Attestation existe y su `revocationTime` es cero | `PrescriptionRegistry` contra EAS |
| `block.timestamp` dentro de `validFrom` y `validUntil` de la credencial | `PrescriptionRegistry` |
| El emisor de la attestation es el emisor autorizado del piloto | `PrescriptionRegistry` |
| La receta no fue dispensada | `PrescriptionRegistry` |
| `block.timestamp < expiresAt` | `PrescriptionRegistry` |
| Firma EIP-712 válida para el `prescriber` declarado | `PrescriptionRegistry` (variante diferida) |

## Ciclo de vida de una credencial

```mermaid
stateDiagram-v2
    [*] --> Solicitada
    Solicitada --> Verificada: comprobación de matrícula ante el colegio o la autoridad
    Verificada --> Vigente: attest en EAS
    Vigente --> Expirada: block.timestamp >= validUntil
    Vigente --> Revocada: revoke (pérdida de matrícula, sanción, robo de dispositivo)
    Revocada --> Vigente: nueva attestation tras rehabilitación
    Expirada --> Vigente: renovación con nueva attestation
    Solicitada --> Rechazada: matrícula no verificable
    Rechazada --> [*]
```

| Evento real | Efecto técnico | Latencia |
|---|---|---|
| El médico pierde la matrícula | El emisor revoca la attestation | Inmediata: la siguiente emisión revierte |
| Le roban el teléfono | Recuperación social y rotación de la passkey; ver [D-04](#d-04) | Depende de los guardianes |
| La credencial caduca | Deja de emitir hasta renovar | Inmediata |
| El emisor se equivoca | Revoca y vuelve a emitir | Inmediata |

> **Lo que la revocación no deshace.** Las recetas ya emitidas por ese médico siguen siendo válidas y dispensables hasta su caducidad. Revocar la credencial no invalida retroactivamente lo firmado antes, igual que retirar una licencia no anula las recetas escritas la semana anterior. Si se necesita invalidación retroactiva, es una decisión de producto que hoy no está implementada.

> **Decisión pendiente — D-03**
> **Contexto.** Alguien tiene que ser la autoridad que afirma "esta dirección es un médico con matrícula vigente". En el MVP ese emisor lo simula el equipo, lo que es honesto para una demo pero inaceptable en producción.
> **Opciones.** (a) Colegio Médico departamental o nacional como emisor. (b) Ministerio de Salud o SEDES Cochabamba. (c) La propia clínica emite credenciales para sus profesionales, con el colegio como emisor de segundo nivel. (d) Emisor operado por el proyecto, con acuerdos bilaterales.
> **Recomendación.** Opción (a) como objetivo natural, ya que el colegio es quien ya mantiene el registro de matrículas, con (c) como puente para el piloto porque una clínica decide más rápido que una institución colegiada. La opción (d) reintroduce el intermediario de confianza que el proyecto pretende evitar.
> **Impacto si se difiere.** El pitch queda sin respuesta para "quién certifica que una dirección es un médico real", que es una pregunta segura del jurado. Ver [12](12-preguntas-de-jurado.md).

<a id="d-04"></a>

> **Decisión pendiente — D-04**
> **Contexto.** La passkey vive en un dispositivo. Si el dispositivo se pierde, se rompe o se roba, el médico queda fuera o un tercero queda dentro.
> **Opciones.** (a) Recuperación social: un umbral de M de N guardianes (la clínica, un colega, un segundo dispositivo del propio médico) autoriza rotar la clave de la smart account. (b) El emisor de credenciales actúa como guardián único. (c) Múltiples passkeys registradas desde el inicio en dispositivos distintos. (d) Sin recuperación: se crea una cuenta nueva y se reemite la credencial.
> **Recomendación.** Combinar (c) y (a): registrar al menos dos passkeys en el alta, y recuperación social con la clínica y un colega como guardianes, con retardo temporal antes de que la rotación surta efecto. La opción (b) convierte al emisor en un poder capaz de suplantar a cualquier médico.
> **Impacto si se difiere.** El primer médico que cambie de teléfono queda bloqueado y el piloto pierde credibilidad operativa.

> **Decisión pendiente — D-05**
> **Contexto.** La attestation vincula una dirección con un número de matrícula, pero alguien debe comprobar en el mundo real que quien controla esa dirección es efectivamente esa persona.
> **Opciones.** (a) Verificación presencial en el alta, por la clínica o el colegio. (b) Verificación mediante certificado digital ADSIB, que ya identifica legalmente al titular. (c) Verificación con documento de identidad y prueba de vivacidad por un proveedor.
> **Recomendación.** Opción (b) cuando el médico ya posee certificado ADSIB, porque resuelve simultáneamente la identificación y la doble firma descrita en [07](07-seguridad-y-cumplimiento.md); (a) como camino alternativo. La opción (c) introduce tratamiento de datos biométricos sin un marco de protección de datos claro en Bolivia y no se adopta en esta etapa.
> **Impacto si se difiere.** Toda la cadena de confianza queda apoyada en una afirmación no verificada, que es exactamente el problema que el proyecto dice resolver.

<a id="d-29"></a>

> **Decisión pendiente — D-29: tipo de farmacia en la credencial**
> **Contexto.** El esquema registrado en `contracts/script/RegisterSchemas.s.sol` es `PharmacyCredential(string pharmacyLicense, string sanitaryRegistryRef, address issuerAuthority, uint64 validFrom, uint64 validUntil)`. No tiene campo de tipo, de modo que el sistema no distingue hoy entre una farmacia independiente, una sucursal de una cadena de venta al público y la farmacia de un centro de salud. Las tres se acreditan igual y dispensan igual. La distinción importa por dos motivos: el régimen de sustancias controladas de [07](07-seguridad-y-cumplimiento.md) no es el mismo para una oficina de farmacia que para un servicio hospitalario, y la supervisión agregada que este documento promete —agregados por farmacia— necesita saber qué representa cada dirección.
> **Opciones.** (a) Añadir un campo `pharmacyType` al esquema, con un conjunto cerrado de valores acordado con SEDES. (b) No tocar el esquema y derivar el tipo off-chain desde `sanitaryRegistryRef`, que ya identifica el establecimiento en el registro sanitario. (c) Registrar un esquema distinto por tipo, de modo que el contrato pueda exigir uno u otro según el medicamento. (d) No modelarlo: toda farmacia acreditada es equivalente.
> **Recomendación.** (b) para el piloto, porque no obliga a migrar credenciales ya emitidas y porque la fuente de verdad sobre qué es cada establecimiento es el registro sanitario, no una afirmación del proyecto. Reservar (c) para cuando entren sustancias controladas ([D-18](07-seguridad-y-cumplimiento.md)), que es el único caso conocido en que el contrato necesitaría decidir según el tipo. La opción (a) parece la más simple y es la más cara: un cambio de esquema cambia el uid y obliga a reemitir todas las credenciales vigentes.
> **Impacto si se difiere.** Bajo mientras el piloto sea una clínica y las farmacias de su radio. Alto en cuanto entre una cadena o un servicio hospitalario, porque para entonces habrá credenciales emitidas bajo un esquema que no sabe distinguirlas.

<a id="d-30"></a>

> **Decisión pendiente — D-30: identidad del operador que dispensa**
> **Contexto.** La credencial acredita a la **organización**, nunca a la persona. `credentialOf` asocia una dirección con una attestation, y el registro on-chain guarda `dispensedBy` con esa dirección: quien tenga el dispositivo dispensa como la farmacia. El modelo de amenazas de [07](07-seguridad-y-cumplimiento.md) ya lo admite al declarar no mitigado el caso de una farmacia acreditada que presta su cuenta a un tercero. Esto deja de ser aceptable con sustancias controladas: el *Libro de Control de Estupefacientes* previsto por la Ley 913 y el DS 3434 registra al farmacéutico que dispensa, con nombre. Un asiento que diga únicamente "Farmacia Bolívar, 14:32" no satisface ese requisito, y en una cadena con varios turnos por sucursal tampoco permite responder quién entregó.
> **Opciones.** (a) Una credencial de farmacéutico, análoga a `PractitionerCredential`, de modo que dispensar exija dos acreditaciones: la del establecimiento y la de la persona. (b) Una dirección por operador, todas acreditadas bajo la misma licencia de establecimiento. (c) Registrar al operador solo off-chain, en el almacén cifrado, junto al documento. (d) No modelarlo: la responsabilidad es del establecimiento.
> **Recomendación.** (c) para el piloto ambulatorio, porque añade trazabilidad de persona sin ampliar lo que se escribe en una cadena pública ni multiplicar las credenciales a emitir. (a) es el destino si el proyecto llega a sustancias controladas, y conviene diseñarlo junto con [D-18](07-seguridad-y-cumplimiento.md) en lugar de por separado. La opción (b) parece equivalente a (a) y no lo es: convierte cada alta y cada baja de empleado en una operación on-chain de la autoridad emisora.
> **Impacto si se difiere.** Ninguno sobre la demo. Sobre el piloto, el sistema no puede responder quién entregó un medicamento, que es exactamente la pregunta que un regulador hace primero cuando algo sale mal.

## Privilegio mínimo

| Rol | Lo que explícitamente no puede hacer |
|---|---|
| Médico | Dispensar; reabrir una receta dispensada; emitir credenciales |
| Farmacia | Emitir recetas; modificar contenido; dispensar dos veces la misma receta |
| Emisor de credenciales | Emitir recetas; leer contenido clínico; dispensar |
| Operador del paymaster | Emitir, dispensar o leer contenido. Solo decide a quién patrocina |
| Cualquiera | Escribir un identificador de paciente on-chain: no existe función que lo acepte |

## Siguiente paso

Continuar con [03-modelo-de-datos.md](03-modelo-de-datos.md).
