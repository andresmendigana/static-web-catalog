## Roadmap

El proyecto evoluciona en cuatro etapas:

| Etapa | Objetivo                          | Almacenamiento  | Autenticación | E-commerce |
|-------|-----------------------------------|-----------------|---------------|------------|
| 1     | Prototipo local (este change)     | localStorage    | No            | No         |
| 2     | Publicación estática con S3       | S3 + CloudFront | No            | No         |
| 3     | Serverless completo               | DynamoDB + S3   | Cognito       | No         |
| 4     | E-commerce con carrito y pagos    | DynamoDB + S3   | Cognito       | Sí (Wompi) |

La arquitectura completa de las cuatro etapas está documentada en `docs/technical-design.md`. Incluye:
- **Etapa 3**: Cognito, API Gateway + Lambda, DynamoDB, CloudFront + S3.
- **Etapa 4**: Cart/Checkout/Order Services, Wompi (pasarela de pagos), SQS, SES/SNS, WAF, Secrets Manager.

El prototipo actual (Etapa 1) valida la interfaz y fija el modelo de datos que sobrevivirá a todas las etapas.

## Context
## Context

Proyecto en verde. No hay código, dependencias ni especificaciones previas. El objetivo final es un catálogo de productos y servicios visible en internet; esta iteración es un **prototipo** cuyo propósito es definir apariencia y funcionalidad básica con hasta 10 productos.

Dos restricciones opuestas modelan el diseño. Por un lado, la Etapa 2 mueve el almacenamiento a un bucket S3 de AWS, con imágenes y plantillas de precios y características por producto: eso exige separar el rol del autor del rol del visitante desde ahora. Por el otro, es un prototipo con datos descartables, así que no corresponde invertir en el almacenamiento definitivo todavía.

La resolución de esa tensión es el criterio que atraviesa todo el documento: **se conserva definitivo solo lo que sería caro retrofitear** (el modelo de datos y la costura de persistencia, unas 40 líneas). Todo lo demás (estilos, layout, validaciones) es descartable.

Parámetros acordados: hasta 10 productos, precios en COP sin decimales, precio opcional pero con decisión explícita, nombre de producto editable, confirmación parcial fila por fila, miniaturas sin recorte.

## Goals / Non-Goals

**Goals:**

- Definir la apariencia base del catálogo: grilla, tarjeta de producto, encuadre de la imagen, lectura del precio.
- Validar el flujo de carga completo: selección múltiple, zona de pendientes, decisión de precio, confirmación parcial.
- Editor estático funcional sin backend, base de datos, paso de compilación ni dependencias externas.
- Fijar el modelo de datos del producto en su forma definitiva, para que sobreviva a la migración a S3.
- Aislar la persistencia detrás de una interfaz asíncrona única, de modo que sustituir `localStorage` por IndexedDB y luego por S3 no toque la interfaz.

**Non-Goals:**

- Publicar el catálogo para terceros. En esta etapa los datos viven solo en el navegador del autor.
- Cualquier integración con AWS: subida a S3, credenciales, CloudFront, plantillas de características.
- Durabilidad de los datos. El contenido del prototipo es descartable por definición.
- Escalar más allá de 10 productos. Los 100 del objetivo final quedan para la iteración siguiente.
- Autenticación, multiusuario o control de acceso. No hay superficie de red.
- Categorías, búsqueda, filtros, orden configurable, paginación, vista de detalle.
- Edición del precio o de la imagen después de confirmar el producto. Solo el nombre es editable; lo demás se resuelve borrando y recargando.
- Temas, modo oscuro, internacionalización más allá del formato COP.

## Decisions

### D1. `localStorage` con data URI para el prototipo; IndexedDB diferido

Con 10 productos la cuenta cierra sin esfuerzo:

`
   10 productos × ~107 KB (data URI de un JPEG de 800 px)  ≈  1.1 MB
   Presupuesto real de localStorage                         ≈  4.5 MB
                                                            ─────────
                                                            entra (4×)
`

Los dos argumentos que exigían IndexedDB desaparecen en este alcance: el límite de tamaño no se alcanza, y la pérdida de los originales no importa porque los datos son descartables. A cambio se gana una implementación sincrónica, trivial de inspeccionar y de tirar.

La deuda queda explícita: **el data URI escalado es la única copia de la imagen.** El original se descarta. Con 100 productos reales eso sería inaceptable porque obligaría a recargar todo a mano al migrar a S3; con 10 productos de prueba es el costo correcto.

`
                       localStorage       IndexedDB
                       (prototipo)        (siguiente iteración)
   10 productos          entra              entra
   100 productos         no entra           entra
   conserva original     no                 sí
   API                   sync               async
   costo de armarlo      bajo               medio
`

**Alternativas consideradas.** IndexedDB desde el prototipo: correcto para producción, pero adelanta trabajo de infraestructura en la iteración cuyo objetivo es visual, y la costura de D2 hace que postergarlo no cueste nada. Object URL persistido: no es una alternativa real, `blob:` es un puntero al documento vivo y muere al recargar la página.

### D2. Costura de repositorio asíncrona como única vía de acceso a datos

Es la decisión que permite que D1 sea reversible. Toda lectura y escritura pasa por una interfaz estable, y la Etapa siguiente aporta otra implementación sin que nada más cambie.

``js
   // Prototipo                  // Siguiente              // Etapa 3
   LocalStorageRepository   →    IndexedDbRepository   →   S3Repository
     async list()                  async list()              async list()   → fetch('catalog.json')
     async add(product, dataUri)   async add(...)            async add(...)  → PUT presignado
     async rename(id, name)        async rename(...)         async rename(...)
     async remove(id)              async remove(id)          async remove(id)
     async count()                 async count()             async count()
``

Los métodos son `async` aunque `localStorage` sea sincrónico. Cuesta cuatro palabras clave y evita el único retrofit caro: convertir a asíncrono un árbol de vistas ya escrito en modo sincrónico.

Ninguna vista importa el módulo de almacenamiento. Se instancia un repositorio en el arranque y se inyecta.

**Alternativa considerada.** Que las vistas lean `localStorage` directamente: menos código ahora, reescritura completa después.

### D3. Identidad por UUID; el nombre de archivo es dato de presentación

El nombre de archivo como clave se rompe en la selección múltiple (dos `camisa-azul.jpg` de carpetas distintas), en la recarga del mismo archivo, y no produce nombres legibles cuando la cámara genera `IMG_20240115_123456.jpg`.

Cada producto recibe un `crypto.randomUUID()` en el momento de la carga. Ese id sobrevive a la migración y es la clave tanto del registro como del futuro objeto en S3.

La derivación del nombre legible es un valor inicial, no un vínculo: quitar la extensión, reemplazar `-` y `_` por espacios, colapsar espacios repetidos, recortar, capitalizar cada palabra.

`
   camisa-azul.jpg          →  Camisa Azul
   vestido_rojo_largo.png   →  Vestido Rojo Largo
   IMG_20240115_123456.jpg  →  Img 20240115 123456   ← el autor lo corrige
`

Esa última fila es la razón por la que el nombre tiene que ser editable.

### D4. Una sola resolución por imagen

En el prototipo la misma imagen escalada sirve para la fila de pendientes y para la tarjeta del catálogo. No hay miniatura separada: con 10 productos, mostrar 10 imágenes de ~80 KB no justifica un segundo binario derivado.

El escalado acota el lado mayor a 800 px preservando la proporción, y codifica JPEG con calidad 0.8. Se aplica siempre, incluso a imágenes ya pequeñas, para que el tamaño persistido sea predecible.

Cuando llegue IndexedDB, esto se separa en original más miniatura. La interfaz de D2 absorbe el cambio.

### D5. Modo de precio explícito, no un `null` implícito

El precio es opcional, pero "sin precio" tiene que ser una decisión, no un olvido. En un catálogo de venta un producto sin precio por descuido se lee como un error; uno que dice "Consultar precio" se lee como una decisión.

``js
Product {
  id:        string          // uuid, estable de por vida
  name:      string          // editable, no vacío
  priceMode: 'amount' | 'inquire'
  priceCOP:  number | null   // entero ≥ 0 si 'amount'; null si 'inquire'
  image:     string          // data URI en el prototipo
  createdAt: number          // epoch ms, orden de la grilla
}
``

La invariante es `priceMode === 'amount'` ⟺ `priceCOP` es un entero no negativo, y `priceMode === 'inquire'` ⟺ `priceCOP === null`.

Existe un tercer estado, `priceMode` sin definir, y vive únicamente en la zona de pendientes: es exactamente lo que bloquea la confirmación de esa fila. Un producto persistido nunca lo tiene.

Este modelo es definitivo. Las características de la Etapa 2 se agregarán como una sección adicional, sin alterar estos campos.

**Alternativa considerada.** Un solo campo `priceCOP: number | null` donde `null` significa "consultar": ahorra un campo pero vuelve indistinguibles el olvido y la decisión, que es justo lo que se quiere separar.

### D6. La zona de pendientes es estado en memoria, no persistido

`
  ┌─────────┐  selecciona  ┌──────────────────────────┐            ┌──────────┐
  │  Vacío  │──── files ──▶│       PENDIENTES         │            │ CATÁLOGO │
  └─────────┘              │  (memoria, se pierde     │            │ persistido│
                           │   al recargar)           │            └──────────┘
                           │                          │                  ▲
                           │  fila  img  nombre  ●    │──── agregar ─────┤
                           │  fila  img  nombre  ●    │──── agregar ─────┘
                           │  fila  img  nombre  ○    │  ← sin decisión,
                           └──────────────────────────┘     se queda
                              ● resuelta   ○ sin resolver
`

Persistir los pendientes agregaría un segundo almacén y un segundo modelo por un estado que dura segundos. Confirmar es la acción que promueve las filas resueltas a productos persistidos; las no resueltas permanecen, y ese es el sentido de la confirmación parcial.

Consecuencia visible: si el autor recarga con filas pendientes, las pierde. Es aceptable, y la interfaz lo advierte con `beforeunload` mientras queden pendientes.

### D7. Formato COP construido sobre `Intl`, con el símbolo pegado

`Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })` produce `$ 1.234.567` con un espacio duro después del símbolo. Se formatea el número con `Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })` y se prefija `$` para obtener `.234.567`, dejando el separador de miles a cargo de la plataforma.

No hay decimales en ninguna capa: no existen en el modelo, no se aceptan en la entrada, no se muestran. El campo de precio acepta solo dígitos y produce un entero.

### D8. Encuadre sin recorte: `object-fit: contain` sobre fondo neutro

Un catálogo mezcla orientaciones, y las dos opciones de encuadre fallan de maneras distintas:

`
   object-fit: cover          object-fit: contain
   (recorta)                  (deja franjas)

   ┌────────┐ ┌────────┐      ┌────────┐ ┌────────┐
   │▓▓▓▓▓▓▓▓│ │▓▓▓▓▓▓▓▓│      │░░▓▓▓▓░░│ │▓▓▓▓▓▓▓▓│
   │▓▓▓▓▓▓▓▓│ │▓▓▓▓▓▓▓▓│      │░░▓▓▓▓░░│ │▓▓▓▓▓▓▓▓│
   └────────┘ └────────┘      └────────┘ └────────┘
    vestido    sofá            vestido    sofá
    (le corta  (encaja)        (completo, (encaja)
     la falda)                  con aire)

   grilla prolija             nada se recorta
   pero mutila productos      pero se ve irregular
   verticales
`

Se elige `contain`: recortar el producto que se está tratando de vender es peor defecto que un poco de aire alrededor. El fondo del contenedor es neutro para que las franjas se lean como marco y no como error.

### D9. Apariencia base del prototipo

Estas son las decisiones visuales por defecto que el prototipo existe para validar. Son deliberadamente reemplazables: si al verlas no funcionan, se cambian sin consecuencias sobre el modelo ni el repositorio.

- **Grilla**: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`. Se adapta al ancho sin media queries.
- **Proporción de la tarjeta**: `aspect-ratio: 4 / 5` para el área de imagen, la proporción vertical habitual en catálogos de venta. Combinada con `contain` de D8, ningún producto se recorta.
- **Precio ausente**: "Consultar precio" ocupa el mismo lugar y el mismo tamaño que un monto, en color atenuado. Mantiene la altura de las tarjetas uniforme y se lee como una decisión, no como un dato faltante.
- **Borrado**: botón siempre visible, no revelado al pasar el mouse. Un control que aparece solo en `hover` es inalcanzable en pantallas táctiles.
- **Confirmación de borrado**: sin diálogo. Borrar un producto de un catálogo descartable de 10 elementos no justifica una interrupción.

### D10. Sin paso de compilación, módulos ES nativos

El proyecto se abre como archivos estáticos y se sirve tal cual. Módulos ES nativos vía `<script type="module">`, sin bundler ni transpilador, lo que mantiene trivial el despliegue de la Etapa 2: subir la carpeta.

Salvedad operativa: los módulos ES no funcionan bajo `file://` por la política de origen. El desarrollo requiere un servidor estático local.

### D11. El límite de 10 se valida en el repositorio

El tope se verifica en `add()`, no en la vista. Así ninguna ruta de escritura futura puede saltearlo, y el número vive en un solo lugar cuando haya que subirlo a 100.

Es un tope duro: al alcanzarlo, la confirmación de las filas excedentes se rechaza y esas filas permanecen en pendientes con un mensaje. No se descarta trabajo del autor en silencio.

## Risks / Trade-offs

- **Las imágenes originales se pierden** (consecuencia directa de D1) → asumido: los datos del prototipo son descartables. La mitigación es no dejar que este esquema sobreviva a la iteración: pasar a IndexedDB antes de que alguien cargue un catálogo real.

- **El navegador puede limpiar `localStorage`** y el catálogo desaparece sin aviso → advertir en la interfaz que los datos son locales y de prueba. No se intenta durabilidad en esta etapa.

- **Cuota agotada antes de los 10 productos** si el escalado no alcanza para imágenes muy grandes → capturar el error de cuota en `add()`, tratarlo como fallo de esa fila (que vuelve a pendientes con un mensaje) y nunca dejar el almacén en estado parcial.

- **Safari en navegación privada restringe el almacenamiento** y la escritura puede fallar → detectar el fallo al escribir y mostrar un mensaje claro en lugar de fallar en silencio.

- **Filas pendientes se pierden al recargar** (consecuencia de D6) → advertencia con `beforeunload` mientras haya pendientes.

- **Archivos que no son imágenes o están corruptos** pasan el filtro de `accept` (que es una sugerencia, no una validación) → validar el tipo real al decodificar y rechazar la fila con un mensaje, sin abortar el resto del lote.

- **Escalar varias imágenes grandes en canvas bloquea el hilo principal** → procesar de a una cediendo control entre archivos y mostrar progreso. Con 10 imágenes el problema es acotado, pero el patrón debe quedar planteado.

- **La apariencia de D9 puede no funcionar al verla.** Es el riesgo que el prototipo existe para tomar → las decisiones visuales están aisladas en CSS y no acopladas al modelo ni al repositorio, así que cambiarlas es barato.

## Migration Plan

El prototipo no tiene datos previos que migrar. Lo que importa es que la ruta hacia adelante quede abierta:

1. **Prototipo → IndexedDB**: se agrega `IndexedDbRepository` con la interfaz de D2, se separa la imagen en original más miniatura (D4), y se sube el tope de D11 de 10 a 100. Los datos del prototipo no se migran: se recargan. Por eso son descartables.

2. **IndexedDB → S3**: el registro persistido se serializa a `catalog.json` conservando los `id`; los campos de D5 se mantienen y las características de la Etapa 2 se agregan como sección adicional. Un procedimiento de publicación recorre el repositorio local, sube cada original a `images/<id>` y escribe `catalog.json`.

3. **Vista del visitante**: usa `S3Repository` y reutiliza sin cambios la grilla, el formato de precio y el estado vacío.

Reversión: mientras el arranque siga instanciando `LocalStorageRepository`, el estado local queda intacto y volver atrás es cambiar qué implementación se instancia.

## Open Questions

- **Forma de la plantilla de características de la Etapa 2**: ¿campos fijos (talla, color, material) o pares clave/valor libres por producto? Define si el modelo de D5 necesita un contenedor extensible.

- **Mecanismo de publicación**: ¿el editor exporta un `catalog.json` más un zip de imágenes para que el autor lo suba, o sube directamente con credenciales acotadas? Es la decisión que resuelve el riesgo de escritura en S3.

- **Vista de detalle**: el prototipo solo muestra una resolución. Si el visitante va a poder ampliar una imagen, hay que decidir si S3 guarda una sola resolución o varias.

- **Orden de la grilla**: por ahora `createdAt` descendente. ¿Debería el autor poder reordenar? Si sí, el modelo necesita un campo de posición.

- **Servicios frente a productos**: un servicio puede no tener una imagen natural. ¿Necesita un marcador visual propio, o alcanza con que el autor suba una imagen representativa?
