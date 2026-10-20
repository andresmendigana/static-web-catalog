/**
 * DynamoDB-backed product repository.
 *
 * The repository deliberately depends on an injected client and injected
 * command constructors. This keeps domain/application code independent from a
 * particular AWS SDK package and makes all tests run without AWS credentials or
 * network access.
 *
 * Ordering is provided by OWNER_CREATED_INDEX: the GSI partition key is the
 * owner partition and its sort key is CREATED#<13-digit epoch-ms>#<uuid>.
 * Queries use ScanIndexForward=false, so newest timestamps are returned first;
 * products sharing a timestamp are deterministically ordered by id in reverse
 * lexicographical order. The base PRODUCT#<id> key is only an identity key and
 * is never used to infer recency.
 */
import { ProductRepository } from '../application/ports/product-repository.js';
import {
    InMemoryIdempotencyStore,
    idempotencyOnlyOptions,
    mutationOptions,
} from '../application/concurrency/idempotency.js';
import { CATALOG_PRODUCT_LIMIT } from '../domain/catalog-limits.js';
import { normalizeCharacteristics } from '../domain/characteristics.js';
import { isSupportedDate, isUuid } from '../domain/catalog-contract-primitives.js';
import { assertValidPrice } from '../domain/price.js';
import { isValidProductName, normalizeProductName } from '../domain/product-name.js';
import {
    ConflictError,
    InvalidProductError,
    ProductNotFoundError,
    QuotaExceededError,
    StorageUnavailableError,
} from '../domain/errors.js';

export const DYNAMODB_KEYS = Object.freeze({
    PARTITION_KEY: 'PK',
    SORT_KEY: 'SK',
    OWNER_INDEX_PARTITION_KEY: 'GSI1PK',
    OWNER_INDEX_SORT_KEY: 'GSI1SK',
    OWNER_CREATED_INDEX: 'OwnerCreatedIndex',
});

const DEFAULT_COMMANDS = Object.freeze({
    QueryCommand: (input) => ({ type: 'QueryCommand', input }),
    PutCommand: (input) => ({ type: 'PutCommand', input }),
    UpdateCommand: (input) => ({ type: 'UpdateCommand', input }),
    DeleteCommand: (input) => ({ type: 'DeleteCommand', input }),
    TransactWriteCommand: (input) => ({ type: 'TransactWriteCommand', input }),
});

const SAFE_KEY_COMPONENT = /^[^#\u0000-\u001f\u007f]+$/u;

function assertKeyComponent(value, field) {
    if (typeof value !== 'string' || value.length === 0 || !SAFE_KEY_COMPONENT.test(value)) {
        throw new InvalidProductError(`${field} must be a non-empty safe key component`);
    }
    return value;
}

/** Returns OWNER#<ownerId>, the sole author partition for a catalog. */
export function ownerPartitionKey(ownerId) {
    return `OWNER#${assertKeyComponent(ownerId, 'ownerId')}`;
}

/** Returns PRODUCT#<productId>, an identity key only (not a date-order key). */
export function productSortKey(productId) {
    return `PRODUCT#${assertKeyComponent(productId, 'productId')}`;
}

function toEpochMilliseconds(value) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || Number.isNaN(new Date(value).getTime())) {
            throw new InvalidProductError('createdAt must be a non-negative epoch-millisecond timestamp');
        }
        return value;
    }

    if (!isSupportedDate(value)) {
        throw new InvalidProductError('createdAt must be a valid UTC ISO datetime or epoch timestamp');
    }

    const timestamp = Date.parse(value);
    if (!Number.isInteger(timestamp) || timestamp < 0) {
        throw new InvalidProductError('createdAt must be a non-negative timestamp');
    }
    return timestamp;
}

/**
 * Encodes a timestamp and UUID in a lexicographically sortable GSI key.
 * Fixed width is required so lexical order equals epoch-millisecond order.
 */
export function ownerCreatedIndexKey(createdAt, productId) {
    const timestamp = toEpochMilliseconds(createdAt);
    const id = assertKeyComponent(productId, 'productId');
    return `CREATED#${String(timestamp).padStart(13, '0')}#${id}`;
}

export function createDynamoDbProductKeys(ownerId, productId, createdAt) {
    const partitionKey = ownerPartitionKey(ownerId);
    const sortKey = productSortKey(productId);
    return {
        [DYNAMODB_KEYS.PARTITION_KEY]: partitionKey,
        [DYNAMODB_KEYS.SORT_KEY]: sortKey,
        [DYNAMODB_KEYS.OWNER_INDEX_PARTITION_KEY]: partitionKey,
        [DYNAMODB_KEYS.OWNER_INDEX_SORT_KEY]: ownerCreatedIndexKey(createdAt, productId),
    };
}

function isConditionalCheckFailure(error) {
    return error?.name === 'ConditionalCheckFailedException'
        || error?.code === 'ConditionalCheckFailedException';
}

function assertExpectedVersion(value) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
        throw new InvalidProductError('expectedVersion must be a positive integer');
    }
}

function nowIso() {
    return new Date().toISOString();
}

function createId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    throw new StorageUnavailableError('A UUID generator is required to create a product');
}

function normalizeImage(image) {
    if (image && typeof image === 'object' && !Array.isArray(image)) {
        if (typeof image.key !== 'string' || image.key.length === 0) {
            throw new InvalidProductError('Image reference key is required');
        }
        if (image.contentType !== 'image/jpeg') {
            throw new InvalidProductError('Image reference contentType must be image/jpeg');
        }
        return { key: image.key, contentType: image.contentType };
    }

    // The string branch preserves the existing repository port for callers that
    // still pass a local image value. Upload/API layers should pass a controlled
    // S3 reference instead of sending image bytes through this repository.
    if (typeof image === 'string' && image.length > 0) {
        return image;
    }

    throw new InvalidProductError('Image reference is required');
}

function normalizeProduct(product, imageReference, ownerId) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new InvalidProductError('Product must be an object');
    }

    const id = product.id ?? createId();
    if (!isUuid(id)) {
        throw new InvalidProductError('Product id must be a UUID');
    }
    if (!isValidProductName(product.name)) {
        throw new InvalidProductError('Product name is required and cannot be empty');
    }
    assertValidPrice(product.priceMode, product.priceCOP);
    if (!isSupportedDate(product.createdAt)) {
        throw new InvalidProductError('Product createdAt must be a valid UTC ISO datetime or epoch timestamp');
    }

    const createdAt = product.createdAt;
    const updatedAt = product.updatedAt ?? createdAt;
    if (!isSupportedDate(updatedAt)) {
        throw new InvalidProductError('Product updatedAt must be a valid UTC ISO datetime or epoch timestamp');
    }

    return {
        id,
        ownerId,
        name: normalizeProductName(product.name),
        priceMode: product.priceMode,
        priceCOP: product.priceCOP,
        image: normalizeImage(imageReference ?? product.image),
        createdAt,
        updatedAt,
        characteristics: normalizeCharacteristics(product.characteristics ?? []),
        version: Number.isInteger(product.version) && product.version > 0 ? product.version : 1,
        ...(product.audit ? { audit: structuredClone(product.audit) } : {}),
    };
}

function toDynamoItem(product) {
    const image = product.image;
    const imageKey = typeof image === 'string' ? image : image.key;
    const imageContentType = typeof image === 'string' ? 'image/jpeg' : image.contentType;
    return {
        ...createDynamoDbProductKeys(product.ownerId, product.id, product.createdAt),
        entityType: 'PRODUCT',
        ownerId: product.ownerId,
        id: product.id,
        name: product.name,
        priceMode: product.priceMode,
        priceCOP: product.priceCOP,
        imageKey,
        imageContentType,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        characteristics: product.characteristics,
        version: product.version,
        ...(product.audit ? { audit: product.audit } : {}),
    };
}

function fromDynamoItem(item) {
    if (!item || typeof item !== 'object') {
        throw new StorageUnavailableError('DynamoDB returned an invalid product item');
    }

    const image = item.image && typeof item.image === 'object'
        ? { key: item.image.key, contentType: item.image.contentType }
        : { key: item.imageKey, contentType: item.imageContentType ?? 'image/jpeg' };

    return {
        id: item.id,
        ownerId: item.ownerId,
        name: item.name,
        priceMode: item.priceMode,
        priceCOP: item.priceCOP,
        image,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
        characteristics: Array.isArray(item.characteristics) ? item.characteristics : [],
        version: item.version ?? 1,
        ...(item.audit ? { audit: item.audit } : {}),
    };
}

function compareProductsDescending(a, b) {
    const timestampDifference = toEpochMilliseconds(b.createdAt) - toEpochMilliseconds(a.createdAt);
    if (timestampDifference !== 0) return timestampDifference;
    return b.id.localeCompare(a.id);
}

function buildCommand(commands, name, input) {
    const constructor = commands[name];
    if (typeof constructor !== 'function') {
        throw new StorageUnavailableError(`Missing DynamoDB command constructor: ${name}`);
    }

    // AWS SDK v3 commands are classes (and require `new`), while the default
    // test builders and small adapters are ordinary functions.
    try {
        return constructor(input);
    } catch (error) {
        if (!/class constructor|cannot be invoked without 'new'/iu.test(String(error?.message))) {
            throw error;
        }
        return new constructor(input);
    }
}

/**
 * DynamoDB implementation of ProductRepository.
 *
 * `client` must expose `send(command)`. `commands` may contain AWS SDK
 * QueryCommand/PutCommand/UpdateCommand/DeleteCommand constructors; tests use
 * the default serializable command builders and an in-memory client instead.
 */
export class DynamoDbProductRepository extends ProductRepository {
    constructor({
        client,
        tableName,
        ownerId,
        indexName = DYNAMODB_KEYS.OWNER_CREATED_INDEX,
        commands = DEFAULT_COMMANDS,
        maxProducts = CATALOG_PRODUCT_LIMIT,
        clock = nowIso,
        idempotencyStore = new InMemoryIdempotencyStore(),
        projectionSync = null,
    } = {}) {
        super();
        if (!client || typeof client.send !== 'function') {
            throw new StorageUnavailableError('A DynamoDB client with send() is required');
        }
        if (typeof tableName !== 'string' || tableName.length === 0) {
            throw new StorageUnavailableError('A DynamoDB table name is required');
        }
        this.client = client;
        this.tableName = tableName;
        this.ownerId = assertKeyComponent(ownerId, 'ownerId');
        this.indexName = indexName;
        this.commands = { ...DEFAULT_COMMANDS, ...commands };
        this.maxProducts = maxProducts;
        this.clock = clock;
        if (!idempotencyStore || typeof idempotencyStore.execute !== 'function') {
            throw new StorageUnavailableError('An idempotency store with execute() is required');
        }
        this.idempotencyStore = idempotencyStore;
        if (projectionSync !== null && typeof projectionSync.recordMutation !== 'function') {
            throw new StorageUnavailableError('projectionSync.recordMutation() is required');
        }
        this.projectionSync = projectionSync;
    }

    async list() {
        const items = [];
        let ExclusiveStartKey;
        do {
            const response = await this._send('QueryCommand', {
                TableName: this.tableName,
                IndexName: this.indexName,
                KeyConditionExpression: '#gsiOwner = :ownerKey',
                ExpressionAttributeNames: { '#gsiOwner': DYNAMODB_KEYS.OWNER_INDEX_PARTITION_KEY },
                ExpressionAttributeValues: { ':ownerKey': ownerPartitionKey(this.ownerId) },
                ScanIndexForward: false,
                ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
            });
            if (Array.isArray(response?.Items)) items.push(...response.Items);
            ExclusiveStartKey = response?.LastEvaluatedKey;
        } while (ExclusiveStartKey);

        return items.map(fromDynamoItem).sort(compareProductsDescending);
    }

    async add(product, imageReference, options) {
        const { idempotencyKey } = idempotencyOnlyOptions(options);
        const action = async () => {
            const products = await this.list();
            if (products.length >= this.maxProducts) {
                throw new QuotaExceededError(`Cannot add more than ${this.maxProducts} products`);
            }

            const normalized = normalizeProduct(product, imageReference, this.ownerId);
            const item = toDynamoItem(normalized);
            try {
                await this._send('PutCommand', {
                    TableName: this.tableName,
                    Item: item,
                    ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk) AND (attribute_not_exists(#owner) OR #owner = :ownerKey)',
                    ExpressionAttributeNames: {
                        '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                        '#sk': DYNAMODB_KEYS.SORT_KEY,
                        '#owner': 'ownerId',
                    },
                    ExpressionAttributeValues: { ':ownerKey': this.ownerId },
                });
            } catch (error) {
                if (isConditionalCheckFailure(error)) {
                    throw new ConflictError('Product identifier already exists', { cause: error });
                }
                throw error;
            }
            await this._recordProjectionMutation();
            return normalized;
        };

        return this._executeIdempotent(
            'create-product',
            idempotencyKey,
            { product, imageReference },
            action,
        );
    }

    async rename(id, newName, expectedVersionOrOptions, idempotencyKey) {
        if (!isUuid(id)) throw new InvalidProductError('Product id must be a UUID');
        if (!isValidProductName(newName)) {
            throw new InvalidProductError('Product name is required and cannot be empty');
        }
        const options = mutationOptions(expectedVersionOrOptions, idempotencyKey);
        assertExpectedVersion(options.expectedVersion);
        const normalizedName = normalizeProductName(newName);
        const condition = '#owner = :ownerKey AND attribute_exists(#pk) AND attribute_exists(#sk)'
            + (options.expectedVersion === undefined ? '' : ' AND #version = :expectedVersion');

        const action = async () => {
            try {
                const response = await this._send('UpdateCommand', {
                    TableName: this.tableName,
                    Key: {
                        [DYNAMODB_KEYS.PARTITION_KEY]: ownerPartitionKey(this.ownerId),
                        [DYNAMODB_KEYS.SORT_KEY]: productSortKey(id),
                    },
                    UpdateExpression: 'SET #name = :name, #updatedAt = :updatedAt, #version = if_not_exists(#version, :one) + :one',
                    ConditionExpression: condition,
                    ExpressionAttributeNames: {
                        '#name': 'name',
                        '#updatedAt': 'updatedAt',
                        '#version': 'version',
                        '#owner': 'ownerId',
                        '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                        '#sk': DYNAMODB_KEYS.SORT_KEY,
                    },
                    ExpressionAttributeValues: {
                        ':name': normalizedName,
                        ':updatedAt': this.clock(),
                        ':one': 1,
                        ':ownerKey': this.ownerId,
                        ...(options.expectedVersion === undefined
                            ? {}
                            : { ':expectedVersion': options.expectedVersion }),
                    },
                    ReturnValues: 'ALL_NEW',
                });
                const result = response?.Attributes ? fromDynamoItem(response.Attributes) : await this._get(id);
                await this._recordProjectionMutation();
                return result;
            } catch (error) {
                if (isConditionalCheckFailure(error)) {
                    if (options.expectedVersion !== undefined) {
                        throw new ConflictError('Product version is stale', { cause: error });
                    }
                    throw new ProductNotFoundError(id);
                }
                throw error;
            }
        };

        return this._executeIdempotent(
            'rename-product',
            options.idempotencyKey,
            { id, name: normalizedName, expectedVersion: options.expectedVersion },
            action,
        );
    }

    async remove(id, expectedVersionOrOptions, idempotencyKey) {
        if (!isUuid(id)) throw new InvalidProductError('Product id must be a UUID');
        const options = mutationOptions(expectedVersionOrOptions, idempotencyKey);
        assertExpectedVersion(options.expectedVersion);
        const condition = '#owner = :ownerKey AND attribute_exists(#pk) AND attribute_exists(#sk)'
            + (options.expectedVersion === undefined ? '' : ' AND #version = :expectedVersion');

        const action = async () => {
            try {
                await this._send('DeleteCommand', {
                    TableName: this.tableName,
                    Key: {
                        [DYNAMODB_KEYS.PARTITION_KEY]: ownerPartitionKey(this.ownerId),
                        [DYNAMODB_KEYS.SORT_KEY]: productSortKey(id),
                    },
                    ConditionExpression: condition,
                    ExpressionAttributeNames: {
                        '#owner': 'ownerId',
                        '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                        '#sk': DYNAMODB_KEYS.SORT_KEY,
                    },
                    ExpressionAttributeValues: {
                        ':ownerKey': this.ownerId,
                        ...(options.expectedVersion === undefined
                            ? {}
                            : { ':expectedVersion': options.expectedVersion }),
                    },
                });
                await this._recordProjectionMutation();
                return undefined;
            } catch (error) {
                if (isConditionalCheckFailure(error)) {
                    if (options.expectedVersion !== undefined) {
                        throw new ConflictError('Product version is stale', { cause: error });
                    }
                    throw new ProductNotFoundError(id);
                }
                throw error;
            }
        };

        return this._executeIdempotent(
            'remove-product',
            options.idempotencyKey,
            { id, expectedVersion: options.expectedVersion },
            action,
        );
    }

    async associateImage(id, imageReference, expectedVersionOrOptions, idempotencyKey) {
        if (!isUuid(id)) throw new InvalidProductError('Product id must be a UUID');
        const image = normalizeImage(imageReference);
        if (typeof image === 'string') {
            throw new InvalidProductError('Image association requires a controlled image reference');
        }
        const options = mutationOptions(expectedVersionOrOptions, idempotencyKey);
        assertExpectedVersion(options.expectedVersion);
        const condition = '#owner = :ownerKey AND attribute_exists(#pk) AND attribute_exists(#sk)'
            + (options.expectedVersion === undefined ? '' : ' AND #version = :expectedVersion');

        const action = async () => {
            try {
                const response = await this._send('UpdateCommand', {
                    TableName: this.tableName,
                    Key: {
                        [DYNAMODB_KEYS.PARTITION_KEY]: ownerPartitionKey(this.ownerId),
                        [DYNAMODB_KEYS.SORT_KEY]: productSortKey(id),
                    },
                    UpdateExpression: 'SET #imageKey = :imageKey, #imageContentType = :imageContentType, #updatedAt = :updatedAt, #version = if_not_exists(#version, :one) + :one',
                    ConditionExpression: condition,
                    ExpressionAttributeNames: {
                        '#imageKey': 'imageKey',
                        '#imageContentType': 'imageContentType',
                        '#updatedAt': 'updatedAt',
                        '#version': 'version',
                        '#owner': 'ownerId',
                        '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                        '#sk': DYNAMODB_KEYS.SORT_KEY,
                    },
                    ExpressionAttributeValues: {
                        ':imageKey': image.key,
                        ':imageContentType': image.contentType,
                        ':updatedAt': this.clock(),
                        ':one': 1,
                        ':ownerKey': this.ownerId,
                        ...(options.expectedVersion === undefined
                            ? {}
                            : { ':expectedVersion': options.expectedVersion }),
                    },
                    ReturnValues: 'ALL_NEW',
                });
                const result = response?.Attributes ? fromDynamoItem(response.Attributes) : await this._get(id);
                await this._recordProjectionMutation();
                return result;
            } catch (error) {
                if (isConditionalCheckFailure(error)) {
                    if (options.expectedVersion !== undefined) {
                        throw new ConflictError('Product version is stale', { cause: error });
                    }
                    throw new ProductNotFoundError(id);
                }
                throw error;
            }
        };

        return this._executeIdempotent(
            'associate-image',
            options.idempotencyKey,
            { id, image, expectedVersion: options.expectedVersion },
            action,
        );
    }

    async importProducts(products, options = {}) {
        if (!Array.isArray(products)) throw new InvalidProductError('Imported products must be an array');
        if (products.length === 0) return [];
        if (products.length > this.maxProducts) {
            throw new QuotaExceededError(`Cannot import more than ${this.maxProducts} products`);
        }

        const normalized = products.map((product) => normalizeProduct(product, product?.image, this.ownerId));
        const ids = new Set();
        normalized.forEach((product) => {
            if (ids.has(product.id)) throw new ConflictError('Imported product identifiers must be unique');
            ids.add(product.id);
        });
        const { idempotencyKey } = idempotencyOnlyOptions(options);

        const action = async () => {
            const existing = await this.list();
            if (existing.length + normalized.length > this.maxProducts) {
                throw new QuotaExceededError(`Cannot add more than ${this.maxProducts} products`);
            }
            const TransactItems = normalized.map((product) => ({
                Put: {
                    TableName: this.tableName,
                    Item: toDynamoItem(product),
                    ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk) AND (attribute_not_exists(#owner) OR #owner = :ownerKey)',
                    ExpressionAttributeNames: {
                        '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                        '#sk': DYNAMODB_KEYS.SORT_KEY,
                        '#owner': 'ownerId',
                    },
                    ExpressionAttributeValues: { ':ownerKey': this.ownerId },
                },
            }));
            try {
                await this._send('TransactWriteCommand', { TableName: this.tableName, TransactItems });
            } catch (error) {
                if (isConditionalCheckFailure(error) || error?.name === 'TransactionCanceledException') {
                    throw new ConflictError('Imported product identifiers conflict with the catalog', { cause: error });
                }
                throw error;
            }
            await this._recordProjectionMutation();
            return normalized;
        };

        return this._executeIdempotent(
            'import-catalog',
            idempotencyKey,
            { products: normalized },
            action,
        );
    }

    async count() {
        return (await this.list()).length;
    }

    async _get(id) {
        const response = await this._send('QueryCommand', {
            TableName: this.tableName,
            KeyConditionExpression: '#pk = :ownerKey AND #sk = :productKey',
            ExpressionAttributeNames: {
                '#pk': DYNAMODB_KEYS.PARTITION_KEY,
                '#sk': DYNAMODB_KEYS.SORT_KEY,
            },
            ExpressionAttributeValues: {
                ':ownerKey': ownerPartitionKey(this.ownerId),
                ':productKey': productSortKey(id),
            },
            Limit: 1,
        });
        const item = response?.Items?.[0];
        if (!item) throw new ProductNotFoundError(id);
        return fromDynamoItem(item);
    }

    async _recordProjectionMutation() {
        if (!this.projectionSync) return null;
        return this.projectionSync.recordMutation({ ownerId: this.ownerId });
    }

    async _executeIdempotent(operation, idempotencyKey, intent, action) {
        if (idempotencyKey === undefined || idempotencyKey === null) return action();
        return this.idempotencyStore.execute({
            scope: this.ownerId,
            key: idempotencyKey,
            operation,
            intent,
            action,
        });
    }

    async _send(commandName, input) {
        try {
            return await this.client.send(buildCommand(this.commands, commandName, input));
        } catch (error) {
            if (error instanceof ProductNotFoundError
                || error instanceof ConflictError
                || error instanceof QuotaExceededError
                || error instanceof InvalidProductError
                || error instanceof StorageUnavailableError) {
                throw error;
            }
            throw error;
        }
    }
}

export { toEpochMilliseconds };
