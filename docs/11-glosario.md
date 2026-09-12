# 11 — Glosario

Términos usados en esta documentación, con la definición que aplica en este proyecto. Si un término aparece en otro documento con un significado distinto, manda este.

## Ethereum y cuentas

| Término | Definición |
|---|---|
| **L2** | Red que ejecuta transacciones fuera de la cadena principal de Ethereum y publica en ella sus datos o pruebas, heredando su seguridad con coste mucho menor. Se define aquí porque el término aparece en la literatura del sector: **este proyecto no corre sobre un L2** |
| **Avalanche Fuji** | Testnet de la C-Chain de Avalanche, su cadena compatible con el EVM. Es donde corre este proyecto: `chainId` 43113, moneda nativa AVAX. Avalanche es una **L1 independiente**, con validadores y consenso propios: ejecuta bytecode del EVM, pero no hereda la seguridad de Ethereum, no publica en ella datos ni pruebas y no tiene secuenciador |
| **Testnet** | Red de pruebas cuyo token no tiene valor económico |
| **EOA** | Cuenta controlada por una clave privada (externally owned account). Es la wallet tradicional |
| **Smart account** | Cuenta que es un contrato: define por sí misma qué firmas acepta y qué operaciones permite |
| **ERC-4337** | Estándar de abstracción de cuenta que permite smart accounts sin cambiar el protocolo de Ethereum |
| **UserOperation** | Intención firmada por el usuario en ERC-4337. Todavía no es una transacción |
| **EntryPoint** | Contrato canónico de ERC-4337 que valida y ejecuta lotes de `UserOperation` |
| **Bundler** | Servicio que agrupa `UserOperation` y las envía a la cadena pagando el gas |
| **Paymaster** | Contrato que se compromete a pagar el gas de una operación según una política. Es lo que permite que el médico no compre AVAX |
| **EIP-7702** | Mecanismo que permite a una EOA delegar temporalmente en código de contrato, obteniendo capacidades de smart account |
| **Gas** | Unidad de coste computacional de una transacción en Ethereum |
| **`revert`** | Interrupción de una transacción que deshace todos sus efectos. Es lo que ocurre al intentar dispensar dos veces |
| **`block.timestamp`** | Marca de tiempo del bloque, fijada por quien lo propone. Precisa en segundos pero no es un reloj exacto |

## Firma y credenciales

| Término | Definición |
|---|---|
| **EIP-712** | Estándar de firma de datos estructurados y tipados, que el usuario ve en texto legible en lugar de una cadena hexadecimal |
| **Passkey** | Credencial criptográfica almacenada en el enclave seguro del dispositivo, usada con huella, rostro o PIN. Reemplaza la contraseña y la frase semilla |
| **WebAuthn** | Estándar web que permite a un navegador usar passkeys |
| **secp256k1** | Curva elíptica que usa Ethereum para firmar |
| **secp256r1 (P-256)** | Curva elíptica que usan WebAuthn y los enclaves seguros. **No es la misma que la de Ethereum** |
| **RIP-7212** | Precompilado que permite al EVM verificar firmas P-256 a coste razonable. Es lo que hace viables las passkeys on-chain. Está disponible en `0x…0100` en Avalanche Fuji, comprobado con una firma P-256 propia |
| **EAS** | Ethereum Attestation Service. Infraestructura para emitir afirmaciones firmadas y revocables sobre direcciones |
| **Attestation** | Afirmación firmada por un emisor sobre un sujeto, con esquema tipado. Aquí acredita a médicos y farmacias |
| **ADSIB** | Agencia para el Desarrollo de la Sociedad de la Información en Bolivia. Autoridad de certificación estatal de firma digital |
| **X.509** | Formato estándar de certificado digital. El de ADSIB lo usa, con RSA |
| **PKCS#7** | Formato de firma digital sobre certificados X.509 |
| **Doble firma** | Firmar el mismo hash dos veces: con certificado ADSIB para validez legal boliviana y con la smart account para anclaje verificable on-chain |
| **Recuperación social** | Mecanismo por el que un umbral de guardianes designados autoriza recuperar el control de una cuenta |

## Criptografía y almacenamiento

| Término | Definición |
|---|---|
| **DEK** | Data encryption key. Clave simétrica que cifra un documento concreto. Aquí es única por receta |
| **Envelope encryption** | Cifrar el documento una vez con una DEK y envolver esa DEK por separado para cada destinatario |
| **AES-256-GCM** | Cifrado simétrico autenticado: además de confidencialidad, detecta manipulación del ciphertext |
| **Proxy re-encryption** | Técnica que permite a un tercero semi-confiable transformar un ciphertext para un nuevo destinatario sin ver el contenido ni la clave |
| **Crypto-shredding** | Destruir la clave para que el dato cifrado quede irrecuperable. Es la respuesta técnica a una solicitud de supresión cuando el dato ya se distribuyó |
| **Compromiso (hash + salt)** | `keccak256(dato, sal)`. Permite probar después que se conocía el dato sin revelarlo. Con sal distinta por receta, dos compromisos del mismo paciente no se pueden relacionar |
| **keccak256** | Función hash que usa el EVM |
| **ZK (conocimiento cero)** | Familia de técnicas que permiten demostrar una afirmación sin revelar los datos que la sustentan |
| **IPFS** | Sistema de archivos distribuido con direccionamiento por contenido |
| **CID** | Content identifier. Nombre de un contenido en IPFS, derivado de su hash. **No es almacenamiento**: sin pinning el contenido se pierde. Término del informe base; el diseño actual identifica la receta con `contentHash` y un `pointer` opaco, no con un CID. Ver [05](05-almacenamiento-y-cifrado.md), D-08 |
| **Pinning** | Marcar un contenido para que un nodo IPFS no lo elimine. Sin pinning no hay persistencia |
| **IPLD** | Modelo de datos enlazados de IPFS, con el que el informe base proponía estructurar los registros. Término del informe base. No se usa en el diseño actual, que almacena el payload cifrado en Postgres; ver [05](05-almacenamiento-y-cifrado.md), D-08 |
| **IPNS** | Puntero mutable a un CID. Término del informe base. **Excluido del MVP** por lentitud e inestabilidad; ver [05](05-almacenamiento-y-cifrado.md), D-08 |
| **DHT** | Tabla de hash distribuida. Localiza qué nodo tiene un bloque; no lo almacena. Término del informe base, donde se usaba entre nodos del consorcio. No se usa en el diseño actual, que no tiene consorcio ni IPFS; ver [05](05-almacenamiento-y-cifrado.md), D-08 |

## Salud e interoperabilidad

| Término | Definición |
|---|---|
| **ATC** | Clasificación anatómica, terapéutica y química. **Clasifica** fármacos por grupo; no identifica ni rastrea unidades físicas |
| **GS1 / GTIN** | Estándares de identificación de productos comerciales. Con número de serie y lote permiten rastrear una unidad concreta. Es lo que ATC no hace |
| **Principio activo** | Sustancia responsable del efecto terapéutico, con independencia de la marca |
| **HL7 FHIR R4** | Estándar de interoperabilidad en salud. Define recursos como `MedicationRequest`, `Patient`, `MedicationDispense` |
| **EMR** | Electronic medical record. Registro clínico electrónico de un paciente |
| **AGEMED** | Agencia estatal boliviana de medicamentos y tecnologías en salud. Mantiene el registro sanitario |
| **SNIS** | Sistema Nacional de Información en Salud de Bolivia |
| **SUS** | Sistema Único de Salud boliviano, en el marco de la Ley 1152 |
| **SEDES** | Servicio Departamental de Salud. El de Cochabamba es el interlocutor natural del piloto |
| **Doctor shopping** | Obtener recetas duplicadas acudiendo a varios prescriptores. Problema documentado sobre todo en el contexto estadounidense de opioides |
| **Receta apócrifa** | Receta falsificada, alterada o emitida por quien no tiene facultad para prescribir |
| **Duplicidad terapéutica** | Prescribir dos fármacos del mismo grupo terapéutico sin justificación clínica |
| **Human-in-the-loop** | Diseño en el que ninguna salida automática tiene efecto sin decisión explícita de una persona |
| **Break-the-glass** | Acceso de emergencia a datos sin consentimiento previo, con auditoría obligatoria posterior. No implementado en este MVP |
| **Fatiga de alertas** | Degradación de la atención del profesional ante un exceso de avisos, que lleva a descartar sin leer |

## Términos del proyecto

| Término | Definición |
|---|---|
| **`contentHash`** | keccak256 del documento cifrado. Es lo que se registra on-chain e identifica la receta |
| **`patientCommitment`** | `keccak256(patientId, salt)` con sal única por receta. Lo único que representa al paciente on-chain |
| **QR** | Código que el paciente recibe. Contiene `contentHash`, el puntero al documento cifrado y la clave de descifrado |
| **Motor de reglas** | Componente determinístico de validación clínica. **No es IA**, y llamarlo así sería inexacto |

## Siguiente paso

Continuar con [12-preguntas-de-jurado.md](12-preguntas-de-jurado.md).
