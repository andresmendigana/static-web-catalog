# 🚀 Guía Completa: Publicar Catálogo en S3

## Requisitos Previos
✓ Bucket S3: `s3-static-public-site` (ya creado)
✓ Productos en localStorage (ya tienes)
✓ AWS CLI configurado

---

## PASO 1: Exportar Productos desde el Navegador

1. Abre http://localhost:8001 con productos en el catálogo
2. F12 → Console → Pega y ejecuta:

```javascript
// Exportar productos
const products = JSON.parse(localStorage.getItem('static_web_catalog_products'));
const blob = new Blob([JSON.stringify(products, null, 2)], {type: 'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'my-products.json';
a.click();
```

Esto descarga `my-products.json` → Guárdalo en la raíz del proyecto.

---

## PASO 2: Generar Package de Exportación

```bash
# Genera el package stage2-export-v1
npm run export -- my-products.json exports/catalog-package.json
```

Resultado: `exports/catalog-package.json` con formato:
```json
{
  "version": "stage2-export-v1",
  "generatedAt": "2026-...",
  "products": [...]
}
```

---

## PASO 3: Crear HTML del Catálogo Público

Crea un archivo `public-catalog.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Catálogo de Productos</title>
    <link rel="stylesheet" href="styles/catalog.css">
</head>
<body>
    <div id="catalog-container"></div>
    <script type="module" src="src/public/main.js"></script>
</body>
</html>
```

---

## PASO 4: Archivos para Subir a S3

Necesitas subir estos archivos:

```
s3://s3-static-public-site/
├── index.html                    ← public-catalog.html (renombrado)
├── catalog-package.json          ← exports/catalog-package.json
├── src/
│   └── public/
│       ├── main.js
│       └── public-catalog.js
├── styles/
│   └── catalog.css               ← styles/public-catalog.css
└── [imágenes si usas locales]
```

---

## PASO 5: Preparar Archivos Localmente

```bash
# Crear estructura de directorio temporal
mkdir -p s3-deploy/src/public
mkdir -p s3-deploy/styles

# Copiar archivos necesarios
cp public-catalog.html s3-deploy/index.html
cp exports/catalog-package.json s3-deploy/
cp src/public/main.js s3-deploy/src/public/
cp src/public/public-catalog.js s3-deploy/src/public/
cp styles/public-catalog.css s3-deploy/styles/catalog.css
```

---

## PASO 6: Configurar Bucket S3 para Hosting

```bash
# Habilitar hosting de sitio web estático
aws s3 website s3://s3-static-public-site/ \
  --index-document index.html \
  --error-document index.html

# Configurar política de bucket (PÚBLICO)
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
```

---

## PASO 7: Subir Archivos a S3

```bash
# Subir todos los archivos
aws s3 sync s3-deploy/ s3://s3-static-public-site/ \
  --acl public-read \
  --cache-control "max-age=300"

# O subir individualmente:
aws s3 cp s3-deploy/index.html s3://s3-static-public-site/ --acl public-read
aws s3 cp s3-deploy/catalog-package.json s3://s3-static-public-site/ --acl public-read
aws s3 cp s3-deploy/src/ s3://s3-static-public-site/src/ --recursive --acl public-read
aws s3 cp s3-deploy/styles/ s3://s3-static-public-site/styles/ --recursive --acl public-read
```

---

## PASO 8: Acceder al Sitio

URL del sitio:
```
http://s3-static-public-site.s3-website-[REGION].amazonaws.com
```

Reemplaza `[REGION]` con tu región (ej: `us-east-1`)

O consulta la URL con:
```bash
aws s3api get-bucket-website --bucket s3-static-public-site
```

---

## ⚡ Comandos Rápidos (Todo en Uno)

```bash
# 1. Ya tienes my-products.json descargado

# 2. Exportar
npm run export -- my-products.json exports/catalog-package.json

# 3. Preparar deploy
mkdir -p s3-deploy/src/public s3-deploy/styles
cp public-catalog.html s3-deploy/index.html
cp exports/catalog-package.json s3-deploy/
cp -r src/public/* s3-deploy/src/public/
cp styles/public-catalog.css s3-deploy/styles/catalog.css

# 4. Subir a S3
aws s3 sync s3-deploy/ s3://s3-static-public-site/ --acl public-read

# 5. Abrir en navegador
echo "http://s3-static-public-site.s3-website-us-east-1.amazonaws.com"
```

---

## 🔍 Verificación

1. **Bucket policy**: Debe ser público
2. **Static website hosting**: Habilitado
3. **Index document**: `index.html`
4. **Archivos**: Todos con ACL `public-read`

---

## 🎯 Resultado Final

Tu cliente podrá ver:
- ✓ Catálogo completo de productos
- ✓ Imágenes desde DummyJSON URLs
- ✓ Precios y características
- ✓ Sin necesidad de autenticación

---

## 📝 Notas Importantes

⚠️ **URLs de Imágenes**: Como usas DummyJSON, las imágenes se cargan desde:
   `https://cdn.dummyjson.com/...`
   
   No necesitas subir imágenes a S3, solo el JSON.

⚠️ **CORS**: Si tienes problemas de CORS, configura:
```bash
aws s3api put-bucket-cors --bucket s3-static-public-site --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"]
  }]
}'
```

