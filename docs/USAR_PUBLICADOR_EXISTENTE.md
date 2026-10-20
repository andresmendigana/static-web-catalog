# Script de publicación manual usando el publicador existente

## PASO 1: Configurar variables de entorno

```bash
# PowerShell
$env:AWS_PROFILE = "tu-perfil"
$env:AWS_REGION = "us-east-1"
$env:S3_BUCKET = "s3-static-public-site"
$env:S3_RELEASE_PREFIX = "releases"
$env:PUBLICATION_MODE = "s3-public-prototype"

# O en Bash:
export AWS_PROFILE=tu-perfil
export AWS_REGION=us-east-1
export S3_BUCKET=s3-static-public-site
export S3_RELEASE_PREFIX=releases
export PUBLICATION_MODE=s3-public-prototype
```

## PASO 2: Crear script de publicación

El publicador ya está implementado en:
`scripts/tooling/external-publisher.mjs`

Funciones disponibles:
- publishRelease() - Publica un release completo
- createExternalPublisher() - Crea el publicador
- preflightPublication() - Valida antes de publicar

## PASO 3: Usar el publicador programáticamente

Puedes importar y usar directamente:

```javascript
import { publishRelease } from './scripts/tooling/external-publisher.mjs';
import { S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: process.env.AWS_REGION,
  profile: process.env.AWS_PROFILE
});

const result = await publishRelease({
  releaseId: '2026-10-18-demo',
  application: readApplicationFiles(),
  exportPackage: readExportPackage(),
  generatedAt: new Date().toISOString(),
  client,
  destination: {
    bucket: 's3-static-public-site',
    releasePrefix: 'releases',
    awsRegion: 'us-east-1'
  }
});

console.log('✅ Published:', result.releaseId);
```

## PASO 4: O ejecutar con AWS CLI (manual)

Como alternativa mientras se implementa el CLI wrapper:

```bash
# 1. Exportar productos
npm run export -- products.json exports/catalog.json

# 2. Generar manifest
npm run manifest -- --input exports/catalog.json --release-id 2026-10-18 --output exports/manifest.json

# 3. Subir manualmente con AWS CLI
aws s3 cp exports/manifest.json s3://s3-static-public-site/releases/2026-10-18/manifest.json
aws s3 cp index.html s3://s3-static-public-site/releases/2026-10-18/index.html
# ... subir imágenes y demás archivos
```

