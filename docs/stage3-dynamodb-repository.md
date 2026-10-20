# Repositorio DynamoDB de Stage 3

`DynamoDbProductRepository` conserva el puerto asíncrono de `ProductRepository` (`list`, `add`, `rename`, `remove`, `count`) y recibe un cliente `send(command)` por inyección. También recibe constructores `QueryCommand`, `PutCommand`, `UpdateCommand` y `DeleteCommand`; por eso los tests usan un doble en memoria y no requieren credenciales, red ni una cuenta AWS.

## Claves y orden

Cada producto se guarda con:

```text
PK    = OWNER#<ownerId>
SK    = PRODUCT#<productId>
GSI1PK = OWNER#<ownerId>
GSI1SK = CREATED#<epoch-ms-de-13-dígitos>#<productId>
```

`SK=PRODUCT#<productId>` identifica el producto, pero **no proporciona orden temporal**. La consulta de listado usa `OwnerCreatedIndex`, `GSI1PK` y `ScanIndexForward=false`. La sort key temporal tiene ancho fijo, por lo que el orden lexicográfico coincide con el orden de `createdAt`; la consulta devuelve primero los timestamps más recientes. Cuando dos timestamps son iguales, el sufijo UUID proporciona un desempate estable (en orden lexicográfico descendente, igual que la consulta descendente).

La codificación acepta las fechas UTC ISO-8601 del contrato y timestamps enteros epoch en milisegundos. Las fechas equivalentes producen la misma sort key. El repositorio vuelve a ordenar la respuesta como defensa adicional frente a dobles o adaptadores que devuelvan páginas en otro orden, sin cambiar la consulta GSI.

## Condiciones de mutación

- `PutCommand` exige que `PK` y `SK` no existan y que el atributo `ownerId`, si existe, corresponda al propietario derivado por el repositorio.
- `UpdateCommand` exige `ownerId` coincidente y la existencia de `PK` y `SK`.
- `DeleteCommand` exige `ownerId` coincidente y la existencia de `PK` y `SK`.

Un `ConditionalCheckFailedException` de una creación se traduce a conflicto; en renombrado/borrado se traduce a `ProductNotFoundError`, sin distinguir al cliente entre un identificador ausente y uno de otro propietario. El repositorio nunca acepta `ownerId` desde el producto como autoridad: usa el `ownerId` inyectado.

Las pruebas unitarias en `test/unit/dynamodb-product-repository.test.js` verifican las claves, fechas iguales, desempate UUID, `ScanIndexForward=false`, condiciones de propietario/existencia y traducción de fallos condicionales sin hacer llamadas AWS.
