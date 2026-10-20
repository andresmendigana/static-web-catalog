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

## Stage 2: Publicación estática (S3 privado + CloudFront/OAC)

Stage 2 amplía el prototipo para que un vendedor pueda publicar **hasta 100 productos** como archivos estáticos. La autoría sigue siendo local: los productos se editan y persisten en `localStorage` del navegador del autor, y no se vuelven públicos automáticamente. El catálogo publicado se consume en modo **read-only**: el visitante solo lee el manifiesto y los assets, sin controles para editar, borrar, cambiar precios o persistir datos.

Stage 2 cubre únicamente autoría local, exportación, validación/publicación de un catálogo estático y su lectura pública. No incorpora un backend de catálogo ni contratos de escritura desde el navegador; esas decisiones pertenecen a etapas posteriores y no forman parte de este contrato.

### Flujo local y publicación externa

1. **Autoría local:** el editor mantiene los registros y las imágenes procesadas en el navegador. El límite de 100 se aplica en el modelo/repositorio, no solo en la vista.
2. **Exportación local:** `npm run export` convierte una lista de registros Stage 1/Stage 2 en un paquete `stage2-export-v1`, conserva el orden e identificadores y agrega las imágenes necesarias. Es una operación local, sin red ni credenciales.
3. **Dry-run:** `npm run dry-run` valida el paquete y la configuración no secreta del destino. No escribe archivos, no hace llamadas de red y reporta `s3Writes: 0` y `networkCalls: 0`.
4. **Publicación externa:** `npm run publish` se ejecuta con Node.js fuera del bundle del navegador, desde un perfil/rol del entorno autorizado. La autorización AWS se resuelve en ese entorno; nunca se entrega al navegador ni se incluye en el paquete exportado.
5. **Consumo público:** la aplicación publicada carga el manifiesto y las imágenes mediante lecturas HTTP. Una publicación incompleta no debe convertirse en la versión visible.

Ejemplo de comandos con rutas locales de muestra (sustituye las rutas; no contienen secretos):

```bash
npm run export -- --input ./data/products.json --output ./artifacts/catalog-export.json
npm run dry-run -- ./artifacts/catalog-export.json
npm run manifest -- --input ./artifacts/catalog-export.json --release-id 2026-08-23-demo --output ./artifacts/manifest.json
npm run publish -- ./artifacts/release-directory
```

`dry-run` valida el paquete y requiere únicamente archivos locales y parámetros de destino no sensibles; `manifest` solo lee el paquete local y el `release-id`. Para `dry-run`/`publish`, la configuración mínima de ejemplo puede establecerse en el entorno autorizado:

```bash
# Bash (exporta estas variables en el proceso que ejecuta el tooling)
export AWS_PROFILE=catalog-publisher
export AWS_REGION=us-east-1
export S3_BUCKET=replace-with-private-catalog-bucket
export S3_RELEASE_PREFIX=releases
export PUBLICATION_MODE=cloudfront-oac

# En PowerShell: $env:AWS_PROFILE = "catalog-publisher" (y análogamente para las demás)
```

Estos valores son metadatos de destino, no credenciales. No definas ni versiones `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, tokens de sesión, claves privadas o policies con secretos en el repositorio, el `.env`, el paquete exportado o el bundle. **No hay credenciales AWS en el navegador:** la SPA pública solo realiza lecturas y el publicador es Node-only.

### Releases y configuración de entrega

El layout lógico de una publicación es:

```text
releases/<release-id>/index.html
releases/<release-id>/manifest.json
releases/<release-id>/images/<product-id>.jpg
releases/current.json
```

Cada prefijo `releases/<release-id>/` es inmutable y usa caché larga (`public, max-age=31536000, immutable`). `releases/current.json` es el puntero mutable y usa caché corta (`no-cache, max-age=0, must-revalidate`); solo se actualiza después de verificar el release completo. La configuración recomendada mantiene el bucket S3 **privado** y permite lecturas únicamente a CloudFront mediante Origin Access Control (OAC), sin `Principal: "*"` ni escritura anónima.

Consulta la [guía técnica](docs/technical-design.md), la [guía operativa S3 privado + CloudFront/OAC](docs/s3-cloudfront-oac.md), el [índice de diagramas reproducibles de Stage 2](diagrams/README.md), la [vista consolidada](diagrams/stage2-publication-architecture.md), su [PNG](diagrams/stage2-publication-architecture.png), [generador Python](diagrams/stage2-publication-architecture.py) y [fuente draw.io](diagrams/stage2-publication-architecture.drawio), las [plantillas de infraestructura](infra/s3-cloudfront-oac/) y la [configuración de ejemplo del publicador](scripts/tooling/publisher.env.example). Los marcadores se sustituyen fuera del repositorio o mediante CI.

`PUBLICATION_MODE=s3-public-prototype` solo existe como alternativa explícita para una demostración temporal con un bucket separado y sin datos sensibles. Permite eludir CloudFront y aumenta la exposición del origen; no es una configuración de producción y no debe mezclarse con la policy privada/OAC.
