# Operación de Stage 3

## Límites y retención

Los valores viven en `cdk.context.json` bajo `stage3:config` y se validan antes de crear cualquiera de los stacks. La configuración actual de desarrollo define un catálogo máximo de 100 productos, imágenes de hasta 5 MiB, URLs prefirmadas válidas durante 15 minutos, 10 solicitudes por segundo con ráfaga de 20, concurrencia máxima de 10 ejecuciones por función, una duración máxima de publicación de 15 minutos y una alarma cuando el mensaje más antiguo de la DLQ supera 15 minutos.

- `uploadRetentionDays` limita el lifecycle de objetos pendientes y sus versiones no actuales; solo el prefijo `uploads/pending/` es elegible para limpieza.
- `queueRetentionDays` conserva mensajes de la cola y la DLQ durante el periodo configurado; `dlqMaxAgeMinutes` alarma si el mensaje más antiguo permanece demasiado tiempo sin reconciliar.
- `logRetentionDays` y `accessLogRetentionDays` controlan la retención de logs de Lambda y access logs de API Gateway. CloudWatch Logs usa cifrado administrado por el servicio cuando no se especifica una clave KMS propia.
- `releaseVersionRetentionDays` conserva versiones no actuales de releases. Los prefijos de release publicados son inmutables y no se eliminan como parte del cleanup de cargas.
- DynamoDB usa cifrado AWS-managed, PITR y deletion protection; S3 usa cifrado S3-managed, bloqueo de acceso público y versioning.

## Telemetría y redacción

Cada Lambda tiene un log group explícito con retención configurada. API Gateway HTTP API escribe access logs JSON con `requestId`, `correlationId`, operación, resultado, estado y duración, sin registrar cuerpo, headers de autorización, IP, claims ni URL firmada. El logger de runtime (`src/infrastructure/observability/structured-logger.js`) acepta únicamente campos allowlisted y representa el propietario mediante un hash truncado.

Nunca se deben registrar PII, JWT, passwords, checksums, URLs prefirmadas, cuerpos de solicitudes o datos de imagen. Los filtros de métrica esperan los eventos estructurados siguientes, sin depender de valores sensibles:

- API 4xx/5xx, autorización (`401`/`403`) y throttling (`429`).
- `operation=publication` con `result=failed`.
- `operation=reconciliation` con `result=failed` o `reconciliation-required`.
- `operation=upload-expiration` con `result=expired`.
- Profundidad y edad del mensaje más antiguo de la DLQ de proyección mediante `ApproximateNumberOfMessagesVisible` y `ApproximateAgeOfOldestMessage`.
- Duración media de las Lambdas de catálogo, upload, proyección y cleanup mediante métricas nativas de Lambda.

El dashboard `${environment}-stage3-operations` agrupa estos indicadores y muestra los objetivos RPO/RTO. Las alarmas publican en el tópico operativo configurado. El presupuesto mensual genera una notificación cuando el costo real supera el 80% del límite parametrizado; esto cubre el control de costo sin introducir llamadas de red ni credenciales en la síntesis.

## RPO/RTO y restauración probada

Los objetivos de la configuración de desarrollo son RPO de 15 minutos y RTO de 60 minutos. El procedimiento debe probarse periódicamente en una cuenta/entorno aislado y registrar la duración real:

1. Crear un entorno de restauración desde un backup/PITR de DynamoDB y restaurar los objetos S3 requeridos desde versioning; nunca restaurar sobre la tabla o bucket productivo.
2. Verificar claves owner-scoped, versiones de productos, asociaciones de imagen y un release completo (`index.html`, manifiesto e imágenes referenciadas).
3. Ejecutar el proyector desde el estado restaurado, validar `stage2-manifest-v1` y comprobar integridad de bytes, content type y referencias.
4. Medir el tiempo desde el punto de recuperación hasta la disponibilidad del catálogo restaurado y compararlo con RTO; medir la antigüedad máxima de datos perdida y compararla con RPO.
5. Eliminar el entorno efímero únicamente después de conservar el reporte de la prueba y sus métricas, respetando la retención definida.

El rollback de `releases/current.json` es una operación distinta: solo repunta la lectura pública a un release inmutable anterior después de verificarlo. No recupera DynamoDB, sesiones de carga ni objetos S3 eliminados. La recuperación de datos requiere PITR/backups de DynamoDB y versioning/retención de S3. Si la publicación falla antes de actualizar el puntero, el puntero anterior se conserva y reconciliación reintenta desde DynamoDB.

## Validación offline

La síntesis se ejecuta con la configuración versionada mediante `npm run infra:synth`; no usa credenciales, lookups vivos ni red. Los smoke tests de `npm run infra:test` inspeccionan templates sintetizados para confirmar retención, cifrado, límites, throttling, roles, colas y separación de stacks. No se ejecuta una publicación productiva como parte de esta validación.
