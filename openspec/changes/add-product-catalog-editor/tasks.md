## 1. Estructura del proyecto y configuración

- [x] 1.1 Crear estructura de carpetas: `src/domain/`, `src/application/`, `src/infrastructure/`, `src/ui/`, `src/shared/`
- [x] 1.2 Crear `index.html` con estructura semántica básica, meta viewport, y carga de módulos ES
- [x] 1.3 Crear `styles/main.css` con variables CSS y estilos base (reset, tipografía, colores neutros)
- [x] 1.4 Crear `src/main.js` como punto de entrada que inicializa la aplicación

## 2. Capa de dominio (domain)

- [x] 2.1 Crear `src/domain/product.js`: entidad Product con factory `createProduct()`, validación de invariantes de precio
- [x] 2.2 Crear `src/domain/product-name.js`: value object ProductName con derivación desde nombre de archivo y capitalización
- [x] 2.3 Crear `src/domain/price.js`: value object Price con validación de entero no negativo y formato COP
- [x] 2.4 Crear `src/domain/pending-item.js`: entidad PendingItem para la zona de staging (sin persistir)
- [x] 2.5 Crear `src/domain/errors.js`: errores de dominio (InvalidProductError, QuotaExceededError, StorageUnavailableError)

## 3. Capa de aplicación (application)

- [x] 3.1 Crear `src/application/ports/product-repository.js`: interfaz del repositorio (list, add, rename, remove, count)
- [x] 3.2 Crear `src/application/use-cases/add-products.js`: caso de uso para agregar productos desde filas resueltas
- [x] 3.3 Crear `src/application/use-cases/rename-product.js`: caso de uso para renombrar un producto
- [x] 3.4 Crear `src/application/use-cases/remove-product.js`: caso de uso para eliminar un producto
- [x] 3.5 Crear `src/application/use-cases/list-products.js`: caso de uso para listar productos ordenados por fecha

## 4. Capa de infraestructura (infrastructure)

- [x] 4.1 Crear `src/infrastructure/local-storage-repository.js`: implementación del repositorio sobre localStorage
- [x] 4.2 Implementar `add()` con validación de límite de 10 productos y manejo de cuota agotada
- [x] 4.3 Implementar `list()` con deserialización y ordenamiento por createdAt descendente
- [x] 4.4 Implementar `rename()` con validación de nombre no vacío
- [x] 4.5 Implementar `remove()` silencioso si el id no existe
- [x] 4.6 Crear `src/infrastructure/image-processor.js`: escalado de imagen a 800px con canvas, output data URI JPEG 0.8

## 5. Capa de UI - Zona de pendientes (ui/staging)

- [x] 5.1 Crear `src/ui/staging/staging-view.js`: componente contenedor de la zona de pendientes
- [x] 5.2 Crear `src/ui/staging/file-input.js`: input de archivos múltiple con accept="image/*"
- [x] 5.3 Crear `src/ui/staging/pending-row.js`: fila individual con thumbnail, nombre editable, decisión de precio
- [x] 5.4 Implementar lógica de decisión de precio: campo de monto (solo dígitos) o checkbox "Consultar precio"
- [x] 5.5 Implementar botón "Agregar al catálogo" que procesa filas resueltas y deja las no resueltas
- [x] 5.6 Implementar descarte de fila individual
- [x] 5.7 Implementar advertencia beforeunload cuando hay filas pendientes
- [x] 5.8 Implementar indicador de progreso durante procesamiento de imágenes

## 6. Capa de UI - Grilla del catálogo (ui/catalog)

- [x] 6.1 Crear `src/ui/catalog/catalog-view.js`: componente contenedor de la grilla
- [x] 6.2 Crear `src/ui/catalog/product-card.js`: tarjeta con imagen (contain 4:5), nombre editable, precio formateado, botón borrar
- [x] 6.3 Implementar edición inline del nombre con validación y persistencia
- [x] 6.4 Implementar formato de precio COP sin decimales ($1.234.567) y "Consultar precio" atenuado
- [x] 6.5 Implementar borrado sin confirmación
- [x] 6.6 Crear `src/ui/catalog/empty-state.js`: mensaje cuando el catálogo está vacío
- [x] 6.7 Implementar indicador de ocupación (X de 10 productos)

## 7. Capa de UI - Componentes compartidos

- [x] 7.1 Crear `src/ui/shared/toast.js`: notificaciones de error/éxito no bloqueantes
- [x] 7.2 Crear `src/ui/shared/prototype-banner.js`: aviso de que los datos son locales y de prueba

## 8. Estilos CSS

- [x] 8.1 Estilos de la zona de pendientes: filas, estados resuelto/sin resolver, campos de precio
- [x] 8.2 Estilos de la grilla: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`
- [x] 8.3 Estilos de la tarjeta: aspect-ratio 4/5, object-fit contain, fondo neutro, botón borrar visible
- [x] 8.4 Estilos del precio: "Consultar precio" en color atenuado, mismo tamaño que monto
- [x] 8.5 Estilos del estado vacío y del banner de prototipo
- [x] 8.6 Estilos de toasts y feedback visual

## 9. Integración y pruebas manuales

- [x] 9.1 Conectar main.js: instanciar repositorio, inyectar en vistas, montar en DOM
- [x] 9.2 Probar flujo completo: cargar imágenes → decidir precio → agregar → ver en grilla
- [x] 9.3 Probar edición de nombre en la grilla
- [x] 9.4 Probar borrado y actualización de contador
- [x] 9.5 Probar persistencia: recargar página y verificar que los productos persisten
- [x] 9.6 Probar límite de 10 productos y mensaje de error
- [x] 9.7 Probar advertencia de beforeunload con filas pendientes
- [x] 9.8 Probar con imágenes de distintas orientaciones (vertical, horizontal, cuadrada)

## 10. Documentación y cleanup

- [x] 10.1 Crear `README.md` con instrucciones de uso (servidor local requerido)
- [x] 10.2 Agregar comentarios JSDoc en módulos públicos
- [x] 10.3 Verificar accesibilidad básica: alt en imágenes, labels en inputs, contraste