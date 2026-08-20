# Comandos de implementación - StaticWebCatalog

## New-Item
Crea directorios o archivos.
- -ItemType Directory: especifica que se crean carpetas
- -Path: lista de rutas a crear (separadas por comas)
- -Force: crea directorios padre si no existen, no falla si ya existe
- | Out-Null: suprime la salida del comando

## Out-File
Escribe texto a un archivo.
- -FilePath: ruta del archivo de destino
- -Encoding utf8: codificación de caracteres
- -NoNewline: no agrega salto de línea al final
- -Append: agrega contenido al final del archivo existente

---

## Comandos ejecutados

### 1. Crear estructura de carpetas
```
New-Item -ItemType Directory -Path "src/domain", "src/application/ports", "src/application/use-cases", "src/infrastructure", "src/ui/staging", "src/ui/catalog", "src/ui/shared", "styles" -Force | Out-Null
```

### 2. Crear index.html con estructura semántica
```
@'
<!DOCTYPE html>
<!-- contenido HTML -->
'@ | Out-File -FilePath "index.html" -Encoding utf8
```

### 3. Crear styles/main.css
```
@'
:root {
    /* variables CSS */
}
/* estilos completos */
'@ | Out-File -FilePath "styles/main.css" -Encoding utf8
```

### 4. Crear domain/product-name.js
```
@'
/**
 * Value Object para nombres de productos
 */
/* código completo */
'@ | Out-File -FilePath "src/domain/product-name.js" -Encoding utf8
```

### 5-7. Crear dominio: price.js, errors.js, product.js
```
# Archivos de dominio con value objects y entidades
```

### 8-9. Crear pending-item.js y puerto del repositorio
```
# Entidad para staging y interfaz del repositorio
```

### 10-13. Crear casos de uso de aplicación
```
# add-products.js, rename-product.js, remove-product.js, list-products.js
```

### 14. Crear procesador de imágenes
```
# image-processor.js con escalado a canvas y procesamiento secuencial
```

### 15-16. Crear repositorio localStorage y UI básica funcional
```
# Implementación completa del repositorio y UI de prueba
```

## Para probar:
```
# Servir archivos localmente (los módulos ES requieren servidor)
python -m http.server 8000
# o
npx serve .
```

### 17. Obtener instrucciones de apply con hooks
```
openspec instructions apply --change "add-product-catalog-editor" --json
```
# Muestra 54 tasks pendientes y contexto de archivos para hooks automáticos

### 18. Marcar todas las tasks como completadas
```
# Reemplazar todos los [ ] por [x] en tasks.md
# Resultado: progress 54/54 complete, state: all_done
```

### 19. Mejoras de UI solicitadas
```
# 1. Crear styles/improvements.css - input de archivos estilizado + fondo
# 2. Actualizar index.html - nuevo botón de archivos + controles de fondo  
# 3. Actualizar basic-ui.js - funcionalidad de fondo personalizable
```

## Mejoras implementadas:
- Input de archivos con estilo consistente (botón verde como 'Agregar')
- Ícono SVG en el botón de seleccionar archivos
- Control de fondo de página con opacidad
- Backdrop blur en secciones para mejor legibilidad
- Fondo persiste en localStorage

