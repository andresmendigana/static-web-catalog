## ADDED Requirements

### Requirement: Selección múltiple de imágenes

El sistema SHALL ofrecer un control de archivos que acepte imágenes y permita seleccionar varias en una sola operación, declarado con `type="file"`, `accept="image/*"` y `multiple`.

Cada archivo seleccionado SHALL producir una fila independiente en la zona de pendientes.

#### Scenario: Varios archivos en una sola selección

- **WHEN** el autor selecciona tres imágenes en una sola operación
- **THEN** la zona de pendientes muestra tres filas, una por imagen

#### Scenario: Selecciones sucesivas se acumulan

- **GIVEN** la zona de pendientes tiene dos filas
- **WHEN** el autor selecciona dos imágenes más
- **THEN** la zona de pendientes tiene cuatro filas
- **AND** las dos filas anteriores conservan el nombre y la decisión de precio que ya tenían

#### Scenario: Selección cancelada

- **WHEN** el autor abre el selector de archivos y lo cierra sin elegir nada
- **THEN** la zona de pendientes queda sin cambios

### Requirement: Validación del tipo real de imagen

El sistema SHALL validar que cada archivo seleccionado sea una imagen decodificable, sin confiar en el atributo `accept`, que es una sugerencia al selector y no una garantía.

Un archivo que no se pueda decodificar SHALL producir una fila en estado de error con un mensaje, y MUST NOT interrumpir el procesamiento de los demás archivos del lote.

#### Scenario: Archivo que no es una imagen

- **WHEN** el autor selecciona un archivo que no se puede decodificar como imagen
- **THEN** su fila se muestra en estado de error con un mensaje que lo explica
- **AND** esa fila no se puede confirmar

#### Scenario: Un archivo inválido no arrastra al lote

- **WHEN** el autor selecciona tres archivos y uno de ellos no es una imagen decodificable
- **THEN** las otras dos filas se procesan normalmente y quedan disponibles para confirmar

### Requirement: Escalado de la imagen a una resolución predecible

El sistema SHALL escalar cada imagen mediante canvas antes de persistirla, acotando su lado mayor a 800 píxeles y preservando la proporción original. La imagen resultante SHALL codificarse como JPEG con calidad 0.8 y representarse como data URI.

El escalado SHALL aplicarse a toda imagen, incluso si ya es más pequeña que el límite, para que el tamaño persistido sea predecible.

#### Scenario: Imagen grande se reduce

- **WHEN** el autor carga una imagen de 3000 por 2000 píxeles
- **THEN** la imagen persistida mide 800 por 533 píxeles
- **AND** conserva la proporción del original

#### Scenario: Imagen vertical se reduce por su lado mayor

- **WHEN** el autor carga una imagen de 1200 por 3000 píxeles
- **THEN** la imagen persistida mide 320 por 800 píxeles

#### Scenario: Imagen ya pequeña también se procesa

- **WHEN** el autor carga una imagen de 400 por 300 píxeles
- **THEN** la imagen persistida es un JPEG de 400 por 300 píxeles

### Requirement: Nombre legible derivado del nombre del archivo

El sistema SHALL proponer un nombre inicial para cada fila derivado del nombre del archivo, aplicando en orden: quitar la extensión, reemplazar guiones y guiones bajos por espacios, colapsar espacios repetidos, recortar espacios de los extremos, y capitalizar la primera letra de cada palabra.

El nombre derivado SHALL ser un valor inicial editable y MUST NOT usarse como identificador del producto.

#### Scenario: Guiones convertidos en nombre legible

- **WHEN** el autor carga un archivo llamado `camisa-azul.jpg`
- **THEN** la fila propone el nombre `Camisa Azul`

#### Scenario: Guiones bajos y varias palabras

- **WHEN** el autor carga un archivo llamado `vestido_rojo_largo.png`
- **THEN** la fila propone el nombre `Vestido Rojo Largo`

#### Scenario: Nombre de cámara sin significado

- **WHEN** el autor carga un archivo llamado `IMG_20240115_123456.jpg`
- **THEN** la fila propone el nombre `Img 20240115 123456`
- **AND** el autor puede reemplazarlo antes de confirmar

#### Scenario: Nombre con múltiples separadores seguidos

- **WHEN** el autor carga un archivo llamado `silla--de_-madera.jpg`
- **THEN** la fila propone el nombre `Silla De Madera`

#### Scenario: Nombre con varios puntos

- **WHEN** el autor carga un archivo llamado `mesa.ratona.v2.jpg`
- **THEN** solo se quita la última extensión y la fila propone el nombre `Mesa.ratona.v2`

### Requirement: Decisión de precio explícita por fila

Cada fila de la zona de pendientes SHALL exigir una decisión de precio explícita antes de poder confirmarse: un monto en pesos colombianos, o la marca "Consultar precio".

Una fila SHALL nacer sin decisión de precio. Una fila sin decisión MUST NOT poder confirmarse.

#### Scenario: Fila recién creada no es confirmable

- **WHEN** una fila se crea a partir de un archivo seleccionado
- **THEN** no tiene decisión de precio
- **AND** la fila se señala como pendiente de resolver

#### Scenario: Ingresar un monto resuelve la fila

- **WHEN** el autor escribe `45000` en el campo de precio de una fila
- **THEN** la fila queda resuelta con `priceMode` igual a `'amount'` y `priceCOP` igual a `45000`

#### Scenario: Marcar consultar precio resuelve la fila

- **WHEN** el autor marca "Consultar precio" en una fila
- **THEN** la fila queda resuelta con `priceMode` igual a `'inquire'` y `priceCOP` igual a `null`

#### Scenario: Marcar consultar precio descarta el monto ingresado

- **GIVEN** una fila tiene el monto `45000` ingresado
- **WHEN** el autor marca "Consultar precio" en esa fila
- **THEN** el campo de monto se vacía y se deshabilita
- **AND** la fila queda resuelta con `priceMode` igual a `'inquire'`

#### Scenario: Vaciar el monto devuelve la fila a sin resolver

- **GIVEN** una fila está resuelta con el monto `45000`
- **WHEN** el autor borra el contenido del campo de precio
- **THEN** la fila vuelve al estado sin resolver
- **AND** la fila deja de ser confirmable

### Requirement: Entrada de precio de solo dígitos sin decimales

El campo de precio SHALL aceptar únicamente dígitos y producir un entero. El sistema MUST NOT aceptar separadores decimales, signos ni letras.

#### Scenario: Caracteres no numéricos ignorados

- **WHEN** el autor intenta escribir `45a.b00` en el campo de precio
- **THEN** el campo contiene `45000`

#### Scenario: Cero es un monto válido

- **WHEN** el autor escribe `0` en el campo de precio
- **THEN** la fila queda resuelta con `priceCOP` igual a `0`

#### Scenario: Ceros iniciales normalizados

- **WHEN** el autor escribe `007500` en el campo de precio
- **THEN** la fila queda resuelta con `priceCOP` igual a `7500`

### Requirement: Confirmación parcial del lote

El sistema SHALL ofrecer una acción "Agregar al catálogo" que persista todas las filas resueltas del lote. Las filas sin resolver o en estado de error SHALL permanecer en la zona de pendientes.

La acción SHALL estar deshabilitada cuando ninguna fila esté resuelta.

#### Scenario: Se confirman solo las filas resueltas

- **GIVEN** la zona de pendientes tiene tres filas, dos resueltas y una sin resolver
- **WHEN** el autor activa "Agregar al catálogo"
- **THEN** las dos filas resueltas se agregan al catálogo
- **AND** la fila sin resolver permanece en la zona de pendientes con su nombre intacto

#### Scenario: Las filas confirmadas desaparecen de pendientes

- **GIVEN** la zona de pendientes tiene dos filas resueltas
- **WHEN** el autor activa "Agregar al catálogo"
- **THEN** la zona de pendientes queda vacía
- **AND** los dos productos aparecen en la grilla del catálogo

#### Scenario: Acción deshabilitada sin filas resueltas

- **GIVEN** todas las filas de la zona de pendientes están sin resolver
- **THEN** la acción "Agregar al catálogo" está deshabilitada

### Requirement: Descarte de una fila pendiente

Cada fila de la zona de pendientes SHALL ofrecer una acción para descartarla sin agregarla al catálogo.

#### Scenario: Descartar una fila

- **GIVEN** la zona de pendientes tiene tres filas
- **WHEN** el autor descarta una
- **THEN** la zona de pendientes tiene dos filas
- **AND** el catálogo no se modifica

### Requirement: Advertencia al abandonar con filas pendientes

Mientras existan filas en la zona de pendientes, el sistema SHALL advertir al autor mediante el mecanismo del navegador antes de que la página se cierre o recargue, porque esas filas no se persisten.

#### Scenario: Advertencia con pendientes

- **GIVEN** la zona de pendientes tiene al menos una fila
- **WHEN** el autor intenta recargar o cerrar la página
- **THEN** el navegador solicita confirmación antes de abandonar

#### Scenario: Sin advertencia sin pendientes

- **GIVEN** la zona de pendientes está vacía
- **WHEN** el autor recarga la página
- **THEN** no se solicita confirmación

### Requirement: Procesamiento secuencial con progreso visible

El sistema SHALL procesar las imágenes de un lote de una en una, cediendo el control entre archivos para no bloquear la interfaz, y SHALL mostrar el avance mientras el lote se procesa.

#### Scenario: Progreso durante el procesamiento

- **WHEN** el autor selecciona varias imágenes
- **THEN** la interfaz indica el avance del procesamiento
- **AND** la página responde a la interacción mientras el lote se procesa

#### Scenario: Las filas aparecen a medida que se procesan

- **WHEN** el autor selecciona cinco imágenes
- **THEN** cada fila aparece en la zona de pendientes al terminar de procesarse, sin esperar a que el lote entero finalice
