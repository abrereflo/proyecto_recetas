# 12 — Preguntas de jurado

Diez preguntas que van a caer, con la respuesta corta que hay que tener ensayada. Cada una cabe en tres frases. Si una respuesta necesita más, es que no está clara todavía. Al final de cada respuesta hay un enlace al documento que la respalda, por si el jurado insiste.

> **Regla de oro del Q&A: si no lo sabemos, lo decimos.** Un "no lo hemos validado todavía, y ese es nuestro siguiente paso" vale más que una respuesta inventada que el jurado desmonta en la repregunta.

---

### 1. ¿Qué construyeron en tres días?

Un contrato desplegado en Avalanche Fuji con dos funciones, `issue` y `dispense`, más dos aplicaciones web: el médico firma con su huella y genera un QR, la farmacia lo escanea y dispensa. Las credenciales de médicos y farmacias son attestations en EAS, con revocación. El segundo intento de dispensar la misma receta revierte, y eso lo pueden ver en vivo. → [09](09-roadmap.md)

### 2. ¿Por qué blockchain y no una base de datos con firma ADSIB?

Una base de datos con firma ADSIB resuelve la autenticidad pero no la unicidad entre organizaciones que no confían entre sí: si cada farmacia tiene su base, ninguna sabe si la receta ya se dispensó en otra. Un registro compartido sin dueño resuelve eso sin que nadie tenga que operar la base de todos ni pedirle permiso. Y además usamos firma ADSIB: no es una alternativa, es la otra mitad. → [07](07-seguridad-y-cumplimiento.md)

### 3. ¿Quién paga el gas y cómo firma un médico que no sabe qué es una wallet?

El médico firma con la huella de su teléfono: es una passkey, la misma tecnología con la que desbloquea el banco, y no hay frase semilla ni extensión. El gas lo paga un paymaster que patrocina solo a cuentas con credencial profesional vigente y solo para llamadas a nuestro contrato. En producción lo financiaría la clínica o la caja de salud; el coste por receta en esta red es bajo, pero es un número que vamos a medir, no a estimar. → [01](01-arquitectura.md)

### 4. Si la receta se cifra con la clave del paciente, ¿cómo la lee la farmacia?

No se cifra con la clave del paciente: esa es una de las cosas que corregimos del planteamiento inicial. Cada receta se cifra con su propia clave simétrica, y esa clave se envuelve por separado para cada destinatario. En el MVP la clave viaja dentro del QR, así que quien tiene el código puede leer la receta, exactamente igual que quien tiene el papel hoy. → [05](05-almacenamiento-y-cifrado.md)

### 5. ¿Qué queda visible de un paciente en la cadena?

Nada que lo identifique. On-chain solo hay un hash del documento cifrado y un compromiso `keccak256(cédula, sal)` con una sal distinta en cada receta, de modo que dos recetas del mismo paciente no se pueden relacionar ni siquiera por nosotros. Lo que sí queda visible son metadatos del grafo de transacciones —qué médico emite cuánto y qué farmacia dispensa cuándo— y eso lo decimos abiertamente: es la contrapartida de usar una cadena pública y la línea de trabajo con pruebas de conocimiento cero. → [03](03-modelo-de-datos.md)

### 6. ¿Quién certifica que una dirección es un médico real y cómo se revoca?

Un emisor autorizado firma una attestation en EAS que dice "esta dirección corresponde a la matrícula X, válida hasta tal fecha", y el contrato la verifica en cada emisión. Si el médico pierde la matrícula, el emisor revoca y la siguiente emisión revierte de inmediato, sin desplegar nada. En el MVP ese emisor lo simulamos nosotros; el emisor natural es el Colegio Médico, y conseguirlo es trabajo institucional, no técnico. → [02](02-roles-y-permisos.md)

### 7. ¿Qué parte es inteligencia artificial de verdad y qué pasa si alucina?

Ninguna, y eso es deliberado. Lo que tenemos es un motor de reglas determinístico que cruza el fármaco prescrito contra las alergias y la medicación que el médico declara en la propia receta y contra la clasificación ATC, usando bases abiertas: misma entrada, misma salida, siempre, y podemos explicar cada alerta. No alucina porque no genera nada; si algún día incorporamos un modelo, tendremos que declarar cuál, dónde corre y por qué no salen datos de pacientes hacia una API externa. → [06](06-validacion-clinica.md)

### 8. ¿Cómo manejan la receta crónica y la dispensación parcial?

Hoy no las manejamos: el MVP es de un solo uso, y lo decimos porque es la mitad del volumen real de una farmacia. El diseño de la extensión está documentado, con contadores de cantidad y de retiros, y con una alternativa interesante que estamos evaluando: modelar la receta crónica como varias recetas de un solo uso con fechas de activación escalonadas, que reutiliza el contrato sin cambiarlo. Es lo primero que se construye después del buildathon. → [04](04-smart-contracts.md)

### 9. ¿Cuál es el incentivo de la farmacia para adoptarlo, y el del laboratorio para correr un nodo?

La farmacia gana poder rechazar una receta ya dispensada, que hoy no puede detectar, y dejar evidencia de qué entregó y cuándo ante una auditoría. El laboratorio no necesita correr ningún nodo: esa era una idea del planteamiento de consorcio que abandonamos al pasarnos a una cadena pública, donde la infraestructura ya existe. El incentivo real todavía no lo hemos validado con farmacéuticos de Cochabamba, y esa validación es parte del plan. → [13](13-pitch-y-sostenibilidad.md)

### 10. ¿Cuánto cuesta una receta en gas y cuánto tarda en verificarse?

Lo vamos a medir en el buildathon y les damos el número real, no una estimación. La verificación es una lectura del contrato, así que no cuesta gas y tarda lo que tarde la consulta al nodo; la escritura es una transacción ordinaria en la C-Chain de Avalanche, barata pero todavía sin medir. Si alguien pregunta por cifras exactas ahora mismo, la respuesta honesta es que aún no las tenemos medidas. → [08](08-stack-y-entorno.md)

---

## Preguntas trampa y cómo no caer

| Pregunta | Trampa | Respuesta segura |
|---|---|---|
| "¿Esto elimina el fraude de recetas?" | Decir que sí | "Elimina la reutilización y verifica al emisor. No impide que un médico corrupto emita recetas válidas ni la colusión con una farmacia. Eso lo detecta una auditoría posterior, no la cadena" |
| "¿Cumple con la ley boliviana?" | Afirmarlo | "El diseño contempla la doble firma con ADSIB, que es lo que le daría validez legal. Todavía no está implementada y necesitamos asesoría legal local" |
| "¿Y la ley de protección de datos?" | Inventar una | "Hasta donde hemos podido verificar, Bolivia no tiene una ley general de protección de datos; existe la vía constitucional del artículo 130. Adoptamos minimización y cifrado por decisión propia, no por obligación" |
| "¿Tienen datos del problema en Bolivia?" | Inventar una cifra | "No. Nuestra fuente es investigación argelina y literatura estadounidense. Validar el problema en Cochabamba con entrevistas es nuestro siguiente paso, y preferimos decirlo" |
| "¿Por qué no Solana o Hyperledger?" | Descalificar otras cadenas | "Elegimos EVM por el tooling de abstracción de cuenta y passkeys, y dentro de EVM la C-Chain de Avalanche porque tiene el precompilado RIP-7212 de verificación P-256 y lo comprobamos nosotros. Eso es lo que permite que el médico firme con la huella y no toque una wallet. Es la razón concreta, no una preferencia de ecosistema" |
| "¿Escala a todo el país?" | Decir que sí | "No lo hemos medido. La C-Chain procesa este volumen sin problema en teoría, pero no hemos hecho pruebas de carga y no vamos a afirmarlo" |
| "¿Trazan el medicamento desde el laboratorio?" | Decir que sí con ATC | "No. ATC clasifica fármacos, no rastrea unidades; para eso hace falta serialización GS1. Es un producto distinto y lo dejamos fuera a propósito" |
| "¿Sirve para estupefacientes y psicotrópicos, que es donde está el problema?" | Decir que sí | "Todavía no, y es deliberado. Hoy se controlan con el formulario valorado que emite el SEDES y que la farmacia retiene: el papel numerado **es** el control, y sustituirlo requiere autorización, no una decisión nuestra. Los excluimos del piloto. Pero ese recetario es justamente nuestro modelo en papel: uso único, numerado por autoridad, retenido como prueba" |
| "¿Contra qué cruzan la alergia? ¿De dónde sale el historial del paciente?" | Decir "del historial en la blockchain" | "De lo que el médico declara en el formulario en ese momento. No hay historial del paciente: nuestro modelo de privacidad impide agrupar sus recetas, y eso lo elegimos. El motor no detecta nada que el médico no sepa o no declare. El historial de la clínica, con consentimiento, es Fase 2" |

## Siguiente paso

Continuar con [13-pitch-y-sostenibilidad.md](13-pitch-y-sostenibilidad.md).
