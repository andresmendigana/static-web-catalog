# Manual de Ejecución - Stage 2 (s3-publication-upgrade)

## Pre-requisitos

1. Node.js 22.14.0 y npm 10.9.2 instalados
2. Python 3 instalado (para servir archivos localmente)
3. Git configurado
4. Credenciales AWS configuradas (solo para publicar a S3)

---

## Paso 1: Preparar el ambiente

\\\powershell
cd "c:\mis_proyectos_2026\Static web catalog\StaticWebCatalog"
npm install
\\\

---

## Paso 2: Ejecutar en navegador (Autoría Local)

Elige una opción:

**Opción A: Usar Python**
\\\powershell
python -m http.server 8000
\\\

**Opción B: Usar npx serve**
\\\powershell
npx serve .
\\\

**Opción C: Usar VS Code Live Server**
- Hacer clic derecho en \index.html\
- Seleccionar "Open with Live Server"

Luego abre en tu navegador:
- **http://localhost:8000** (con Python)
- **http://localhost:3000** (con npx serve)

---

## Paso 3: Usar la aplicación (Autoría Local)

### Agregar productos

1. Haz clic en **"Seleccionar imágenes de productos"**
2. Carga imágenes JPEG desde tu computadora
3. Se crearán filas pendientes con campos para:
   - Nombre del producto
   - Precio (COP) o "Consultar precio"
   - Características (0-12 pares clave-valor)

### Editar características

- Cada fila permite agregar características ordenadas
- Etiqueta: 1-40 caracteres
- Valor: 1-120 caracteres
- Máximo: 12 pares por producto
- El orden se preserva

### Confirmar parcialmente

- Solo se agregan las filas con precio resuelto
- Las filas pendientes permanecen en la zona de pendientes
- Si algo falla, se mantiene intacto para reintento

### Ver catálogo

- Se muestra abajo con ocupación actual/100
- Los productos están ordenados por fecha de creación (más nuevos primero)

---

## Paso 4: Exportar el catálogo

\\\powershell
npm run export -- --input ./data/products.json --output ./artifacts/catalog-export.json
\\\

**Qué hace:**
- Lee registros locales de \localStorage\ o archivo JSON
- Convierte Stage 1 a Stage 2 (agrega \characteristics: []\ si falta)
- Incluye imágenes procesadas como data URI JPEG
- Genera paquete \stage2-export-v1\ con:
  - \schemaVersion\: versión del contrato
  - \generatedAt\: marca de tiempo UTC
  - \products\: array de productos normalizados
  - \images\: referencias y datos JPEG

**Alternativa: Desde localStorage del navegador**
- Abre DevTools (F12)
- Copia el contenido de \localStorage\
- Guarda como JSON en \./data/products.json\
- Ejecuta \
pm run export\

---

## Paso 5: Validar sin escribir a S3 (Dry-run)

### Configurar variables de entorno

Crea un archivo \.env.local\ o exporta en PowerShell:

\\\powershell
\="catalog-publisher"
\="us-east-1"
\="replace-with-private-catalog-bucket"
\="releases"
\="cloudfront-oac"
\\\

### Ejecutar validación

\\\powershell
npm run dry-run -- ./artifacts/catalog-export.json
\\\

**Qué hace:**
- Valida paquete exportado (esquema, precios, características, imágenes)
- Valida configuración destino (sin credenciales)
- Reporta errores detallados sin exponerlos
- **No escribe nada en S3** (0 writes, 0 network calls)

**Salida esperada:**
\\\
✅ Preflight validation passed
📦 Artifacts: 52 files
💾 S3 writes: 0
🌐 Network calls: 0
\\\

---

## Paso 6: Generar manifiesto público

\\\powershell
npm run manifest -- --input ./artifacts/catalog-export.json 
  --release-id 2026-08-25-mi-release 
  --output ./artifacts/manifest.json
\\\

**Qué hace:**
- Genera \stage2-manifest-v1\ (contrato público)
- Incluye:
  - Productos ordenados por \createdAt\ descendente
  - Precios (\priceMode\ y \priceCOP\)
  - Características preservadas en orden
  - Referencias de imagen controladas
  - Catálogo limitado a 100 productos

**Contrato del manifiesto:**
\\\json
{
  "schemaVersion": "stage2-manifest-v1",
  "generatedAt": "2026-08-25T12:00:00.000Z",
  "catalogLimit": 100,
  "products": [
    {
      "id": "uuid",
      "name": "Producto",
      "priceMode": "amount",
      "priceCOP": 10000,
      "createdAt": "2026-08-25T12:00:00.000Z",
      "characteristics": [
        {"label": "Color", "value": "Rojo"}
      ],
      "image": {
        "key": "releases/release-id/images/uuid.jpg",
        "contentType": "image/jpeg"
      }
    }
  ]
}
\\\

---

## Paso 7: Publicar a S3

### Pre-requisito: Configuración AWS

Asegúrate de tener credenciales configuradas:

\\\powershell
# Verifica credenciales
aws sts get-caller-identity

# Si no está configurado
aws configure --profile catalog-publisher
\\\

### Ejecutar publicación

\\\powershell
npm run publish -- ./artifacts/release-directory
\\\

**Flujo de publicación:**

1. **Preflight:** valida completamente el paquete
   - Esquema, UUID, fechas, precios, características
   - Imágenes uno-a-uno
   - Capacidad ≤ 100

2. **Upload:** sube a S3 bajo \eleases/<release-id>/\
   - \index.html\ (aplicación read-only)
   - \manifest.json\ (contrato público)
   - \images/<product-uuid>.jpg\ (JPEG)
   - Caché larga: \public, max-age=31536000, immutable\

3. **Verificación:** lee cada artefacto y confirma
   - Existencia de objetos
   - Bytes correctos (ContentLength)
   - Metadatos correctos (ContentType, CacheControl)
   - Referencias de imagen resuelven

4. **Pointer:** actualiza \eleases/current.json\ como última operación
   - Caché corta: \
o-cache, max-age=0, must-revalidate\
   - Solo después de verificación completa
   - Si falla, mantiene puntero anterior vigente

**Salida esperada:**
\\\
✅ Release verified
📝 Pointer updated: releases/current.json
🎉 Publication complete
\\\

---

## Paso 8: Consumir públicamente (Read-only)

El visitante anónimo accede mediante:

\\\
https://tu-dominio.com/releases/current.json
  → redirige a release actual

https://cloudfront.../releases/<id>/index.html
  → aplicación read-only
\\\

### La aplicación read-only

- Carga el manifiesto desde su mismo prefijo o desde \current.json\
- Renderiza productos en orden, sin controles de edición
- Muestra imágenes desde claves controladas (\eleases/<id>/images/<uuid>.jpg\)
- Muestra características en orden
- No requiere Cognito, API de escritura ni DynamoDB
- Maneja errores sin tarjetas parciales

---

## Paso 9: Rollback a release anterior

\\\powershell
npm run rollback -- --release-id "2026-08-24-anterior-release"
\\\

**Qué hace:**
- Verifica que el release anterior sea completo
  - Manifiesto válido
  - \index.html\ existe
  - Todas las imágenes referenciadas existen
- Solo actualiza \eleases/current.json\
- Los prefijos inmutables \eleases/<id>/*\ no se tocan
- El visitante ve la release anterior
- Si la verificación o la escritura falla, mantiene puntero anterior

---

## Ejecutar pruebas

### Todas las pruebas
\\\powershell
npm run test:all
\\\

### Por tipo

\\\powershell
npm run test:unit          # 198 tests - invariantes, contratos, validación
npm run test:property      # Property-based (fast-check 100+ runs cada propiedad)
npm run test:dom           # DOM/UI - capacidad, características, imágenes
npm run test:migration     # Migración Stage 1→2
npm run test:integration   # 10 tests - publicación completa
npm run test:smoke         # Humo y seguridad
npm run test:security      # Seguridad - sin credenciales en bundle
\\\

**Resultado esperado:**
- 198 tests unitarios: ✅ PASS
- 10 tests integración: ✅ PASS
- Property-based: ✅ PASS
- Total: 250+ assertions

---

## Configuración de producción (S3 privado + CloudFront/OAC)

Consulta \docs/s3-cloudfront-oac.md\ para:
- Crear bucket S3 privado con bloqueo de acceso público
- Configurar CloudFront con Origin Access Control (OAC)
- Policies de lectura exclusiva por OAC
- Caché: larga para \eleases/\, corta para \current.json\
- Certificado SSL/TLS
- Dominio personalizado

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| "Cannot find module" | Ejecuta \
pm install\ primero |
| Módulos ES no funcionan en local | Necesita servidor (Python, npx serve, o Live Server) |
| Dry-run falla con "101 productos" | Limita a máximo 100 productos en la exportación |
| S3 rechaza upload | Verifica credenciales AWS y política de bucket |
| Manifiesto inválido | Revisa precios, características (0-12 pares), referencias de imagen |
| "Release already exists" | El prefijo ya tiene artefactos; usa otro \elease-id\ |
| Pointer no se actualiza | Verifica que la verificación post-upload completó exitosamente |

---

## Estructura de artifacts

\\\
artifacts/
├── catalog-export.json       # stage2-export-v1 (entrada al publicador)
├── manifest.json             # stage2-manifest-v1 (contrato público)
└── release-directory/
    ├── index.html            # Aplicación read-only
    ├── assets/               # CSS, JS, etc.
    ├── manifest.json         # Copia del manifiesto
    ├── images/               # Imágenes JPEG por producto
    │   ├── uuid1.jpg
    │   ├── uuid2.jpg
    │   └── ...
    └── releases/
        └── current.json      # Puntero a release actual
\\\

---

## Recursos adicionales

- **\docs/technical-design.md\** — Decisiones arquitectónicas y modelos
- **\docs/s3-cloudfront-oac.md\** — Configuración AWS producción
- **\diagrams/stage2-publication-architecture.md\** — Diagrama visual
- **\scripts/tooling/publisher.env.example\** — Variables de entorno
- **\README.md\** — Overview del proyecto

---

## Preguntas frecuentes

### ¿Cómo copio productos de localStorage?
1. Abre DevTools (F12) en el navegador
2. En la pestaña Console, ejecuta:
   \\\javascript
   JSON.stringify(localStorage)
   \\\
3. Copia el resultado
4. Crea \data/products.json\ y pega el contenido
5. Ejecuta \
pm run export\

### ¿Qué pasa si publico con menos de 100 productos?
Funciona normalmente. El límite es 100 máximo, no mínimo.

### ¿Puedo cambiar el nombre de la release?
Sí, el \elease-id\ es único y personalizable. Se recomienda incluir fecha: \2026-08-25-v1\.

### ¿Cómo reviso lo que se va a subir sin publicar?
Ejecuta \
pm run dry-run\ — valida todo sin escribir a S3.

### ¿Puedo revertir a la publicación anterior?
Sí, con \
pm run rollback --release-id <id-anterior>\. Solo cambia el puntero.

---

**Versión del manual:** 2.0.0 (s3-publication-upgrade completo)
**Última actualización:** 2026-08-25
