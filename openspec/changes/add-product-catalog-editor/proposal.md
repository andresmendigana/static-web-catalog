## Why

Quien vende productos y servicios necesita publicarlos en internet, pero hoy eso implica un backend, una base de datos y un despliegue. El objetivo final es un catálogo estático publicable; esta iteración es el **prototipo** que define apariencia y funcionalidad básica antes de invertir en el almacenamiento definitivo.

El prototipo se limita a 10 productos y persiste en el navegador del autor. Su propósito es validar cómo se ve y cómo se usa el editor: la grilla, la lectura del precio, el flujo de carga. Los datos que se carguen en él son descartables.

La Etapa 2 mueve el almacenamiento a un bucket S3 de AWS, con imágenes y plantillas de precios y características por producto. Por eso el prototipo, aunque sea desechable en su apariencia y sus estilos, conserva dos piezas definitivas: el modelo de datos del producto y una costura de persistencia única. Son las dos cosas cuyo retrofit sería caro; todo lo demás puede reescribirse sin costo.

## What Changes

- Nueva página estática de edición de catálogo, sin backend ni base de datos, sin dependencias externas y sin paso de compilación.
- Carga de múltiples imágenes en una sola operación (`input[type=file]`, `accept="image/*"`, `multiple`).
- Zona de pendientes previa al catálogo: cada imagen cargada aparece como una fila con su miniatura, su nombre propuesto y su propia decisión de precio.
- Decisión de precio explícita por fila: monto en COP o "Consultar precio". Una fila sin decisión no se puede confirmar.
- Confirmación parcial: se agregan al catálogo las filas resueltas y las no resueltas permanecen en pendientes.
- Nombre de producto editable, con un valor inicial derivado del nombre del archivo (`camisa-azul.jpg` → `Camisa Azul`).
- Grilla de catálogo con miniatura, nombre, precio formateado en COP sin decimales, y borrado individual.
- Imágenes escaladas en canvas y persistidas en `localStorage` como data URI, detrás de una interfaz de repositorio asíncrona que permita sustituir el almacenamiento sin tocar la interfaz.
- Identidad de producto por UUID generado en la carga. El nombre del archivo pasa a ser dato de presentación, no clave.
- Límite de 10 productos, validado en el repositorio.
- Definición de la apariencia base: grilla, proporción de miniatura, encuadre sin recorte, tratamiento visual del precio ausente y del borrado.

## Capabilities

### New Capabilities

- `catalog-storage`: modelo de datos del producto, costura de repositorio asíncrona (`list`, `add`, `rename`, `remove`, `count`), implementación sobre `localStorage`, límite de 10 productos y manejo de cuota agotada.
- `product-intake`: selección múltiple de imágenes, validación del tipo de archivo, escalado en canvas, derivación del nombre legible desde el nombre del archivo, zona de pendientes, decisión explícita de precio por fila, confirmación parcial y descarte de filas.
- `catalog-display`: grilla de productos persistidos, encuadre de la miniatura sin recorte, edición del nombre, formato de precio en COP sin decimales, presentación de "Consultar precio", borrado individual y estado vacío.

### Modified Capabilities

<!-- No hay especificaciones previas en este proyecto. -->

## Impact

- **Código**: proyecto nuevo. Se crean `index.html`, una hoja de estilo y módulos JS con módulos ES nativos (modelo de producto, repositorio, escalado de imágenes en canvas, formato de moneda, vista de pendientes y vista de catálogo).
- **Dependencias**: ninguna. Solo APIs del navegador: File API, `crypto.randomUUID()`, Canvas, `localStorage`, `Intl.NumberFormat`.
- **Alcance de la persistencia**: los datos viven en el navegador del autor y son descartables. El catálogo todavía no es visible para terceros; esa es la razón de ser de la Etapa 2.
- **Deuda asumida deliberadamente**: `localStorage` con data URI no puede conservar las imágenes originales. Al pasar a IndexedDB y a S3 habrá que recargar las imágenes. Es aceptable porque los datos del prototipo son descartables, y sería inaceptable con 100 productos reales.
- **Preparación para la Etapa 2**: el modelo referencia la imagen en lugar de embeberla en la lógica de vista, los identificadores son estables, y la interfaz del repositorio es asíncrona, para que un `catalog.json` en S3 sea prácticamente el mismo objeto ya persistido.
- **Riesgo conocido, fuera de alcance**: escribir a S3 desde el navegador requiere credenciales que serían públicas. La Etapa 2 tendrá que elegir entre URLs prefirmadas emitidas por un servicio, identidades acotadas de Cognito, o publicación mediante un script del autor con el bucket en modo solo lectura.
