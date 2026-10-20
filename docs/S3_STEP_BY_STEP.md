# 🚀 PUBLICAR EN S3: GUÍA PASO A PASO

## PASO 1: Exportar Productos desde el Navegador
**Donde**: http://localhost:8001 (en DevTools Console - F12)

Ejecuta este código:
\\\javascript
const products = JSON.parse(localStorage.getItem('static_web_catalog_products') || '[]');
const exportPackage = {
    version: 'stage2-export-v1',
    generatedAt: new Date().toISOString(),
    products: products
};
const blob = new Blob([JSON.stringify(exportPackage, null, 2)], {type: 'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'catalog-export.json';
a.click();
\\\

📥 **Resultado**: Descarga catalog-export.json
📍 **Guardar en**: Raíz del proyecto (al lado de package.json)

---

## PASO 2: Generar Manifest
**Donde**: PowerShell en la raíz del proyecto

Ejecuta (reemplaza la fecha):
\\\ash
npm run manifest -- --input catalog-export.json --release-id 2026-10-19-demo --output manifest.json
\\\

📤 **Resultado**: Se crea \manifest.json\ en la raíz
**Contenido**: Índice de todos tus productos con metadatos

---

## PASO 3: Preparar Archivos para S3
**Donde**: PowerShell

Ejecuta:
\\\ash
.\scripts\prepare-s3-deploy.ps1 -ReleaseId 2026-10-19-demo
\\\

📂 **Resultado**: Crea carpeta \s3-deploy/\ con estructura:
\\\
s3-deploy/
├── releases/
│   ├── 2026-10-19-demo/
│   │   ├── index.html
│   │   ├── manifest.json
│   │   ├── src/
│   │   ├── styles/
│   │   └── images/           ← Aquí van las imágenes
│   └── current.json
\\\

---

## PASO 4: Subir a S3 con AWS CLI
**Donde**: PowerShell

### 4a. Configurar AWS (una sola vez):
\\\ash
aws configure
\\\

Te pide:
- AWS Access Key ID: [tu clave de acceso]
- AWS Secret Access Key: [tu clave secreta]
- Default region: us-east-1
- Default output format: json

### 4b. Habilitar hosting estático en S3:
\\\ash
aws s3 website s3://s3-static-public-site/ \
  --index-document index.html \
  --error-document index.html
\\\

### 4c. Hacer bucket PÚBLICO (importante):
\\\ash
aws s3api put-bucket-policy --bucket s3-static-public-site --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::s3-static-public-site/*"
  }]
}'
\\\

### 4d. Subir archivos:
\\\ash
aws s3 sync s3-deploy/ s3://s3-static-public-site/ \
  --acl public-read \
  --cache-control \"max-age=300\"
\\\

---

## PASO 5: Acceder al Catálogo Publicado
**URL**:
\\\
http://s3-static-public-site.s3-website-us-east-1.amazonaws.com
\\\

Para confirmar la región de tu bucket:
\\\ash
aws s3api get-bucket-location --bucket s3-static-public-site
\\\

---

## ✅ RESUMEN RÁPIDO

1. **Navegador**: Descarga \catalog-export.json\
2. **Terminal**: \
pm run manifest -- --input catalog-export.json --release-id 2026-10-19-demo --output manifest.json\
3. **Terminal**: \.\scripts\prepare-s3-deploy.ps1 -ReleaseId 2026-10-19-demo\
4. **Terminal**: \ws s3 sync s3-deploy/ s3://s3-static-public-site/ --acl public-read\
5. **Navegador**: Visita la URL pública

---

## 🔍 VERIFICACIÓN

¿Qué hace manifest.json?
- Lee la estructura de productos
- Obtiene imágenes de DummyJSON URLs
- Muestra el catálogo en modo lectura (sin edición)
- Valida la integridad del catálogo

¿Dónde se genera?
- **ANTES**: No existe
- **DESPUÉS de npm run manifest**: Se crea en la raíz como \manifest.json\
- **FINAL**: Se sube a S3 en \eleases/[release-id]/manifest.json\

