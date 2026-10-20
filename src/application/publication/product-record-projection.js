import { CATALOG_PRODUCT_LIMIT } from '../../domain/catalog-limits.js';
import {
  IMAGE_CONTENT_TYPE,
  MANIFEST_SCHEMA_VERSION,
  validateManifest,
  validateProduct,
} from '../validation/catalog-contracts.js';
import { createImageObjectReference } from './image-object-keys.js';

export const PUBLIC_PRODUCT_FIELDS = Object.freeze([
  'id',
  'name',
  'priceMode',
  'priceCOP',
  'createdAt',
  'characteristics',
  'image',
]);

const IMAGE_FIELDS = Object.freeze(['key', 'contentType']);

/**
 * Error raised when a ProductRecord cannot be projected to the public v1
 * contract. It exposes only safe validation metadata, never the source record.
 */
export class ProductRecordProjectionError extends Error {
  constructor(message, { code = 'PRODUCT_RECORD_PROJECTION_FAILED', errors = [], issues = [] } = {}) {
    super(message);
    this.name = 'ProductRecordProjectionError';
    this.code = code;
    this.errors = [...errors];
    this.issues = [...issues];
  }
}

/**
 * Projects one ProductRecord through the public allowlist. No source object or
 * nested characteristic/image object is reused, and backend-only attributes
 * therefore cannot leak into the result.
 *
 * When releaseId is supplied, the image key is derived only from that
 * controlled release identifier and the product UUID. Without releaseId, an
 * already-public image reference is copied as-is; the manifest-level function
 * still validates the complete stage2-manifest-v1 contract.
 */
export function projectProductRecord(record, { releaseId } = {}) {
  assertValidProductRecord(record);
  const image = projectImageReference(record, releaseId);
  const characteristics = Array.isArray(record.characteristics)
    ? record.characteristics.map(({ label, value }) => ({ label, value }))
    : [];

  return {
    id: record.id,
    name: record.name,
    priceMode: record.priceMode,
    priceCOP: record.priceCOP,
    createdAt: record.createdAt,
    characteristics,
    image,
  };
}

/**
 * Projects ProductRecords in newest-first order. Products sharing createdAt
 * are ordered by descending UUID text, matching the DynamoDB repository's
 * deterministic tie-breaker.
 */
export function projectProductRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new ProductRecordProjectionError('Product records must be an array', {
      code: 'INVALID_PRODUCT_RECORDS',
      errors: ['Product records must be an array'],
    });
  }

  return records
    .map((record, index) => ({
      record: projectProductRecord(record, options),
      index,
    }))
    .sort((left, right) => {
      const timestampDifference = timestampOf(right.record.createdAt)
        - timestampOf(left.record.createdAt);
      if (timestampDifference !== 0) return timestampDifference;
      return right.record.id.localeCompare(left.record.id);
    })
    .map(({ record }) => record);
}

/**
 * Builds a complete, validated stage2-manifest-v1 without I/O, AWS
 * dependencies, or mutation. `releaseId` is optional only when each record
 * already contains a public release image reference.
 */
export function projectProductRecordsToManifest(
  records,
  { releaseId, generatedAt = new Date().toISOString() } = {},
) {
  const products = projectProductRecords(records, { releaseId });
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: normalizeGeneratedAt(generatedAt),
    catalogLimit: CATALOG_PRODUCT_LIMIT,
    products,
  };
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new ProductRecordProjectionError('Projected public manifest is invalid', {
      code: 'PROJECTED_MANIFEST_INVALID',
      errors: validation.errors,
      issues: validation.issues,
    });
  }
  return manifest;
}

function assertValidProductRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ProductRecordProjectionError('Product record must be an object', {
      code: 'INVALID_PRODUCT_RECORD',
      errors: ['Product record must be an object'],
    });
  }

  const validation = validateProduct(record, {
    imageMode: 'manifest',
    requireCharacteristics: false,
  });
  if (!validation.valid) {
    throw new ProductRecordProjectionError('Product record is invalid', {
      code: 'INVALID_PRODUCT_RECORD',
      errors: validation.errors,
      issues: validation.issues,
    });
  }

  if (!isImageReference(record.image)) {
    throw new ProductRecordProjectionError('Product record image reference is invalid', {
      code: 'INVALID_IMAGE_REFERENCE',
      errors: ['Product record image must be an image/jpeg reference'],
    });
  }
}

function projectImageReference(record, releaseId) {
  if (releaseId !== undefined) {
    try {
      return createImageObjectReference(releaseId, record.id);
    } catch (error) {
      throw new ProductRecordProjectionError('Product record image reference is invalid', {
        code: error.code ?? 'INVALID_IMAGE_REFERENCE',
        errors: ['Product record image reference could not be projected'],
      });
    }
  }

  return {
    key: record.image.key,
    contentType: record.image.contentType,
  };
}

function isImageReference(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.key === 'string'
    && value.key.length > 0
    && value.contentType === IMAGE_CONTENT_TYPE;
}

function timestampOf(value) {
  return typeof value === 'number' ? value : Date.parse(value);
}

function normalizeGeneratedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ProductRecordProjectionError('generatedAt must be a valid ISO UTC datetime', {
      code: 'INVALID_GENERATED_AT',
      errors: ['generatedAt must be a valid ISO UTC datetime'],
    });
  }
  return date.toISOString();
}

export { IMAGE_FIELDS };
