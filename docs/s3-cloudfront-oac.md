# Publicación recomendada: S3 privado + CloudFront OAC

Esta es la configuración recomendada para Stage 2. El bucket de S3 es privado y CloudFront es el único punto de lectura pública. El Origin Access Control (OAC) firma las solicitudes hacia el origen con SigV4; el navegador del visitante nunca recibe credenciales AWS ni permisos de escritura.

La alternativa de bucket S3 público está descrita al final únicamente para un prototipo temporal. No es la configuración recomendada.

La documentación visual reproducible está centralizada en [`diagrams/README.md`](../diagrams/README.md), incluida la [vista consolidada Mermaid/Markdown](../diagrams/stage2-publication-architecture.md), su [PNG](../diagrams/stage2-publication-architecture.png), [generador Python](../diagrams/stage2-publication-architecture.py) y [fuente editable multi-página draw.io](../diagrams/stage2-publication-architecture.drawio).

## Parámetros sin secretos

La provisión de infraestructura y el publicador externo usan estos valores. Los marcadores `replace-with-*` no son credenciales y deben sustituirse fuera del repositorio, por variables de entorno, un gestor de configuración de CI o la consola de AWS:

| Parámetro | Ejemplo seguro | Uso |
|---|---|---|
| `AWS_REGION` | `us-east-1` | Región del bucket y del origen S3 |
| `AWS_ACCOUNT_ID` | `replace-with-12-digit-account-id` | Construye el ARN de la distribución en la policy |
| `S3_BUCKET` | `replace-with-private-catalog-bucket` | Bucket privado de artefactos |
| `S3_RELEASE_PREFIX` | `releases` | Prefijo inmutable de releases |
| `PUBLICATION_MODE` | `cloudfront-oac` | Selecciona la configuración recomendada del publicador |
| `CLOUDFRONT_DISTRIBUTION_ID` | `replace-with-distribution-id` | Distribución autorizada por la policy |
| `CLOUDFRONT_OAC_ID` | `replace-with-oac-id` | OAC asociado al origen S3 |

`publisher-config.mjs` consume únicamente el perfil AWS, región, bucket, prefijo y `PUBLICATION_MODE`. `AWS_ACCOUNT_ID`, `CLOUDFRONT_DISTRIBUTION_ID` y `CLOUDFRONT_OAC_ID` son parámetros de provisión: se usan para crear/verificar la distribución y la bucket policy, no para transportar credenciales al navegador. La autorización del publicador proviene del perfil/rol del entorno autorizado.

El archivo [`scripts/tooling/publisher.env.example`](../scripts/tooling/publisher.env.example) contiene la configuración de destino de ejemplo. La plantilla [`infra/s3-cloudfront-oac/bucket-policy.json.template`](../infra/s3-cloudfront-oac/bucket-policy.json.template) y el ejemplo [`infra/s3-cloudfront-oac/cloudfront-origin.json.template`](../infra/s3-cloudfront-oac/cloudfront-origin.json.template) usan los mismos nombres de parámetros.

## Configuración de producción

1. **Crear un bucket S3 privado.** Activar `BucketOwnerEnforced` y las cuatro opciones de bloqueo de acceso público. No habilitar el endpoint de sitio web de S3 para el origen recomendado; usar el endpoint REST regional `S3_BUCKET.s3.AWS_REGION.amazonaws.com`.
2. **Crear un OAC de CloudFront.** Configurarlo para un origen S3, con `SigningBehavior=always` y `SigningProtocol=sigv4`. Asociar ese OAC a la distribución indicada por `CLOUDFRONT_DISTRIBUTION_ID`.
3. **Aplicar la bucket policy mínima.** Sustituir los marcadores de `bucket-policy.json.template`. La única autorización de lectura es `s3:GetObject` para el principal de servicio `cloudfront.amazonaws.com`, limitada por `AWS:SourceArn` al ARN de esa distribución. No se concede `s3:ListBucket`, `s3:PutObject` ni acceso a `Principal: "*"`.
4. **Mantener el acceso público directo bloqueado.** Una petición al endpoint S3 que no venga firmada por el OAC debe recibir `AccessDenied`; la URL pública es la distribución CloudFront, no el bucket.
5. **Configurar HTTPS y caché en CloudFront.** Redirigir HTTP a HTTPS y respetar el `Cache-Control` emitido por el publicador. No sobrescribir el encabezado del puntero con una política de caché larga.

La policy no contiene claves ni secretos. El publicador externo escribe con el perfil/rol autorizado y la aplicación pública solo hace `GET` de archivos estáticos.

## Layout y caché

Cada release es inmutable:

```text
releases/<release-id>/index.html
releases/<release-id>/manifest.json
releases/<release-id>/images/<product-id>.jpg
releases/current.json
```

- `releases/current.json`: `Cache-Control: no-cache, max-age=0, must-revalidate`. Es un puntero pequeño y mutable; debe tener una TTL efectiva corta en CloudFront para que un cambio de release sea visible rápidamente.
- `releases/<release-id>/*`: `Cache-Control: public, max-age=31536000, immutable`. El publicador nunca sobrescribe ese prefijo. Esta caché larga aplica a `index.html`, `manifest.json`, JavaScript, CSS e imágenes versionadas.
- El puntero se escribe después de verificar todos los objetos del release. Si falla una subida o verificación, el puntero anterior permanece vigente.

La aplicación pública intenta el manifiesto directo cuando está servida dentro de un release y, si no está disponible, resuelve `releases/current.json`. La distribución debe permitir `GET` a ambas rutas bajo el mismo dominio y no debe transformar ni redirigir el JSON del puntero.

## Flujo del publicador

```text
export local -> dry-run -> preflight -> upload releases/<id>/
                                      -> verify objects/images
                                      -> update releases/current.json
```

Ejemplo de configuración de destino (sin credenciales):

```text
AWS_PROFILE=catalog-publisher
AWS_REGION=us-east-1
S3_BUCKET=replace-with-private-catalog-bucket
S3_RELEASE_PREFIX=releases
PUBLICATION_MODE=cloudfront-oac
```

La autorización se resuelve fuera del repositorio mediante `AWS_PROFILE`, un rol de CI con identidad federada o un proveedor de credenciales temporal administrado por AWS. No se deben agregar `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, tokens de sesión, claves privadas ni policies con secretos a `.env`, al paquete exportado o al bundle.

## Alternativa explícita: S3 público solo para prototipo

`PUBLICATION_MODE=s3-public-prototype` existe únicamente para una demostración no productiva o un entorno aislado. En ese modo el origen S3 puede ser consultado directamente y una policy de lectura pública tendría una frontera equivalente a `Principal: "*"` con `s3:GetObject` solamente. Esto aumenta la superficie de exposición, permite omitir CloudFront, dificulta controlar caché y hace más fácil publicar accidentalmente datos que no debían ser públicos.

Si se usa esta alternativa, debe cumplirse todo lo siguiente:

- usar un bucket separado, sin datos sensibles, sin credenciales y sin artefactos de producción;
- limitar la policy a lectura de objetos y no conceder escritura anónima;
- documentar la fecha de retiro y migrar a bucket privado + OAC antes de cualquier uso real;
- no interpretar `s3-public-prototype` como una relajación de la configuración recomendada.

No se debe mezclar una bucket policy pública con la configuración `cloudfront-oac`. Para producción, bloquear el acceso público del bucket y autorizar exclusivamente al OAC de la distribución.
