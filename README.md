# StaticWebCatalog

Catálogo de productos web estático con editor de productos.

## Stage 1: Prototipo Local ✅ COMPLETADO
- Editor de productos con localStorage
- Arquitectura DDD (Domain/Application/Infrastructure/UI)
- Hasta 10 productos con imágenes
- Precios en COP o "Consultar precio"
- Funcionalidad de fondo de página
- Tema azul uniforme

## Tecnologías
- HTML5 + CSS3 + JavaScript vanilla
- Módulos ES6
- localStorage para persistencia
- Canvas API para redimensión de imágenes

## Uso (Stage 1)
```bash
# Servidor local requerido (módulos ES)
python -m http.server 8000
# Abrir: http://localhost:8000
```

## Roadmap
- **Stage 1**: ✅ Prototipo local (localStorage, 10 productos)
- **Stage 2**: 🔄 S3 Publication (AWS S3, 100 productos)
- **Stage 3**: ⏸️ Serverless Architecture
- **Stage 4**: ⏸️ E-commerce Integration (Wompi)

## Arquitectura
```
src/
├── domain/          # Entidades y value objects
├── application/     # Casos de uso y ports
├── infrastructure/ # Implementaciones (localStorage, image processing)
└── ui/             # Componentes de interfaz
```
