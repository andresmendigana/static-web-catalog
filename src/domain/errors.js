/**
 * Errores específicos del dominio y traducción segura para fronteras HTTP.
 *
 * Las clases históricas de Stage 2 se conservan deliberadamente: sus nombres,
 * herencia y mensajes siguen siendo parte del contrato de los consumidores
 * locales. La traducción común nunca expone esos mensajes directamente.
 */

export const ERROR_CODES = Object.freeze({
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN_OR_NOT_FOUND: 'FORBIDDEN_OR_NOT_FOUND',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    CONFLICT: 'CONFLICT',
    IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',
    LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
    UPLOAD_EXPIRED: 'UPLOAD_EXPIRED',
    UPLOAD_INVALID: 'UPLOAD_INVALID',
    PUBLICATION_FAILED: 'PUBLICATION_FAILED',
    TRANSPORT_ERROR: 'TRANSPORT_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const ERROR_MESSAGES = Object.freeze({
    [ERROR_CODES.UNAUTHORIZED]: 'La solicitud requiere autenticación válida.',
    [ERROR_CODES.FORBIDDEN_OR_NOT_FOUND]: 'El recurso no está disponible.',
    [ERROR_CODES.VALIDATION_ERROR]: 'La solicitud no es válida.',
    [ERROR_CODES.CONFLICT]: 'La operación entra en conflicto con el estado actual.',
    [ERROR_CODES.IDEMPOTENCY_REPLAY]: 'La operación ya fue procesada.',
    [ERROR_CODES.LIMIT_EXCEEDED]: 'Se alcanzó un límite operativo.',
    [ERROR_CODES.UPLOAD_EXPIRED]: 'La carga ha expirado.',
    [ERROR_CODES.UPLOAD_INVALID]: 'La carga no es válida.',
    [ERROR_CODES.PUBLICATION_FAILED]: 'La publicación no pudo completarse.',
    [ERROR_CODES.TRANSPORT_ERROR]: 'El servicio requerido no está disponible.',
    [ERROR_CODES.INTERNAL_ERROR]: 'No fue posible completar la operación.',
});

const ERROR_STATUS_CODES = Object.freeze({
    [ERROR_CODES.UNAUTHORIZED]: 401,
    [ERROR_CODES.FORBIDDEN_OR_NOT_FOUND]: 404,
    [ERROR_CODES.VALIDATION_ERROR]: 422,
    [ERROR_CODES.CONFLICT]: 409,
    [ERROR_CODES.IDEMPOTENCY_REPLAY]: 409,
    [ERROR_CODES.LIMIT_EXCEEDED]: 429,
    [ERROR_CODES.UPLOAD_EXPIRED]: 422,
    [ERROR_CODES.UPLOAD_INVALID]: 422,
    [ERROR_CODES.PUBLICATION_FAILED]: 503,
    [ERROR_CODES.TRANSPORT_ERROR]: 503,
    [ERROR_CODES.INTERNAL_ERROR]: 500,
});

const SAFE_DETAIL_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_DOMAIN_REASON_CODE = /^(?:INVALID|INQUIRE|AMOUNT|CHARACTERISTICS|EXPORT|DUPLICATE|MISSING|ORPHAN|UNSAFE)_[A-Z0-9_]{1,63}$/;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.[\]-]{0,127}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogError extends Error {
    constructor(message, {
        code = ERROR_CODES.INTERNAL_ERROR,
        status = ERROR_STATUS_CODES[ERROR_CODES.INTERNAL_ERROR],
        details = null,
        cause = null,
    } = {}) {
        super(message);
        this.name = 'CatalogError';
        this.code = code;
        this.status = status;
        this.details = details;
        if (cause !== null && cause !== undefined) this.cause = cause;
    }
}

export class AuthorizationError extends CatalogError {
    constructor(message = 'Authorization failed', options = {}) {
        super(message, { ...options, code: ERROR_CODES.UNAUTHORIZED, status: 401 });
        this.name = 'AuthorizationError';
    }
}

export class ConflictError extends CatalogError {
    constructor(message = 'The operation conflicts with the current state', options = {}) {
        super(message, { ...options, code: ERROR_CODES.CONFLICT, status: 409 });
        this.name = 'ConflictError';
    }
}

export class LimitExceededError extends CatalogError {
    constructor(message = 'An operational limit was exceeded', options = {}) {
        super(message, { ...options, code: ERROR_CODES.LIMIT_EXCEEDED, status: options.status ?? 429 });
        this.name = 'LimitExceededError';
    }
}

export class UploadExpiredError extends CatalogError {
    constructor(message = 'Upload expired', options = {}) {
        super(message, { ...options, code: ERROR_CODES.UPLOAD_EXPIRED, status: 422 });
        this.name = 'UploadExpiredError';
    }
}

export class UploadInvalidError extends CatalogError {
    constructor(message = 'Upload is invalid', options = {}) {
        super(message, { ...options, code: ERROR_CODES.UPLOAD_INVALID, status: 422 });
        this.name = 'UploadInvalidError';
    }
}

export class PublicationError extends CatalogError {
    constructor(message = 'Publication failed', options = {}) {
        super(message, { ...options, code: ERROR_CODES.PUBLICATION_FAILED, status: 503 });
        this.name = 'PublicationError';
    }
}

export class TransportError extends CatalogError {
    constructor(message = 'Transport failed', options = {}) {
        super(message, { ...options, code: ERROR_CODES.TRANSPORT_ERROR, status: options.status ?? 503 });
        this.name = 'TransportError';
    }
}

export class InvalidProductError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidProductError';
    }
}

/**
 * Error de dominio para la combinación inválida de modo y valor de precio.
 * Conserva InvalidProductError como tipo base para no romper consumidores
 * existentes, pero ofrece un código estable para distinguir la causa.
 */
export class InvalidPriceError extends InvalidProductError {
    constructor(message, {
        code = 'INVALID_PRICE',
        field = 'priceCOP',
        priceMode = null,
        priceCOP,
    } = {}) {
        super(message);
        this.name = 'InvalidPriceError';
        this.code = code;
        this.field = field;
        this.priceMode = priceMode;
        if (priceCOP !== undefined) {
            this.priceCOP = priceCOP;
        }
    }
}

export class QuotaExceededError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QuotaExceededError';
    }
}

export class StorageUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StorageUnavailableError';
    }
}

export class ProductNotFoundError extends Error {
    constructor(id) {
        super(`Product with id ${id} not found`);
        this.name = 'ProductNotFoundError';
        this.productId = id;
    }
}

/**
 * Converts domain, authorization, transport and publication failures into the
 * stable public error contract. The original error is intentionally never
 * serialized, which prevents stacks, claims, signed URLs and IAM details from
 * crossing the application boundary.
 */
export function translateError(error, requestId = createRequestId()) {
    const classification = classifyError(error);
    const safeRequestId = normalizeRequestId(requestId);
    const response = {
        statusCode: classification.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            error: {
                code: classification.code,
                message: ERROR_MESSAGES[classification.code],
                requestId: safeRequestId,
                ...(classification.details ? { details: classification.details } : {}),
            },
        }),
    };
    return Object.freeze(response);
}

/** Alias explícito para handlers HTTP que prefieran nombrar la operación por su resultado. */
export const toErrorResponse = translateError;

function classifyError(error) {
    const stableCode = Object.values(ERROR_CODES).find((code) => hasCode(error, code));
    if (stableCode) return result(stableCode, ERROR_STATUS_CODES[stableCode], error);

    if (error instanceof AuthorizationError
        || hasName(error, 'UnauthorizedError')
        || hasStatus(error, 401)) {
        return result(ERROR_CODES.UNAUTHORIZED, 401, error);
    }
    if (error instanceof ConflictError
        || hasName(error, 'ConflictError')
        || hasStatus(error, 409)) {
        return result(ERROR_CODES.CONFLICT, 409, error);
    }
    if (error instanceof UploadExpiredError || hasName(error, 'UploadExpiredError')) {
        return result(ERROR_CODES.UPLOAD_EXPIRED, 422, error);
    }
    if (error instanceof UploadInvalidError || hasName(error, 'UploadInvalidError')) {
        return result(ERROR_CODES.UPLOAD_INVALID, 422, error);
    }
    if (error instanceof PublicationError || hasName(error, 'PublicationError')) {
        return result(ERROR_CODES.PUBLICATION_FAILED, 503, error);
    }
    if (error instanceof TransportError || hasName(error, 'StorageUnavailableError') || hasTransportStatus(error)) {
        return result(ERROR_CODES.TRANSPORT_ERROR, 503, error);
    }
    if (error instanceof LimitExceededError) {
        return result(ERROR_CODES.LIMIT_EXCEEDED, error.status, error);
    }
    if (error instanceof QuotaExceededError || hasStatus(error, 429)) {
        return result(ERROR_CODES.LIMIT_EXCEEDED, error instanceof QuotaExceededError ? 422 : 429, error);
    }
    if (error instanceof ProductNotFoundError || hasStatus(error, 403) || hasStatus(error, 404)) {
        return result(ERROR_CODES.FORBIDDEN_OR_NOT_FOUND, 404, error);
    }
    if (isValidationError(error) || hasStatus(error, 400) || hasStatus(error, 422)) {
        return result(ERROR_CODES.VALIDATION_ERROR, 422, error);
    }
    return result(ERROR_CODES.INTERNAL_ERROR, 500, error);
}

function result(code, status, error) {
    const details = safeDetails(error, code);
    return { code, status, details };
}

function isValidationError(error) {
    return error instanceof InvalidProductError
        || hasName(error, 'InvalidCharacteristicsError')
        || hasCode(error, ERROR_CODES.VALIDATION_ERROR)
        || (typeof error?.code === 'string' && SAFE_DETAIL_CODE.test(error.code)
            && error.code.startsWith('INVALID_'));
}

function safeDetails(error, stableCode) {
    if (!error || typeof error !== 'object') return null;
    const details = {};
    const reasonCode = typeof error.code === 'string'
        && SAFE_DETAIL_CODE.test(error.code)
        && SAFE_DOMAIN_REASON_CODE.test(error.code)
        && error.code !== stableCode
        ? error.code
        : null;
    if (reasonCode) details.reasonCode = reasonCode;
    if (typeof error.field === 'string' && SAFE_FIELD.test(error.field)) details.field = error.field;
    const index = Number.isInteger(error.index) ? error.index : error.recordIndex;
    if (Number.isInteger(index) && index >= 0) details.index = index;
    if (typeof error.productId === 'string' && UUID.test(error.productId)) {
        details.productId = error.productId;
    }
    return Object.keys(details).length > 0 ? Object.freeze(details) : null;
}

function hasName(error, name) {
    return error?.name === name;
}

function hasCode(error, code) {
    return error?.code === code;
}

function hasStatus(error, status) {
    return error?.status === status || error?.statusCode === status;
}

function hasTransportStatus(error) {
    const status = error?.status ?? error?.statusCode;
    return Number.isInteger(status) && status >= 500;
}

function normalizeRequestId(requestId) {
    return typeof requestId === 'string' && SAFE_REQUEST_ID.test(requestId)
        ? requestId
        : createRequestId();
}

function createRequestId() {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export { createRequestId };
