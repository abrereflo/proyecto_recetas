# 16 — Plan de ejecución verificado

El tiempo que queda hasta el cierre de entrega es la restricción que domina cualquier otra decisión. Este documento reemplaza tres supuestos del conjunto documental por mediciones tomadas el 11 de septiembre de 2026, antes de escribir la primera línea de contrato, y libera el presupuesto del primer día que [09](09-roadmap.md) había reservado para verificar el riesgo más alto de su tabla.

## Verificaciones resueltas

| Afirmación previa | Estado en los docs | Resultado verificado |
|---|---|---|
| Precompilado P-256 (RIP-7212) disponible en Base Sepolia | `VERIFICAR:` en [01](01-arquitectura.md) y riesgo Media/Alto en [09](09-roadmap.md) | **Confirmado, disponible y funcionando** |
| `chainId` de Base Sepolia = 84532 | `SUPUESTO:` en [01](01-arquitectura.md) | **Confirmado: 84532** |
| Direcciones de EAS y EntryPoint en Base Sepolia | [08](08-stack-y-entorno.md) las omitía deliberadamente, a la espera de esta comprobación | **Confirmadas, con código desplegado** |

## Cómo se verificó RIP-7212

Lo que importa aquí es que el resultado se pueda reproducir, no solo que se pueda enunciar. Se generó localmente un par de claves P-256 y una firma con la API WebCrypto de Node 24, sin reutilizar vectores de prueba publicados, normalizando `s` a la mitad inferior del orden de la curva. La entrada de 160 bytes, `sha256(mensaje) || r || s || pubX || pubY`, se envió mediante `eth_call` a la dirección `0x0000000000000000000000000000000000000100` en Base Sepolia.

| Caso de prueba | Resultado |
|---|---|
| Firma válida | **Aceptada (`0x…01`)** |
| Hash alterado en un byte | Rechazada (respuesta vacía) |
| `r` alterado (xor 1) | Rechazada (respuesta vacía) |
| Clave pública en ceros | Rechazada (respuesta vacía) |
| Entrada truncada a 96 bytes | Rechazada (respuesta vacía) |

> **Por qué importa el control negativo.** Un precompilado que respondiera con éxito ante cualquier entrada sería indistinguible de uno que verifica de verdad si solo se prueba el caso positivo. Rechazar las cuatro variantes manipuladas —hash, `r`, clave pública y longitud de la entrada— es lo que demuestra que el precompilado efectivamente verifica la firma y no devuelve un valor fijo.

El precompilado también está presente en Optimism Sepolia (11155420) y en Arbitrum Sepolia (421614). Base Mainnet y Avalanche Fuji fueron inalcanzables desde la red usada para esta prueba; esto **no** es un veredicto sobre esas dos redes, es una comprobación que falta.

## Direcciones confirmadas en Base Sepolia

Todas las direcciones siguientes se comprobaron contra el bloque de cabeza aproximado 46.707.234.

| Contrato | Dirección | Comprobación |
|---|---|---|
| EAS | `0x4200000000000000000000000000000000000021` | `version()` devuelve `1.2.0`; su `getSchemaRegistry()` apunta a `0x4200000000000000000000000000000000000020` |
| SchemaRegistry | `0x4200000000000000000000000000000000000020` | `version()` devuelve `1.2.0` |
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Con código |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Con código |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | Con código |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Con código |

> EAS y SchemaRegistry son proxies: que una dirección tenga código no basta para confirmar su identidad. Por eso se les pidió `version()` a ambas y se comprobó la referencia cruzada entre ellas, en lugar de conformarse con "tiene bytecode".

El RPC público `https://sepolia.base.org` tuvo timeouts intermitentes durante estas pruebas. Cualquier script de despliegue o verificación debe usar reintentos con backoff; un fallo aislado no es evidencia de que algo esté roto.

## Orden de ejecución

1. `PrescriptionRegistry.sol` con `test_dispense_twice_reverts` pasando en Foundry. **Criterio de salida:** el test pasa. Nada más empieza antes de esto.
2. Despliegue y verificación en Base Sepolia, con la dirección anotada en el README de la raíz. **Criterio de salida:** dirección pública y explorable. Desbloquea todo lo que necesita hablar contra un contrato real.
3. Esquemas EAS y attestations de prueba para médico y farmacia. **Criterio de salida:** el contrato rechaza a una cuenta sin credencial. Desbloquea la CLI de demo, que necesita cuentas acreditadas para completar el guion.
4. **CLI de demo** (`issue` → `dispense` → `dispense` mostrando el `revert`). **Criterio de salida:** corre de punta a punta contra el contrato desplegado. Desbloquea un entregable válido con independencia del estado de las dos aplicaciones web.
5. Smart account y paymaster, flujo patrocinado sin que el médico tenga ETH. **Criterio de salida:** una emisión sin que el médico posea ETH. Desbloquea las dos aplicaciones, que dependen de esta capa para no pedirle gas al usuario.
6. App del médico (formulario, cifrado, EIP-712, QR). **Criterio de salida:** QR generado y legible.
7. App de farmacia (escáner, verify, dispense). **Criterio de salida:** el segundo escaneo muestra el rechazo.
8. README de entrega completo: funcionalidades, instalación, ejecución y enfoque de integración técnica. **Criterio de salida:** cumple los tres materiales exigidos en [15](15-track-y-entrega.md).
9. Ensayo cronometrado. **Criterio de salida:** tres pasadas seguidas por debajo de tres minutos, sin fallos.
10. Reglas clínicas, y solo entonces cualquier otra cosa. **Criterio de salida:** una alerta visible en la demo.

> **El único cambio de fondo respecto a [09](09-roadmap.md) es este: la CLI sube a la posición 4, antes que las aplicaciones web.** [15](15-track-y-entrega.md) ya establece que una CLI es un formato de entrega aceptado; ponerla antes que el frontend convierte el entregable en algo que ya no depende de terminar dos SPA. Las aplicaciones web dejan de ser un requisito para tener algo que entregar y pasan a ser una mejora sobre un entregable ya válido.

## Lo que sigue sin resolverse

| Asunto | Dónde vive | Por qué importa ahora |
|---|---|---|
| La clave de descifrado viaja sin envolver dentro del QR | [05](05-almacenamiento-y-cifrado.md), D-24 | Quien fotografíe el QR puede leer la receta completa de forma indefinida; el uso único protege contra la re-dispensación, no contra la lectura. Los docs equiparan esto al papel, con un matiz que conviene no perder: una receta de papel fotografiada exige proximidad física; una imagen del QR se puede copiar y archivar sin límite |
| Una passkey WebAuthn es una clave de firma únicamente | [05](05-almacenamiento-y-cifrado.md), D-24 | No permite acuerdo de claves (ECDH), así que hoy no existe mecanismo para envolver la clave por destinatario; esto bloquea toda la Fase 2 |
| Correlación de metadatos en cadena pública | [03](03-modelo-de-datos.md) D-06, [07](07-seguridad-y-cumplimiento.md) | Reconocida como no mitigada, sin mitigación intermedia prevista ni siquiera para el piloto |
| Contradicción sobre AGEMED | [07](07-seguridad-y-cumplimiento.md) lo presenta como control de cumplimiento activo, mientras D-07 en [03](03-modelo-de-datos.md) indica que en el MVP se prescribe solo por ATC y principio activo porque su disponibilidad legible por máquina está sin verificar | Un jurado técnico que lea ambos documentos lo notará; conviene alinear el 07 con la posición del 03 antes de la demo |

## Siguiente paso

Lo único que puede anular la entrega con independencia del estado del código está en [15-track-y-entrega.md](15-track-y-entrega.md): la plataforma de entrega no se pudo confirmar contra la fuente oficial del evento, y eso es bloqueante.
