# Diseño Técnico: StaticWebCatalog

## Resumen ejecutivo

StaticWebCatalog es un editor de catálogo de productos que evoluciona en cuatro etapas: un prototipo local para validar la interfaz, una publicación estática con S3 para hacerlo visible, una arquitectura serverless completa para producción multiusuario y una etapa posterior de comercio electrónico. Este documento explica las decisiones técnicas de cada etapa, las alternativas consideradas, y las razones detrás de cada elección.

---

## Etapa 1: Prototipo local

### Objetivo

Validar la interfaz de usuario: la grilla de productos, el encuadre de las imágenes, el flujo de decisión de precio, y la experiencia de carga. El prototipo corre enteramente en el navegador del autor, sin backend ni base de datos, y persiste hasta 10 productos en el almacenamiento local.

### Decisión central: localStorage con data URI

El prototipo podría haber usado IndexedDB, pero con 10 productos y datos deliberadamente descartables, localStorage alcanza:

`   10 productos × ~107 KB (data URI de JPEG 800px)  ≈  1.1 MB
   Presupuesto de localStorage                        ≈  4.5 MB
                                                       ─────────
                                                       margen 4×
`

IndexedDB sería correcto para producción, pero la diferencia de implementación no se justifica cuando el objetivo es validar apariencia y el contenido se va a tirar.

#### Alternativas consideradas

| Almacenamiento          | Pros                                          | Contras                                       |
|-------------------------|-----------------------------------------------|-----------------------------------------------|
| **localStorage + b64**  | Trivial, sincrónico, sin configuración       | No escala a 100 productos, pierde el original |
| **IndexedDB**           | Escala a cientos, guarda originales          | API async, más código, adelanta trabajo       |
| **Origin Private FS**   | Cuota similar a IndexedDB                    | Soporte desigual, sin ventaja real            |
| **Object URL persistido** | Sin inflación base64                        | Muere al recargar: es un puntero al documento |

La elección de localStorage es deliberadamente técnica para el alcance del prototipo. La deuda se hace explícita: **el data URI escalado es la única copia de la imagen**. Con 100 productos reales eso sería inaceptable; con 10 de prueba es el costo correcto.

### Costura de repositorio: la decisión que amortigua el cambio

Aunque localStorage es sincrónico, toda lectura y escritura pasa por una interfaz de repositorio async:

``js
interface ProductRepository {
  list(): Promise<Product[]>
  add(product: Product, image: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
  count(): Promise<number>
}
``

Esta capa permite sustituir LocalStorageRepository por IndexedDbRepository o ApiRepository sin tocar las vistas. Las cuatro palabras clave `async/wait` que cuesta hoy evitan el único retrofit caro: convertir un árbol de vistas síncronas a asíncronas.
### Modelo de producto

``js
Product {
  id:        string          // uuid generado con crypto.randomUUID()
  name:      string          // editable, no vacío
  priceMode: 'amount' | 'inquire'
  priceCOP:  number | null   // entero ≥ 0 si 'amount'; null si 'inquire'
  image:     string          // data URI en el prototipo
  createdAt: number          // epoch ms, orden de la grilla
}
``

La invariante `priceMode === 'amount' ⟺ priceCOP` es un entero no negativo garantiza que "sin precio" sea una decisión explícita, no un olvido. Esto es importante en un catálogo de venta: un producto sin precio por descuido se lee como un error; uno que dice "Consultar precio" se lee como una decisión.

### Encuadre sin recorte

Un catálogo mezcla orientaciones. Las dos opciones de `object-fit` fallan de maneras distintas:

| Opción           | Comportamiento                          | Problema                             |
|------------------|-----------------------------------------|--------------------------------------|
| cover          | Recorta para llenar el contenedor       | Mutila productos verticales (vestidos, personas) |
| contain        | Muestra la imagen completa con aire     | La grilla se ve irregular            |

Se elige contain con fondo neutro: recortar el producto que se está vendiendo es peor que un poco de aire. La proporción del contenedor es 4:5, la habitual en catálogos de venta.

### Decisión de precio explícita

Cada fila de la zona de pendientes exige una decisión antes de poder confirmarse: un monto en COP, o la marca "Consultar precio". El precio es opcional, pero la decisión no. Esto se traduce en dos estados de la fila:

- **Sin resolver**: no se puede confirmar, se señala como pendiente.
- **Resuelto**: tiene un monto o está marcado como "consultar".

La confirmación es parcial: solo las filas resueltas se agregan al catálogo; las demás permanecen con su estado intacto.

### Límites y advertencias

- **Máximo 10 productos**: validado en el repositorio, no en la vista.
- **Datos descartables**: se advierte que el contenido es de prueba y vive solo en este navegador.
- **Advertencia al salir**: con filas pendientes, el navegador solicita confirmación antes de recargar.

---

## Etapa 2: Publicación estática con S3

### Objetivo y frontera

Stage 2 hace visible para terceros el catálogo de un solo vendedor sin convertirlo en un backend. La autoría continúa siendo local: el navegador del autor mantiene los registros en `localStorage`, genera un paquete exportable y el publicador externo lo transforma en una publicación versionada. El visitante solo lee HTML, JavaScript, CSS, `manifest.json` e imágenes; no existen controles de edición ni APIs de escritura en el sitio publicado.

El límite contractual de Stage 2 es de **100 productos**. La capacidad se define una sola vez en el dominio y se valida en el repositorio, la exportación, el manifiesto y el preflight del publicador. Un lote de 101 productos falla antes de resolver un cliente autorizado o ejecutar cualquier `PutObject`; el release anterior y su puntero permanecen vigentes. Esta ampliación reemplaza el límite de 10 productos de Stage 1 únicamente para el modelo Stage 2; Stage 1 sigue documentado como prototipo local.

Stage 2 queda deliberadamente fuera de alcance para autenticación de vendedores, Lambda, API Gateway, DynamoDB u otra base de datos, sincronización en tiempo real, pagos, inventario y pedidos. Esas capacidades pertenecen a Stage 3 y Stage 4, que permanecen como etapas futuras en este documento.

### Arquitectura

`
   AUTOR (local)                      VISITANTE
        │                                 │
        ▼                                 ▼
   Editor en el         ┌──────────────────────────┐
   navegador            │   CloudFront + OAC        │
        │               │  lee current.json        │
        ▼               │  sirve releases/<id>/*  │
   ExportPackage       └───────────┬──────────────┘
        │                          │ GET
        ▼                          ▼
   Publicador Node-only      ┌───────────────────────┐
   (perfil/rol autorizado)   │ S3 privado             │
        │                     │ releases/<id>/*       │
        └────────────────────▶│ releases/current.json │
                              │ lectura exclusiva OAC │
                              └───────────────────────┘
`

La aplicación de autoría no sube a S3. El publicador se ejecuta fuera del bundle del navegador con Node.js y recibe autorización del perfil AWS, rol de CI o proveedor de credenciales temporales del entorno de ejecución. Ni la aplicación web, ni `ExportPackage`, ni el paquete público contienen claves, tokens, roles o permisos de escritura AWS. El modo `s3-public-prototype` es una excepción aislada para demostraciones y no es una configuración de producción.

### Modelo Stage 2 y características

El `ProductRecord` conserva la identidad y los datos de Stage 1, y añade una lista ordenada opcional de características:

```js
ProductRecord {
  id:             UUID,
  name:           string,                 // no vacío, se recorta al confirmar
  priceMode:      'amount' | 'inquire',
  priceCOP:       integer >= 0 | null,
  image:          string,                 // JPEG procesado en data URI durante autoría
  createdAt:      number | ISO-8601,      // epoch ms local; fecha válida en contratos
  characteristics: Array<{
    label: string,                        // 1–40 caracteres después de recortar
    value: string                         // 1–120 caracteres después de recortar
  }>                                     // 0–12 pares, orden estable
}
```

`characteristics` es una lista, no un mapa: conserva el orden de presentación y permite etiquetas repetidas. Cada par se normaliza sin mutar la entrada; se recortan `label` y `value`, se rechazan cadenas vacías y se rechazan listas de más de 12 elementos. Los límites son parte del contrato v1 y deben provenir de las constantes compartidas, no de una validación exclusiva de la UI.

La invariante de precio es bidireccional: `priceMode: 'amount'` exige un entero COP no negativo y `priceMode: 'inquire'` exige `priceCOP: null`. No se publica una combinación ambigua. La exportación y el manifiesto conservan `priceMode`, `priceCOP`, el orden de `characteristics`, `id`, `name` y `createdAt`.

### Compatibilidad con Stage 1

Los registros válidos de Stage 1 se convierten de manera **no destructiva** al modelo Stage 2. El conversor conserva exactamente `id`, `name`, `priceMode`, `priceCOP`, `image` y `createdAt`, y agrega `characteristics: []` cuando el campo no existe. Cada registro convertido recibe su propia lista vacía; la conversión no modifica, borra ni reescribe el objeto fuente ni el valor original de `localStorage`.

Durante la lectura/exportación, los registros malformados se reportan con su posición o identificador y se excluyen del lote; no se inventan nombre, precio o imagen. Los registros válidos siguen disponibles en modo local y una publicación solo se inicia después de una validación explícita del lote completo.

### Contratos de exportación y manifiesto

`ExportPackage` es la entrada portable al publicador, no una base de datos pública. La versión actual es `stage2-export-v1`:

```js
ExportPackage {
  schemaVersion: 'stage2-export-v1',
  generatedAt: ISO-8601 UTC datetime,
  products: ProductRecord[],             // máximo 100, orden createdAt descendente
  images: Array<{
    productId: UUID,
    contentType: 'image/jpeg',
    data: string                          // JPEG procesado como data URI
  }>
}
```

Cada producto debe tener exactamente una imagen procesada asociada por `productId`; nombres duplicados no son un problema porque la identidad estable es el UUID. El paquete no incluye credenciales, tokens, roles, permisos ni configuración secreta. `generatedAt` identifica el momento de preparación del paquete y se serializa como fecha UTC ISO-8601.

`PublicManifest` es el contrato público autocontenido y versionado, `stage2-manifest-v1`:

```js
PublicManifest {
  schemaVersion: 'stage2-manifest-v1',
  generatedAt: ISO-8601 UTC datetime,
  catalogLimit: 100,
  products: Array<{
    id: UUID,
    name: string,
    priceMode: 'amount' | 'inquire',
    priceCOP: integer >= 0 | null,
    createdAt: number | ISO-8601,
    characteristics: Array<{ label: string, value: string }>,
    image: { key: string, contentType: 'image/jpeg' }
  }>
}
```

El generador ordena por `createdAt` descendente y usa el índice original como desempate estable. `serializeManifest` produce JSON UTF-8; `parseManifest` decodifica y valida el esquema antes de entregarlo al renderer. Una versión desconocida, un precio inválido, una característica fuera de límites, una fecha no válida, una referencia de imagen insegura o una capacidad superior a 100 rechaza la operación.

La función de clave de imagen acepta únicamente `releaseId` y UUID de producto controlados y usa el formato fijo `.jpg`/`image/jpeg`:

```text
releases/<release-id>/images/<product-uuid>.jpg
```

No usa `name`, `label`, `value` ni ningún texto controlado por el usuario como componente de ruta. La clave debe permanecer dentro del prefijo del release, ser determinista y ser única para IDs distintos.

Las pruebas property-based comparan valores contractuales, no prototipos de objetos. Para evitar diferencias de prototipos entre objetos deserializados, value objects y fixtures, se decidió usar `toPlainData` únicamente en las aserciones: recorre recursivamente arrays y objetos y los convierte en datos planos antes de `deepEqual`. No es una normalización de producción ni relaja la validación; las invariantes se validan por separado.

### Layout de objetos y caché

Cada release se escribe bajo un prefijo nuevo e inmutable:

```text
releases/<release-id>/index.html
releases/<release-id>/assets/...
releases/<release-id>/manifest.json
releases/<release-id>/images/<product-uuid>.jpg
releases/current.json
```

Los artefactos de `releases/<release-id>/` nunca se sobrescriben. `releases/current.json` es el único objeto mutable y contiene solamente el `releaseId` y la ruta del manifiesto completo, por ejemplo `{ "releaseId": "...", "manifest": "releases/<release-id>/manifest.json" }`. El renderer resuelve la publicación actual mediante ese puntero o usa el manifiesto del release cuando la aplicación ya está servida dentro de un prefijo versionado.

- Manifiesto y assets versionados: `Cache-Control: public, max-age=31536000, immutable`.
- Puntero `releases/current.json`: `Cache-Control: no-cache, max-age=0, must-revalidate`.
- `Content-Type`: `application/json` para manifiesto/puntero, `image/jpeg` para imágenes y el tipo correspondiente para HTML, JavaScript, CSS y demás assets.

### Flujo de publicación, validación y rollback

El flujo canónico es **preflight → upload → verificación → pointer**:

1. **Preflight:** valida `ExportPackage`, esquema, UUID, fechas, precio, características, imágenes, capacidad, claves, colisiones y ausencia de campos secretos; genera `PublicManifest` y arma el paquete autocontenido. Un error produce cero escrituras.
2. **Upload:** comprueba que el prefijo `releases/<release-id>/` no tenga artefactos y sube primero `index.html`, assets, manifiesto e imágenes con `If-None-Match: *` y caché larga.
3. **Verificación:** lee o inspecciona cada objeto subido y confirma existencia, bytes, `Content-Type`, `Cache-Control`, manifiesto válido y correspondencia uno-a-uno entre sus referencias de imagen y los objetos del release. El `current.json` aún no cambia.
4. **Pointer:** solo después de una verificación completa escribe `releases/current.json` como última operación. Si falla validación, red, autorización, cuota, upload o verificación, el puntero anterior queda vigente; un prefijo incompleto nunca se anuncia como actual.

El rollback no reescribe ni elimina un prefijo inmutable. El publicador recibe un `releaseId` anterior, verifica que existan y sean válidos su `manifest.json`, `index.html` y todas las imágenes referenciadas, y solo entonces repunta `releases/current.json` a esa release completa. Si la verificación o la escritura del puntero falla, conserva el puntero que ya estaba vigente.

### Configuración S3 + CloudFront/OAC

La configuración recomendada mantiene S3 privado y usa CloudFront como único punto público:

- Activar `BucketOwnerEnforced` y las cuatro opciones de bloqueo de acceso público.
- Usar el endpoint REST regional de S3 como origen, no el endpoint de sitio S3.
- Configurar CloudFront Origin Access Control con `SigningBehavior=always`, `SigningProtocol=sigv4`.
- Permitir únicamente `s3:GetObject` al principal `cloudfront.amazonaws.com` cuando `AWS:SourceArn` coincide con la distribución autorizada. No conceder `Principal: "*"`, `s3:PutObject` ni `s3:ListBucket` en la policy de lectura del origen.
- Mantener HTTPS y caché corta para el puntero, larga e inmutable para releases.
- Resolver la autorización de escritura mediante `AWS_PROFILE`, un rol de CI con identidad federada o credenciales temporales administradas fuera del repositorio. Los parámetros de bucket, región, prefijo, modo y distribución son configuración de destino, no secretos para el navegador.

`PUBLICATION_MODE=s3-public-prototype` solo se permite para una demostración temporal en un bucket separado, sin datos sensibles y sin escritura anónima. No debe mezclarse con la policy privada/OAC ni presentarse como configuración productiva. La configuración parametrizada y las plantillas se mantienen en [`docs/s3-cloudfront-oac.md`](s3-cloudfront-oac.md) y [`infra/s3-cloudfront-oac/`](../infra/s3-cloudfront-oac/).

La referencia visual reproducible de Stage 2 está en [`diagrams/README.md`](../diagrams/README.md), con vistas de solución, datos, integración, seguridad y la [vista consolidada](../diagrams/stage2-publication-architecture.md), disponible también como [PNG](../diagrams/stage2-publication-architecture.png). El [generador Python](../diagrams/stage2-publication-architecture.py) y la [fuente editable draw.io](../diagrams/stage2-publication-architecture.drawio) permiten reproducirla sin AWS, red ni rutas locales.
---

## Etapa 3: Arquitectura serverless

### Objetivo

Producción completa: el autor edita directamente contra la nube, la autenticación protege la escritura, y la infraestructura escala sin mantenimiento de servidores. La fuente de verdad es DynamoDB; las imágenes se transfieren directamente a S3 mediante URLs prefirmadas; la publicación pública continúa siendo una proyección inmutable compatible con Stage 2.

### Artefactos visuales reproducibles

Las vistas vigentes de Stage 3 están centralizadas en [`diagrams/README.md`](../diagrams/README.md) y en la [vista consolidada serverless](../diagrams/stage3-serverless-architecture.md). El conjunto cubre infraestructura, aplicación, datos y seguridad:

- Infraestructura: [PNG](../diagrams/stage3-infrastructure.png) · [SVG](../diagrams/stage3-infrastructure.svg)
- Aplicación: [PNG](../diagrams/stage3-application.png) · [SVG](../diagrams/stage3-application.svg)
- Datos: [PNG](../diagrams/stage3-data.png) · [SVG](../diagrams/stage3-data.svg)
- Seguridad: [PNG](../diagrams/stage3-security.png) · [SVG](../diagrams/stage3-security.svg)
- Vista consolidada (cuatro perspectivas): [PNG](../diagrams/stage3-serverless-architecture.png) · [SVG](../diagrams/stage3-serverless-architecture.svg)
- [Fuente editable multi-página draw.io](../diagrams/stage3-serverless-architecture.drawio)
- [Generador Python reproducible](../diagrams/stage3-serverless-architecture.py)

Desde la raíz del repositorio se regeneran las diez salidas (cuatro pares por vista y un par consolidado) con:

```bash
python diagrams/stage3-serverless-architecture.py
```

La reproducción es local y offline: no necesita AWS, red, credenciales, perfiles, rutas absolutas ni acceso al renderer Stage 2. El generador obtiene el directorio de salida desde su propia ubicación y usa únicamente el ejecutable local Graphviz `dot`; si `dot` no está instalado, las fuentes Markdown/Mermaid, Python y draw.io permanecen disponibles para edición. Los archivos generados y sus fuentes no contienen secretos ni valores dependientes de una cuenta o máquina.

Estas vistas son la referencia visual de la arquitectura actual. El esquema conceptual que sigue conserva el contexto histórico de la evolución, pero los contratos vigentes son `stage2-manifest-v1`, `releases/current.json`, buckets privados con CloudFront/OAC, SQS Standard con DLQ y publicación asíncrona con puntero tardío. El renderer público sigue siendo read-only y no requiere Cognito, API de escritura ni DynamoDB.

### Arquitectura vigente

La vista completa y sus cuatro perspectivas están en [los artefactos Stage 3](../diagrams/stage3-serverless-architecture.md). Este resumen muestra la separación de lectura y escritura sin duplicar el detalle visual:

```text
Autor SPA -- Cognito PKCE/JWT --> API Gateway --> Lambdas --> DynamoDB
   |                                  |             |
   | PUT directo con URL prefirmada   |             +--> SQS Standard --> proyección
   v                                  v                                      |
S3 uploads privado                 confirmación                         S3 releases
                                                                              |
Visitante anónimo -- HTTPS GET --> CloudFront/OAC --> releases/current.json
```

Los buckets son privados. El visitante solo consume la aplicación estática, `releases/current.json`, `stage2-manifest-v1` y sus imágenes mediante CloudFront/OAC; nunca obtiene listado, escritura o borrado del origen. La SPA de autoría usa rutas autenticadas y no forma parte del bundle read-only.

### Separación de lectura y escritura

La mutación confirmada marca la proyección como pendiente y encola una publicación; el proyector genera `stage2-manifest-v1` bajo un release inmutable y actualiza `releases/current.json` únicamente después de verificar todos los artefactos. El visitante conserva el release completo anterior si la publicación falla.

La sincronización usa SQS Standard con DLQ, reintentos acotados e idempotencia por versión lógica. No se necesita orden global ni entrega exactamente una vez: las condiciones de versión y el puntero tardío protegen frente a duplicados y mensajes atrasados.

### URLs prefirmadas para imágenes

Los bytes de las imágenes no pasan por Lambda:

```text
1. POST /uploads/prepare → Lambda crea UploadSession y URL prefirmada.
2. PUT directo a S3     ← El navegador sube; Lambda no recibe los bytes.
3. POST /uploads/{id}/complete → Lambda valida HeadObject y asocia la referencia.
```

Las claves se construyen con identificadores controlados, no con nombres o textos del usuario. La URL, el checksum y los datos sensibles de la solicitud no se registran.

### Autenticación con Cognito

Cognito entrega la identidad de la SPA mediante Authorization Code + PKCE. El JWT authorizer de API Gateway valida issuer, audience y scopes antes de invocar Lambda. La sesión maneja expiración, refresh y logout según la configuración del entorno; no existe Cognito Identity Pool ni se entregan credenciales AWS al navegador.

### Fuente de verdad y contrato público

DynamoDB guarda el estado completo del catálogo. `stage2-manifest-v1` es una proyección allowlist derivada que se publica de forma asíncrona por release. Esto permite:

- Escrituras condicionales por producto y propietario.
- Consultas owner-scoped con orden determinista por `createdAt + id`.
- Escalar a múltiples autores sin exponer datos cross-owner.

La proyección conserva `id`, `name`, `priceMode`, `priceCOP`, `createdAt`, `characteristics` e imagen, y omite `ownerId`, versión, auditoría, claims, estado de carga y claves internas. El renderer Stage 2 sigue sin Cognito, API de escritura o DynamoDB y muestra su estado de error sin tarjetas parciales ante un manifiesto inválido.

### Imágenes y retención

S3 separa los objetos temporales de uploads de los objetos de releases. Las sesiones pendientes tienen expiración y lifecycle; las imágenes asociadas a productos o referenciadas por releases no se eliminan durante la limpieza de temporales. El versioning de S3 y la retención configurada apoyan la recuperación de objetos, mientras que el rollback de `current.json` solo cambia el puntero público.

### Infraestructura como código

CDK es la IaC elegida para Stage 3. Separa stacks stateful y stateless, recibe región, dominios, límites, retención y RPO/RTO por configuración, y sintetiza sin credenciales, red ni lookups vivos. Las verificaciones incluyen snapshots/assertions, logical IDs, Aspects, cfn-lint y cfn-guard; cdk-nag no forma parte de este cambio.
---

## Decisiones que sobreviven entre etapas

| Decisión                               | Etapa 1 | Etapa 2 | Etapa 3 |
|----------------------------------------|---------|---------|---------|
| Modelo de producto (id uuid, priceMode) | ✔       | ✔       | ✔       |
| Repositorio async como costura         | ✔       | ✔       | ✔       |
| Encuadre sin recorte (contain)       | ✔       | ✔       | ✔       |
| Decisión de precio explícita           | ✔       | ✔       | ✔       |
| localStorage                           | ✔       | ✗       | ✗       |
| Conservación del original              | ✗       | Opcional| ✔       |
| Autenticación                          | ✗       | ✗       | ✔       |
| Manifiesto estático para lectura       | ✗       | ✔       | ✔       |

---

## Trade-offs asumidos

### Prototipo (Etapa 1)

- **Imágenes originales se pierden**: aceptado porque los datos son de prueba. La mitigación es no dejar que este esquema sobreviva a la iteración.
- **Cuota de localStorage**: con 10 productos el margen es amplio. Si falla, se captura el error y se informa.
- **Safari en navegación privada**: puede restringir el almacenamiento. Se detecta y se muestra un mensaje.

### Publicación (Etapa 2)

- **El autor publica manualmente**: más pasos, pero sin exponer credenciales.
- **Sin autenticación**: cualquiera con acceso al editor local puede modificar.

### Serverless (Etapa 3)

- **Costo por escritura**: Lambda y DynamoDB cobran por request. A este volumen es irrelevante.
- **Latencia de invalidación**: unos segundos entre la escritura y la propagación a CloudFront. Aceptable para un catálogo.

---

## Riesgos y mitigaciones

| Riesgo                                        | Mitigación                                              |
|-----------------------------------------------|---------------------------------------------------------|
| Credenciales expuestas si el endpoint queda abierto | Cognito obligatorio desde el diseño. Validación en API Gateway. |
| Imágenes grandes bloquean el hilo principal   | Procesamiento secuencial con cesión de control. Progreso visible. |
| Safari en modo privado bloquea storage        | Detección temprana con mensaje claro.                   |
| El autor pierde datos del prototipo           | Advertencia explícita de alcance. No se promete durabilidad. |

---

## Open questions

- **Forma de la plantilla de características**: ¿campos fijos (talla, color) o pares clave/valor libres?
- **Mecanismo de publicación en Etapa 2**: ¿exportar + subir manual, CLI, o anticipar Cognito?
- **Dominio propio**: ¿se usará un dominio custom con ACM y Route 53?
- **Región**: ¿cuál región de AWS para minimizar latencia desde Colombia?
- **Vista de detalle**: ¿el visitante puede ampliar la imagen? Si sí, S3 guarda varias resoluciones.

---

## Conclusión

El diseño evoluciona en tres etapas que entregan valor incremental sin reescrituras:

1. **Prototipo local**: valida la interfaz con la menor infraestructura posible.
2. **Publicación estática**: hace visible el catálogo con un bucket S3 y CloudFront.
3. **Serverless completo**: autenticación, escritura protegida, y escala sin mantenimiento.

La costura de repositorio y el modelo de producto son las dos piezas que se diseñan una vez y sobreviven a todas las etapas. Todo lo demás (estilos, layout, almacenamiento) puede ajustarse o reemplazarse sin costo de retrofit.
---

## Etapa 4: E-commerce con carrito y pagos

### Objetivo

Convertir el catálogo en una tienda online funcional: carrito de compras, checkout con pago, gestión de stock real, y notificaciones al comprador. Mantener también el flujo de contacto directo (WhatsApp/email) para productos sin precio o consultas.

### Decisiones de negocio

| Aspecto | Decisión |
|---------|----------|
| Modelo de venta | Vendedor único |
| Flujos de compra | Pago online + contacto directo (WhatsApp/email) |
| Inventario | Stock real, se descuenta al confirmar pago |
| Pasarela de pago | **Wompi** (nativa COP, menor complejidad, PSE incluido) |
| Notificaciones | Email al comprador (confirmación, tracking) |

### Arquitectura adaptada de la referencia

La arquitectura de referencia de microservicios se simplifica para un vendedor único:

`
         COMPRADOR                           VENDEDOR (autor)
              │                                    │
              ▼                                    ▼
   ┌────────────────────────┐           ┌─────────────────────┐
   │ Route 53 → WAF →       │           │ Cognito (admin)     │
   │ CloudFront             │           └──────────┬──────────┘
   └──────────┬─────────────┘                      │
              │                                    │
              ▼                                    ▼
   ┌────────────────────────┐           ┌─────────────────────┐
   │ S3 (frontend estático) │           │ Panel de admin      │
   │ catalog.json + assets  │           │ (gestión de pedidos,│
   └──────────┬─────────────┘           │  stock, productos)  │
              │                         └──────────┬──────────┘
              ▼                                    │
   ┌────────────────────────────────────────────────▼──────────┐
   │                      API Gateway                          │
   └──────────┬─────────────┬─────────────┬───────────────────┘
              │             │             │
              ▼             ▼             ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Cart Lambda  │  │ Checkout     │  │ Order Lambda │
   │              │  │ Lambda       │  │              │
   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
          │                 │                 │
          ▼                 ▼                 ▼
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Cart Table   │  │ Wompi        │  │ Orders Table │
   │ (DynamoDB)   │  │ (externo)    │  │ (DynamoDB)   │
   └──────────────┘  └──────────────┘  └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ SQS          │
                     │ Payment      │
                     │ Events       │
                     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ Order        │
                     │ Processor    │
                     │ Lambda       │
                     └──────┬───────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌──────────────┐              ┌──────────────┐
   │ SES          │              │ SNS          │
   │ (email al    │              │ (notif al    │
   │ comprador)   │              │ vendedor)    │
   └──────────────┘              └──────────────┘
`

### Componentes nuevos vs Etapa 3

| Componente | Etapa 3 | Etapa 4 |
|------------|---------|---------|
| WAF | No | Sí (protección de endpoints de pago) |
| Cart Service | No | Sí (Lambda + DynamoDB) |
| Checkout | No | Sí (Lambda + Wompi) |
| Order Service | No | Sí (Lambda + DynamoDB) |
| SQS | No | Sí (eventos de pago asincrónicos) |
| SES | No | Sí (emails transaccionales) |
| SNS | No | Sí (notificaciones al vendedor) |
| Secrets Manager | No | Sí (claves de Wompi) |

### Modelo de datos extendido

El producto de la Etapa 3 se extiende con campos de inventario:

``js
Product {
  // Campos existentes (Etapa 3)
  id:        string
  name:      string
  priceMode: 'amount' | 'inquire'
  priceCOP:  number | null
  imageRef:  string
  createdAt: number

  // Campos nuevos (Etapa 4)
  stock:     number          // cantidad disponible
  sku:       string | null   // código interno opcional
  active:    boolean         // visible en el catálogo
}
``

Nuevas entidades:

``js
CartItem {
  cartId:    string     // sessionId o visitorId
  productId: string
  quantity:  number
  addedAt:   number
  ttl:       number     // expiración automática
}

Order {
  orderId:      string
  status:       'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'
  items:        OrderItem[]
  totalCOP:     number
  buyerEmail:   string
  buyerPhone:   string | null
  shippingAddr: Address | null
  paymentRef:   string | null    // referencia de Wompi
  contactOnly:  boolean          // true si fue pedido por WhatsApp
  createdAt:    number
  updatedAt:    number
}
``

### Flujo de checkout con Wompi

`
   1. Comprador llena carrito
              │
              ▼
   2. POST /checkout
      → Valida stock
      → Crea orden en estado 'pending'
      → Reserva stock temporalmente
              │
              ▼
   3. Redirect a Wompi (hosted checkout)
      → Wompi muestra formulario de pago
      → Comprador paga
              │
              ▼
   4. Webhook de Wompi → API Gateway → Lambda
      → Valida firma del webhook
      → Actualiza orden a 'paid'
      → Descuenta stock definitivo
      → Encola notificaciones
              │
              ▼
   5. SQS → Order Processor
      → SES: email de confirmación al comprador
      → SNS: notificación push/email al vendedor
`

### Flujo de contacto directo (WhatsApp/email)

Para productos con `priceMode: 'inquire'` o cuando el comprador prefiere no pagar online:

`
   1. Comprador agrega al carrito
              │
              ▼
   2. En checkout, elige "Consultar por WhatsApp"
              │
              ▼
   3. POST /checkout?contact=whatsapp
      → Crea orden en estado 'pending' con contactOnly: true
      → Genera link de WhatsApp con resumen del pedido
              │
              ▼
   4. Redirect a WhatsApp
      → Vendedor recibe mensaje con productos y cantidades
      → Negociación directa
`

### Integración con Wompi

Wompi ofrece dos modos de integración:

| Modo | Descripción | Complejidad | Recomendado |
|------|-------------|-------------|-------------|
| **Hosted Checkout** | Redirect a página de Wompi | Baja | Sí, para empezar |
| **Widget embebido** | Formulario dentro de tu página | Media | Después, si quieres más control |
| **API directa** | Tokenización + cargo desde backend | Alta | No necesario |

Empezamos con **Hosted Checkout**: el comprador va a Wompi, paga, y vuelve. Un webhook confirma el pago.

### Seguridad

- **WAF**: rate limiting en endpoints de checkout, bloqueo de IPs sospechosas.
- **Secrets Manager**: claves pública y privada de Wompi, nunca en código ni variables de entorno.
- **Validación de webhooks**: firma HMAC de Wompi verificada antes de procesar.
- **Reserva de stock con TTL**: si el pago no se completa en 15 minutos, el stock se libera.
- **Idempotencia**: el webhook puede llegar múltiples veces; se procesa solo una.

### Notificaciones

| Evento | Destinatario | Canal | Contenido |
|--------|--------------|-------|-----------|
| Orden creada | Comprador | Email (SES) | Resumen del pedido, link de pago si aplica |
| Pago confirmado | Comprador | Email (SES) | Confirmación, número de orden |
| Pago confirmado | Vendedor | SNS → Email/Push | Alerta de nueva venta |
| Pedido enviado | Comprador | Email (SES) | Tracking si existe |

### Gestión de stock

`
   Producto con stock = 5
              │
   Comprador A agrega 3 al carrito
   Comprador B agrega 4 al carrito
              │
              ▼
   Stock disponible = 5 (no se reserva al agregar)
              │
   Comprador A inicia checkout
              │
              ▼
   Reserva temporal: stock_disponible = 2, reservado_A = 3
   TTL: 15 minutos
              │
   Comprador B inicia checkout
              │
              ▼
   Error: solo hay 2 disponibles
              │
   Comprador A paga
              │
              ▼
   Stock definitivo = 2, reserva liberada
`

El stock se reserva temporalmente al iniciar checkout, no al agregar al carrito. Esto evita bloquear inventario por carritos abandonados.

### Costos estimados (mensual, bajo volumen)

| Servicio | Uso estimado | Costo |
|----------|--------------|-------|
| Lambda | 10,000 invocaciones | ~ (capa gratuita) |
| DynamoDB | 1 GB, 25 WCU/RCU | ~ (capa gratuita) |
| API Gateway | 1M requests | ~ |
| SES | 1,000 emails | ~.10 |
| SNS | 1,000 notificaciones | ~ (capa gratuita) |
| SQS | 1,000 mensajes | ~ (capa gratuita) |
| WAF | 1M requests | ~ |
| Secrets Manager | 2 secretos | ~.80 |
| **Wompi** | 2.79% +  por transacción | Variable |

Total fijo: **~/mes** + comisión de Wompi por venta.

---

## Roadmap completo actualizado

| Etapa | Objetivo | Almacenamiento | Auth | E-commerce |
|-------|----------|----------------|------|------------|
| 1 | Prototipo local | localStorage | No | No |
| 2 | Publicación estática | S3 + CloudFront | No | No |
| 3 | Serverless (autor) | DynamoDB + S3 | Cognito | No |
| 4 | E-commerce completo | DynamoDB + S3 | Cognito | Sí (Wompi) |

### Dependencias entre etapas

`
   Etapa 1          Etapa 2          Etapa 3          Etapa 4
   ════════         ════════         ════════         ════════
   
   Modelo de   ──────────────────────────────────────────────▶
   producto
   
   Repositorio ──────────────────────────────────────────────▶
   async
   
   Frontend    ──────────────────────────────────────────────▶
   estático
   
                    S3/CloudFront ───────────────────────────▶
   
                                     Cognito ────────────────▶
                                     
                                     DynamoDB ───────────────▶
                                     
                                     API Gateway ────────────▶
                                     
                                                    Cart ────▶
                                                    
                                                    Checkout ▶
                                                    
                                                    Orders ──▶
                                                    
                                                    Wompi ───▶
                                                    
                                                    SQS ─────▶
                                                    
                                                    SES/SNS ─▶
`

### Open questions para Etapa 4

- **Envío**: ¿se integra con alguna transportadora, o el vendedor gestiona manualmente?
- **Impuestos**: ¿IVA incluido en el precio o calculado en checkout?
- **Devoluciones**: ¿política de reembolso? Wompi tiene API de reversión.
- **Múltiples métodos de pago**: Wompi soporta tarjeta, PSE, Nequi. ¿Todos habilitados?
- **Límite de carrito**: ¿máximo de items o monto?

---

## Decisiones de pasarela de pago

### Análisis comparativo para Colombia

| Pasarela | Complejidad | Costo/transacción | COP nativo | PSE | Observaciones |
|----------|-------------|-------------------|------------|-----|---------------|
| Stripe | Media | 2.9% + .30 USD | Sí (conversión) | No | Mejor API, pero conversión de moneda |
| **Wompi** | Baja | 2.79% +  COP | Sí | Sí | Recomendado para Colombia |
| PayU | Media-Alta | 2.99% + IVA | Sí | Sí | Integración más verbosa |
| MercadoPago | Baja | 3.49% + IVA | Sí | No | Fee más alto, retención de fondos |

### Decisión: Wompi

Razones:
1. **Menor complejidad**: Hosted Checkout funciona con redirect + webhook.
2. **COP nativo**: Sin conversión de moneda, pricing predecible.
3. **PSE incluido**: Transferencia bancaria muy usada en Colombia.
4. **Costo competitivo**: 2.79% es el más bajo de la lista.
5. **Soporte local**: Bancolombia, documentación en español.
6. **Sandbox gratuito**: Desarrollo sin costo.

Stripe queda como alternativa si en el futuro se necesita venta internacional.
