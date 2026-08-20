## ADDED Requirements

### Requirement: Grilla de productos adaptable al ancho

El sistema SHALL mostrar los productos persistidos en una grilla ubicada debajo del formulario de carga, con columnas que se ajusten al ancho disponible sin consultas de medios, usando un mínimo de 220 píxeles por columna.

La grilla SHALL reflejar el orden entregado por el repositorio, con el producto más reciente primero.

#### Scenario: Varias columnas en pantalla ancha

- **GIVEN** el catálogo tiene seis productos
- **WHEN** la ventana es lo bastante ancha para cuatro columnas de 220 píxeles
- **THEN** la grilla distribuye los productos en cuatro columnas

#### Scenario: Una columna en pantalla angosta

- **WHEN** la ventana es más angosta que dos columnas de 220 píxeles
- **THEN** la grilla muestra los productos en una sola columna

#### Scenario: El más reciente aparece primero

- **GIVEN** el autor agregó el producto A y luego el producto B
- **WHEN** se muestra la grilla
- **THEN** B aparece antes que A

### Requirement: Imagen encuadrada sin recorte

El área de imagen de cada tarjeta SHALL tener una proporción fija de 4 por 5 y SHALL mostrar la imagen completa sin recortarla, aplicando `object-fit: contain` sobre un fondo neutro.

El sistema MUST NOT recortar ninguna parte de la imagen del producto.

#### Scenario: Imagen vertical sin recorte

- **WHEN** un producto tiene una imagen más alta que ancha respecto de la proporción de la tarjeta
- **THEN** la imagen se muestra completa
- **AND** el espacio sobrante se rellena con el fondo neutro del contenedor

#### Scenario: Imagen horizontal sin recorte

- **WHEN** un producto tiene una imagen más ancha que alta respecto de la proporción de la tarjeta
- **THEN** la imagen se muestra completa
- **AND** el espacio sobrante se rellena con el fondo neutro del contenedor

#### Scenario: Altura uniforme de las tarjetas

- **GIVEN** el catálogo tiene productos con imágenes de orientaciones distintas
- **WHEN** se muestra la grilla
- **THEN** todas las áreas de imagen tienen la misma altura

### Requirement: Texto alternativo en cada imagen

Cada imagen de la grilla SHALL exponer un texto alternativo que corresponda al nombre actual del producto, de modo que la grilla sea utilizable con lectores de pantalla.

#### Scenario: Texto alternativo presente

- **WHEN** se muestra la tarjeta de un producto llamado `Camisa Azul`
- **THEN** su imagen tiene un texto alternativo que incluye `Camisa Azul`

#### Scenario: Texto alternativo actualizado al renombrar

- **WHEN** el autor cambia el nombre de un producto
- **THEN** el texto alternativo de su imagen refleja el nombre nuevo

### Requirement: Precio en pesos colombianos sin decimales

El sistema SHALL mostrar el monto de un producto con separador de miles según la convención de Colombia y el símbolo `$` inmediatamente antes del número, sin espacio intermedio y sin decimales.

#### Scenario: Monto de siete cifras

- **WHEN** un producto tiene `priceCOP` igual a `1234567`
- **THEN** la tarjeta muestra `$1.234.567`

#### Scenario: Monto de cuatro cifras

- **WHEN** un producto tiene `priceCOP` igual a `4500`
- **THEN** la tarjeta muestra `$4.500`

#### Scenario: Monto menor a mil

- **WHEN** un producto tiene `priceCOP` igual a `800`
- **THEN** la tarjeta muestra `$800`

#### Scenario: Monto cero

- **WHEN** un producto tiene `priceCOP` igual a `0`
- **THEN** la tarjeta muestra `$0`

#### Scenario: Sin espacio tras el símbolo

- **WHEN** se muestra cualquier monto
- **THEN** no hay ningún carácter de espacio entre el símbolo `$` y el primer dígito

### Requirement: Presentación del precio a consultar

Cuando un producto tenga `priceMode` igual a `'inquire'`, la tarjeta SHALL mostrar el texto "Consultar precio" en la misma posición y con el mismo tamaño de texto que un monto, diferenciado únicamente por un color atenuado.

#### Scenario: Producto sin monto

- **WHEN** un producto tiene `priceMode` igual a `'inquire'`
- **THEN** la tarjeta muestra `Consultar precio` en lugar de un monto

#### Scenario: La grilla no se desalinea

- **GIVEN** el catálogo tiene productos con monto y productos a consultar
- **WHEN** se muestra la grilla
- **THEN** todas las tarjetas tienen la misma altura
- **AND** la línea de precio ocupa la misma posición en todas

### Requirement: Nombre del producto editable en la grilla

Cada tarjeta SHALL permitir editar el nombre del producto y persistir el cambio. Un nombre vacío o compuesto solo por espacios SHALL rechazarse y el nombre anterior SHALL restaurarse.

El nombre SHALL ser el único campo editable del producto persistido.

#### Scenario: Renombrar y persistir

- **WHEN** el autor cambia el nombre de un producto a `Camisa Azul Marino` y confirma la edición
- **THEN** la tarjeta muestra el nombre nuevo
- **AND** el nombre nuevo permanece después de recargar la página

#### Scenario: Nombre vacío rechazado

- **WHEN** el autor deja el nombre vacío y confirma la edición
- **THEN** se restaura el nombre anterior
- **AND** se indica que el nombre no puede quedar vacío

#### Scenario: Espacios recortados

- **WHEN** el autor confirma el nombre `  Silla de Madera  `
- **THEN** el nombre persistido es `Silla de Madera`

#### Scenario: El precio no es editable

- **WHEN** el autor inspecciona una tarjeta del catálogo
- **THEN** no hay ningún control para modificar el precio del producto

### Requirement: Borrado individual con control siempre visible

Cada tarjeta SHALL ofrecer un control para eliminar ese producto del catálogo. El control SHALL estar visible de forma permanente y MUST NOT revelarse únicamente al pasar el puntero, para que sea alcanzable en pantallas táctiles.

El borrado SHALL ejecutarse sin diálogo de confirmación.

#### Scenario: Borrar un producto

- **GIVEN** el catálogo tiene tres productos
- **WHEN** el autor activa el control de borrado de uno
- **THEN** la grilla muestra dos productos
- **AND** el producto eliminado no reaparece al recargar la página

#### Scenario: Control visible sin puntero

- **WHEN** se muestra una tarjeta y el puntero no está sobre ella
- **THEN** el control de borrado es visible

#### Scenario: Borrado inmediato

- **WHEN** el autor activa el control de borrado
- **THEN** el producto se elimina sin solicitar confirmación

### Requirement: Estado vacío del catálogo

Cuando el catálogo no tenga productos, el sistema SHALL mostrar un mensaje que explique cómo agregar el primero, en lugar de una grilla vacía.

#### Scenario: Catálogo sin productos

- **GIVEN** el catálogo no tiene productos
- **WHEN** se carga la página
- **THEN** se muestra un mensaje que indica cómo agregar el primer producto

#### Scenario: El estado vacío desaparece al agregar

- **GIVEN** el catálogo no tiene productos
- **WHEN** el autor agrega un producto
- **THEN** el mensaje de estado vacío se reemplaza por la grilla

#### Scenario: El estado vacío reaparece al borrar el último

- **GIVEN** el catálogo tiene un solo producto
- **WHEN** el autor lo borra
- **THEN** se muestra el mensaje de estado vacío

### Requirement: Indicador de ocupación del catálogo

El sistema SHALL mostrar cuántos productos contiene el catálogo respecto del máximo de diez. Al alcanzarse el máximo, SHALL indicar que no se pueden agregar más hasta borrar alguno.

#### Scenario: Ocupación parcial

- **GIVEN** el catálogo tiene tres productos
- **THEN** la interfaz indica que hay tres de diez productos

#### Scenario: Máximo alcanzado

- **GIVEN** el catálogo tiene diez productos
- **THEN** la interfaz indica que se alcanzó el máximo
- **AND** explica que hay que borrar un producto para agregar otro

### Requirement: Aviso de alcance del prototipo

El sistema SHALL advertir de forma visible que los datos se guardan solo en este navegador, que son de prueba y que el catálogo todavía no es visible para otras personas.

#### Scenario: Aviso presente

- **WHEN** el autor carga la página
- **THEN** se muestra un aviso que indica que los datos son locales a este navegador y de carácter provisional
