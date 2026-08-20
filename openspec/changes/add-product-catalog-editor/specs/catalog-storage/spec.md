## ADDED Requirements

### Requirement: Modelo de producto con invariantes de precio

El sistema SHALL representar cada producto persistido con los campos `id`, `name`, `priceMode`, `priceCOP`, `image` y `createdAt`.

El campo `priceMode` SHALL tomar exactamente uno de dos valores: `'amount'` o `'inquire'`. La relación con `priceCOP` SHALL cumplir la doble implicación: `priceMode === 'amount'` si y solo si `priceCOP` es un entero mayor o igual a cero, y `priceMode === 'inquire'` si y solo si `priceCOP` es `null`.

Un producto persistido MUST NOT tener `priceMode` sin definir.

#### Scenario: Producto con monto

- **WHEN** se persiste un producto con `priceMode` igual a `'amount'`
- **THEN** `priceCOP` es un entero mayor o igual a cero
- **AND** `priceCOP` no tiene parte decimal

#### Scenario: Producto sin monto

- **WHEN** se persiste un producto con `priceMode` igual a `'inquire'`
- **THEN** `priceCOP` es `null`

#### Scenario: Combinación inválida rechazada

- **WHEN** se intenta persistir un producto con `priceMode` igual a `'inquire'` y `priceCOP` igual a `50000`
- **THEN** el repositorio rechaza la operación con un error
- **AND** el catálogo persistido no se modifica

#### Scenario: Precio decimal rechazado

- **WHEN** se intenta persistir un producto con `priceMode` igual a `'amount'` y `priceCOP` igual a `1500.75`
- **THEN** el repositorio rechaza la operación con un error

#### Scenario: Precio negativo rechazado

- **WHEN** se intenta persistir un producto con `priceMode` igual a `'amount'` y `priceCOP` igual a `-1`
- **THEN** el repositorio rechaza la operación con un error

### Requirement: Identidad estable por UUID

El sistema SHALL asignar a cada producto un identificador generado con `crypto.randomUUID()` en el momento de la carga. El identificador SHALL ser la única clave del producto y MUST NOT derivarse del nombre del archivo ni del nombre del producto.

El identificador SHALL permanecer inalterado ante cualquier edición del producto.

#### Scenario: Archivos con el mismo nombre producen productos distintos

- **WHEN** el autor confirma dos filas cuyas imágenes se llamaban ambas `camisa-azul.jpg`
- **THEN** el catálogo contiene dos productos con identificadores distintos

#### Scenario: El identificador sobrevive al renombrado

- **WHEN** el autor cambia el nombre de un producto
- **THEN** el identificador del producto es el mismo que antes del cambio

### Requirement: Interfaz de repositorio asíncrona y única

El sistema SHALL exponer el acceso a los datos únicamente a través de una interfaz de repositorio con las operaciones `list`, `add`, `rename`, `remove` y `count`. Todas las operaciones SHALL devolver promesas, independientemente de que la implementación subyacente sea sincrónica.

Los módulos de vista MUST NOT acceder al mecanismo de almacenamiento de forma directa. El repositorio SHALL recibirse por inyección desde el arranque de la aplicación.

#### Scenario: Todas las operaciones son asíncronas

- **WHEN** se invoca cualquier operación del repositorio
- **THEN** la operación devuelve una promesa

#### Scenario: Las vistas no conocen el almacenamiento

- **WHEN** se inspeccionan los módulos de vista
- **THEN** ninguno referencia `localStorage` ni ninguna API de almacenamiento del navegador
- **AND** todos operan sobre la interfaz de repositorio recibida por inyección

#### Scenario: Sustituir la implementación no altera las vistas

- **WHEN** se reemplaza la implementación del repositorio por otra que cumple la misma interfaz
- **THEN** los módulos de vista funcionan sin modificación

### Requirement: Persistencia entre recargas

El sistema SHALL persistir los productos del catálogo de modo que sobrevivan al cierre y la reapertura de la página en el mismo navegador.

#### Scenario: El catálogo se recupera tras recargar

- **GIVEN** el autor tiene tres productos en el catálogo
- **WHEN** recarga la página
- **THEN** la grilla muestra los mismos tres productos con su nombre, precio e imagen

#### Scenario: Un borrado persiste

- **GIVEN** el autor tiene tres productos en el catálogo
- **WHEN** borra uno y recarga la página
- **THEN** la grilla muestra dos productos
- **AND** el producto borrado no reaparece

### Requirement: Orden de listado determinista

La operación `list` SHALL devolver los productos ordenados por `createdAt` de forma descendente, de modo que el producto agregado más recientemente aparezca primero.

#### Scenario: El más reciente aparece primero

- **GIVEN** el autor agregó el producto A y luego el producto B
- **WHEN** se lista el catálogo
- **THEN** B aparece antes que A

### Requirement: Límite de diez productos validado en el repositorio

El repositorio SHALL rechazar la operación `add` cuando el catálogo ya contiene diez productos. La validación SHALL residir en el repositorio y MUST NOT depender de una comprobación en la vista.

El límite SHALL estar definido en una única constante.

#### Scenario: La undécima adición se rechaza

- **GIVEN** el catálogo contiene diez productos
- **WHEN** se invoca `add` con un producto nuevo
- **THEN** el repositorio rechaza la operación con un error que identifica el límite alcanzado
- **AND** el catálogo sigue conteniendo diez productos

#### Scenario: Borrar libera un lugar

- **GIVEN** el catálogo contiene diez productos
- **WHEN** el autor borra un producto y luego se invoca `add`
- **THEN** la adición se completa
- **AND** el catálogo contiene diez productos

#### Scenario: Un lote que excede el límite se agrega parcialmente

- **GIVEN** el catálogo contiene ocho productos
- **WHEN** el autor confirma cuatro filas resueltas
- **THEN** las dos primeras se agregan al catálogo
- **AND** las dos restantes permanecen en la zona de pendientes con un mensaje que indica que se alcanzó el límite

### Requirement: Manejo de cuota de almacenamiento agotada

Cuando la escritura falle por cuota agotada, el repositorio SHALL propagar un error distinguible de otros fallos y MUST NOT dejar el almacén en un estado parcial.

#### Scenario: La adición falla por cuota

- **WHEN** `add` falla porque el almacenamiento excedió su cuota
- **THEN** el repositorio propaga un error identificable como fallo de cuota
- **AND** el catálogo persistido queda idéntico a como estaba antes de la operación

#### Scenario: La fila afectada no se pierde

- **WHEN** la adición de una fila falla por cuota
- **THEN** esa fila permanece en la zona de pendientes con su nombre y su decisión de precio intactos
- **AND** las filas que sí se agregaron no se revierten

### Requirement: Almacenamiento no disponible

Cuando el almacenamiento del navegador no esté disponible para escritura, el sistema SHALL informarlo con un mensaje visible y MUST NOT fallar en silencio.

#### Scenario: Escritura bloqueada por el navegador

- **GIVEN** el navegador impide escribir en el almacenamiento
- **WHEN** el autor intenta confirmar una fila
- **THEN** la aplicación muestra un mensaje que explica que los datos no se pueden guardar
- **AND** la interfaz permanece utilizable

### Requirement: Renombrado y borrado por identificador

El repositorio SHALL permitir cambiar el nombre de un producto y eliminar un producto, ambos identificados por su `id`.

La operación `rename` SHALL rechazar un nombre vacío o compuesto solo por espacios en blanco.

#### Scenario: Renombrado exitoso

- **WHEN** se invoca `rename` con un identificador existente y el nombre `Camisa Azul Marino`
- **THEN** el producto queda con ese nombre
- **AND** el cambio sobrevive a una recarga de la página

#### Scenario: Nombre vacío rechazado

- **WHEN** se invoca `rename` con una cadena vacía o solo espacios
- **THEN** el repositorio rechaza la operación
- **AND** el nombre anterior del producto se conserva

#### Scenario: Borrado de un identificador inexistente

- **WHEN** se invoca `remove` con un identificador que no está en el catálogo
- **THEN** la operación no altera el catálogo
- **AND** no se propaga un error al autor
