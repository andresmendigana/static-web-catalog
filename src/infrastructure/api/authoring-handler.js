import { resolveAuthorContext, rejectClientOwnerOverride, requireAuthorScope } from '../../application/auth/author-context.js';
import { normalizeCharacteristics } from '../../domain/characteristics.js';
import { isSafeObjectKey, isUuid } from '../../domain/catalog-contract-primitives.js';
import { assertValidPrice } from '../../domain/price.js';
import { isValidProductName, normalizeProductName } from '../../domain/product-name.js';
import { InvalidProductError, translateError } from '../../domain/errors.js';
import { importCatalog } from '../../application/use-cases/import-catalog.js';
import { correlationIdFromEvent, logOperation } from '../observability/structured-logger.js';
import { createRuntimeUploadPreparationService } from '../../../infra/runtime/upload-adapters.mjs';
import { routeForEvent } from './authoring-routes.js';

let configuredUploadPreparationService;

const CREATE_FIELDS = new Set(['name', 'priceMode', 'priceCOP', 'image', 'characteristics']);
const RENAME_FIELDS = new Set(['name', 'expectedVersion']);
const REMOVE_FIELDS = new Set(['expectedVersion']);
const IMAGE_CONTENT_TYPE = 'image/jpeg';

/**
 * Thin authenticated function boundary. Identity and authorization are
 * resolved before the injected repository port is used. The handler never
 * gives the browser an AWS client or a persistence implementation.
 */
export async function handler(event, context = {}) {
  const startedAt = Date.now();
  const requestId = event?.requestContext?.requestId;
  const correlationId = correlationIdFromEvent(event, requestId);
  let operation = event?.routeKey ?? 'unknown-operation';
  let ownerId;

  try {
    if (event?.routeKey === 'GET /health') {
      return complete(jsonResponse(200, { ok: true, requestId }), {
        requestId,
        correlationId,
        operation: 'health',
        startedAt,
      });
    }

    const route = routeForEvent(event);
    operation = route?.id ?? operation;
    if (!route) {
      return complete(jsonResponse(404, { error: { code: 'FORBIDDEN_OR_NOT_FOUND', requestId } }), {
        requestId,
        correlationId,
        operation,
        startedAt,
        result: 'rejected',
      });
    }

    const author = resolveAuthorContext(event);
    ownerId = author.ownerId;
    requireAuthorScope(author, route.scopes[0]);
    rejectClientOwnerOverride(event);

    if (route.id === 'PrepareUpload') {
      const body = parseJsonBody(event);
      const service = context?.uploadPreparationService
        ?? configuredUploadPreparationService
        ?? createRuntimeUploadPreparationService();
      const preparation = await service.prepare({
        ownerId: author.ownerId,
        contentType: body?.contentType,
        contentLength: body?.contentLength,
        checksum: body?.checksum,
      });
      return complete(jsonResponse(201, preparation), {
        requestId,
        correlationId,
        operation,
        ownerId,
        startedAt,
      });
    }

    if (route.handler === 'catalog') {
      const repository = await resolveRepository(context, author);
      return complete(await handleCatalogRoute(route.id, event, repository, author), {
        requestId,
        correlationId,
        operation,
        ownerId,
        startedAt,
      });
    }

    return complete(jsonResponse(501, { error: { code: 'INTERNAL_ERROR', requestId } }), {
      requestId,
      correlationId,
      operation,
      ownerId,
      startedAt,
      result: 'error',
    });
  } catch (error) {
    const response = translateError(error, requestId);
    return complete(response, {
      requestId,
      correlationId,
      operation,
      ownerId,
      startedAt,
      result: 'error',
    });
  }
}

async function resolveRepository(context, author) {
  const repository = typeof context?.repositoryFactory === 'function'
    ? await context.repositoryFactory(author)
    : context?.repository;

  if (!repository || typeof repository !== 'object') {
    throw new Error('An injected catalog repository is required');
  }
  return repository;
}

async function handleCatalogRoute(routeId, event, repository, author) {
  switch (routeId) {
    case 'ListProducts': {
      requireRepositoryMethod(repository, 'list');
      const products = await repository.list();
      if (!Array.isArray(products)) throw new Error('Repository returned an invalid product list');
      return jsonResponse(200, { products: products.map(toProductDto) });
    }
    case 'CreateProduct': {
      requireRepositoryMethod(repository, 'add');
      const body = requireBody(event);
      const payload = validateCreatePayload(body);
      const idempotencyKey = headerValue(event, 'idempotency-key');
      const created = idempotencyKey
        ? await repository.add(payload, payload.image, { idempotencyKey })
        : await repository.add(payload, payload.image);
      return jsonResponse(201, { product: toProductDto(created) });
    }
    case 'UpdateProduct': {
      requireRepositoryMethod(repository, 'rename');
      const id = requireProductId(event);
      const body = requireBody(event);
      const { name, expectedVersion } = validateRenamePayload(body, event);
      const renamed = await repository.rename(id, name, expectedVersion);
      return jsonResponse(200, { product: toProductDto(renamed) });
    }
    case 'DeleteProduct': {
      requireRepositoryMethod(repository, 'remove');
      const id = requireProductId(event);
      const body = optionalBody(event);
      const expectedVersion = validateRemovePayload(body, event);
      await repository.remove(id, expectedVersion);
      return { statusCode: 204, headers: { 'content-type': 'application/json' }, body: '' };
    }
    case 'ImportCatalog': {
      const body = requireBody(event);
      const fields = new Set(['exportPackage', 'dryRun', 'confirm', 'confirmed', 'confirmation']);
      rejectUnknownFields(body, fields);
      if (!body.exportPackage || typeof body.exportPackage !== 'object' || Array.isArray(body.exportPackage)) {
        throw validationError('exportPackage must be an object', 'exportPackage', 'INVALID_EXPORT_PACKAGE');
      }
      if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
        throw validationError('dryRun must be a boolean', 'dryRun', 'INVALID_IMPORT_OPTION');
      }
      for (const field of ['confirm', 'confirmed', 'confirmation']) {
        if (body[field] !== undefined && typeof body[field] !== 'boolean') {
          throw validationError(`${field} must be a boolean`, field, 'INVALID_IMPORT_OPTION');
        }
      }
      const idempotencyKey = headerValue(event, 'idempotency-key');
      const report = await importCatalog({
        exportPackage: body.exportPackage,
        repository,
        ownerId: author.ownerId,
        dryRun: body.dryRun,
        confirm: body.confirm,
        confirmed: body.confirmed,
        confirmation: body.confirmation,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      return jsonResponse(200, report);
    }
    default:
      throw new Error(`Unsupported catalog route: ${routeId}`);
  }
}

function validateCreatePayload(body) {
  rejectUnknownFields(body, CREATE_FIELDS);
  const name = requireProductName(body.name);
  try {
    assertValidPrice(body.priceMode, body.priceCOP);
  } catch (error) {
    if (error?.field === undefined) error.field = 'priceCOP';
    throw error;
  }

  let characteristics;
  try {
    characteristics = normalizeCharacteristics(body.characteristics ?? []);
  } catch (error) {
    throw error;
  }

  const image = validateImageReference(body.image);
  return {
    name,
    priceMode: body.priceMode,
    priceCOP: body.priceCOP,
    image,
    characteristics,
  };
}

function validateRenamePayload(body, event) {
  rejectUnknownFields(body, RENAME_FIELDS);
  const name = requireProductName(body.name);
  const expectedVersion = readExpectedVersion(body, event);
  return { name, expectedVersion };
}

function validateRemovePayload(body, event) {
  rejectUnknownFields(body, REMOVE_FIELDS);
  return readExpectedVersion(body, event);
}

function validateImageReference(image) {
  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    throw validationError('image must be a controlled JPEG reference', 'image', 'INVALID_PRODUCT_IMAGE');
  }
  if (typeof image.key !== 'string' || !isSafeObjectKey(image.key)) {
    throw validationError('image key is invalid', 'image.key', 'INVALID_PRODUCT_IMAGE');
  }
  if (image.contentType !== IMAGE_CONTENT_TYPE) {
    throw validationError('image contentType must be image/jpeg', 'image.contentType', 'INVALID_PRODUCT_IMAGE');
  }
  return { key: image.key, contentType: IMAGE_CONTENT_TYPE };
}

function requireProductId(event) {
  const id = event?.pathParameters?.id;
  if (!isUuid(id)) throw validationError('Product id must be a UUID', 'id', 'INVALID_PRODUCT_ID');
  return id;
}

function requireProductName(name) {
  if (!isValidProductName(name)) {
    throw validationError('Product name is required and cannot be empty', 'name', 'INVALID_PRODUCT_NAME');
  }
  return normalizeProductName(name);
}

function readExpectedVersion(body, event) {
  const bodyVersion = body?.expectedVersion;
  const header = headerValue(event, 'x-expected-version') ?? headerValue(event, 'if-match');
  const headerVersion = header === undefined ? undefined : parseVersion(header, 'header');
  const normalizedBodyVersion = bodyVersion === undefined
    ? undefined
    : parseVersion(bodyVersion, 'expectedVersion');
  if (headerVersion !== undefined && normalizedBodyVersion !== undefined && headerVersion !== normalizedBodyVersion) {
    throw validationError('expectedVersion values must match', 'expectedVersion', 'INVALID_EXPECTED_VERSION');
  }
  return normalizedBodyVersion ?? headerVersion;
}

function parseVersion(value, field) {
  const parsed = typeof value === 'string' && /^"?\d+"?$/u.test(value)
    ? Number(value.replace(/"/gu, ''))
    : value;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw validationError('expectedVersion must be a positive integer', field, 'INVALID_EXPECTED_VERSION');
  }
  return parsed;
}

function rejectUnknownFields(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('Request body must be a JSON object', 'body', 'INVALID_REQUEST_BODY');
  }
  const unknown = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unknown) throw validationError(`Field ${unknown} is not allowed`, unknown, 'INVALID_FIELD');
}

function requireBody(event) {
  const body = parseJsonBody(event);
  if (!body) throw validationError('Request body must be a JSON object', 'body', 'INVALID_REQUEST_BODY');
  return body;
}

function optionalBody(event) {
  const body = parseJsonBody(event);
  if (event?.body !== undefined && event?.body !== null && event?.body !== '' && !body) {
    throw validationError('Request body must be a JSON object', 'body', 'INVALID_REQUEST_BODY');
  }
  return body ?? {};
}

function toProductDto(product) {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw new Error('Repository returned an invalid product');
  }
  return {
    id: product.id,
    name: product.name,
    priceMode: product.priceMode,
    priceCOP: product.priceCOP,
    createdAt: product.createdAt,
    characteristics: Array.isArray(product.characteristics)
      ? product.characteristics.map((characteristic) => ({
        label: characteristic.label,
        value: characteristic.value,
      }))
      : [],
    image: product.image && typeof product.image === 'object' && !Array.isArray(product.image)
      ? { key: product.image.key, contentType: product.image.contentType }
      : product.image,
  };
}

function requireRepositoryMethod(repository, method) {
  if (typeof repository?.[method] !== 'function') {
    throw new Error(`Injected repository must implement ${method}()`);
  }
}

function headerValue(event, name) {
  const headers = event?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const expectedName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === expectedName);
  return key === undefined ? undefined : headers[key];
}

function validationError(message, field, code) {
  const error = new InvalidProductError(message);
  error.code = code;
  error.field = field;
  return error;
}

function complete(response, {
  requestId,
  correlationId,
  operation,
  ownerId,
  startedAt,
  result = 'success',
}) {
  const errorCode = readErrorCode(response);
  logOperation({
    requestId,
    correlationId,
    operation,
    result,
    durationMs: Date.now() - startedAt,
    ownerId,
    statusCode: response.statusCode,
    errorCode,
  });
  return response;
}

function readErrorCode(response) {
  if (response?.statusCode < 400 || typeof response.body !== 'string') return undefined;
  try {
    return JSON.parse(response.body)?.error?.code;
  } catch {
    return undefined;
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  if (event?.body === undefined || event.body === null || event.body === '') return null;
  if (typeof event.body === 'object' && !Array.isArray(event.body)) return event.body;
  if (typeof event.body !== 'string') return null;
  try {
    const decoded = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    const body = JSON.parse(decoded);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function setUploadPreparationService(service) {
  if (!service || typeof service.prepare !== 'function') {
    throw new TypeError('service.prepare must be a function');
  }
  configuredUploadPreparationService = service;
}
