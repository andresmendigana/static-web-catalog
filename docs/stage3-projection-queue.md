# Stage 3 projection queue

Las mutaciones confirmadas incrementan `catalogVersion` en el estado de publicación del autor. El coordinador guarda `status: pending` en la tabla de operaciones y encola un mensaje `stage3-projection-job-v1` con `ownerId`, `catalogVersion`, `requestedAt` y un `correlationId` opcional. `projectionVersion` solo avanza después de que el proyector termina correctamente; el estado expone `pending`, `succeeded`, `failed` o `reconciliation-required` y `reason` contiene únicamente códigos sanitizados (`VALIDATION_FAILED`, `VERSION_CONFLICT`, `RELEASE_COLLISION`, `DEPENDENCY_UNAVAILABLE`, `PUBLICATION_TIMEOUT` o `PROJECTION_FAILED`). Nunca se persisten mensajes de proveedor, stacks, URLs, claims, tokens o payloads.

## SQS Standard, reintentos y DLQ

`ProjectionQueue` es una cola SQS **Standard**, cifrada con la clave administrada de SQS. Su `visibilityTimeout` se calcula como seis veces el mayor timeout del consumidor/publicador, con el límite de SQS de 12 horas. El `redrivePolicy` usa `projectionMaxReceiveCount` (5 por defecto) para acotar reintentos; después el mensaje llega a `ProjectionDeadLetterQueue`, que conserva mensajes durante `queueRetentionDays`. La alarma `ProjectionDlqAlarm` detecta mensajes visibles y `ProjectionDlqAgeAlarm` alerta cuando `ApproximateAgeOfOldestMessage` supera `dlqMaxAgeMinutes`.

El consumidor usa respuestas de batch parcial: una entrega transitoria vuelve a la cola; en el último intento marca `reconciliation-required` y el mensaje continúa hacia la DLQ. La reconciliación puede volver a leer DynamoDB y encolar la versión vigente. Fallos de publicación no mueven ni sobrescriben `releases/current.json`.

## Por qué no FIFO

FIFO no es necesario porque el sistema no necesita orden global ni entrega exactly-once. Los mensajes llevan la versión lógica del catálogo y el consumidor compara `catalogVersion` con `projectionVersion`: duplicados ya publicados y mensajes atrasados se reconocen sin publicar, mientras que el estado más nuevo queda protegido por una condición de versión. El publicador es idempotente por esa misma versión y escribe releases inmutables. Standard evita acoplamiento, deduplicación temporal y coste adicional sin sacrificar la corrección requerida.

## Contrato de estado

```text
PK = OWNER#<ownerId>
SK = PUBLICATION#STATE
catalogVersion       = entero creciente por mutación confirmada
projectionVersion    = última versión publicada, o null
status               = pending | succeeded | failed | reconciliation-required
releaseId             = release verificado, o null
reason                = código sanitizado, o null
updatedAt             = ISO-8601 UTC
```

La implementación es AWS-free en `src/application/publication/projection-sync.js`; `DynamoDbPublicationStateStore` y `SqsProjectionQueue` reciben clientes/comandos inyectados. Esto permite pruebas offline con dobles y evita credenciales, red o llamadas AWS durante CI.
