# Validación offline de CDK Stage 3

La cobertura de la tarea 6.4 está en `test/smoke/cdk-infrastructure.test.js` y se ejecuta con:

```text
npm run infra:synth
npm run infra:test
```

Los checks sintetizan los stacks sin red, credenciales ni despliegue y cubren snapshots deterministas del layout de recursos/logical IDs, assertions de template, un Aspect offline de recorrido, región configurable, termination protection, retención, cifrado, PITR, versioning, CORS, OAC parametrizado, policies S3 privadas, roles separados, SQS/DLQ y alarmas.

En el entorno de desarrollo verificado, `cfn-lint` y `cfn-guard` no están instalados. El test lo informa en la salida y ejecuta un equivalente determinista sobre el template sintetizado: bloqueo de acceso público, cifrado y versioning de buckets, ausencia de `Principal: "*"` y de escritura anónima en policies. `cdk-nag` tampoco se añade.

La configuración OAC vive en `infra/s3-cloudfront-oac/` porque la distribución CloudFront no forma parte de los stacks CDK actuales. Las assertions comprueban que esa configuración es parametrizada, usa SigV4 con signing behavior `always`, HTTPS-only y una policy de solo lectura condicionada a la distribución.
