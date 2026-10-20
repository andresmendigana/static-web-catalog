import { CATALOG_PRODUCT_LIMIT } from '../../domain/catalog-limits.js';
import {
  createImageObjectKey as createControlledImageObjectKey,
  createImageObjectReference,
  assertSafeReleaseId,
  ImageObjectKeyError,
  IMAGE_OBJECT_CONTENT_TYPE,
  IMAGE_OBJECT_EXTENSION,
} from '../publication/image-object-keys.js';
import {
  IMAGE_CONTENT_TYPE,
  MANIFEST_SCHEMA_VERSION,
  validateExportPackage,
  validateManifest,
} from '../validation/catalog-contracts.js';

/**
 * Error raised when a public manifest cannot be generated from an export
 * package. It deliberately exposes validation metadata, not source records.
 */
export class ManifestGenerationError extends Error {
  constructor(message, {
    code = 'MANIFEST_GENERATION_FAILED',
    errors = [],
    issues = [],
    releaseId = null,
  } = {}) {
    super(message);
    this.name = 'ManifestGenerationError';
    this.code = code;
    this.errors = [...errors];
    this.issues = [...issues];
    this.releaseId = releaseId;
  }
}

/**
 * Error raised when manifest JSON cannot be serialized or parsed according to
 * the shared PublicManifest contract. The error contains validation metadata
 * but never includes the input payload itself.
 */
export class ManifestSerializationError extends Error {
  constructor(message, {
    code = 'MANIFEST_SERIALIZATION_FAILED',
    errors = [],
    issues = [],
  } = {}) {
    super(message);
    this.name = 'ManifestSerializationError';
    this.code = code;
    this.errors = [...errors];
    this.issues = [...issues];
  }
}

/**
 * Creates a safe, deterministic public image key for a release and product.
 * Both values are controlled identifiers; user-facing product text is never
 * used as a path component.
 */
export function createImageObjectKey(releaseId, productId, options) {
  try {
    return createControlledImageObjectKey(releaseId, productId, options);
  } catch (error) {
    if (!(error instanceof ImageObjectKeyError)) throw error;
    throw new ManifestGenerationError(error.message, {
      code: error.code,
      releaseId: error.releaseId ?? releaseId ?? null,
      errors: [error.message],
    });
  }
}

/**
 * Generates a PublicManifest v1 without I/O, AWS dependencies, or mutation.
 * `generatedAt` is intentionally sourced from the runtime clock unless the
 * caller explicitly supplies the option, which keeps production timestamps
 * dynamic while making tests reproducible.
 *
 * @param {object} exportPackage A validated stage2-export-v1 package.
 * @param {string} releaseId Controlled release identifier used for image keys.
 * @param {{generatedAt?: Date|string}} [options]
 * @returns {object} A validated stage2-manifest-v1 public manifest.
 */
export function generateManifest(exportPackage, releaseId, { generatedAt } = {}) {
  const packageValidation = validateExportPackage(exportPackage);
  if (!packageValidation.valid) {
    throw new ManifestGenerationError('Export package is invalid', {
      code: 'EXPORT_PACKAGE_INVALID',
      errors: packageValidation.errors,
      issues: packageValidation.issues,
      releaseId,
    });
  }

  assertManifestReleaseId(releaseId);
  const products = exportPackage.products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => {
      const timestampDifference = timestampOf(right.product.createdAt)
        - timestampOf(left.product.createdAt);
      return timestampDifference || left.index - right.index;
    })
    .map(({ product }) => ({
      id: product.id,
      name: product.name,
      priceMode: product.priceMode,
      priceCOP: product.priceCOP,
      createdAt: product.createdAt,
      characteristics: product.characteristics.map(({ label, value }) => ({ label, value })),
      image: createImageObjectReference(releaseId, product.id),
    }));

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: normalizeGeneratedAt(generatedAt),
    catalogLimit: CATALOG_PRODUCT_LIMIT,
    products,
  };
  const manifestValidation = validateManifest(manifest);
  if (!manifestValidation.valid) {
    throw new ManifestGenerationError('Generated public manifest is invalid', {
      code: 'GENERATED_MANIFEST_INVALID',
      errors: manifestValidation.errors,
      issues: manifestValidation.issues,
      releaseId,
    });
  }

  return manifest;
}

/**
 * Serializes a validated PublicManifest as JSON text intended to be written
 * using UTF-8 by the caller. JSON.stringify preserves object and array order,
 * and this function performs no filesystem, network, or AWS I/O.
 *
 * @param {object} manifest A PublicManifest v1 value.
 * @param {{pretty?: boolean}} [options]
 * @returns {string} JSON text encoded as UTF-8 by the consuming boundary.
 */
export function serializeManifest(manifest, { pretty = false } = {}) {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new ManifestSerializationError('Public manifest is invalid', {
      code: 'MANIFEST_INVALID',
      errors: validation.errors,
      issues: validation.issues,
    });
  }

  if (typeof pretty !== 'boolean') {
    throw new ManifestSerializationError('Manifest serialization options are invalid', {
      code: 'INVALID_SERIALIZATION_OPTIONS',
      errors: ['pretty must be a boolean'],
    });
  }

  try {
    return JSON.stringify(manifest, null, pretty ? 2 : 0);
  } catch {
    throw new ManifestSerializationError('Public manifest cannot be serialized as JSON', {
      code: 'MANIFEST_SERIALIZATION_FAILED',
      errors: ['manifest must contain only JSON-compatible values'],
    });
  }
}

/**
 * Parses JSON text or UTF-8 bytes and validates the complete PublicManifest
 * contract before returning it. ArrayBuffer views (including Node Buffers)
 * are decoded using fatal UTF-8 handling so malformed byte sequences reject.
 *
 * @param {string|ArrayBuffer|ArrayBufferView} bytes JSON text or UTF-8 bytes.
 * @returns {object} A validated PublicManifest v1 value.
 */
export function parseManifest(bytes) {
  let source;
  try {
    source = decodeManifestInput(bytes);
  } catch (error) {
    throw new ManifestSerializationError('Manifest input is not valid UTF-8', {
      code: 'MANIFEST_INVALID_UTF8',
      errors: ['manifest input must be a UTF-8 string or byte sequence'],
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new ManifestSerializationError('Manifest input contains malformed JSON', {
      code: 'MANIFEST_INVALID_JSON',
      errors: ['manifest input must contain valid JSON'],
    });
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new ManifestSerializationError('Public manifest is invalid', {
      code: 'MANIFEST_INVALID',
      errors: validation.errors,
      issues: validation.issues,
    });
  }

  return manifest;
}

function decodeManifestInput(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  throw new TypeError('manifest input must be a string or byte sequence');
}

function assertManifestReleaseId(releaseId) {
  try {
    assertSafeReleaseId(releaseId);
  } catch (error) {
    if (!(error instanceof ImageObjectKeyError)) throw error;
    throw new ManifestGenerationError(error.message, {
      code: error.code,
      releaseId: error.releaseId ?? releaseId ?? null,
      errors: [error.message],
    });
  }
}

function normalizeGeneratedAt(value) {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ManifestGenerationError('generatedAt must be a valid ISO UTC datetime', {
      code: 'INVALID_GENERATED_AT',
    });
  }
  return date.toISOString();
}

function timestampOf(value) {
  return typeof value === 'number' ? value : Date.parse(value);
}

export {
  IMAGE_CONTENT_TYPE,
  IMAGE_OBJECT_CONTENT_TYPE,
  IMAGE_OBJECT_EXTENSION,
  MANIFEST_SCHEMA_VERSION,
};
