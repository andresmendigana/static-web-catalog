/**
 * HTTP implementation of ProductRepository.
 *
 * The adapter deliberately receives fetch and token access as dependencies so
 * the browser can use the Cognito session without exposing AWS clients to
 * views, while tests can exercise the full contract without network access.
 */
import { ProductRepository } from '../application/ports/product-repository.js';
import {
    idempotencyOnlyOptions,
    mutationOptions,
} from '../application/concurrency/idempotency.js';
import {
    AuthorizationError,
    ConflictError,
    InvalidProductError,
    LimitExceededError,
    ProductNotFoundError,
    StorageUnavailableError,
} from '../domain/errors.js';

const DEFAULT_PRODUCTS_PATH = '/catalog/products';
const SAFE_ERROR_CODES = new Set([
    'UNAUTHORIZED',
    'FORBIDDEN_OR_NOT_FOUND',
    'VALIDATION_ERROR',
    'CONFLICT',
    'IDEMPOTENCY_REPLAY',
    'LIMIT_EXCEEDED',
    'TRANSPORT_ERROR',
    'INTERNAL_ERROR',
]);
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

function now() {
    return Date.now();
}

function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function compareProductsDescending(a, b) {
    const timeDifference = timestamp(b.createdAt) - timestamp(a.createdAt);
    if (timeDifference !== 0) return timeDifference;
    return String(b.id ?? '').localeCompare(String(a.id ?? ''));
}

function stripInternalProductFields(product, image) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new InvalidProductError('Product must be an object');
    }

    const {
        id: _id,
        ownerId: _ownerId,
        createdAt: _createdAt,
        audit: _audit,
        updatedAt: _updatedAt,
        version: _version,
        ...publicProduct
    } = product;

    return {
        ...publicProduct,
        ...(image !== undefined ? { image } : {}),
    };
}

function normalizeProduct(product) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
        throw new StorageUnavailableError('Remote API returned an invalid product');
    }

    const normalized = {
        id: product.id,
        name: product.name,
        priceMode: product.priceMode,
        priceCOP: product.priceCOP,
        image: cloneImage(product.image),
        createdAt: product.createdAt,
        characteristics: Array.isArray(product.characteristics)
            ? product.characteristics.map((characteristic) => ({ ...characteristic }))
            : [],
    };

    // Version and updatedAt are useful to callers that opt into optimistic
    // concurrency, but ownership and audit claims never cross this boundary.
    if (product.updatedAt !== undefined) normalized.updatedAt = product.updatedAt;
    if (product.version !== undefined) normalized.version = product.version;
    return normalized;
}

function cloneImage(image) {
    if (image && typeof image === 'object' && !Array.isArray(image)) return { ...image };
    return image;
}

function extractProducts(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.products)) return payload.products;
    if (Array.isArray(payload?.data?.products)) return payload.data.products;
    return null;
}

function extractProduct(payload) {
    if (payload?.product && typeof payload.product === 'object') return payload.product;
    if (payload?.data?.product && typeof payload.data.product === 'object') return payload.data.product;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.id) return payload;
    return null;
}

function extractErrorPayload(payload) {
    const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
    if (!error || typeof error !== 'object') return {};

    const code = typeof error.code === 'string' && SAFE_ERROR_CODES.has(error.code)
        ? error.code
        : null;
    const details = error.details && typeof error.details === 'object' ? error.details : {};
    return {
        code,
        field: typeof details.field === 'string' ? details.field : undefined,
        index: Number.isInteger(details.index) && details.index >= 0 ? details.index : undefined,
        reasonCode: typeof details.reasonCode === 'string' && SAFE_REASON_CODE.test(details.reasonCode)
            ? details.reasonCode
            : undefined,
    };
}

/**
 * Maps an HTTP response or a failed fetch to the stable local domain errors.
 * Raw upstream messages, URLs, claims, and provider details are intentionally
 * not copied into the resulting error.
 */
export function mapRemoteError(error, { productId = null, operation = 'catalog operation' } = {}) {
    if (error instanceof AuthorizationError
        || error instanceof ConflictError
        || error instanceof InvalidProductError
        || error instanceof LimitExceededError
        || error instanceof ProductNotFoundError
        || error instanceof StorageUnavailableError) {
        return error;
    }

    const status = Number(error?.status ?? error?.statusCode);
    const payload = extractErrorPayload(error?.payload);
    const code = payload.code;

    if (code === 'UNAUTHORIZED' || status === 401) {
        return new AuthorizationError('Remote catalog authentication failed');
    }
    if (code === 'FORBIDDEN_OR_NOT_FOUND' || status === 403 || (status === 404 && productId)) {
        return new ProductNotFoundError(productId ?? 'remote-resource');
    }
    if (code === 'CONFLICT' || code === 'IDEMPOTENCY_REPLAY' || status === 409) {
        return new ConflictError('Remote catalog operation conflicts with the current state');
    }
    if (code === 'LIMIT_EXCEEDED' || status === 429) {
        return new LimitExceededError('Remote catalog operation exceeded an operational limit');
    }
    if (code === 'VALIDATION_ERROR' || status === 400 || status === 422) {
        const validationError = new InvalidProductError(`Remote catalog rejected ${operation}`);
        if (payload.field) validationError.field = payload.field;
        if (payload.index !== undefined) validationError.index = payload.index;
        if (payload.reasonCode) validationError.code = payload.reasonCode;
        return validationError;
    }
    return new StorageUnavailableError('Remote catalog service is unavailable');
}

export class RemoteProductRepository extends ProductRepository {
    constructor({
        baseUrl,
        fetchImpl = globalThis.fetch,
        authSession = null,
        accessToken = null,
        getAccessToken = null,
        tokenProvider = null,
        productsPath = DEFAULT_PRODUCTS_PATH,
        requestTimeoutMs = 15000,
        clock = now,
    } = {}) {
        super();
        if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
            throw new StorageUnavailableError('Remote catalog API base URL is required');
        }
        try {
            this.baseUrl = new URL(`${baseUrl.replace(/\/+$/u, '')}/`);
        } catch {
            throw new StorageUnavailableError('Remote catalog API base URL is invalid');
        }
        if (typeof fetchImpl !== 'function') {
            throw new StorageUnavailableError('A fetch implementation is required for the remote catalog');
        }
        if (typeof productsPath !== 'string' || productsPath.trim().length === 0) {
            throw new StorageUnavailableError('Remote catalog products path is required');
        }
        this.fetchImpl = fetchImpl;
        this.authSession = authSession;
        this.accessToken = accessToken;
        this.getAccessToken = getAccessToken ?? tokenProvider;
        this.productsPath = productsPath;
        this.requestTimeoutMs = requestTimeoutMs;
        this.clock = clock;
    }

    async list() {
        const payload = await this._request('GET', this.productsPath);
        const products = extractProducts(payload);
        if (!products) throw new StorageUnavailableError('Remote API returned an invalid product list');
        return products.map(normalizeProduct).sort(compareProductsDescending);
    }

    async add(product, imageReference, options) {
        const { idempotencyKey } = idempotencyOnlyOptions(options);
        const body = stripInternalProductFields(product, imageReference ?? product?.image);
        const payload = await this._request('POST', this.productsPath, {
            body,
            idempotencyKey,
        });
        const created = extractProduct(payload);
        if (!created) throw new StorageUnavailableError('Remote API returned an invalid created product');
        return normalizeProduct(created);
    }

    async rename(id, newName, expectedVersionOrOptions, idempotencyKey) {
        const options = mutationOptions(expectedVersionOrOptions, idempotencyKey);
        const payload = await this._request('PATCH', `${this.productsPath}/${encodeURIComponent(id)}`, {
            body: {
                name: newName,
                ...(options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {}),
            },
            idempotencyKey: options.idempotencyKey,
            expectedVersion: options.expectedVersion,
        });
        const renamed = extractProduct(payload);
        return renamed ? normalizeProduct(renamed) : undefined;
    }

    async remove(id, expectedVersionOrOptions, idempotencyKey) {
        const options = mutationOptions(expectedVersionOrOptions, idempotencyKey);
        await this._request('DELETE', `${this.productsPath}/${encodeURIComponent(id)}`, {
            idempotencyKey: options.idempotencyKey,
            expectedVersion: options.expectedVersion,
        });
    }

    async count() {
        return (await this.list()).length;
    }

    async _request(method, path, { body, idempotencyKey, expectedVersion } = {}) {
        const url = this._resolveUrl(path);
        const headers = { accept: 'application/json' };
        if (body !== undefined) headers['content-type'] = 'application/json';

        const token = await this._resolveAccessToken();
        if (token) headers.authorization = `Bearer ${token}`;
        if (typeof idempotencyKey === 'string' && idempotencyKey.length > 0) {
            headers['idempotency-key'] = idempotencyKey;
        }
        if (expectedVersion !== undefined) headers['if-match'] = String(expectedVersion);

        const controller = typeof AbortController === 'function' && this.requestTimeoutMs > 0
            ? new AbortController()
            : null;
        const timeout = controller ? setTimeout(() => controller.abort(), this.requestTimeoutMs) : null;
        try {
            let response;
            try {
                response = await this.fetchImpl(url.toString(), {
                    method,
                    headers,
                    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                    ...(controller ? { signal: controller.signal } : {}),
                });
            } catch (error) {
                throw mapRemoteError(error, { operation: `${method} ${path}` });
            }

            const payload = await readPayload(response);
            const ok = typeof response.ok === 'boolean'
                ? response.ok
                : Number(response.status) >= 200 && Number(response.status) < 300;
            if (!ok) {
                const upstreamError = new Error('Remote catalog request failed');
                upstreamError.status = response.status;
                upstreamError.payload = payload;
                throw mapRemoteError(upstreamError, {
                    productId: method === 'PATCH' || method === 'DELETE' ? decodeURIComponent(path.split('/').pop()) : null,
                    operation: `${method} ${path}`,
                });
            }
            return payload;
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    async _resolveAccessToken() {
        if (typeof this.getAccessToken === 'function') {
            const token = await this.getAccessToken();
            if (token !== null && token !== undefined && token !== '') return token;
            throw new AuthorizationError('A remote catalog access token is required');
        }
        if (this.authSession && typeof this.authSession.accessToken === 'function') {
            const token = await this.authSession.accessToken();
            if (token) return token;
            throw new AuthorizationError('A remote catalog access token is required');
        }
        return typeof this.accessToken === 'string' && this.accessToken.length > 0
            ? this.accessToken
            : null;
    }

    _resolveUrl(path) {
        const normalizedPath = String(path).replace(/^\/+/, '');
        return new URL(normalizedPath, this.baseUrl);
    }
}

async function readPayload(response) {
    if (response?.status === 204) return null;
    if (typeof response?.json === 'function') {
        try {
            return await response.json();
        } catch {
            // Some fetch doubles expose only text for empty or malformed bodies.
        }
    }
    if (typeof response?.text === 'function') {
        const text = await response.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
    return null;
}
