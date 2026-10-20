import { isSafeObjectKey, isUuid } from '../../domain/catalog-contract-primitives.js';

export const IMAGE_OBJECT_EXTENSION = '.jpg';
export const IMAGE_OBJECT_CONTENT_TYPE = 'image/jpeg';
export const IMAGE_OBJECT_PREFIX = 'releases/';

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Error raised when controlled inputs cannot produce a safe image object key.
 * The error carries validation metadata, but never incorporates product text
 * into the generated path.
 */
export class ImageObjectKeyError extends Error {
  constructor(message, {
    code = 'IMAGE_OBJECT_KEY_INVALID',
    releaseId = null,
    productId = null,
  } = {}) {
    super(message);
    this.name = 'ImageObjectKeyError';
    this.code = code;
    this.releaseId = releaseId;
    this.productId = productId;
  }
}

/**
 * Creates the only image format supported by the Stage 2 publication
 * contract. Extension and content type are validated together so a caller
 * cannot accidentally publish a key with incompatible metadata.
 */
export function createImageObjectKey(releaseId, productId, options) {
  const format = resolveImageFormat(options);
  assertSafeReleaseId(releaseId);
  assertProductId(productId, releaseId);

  const releasePrefix = `${IMAGE_OBJECT_PREFIX}${releaseId}/`;
  const key = `${releasePrefix}images/${productId}${format.extension}`;
  if (!key.startsWith(releasePrefix) || !isSafeObjectKey(key)) {
    throw new ImageObjectKeyError('Image key must remain inside the release prefix', {
      code: 'IMAGE_KEY_OUTSIDE_RELEASE_PREFIX',
      releaseId,
      productId,
    });
  }

  return key;
}

/**
 * Creates the public manifest image reference with the same validated format
 * used by the object-key function.
 */
export function createImageObjectReference(releaseId, productId, options) {
  const format = resolveImageFormat(options);
  return Object.freeze({
    key: createImageObjectKey(releaseId, productId, format),
    contentType: format.contentType,
  });
}

function resolveImageFormat(options) {
  if (options !== undefined && !isRecord(options)) {
    throw new ImageObjectKeyError('Image object format options must be an object', {
      code: 'INVALID_IMAGE_FORMAT_OPTIONS',
    });
  }

  const extension = options?.extension === undefined
    ? IMAGE_OBJECT_EXTENSION
    : options.extension;
  const contentType = options?.contentType === undefined
    ? IMAGE_OBJECT_CONTENT_TYPE
    : options.contentType;
  if (extension !== IMAGE_OBJECT_EXTENSION) {
    throw new ImageObjectKeyError(
      `Image extension must be ${IMAGE_OBJECT_EXTENSION}`,
      { code: 'INVALID_IMAGE_EXTENSION' },
    );
  }
  if (contentType !== IMAGE_OBJECT_CONTENT_TYPE) {
    throw new ImageObjectKeyError(
      `Image content type must be ${IMAGE_OBJECT_CONTENT_TYPE}`,
      { code: 'INVALID_IMAGE_CONTENT_TYPE' },
    );
  }
  if (extension !== '.jpg' || contentType !== 'image/jpeg') {
    throw new ImageObjectKeyError('Image extension and content type are incompatible', {
      code: 'IMAGE_FORMAT_MISMATCH',
    });
  }

  return { extension, contentType };
}

export function isControlledImageObjectKey(value) {
  if (!isSafeObjectKey(value)) return false;

  const segments = value.split('/');
  if (segments.length !== 4 || segments[0] !== 'releases' || segments[2] !== 'images') {
    return false;
  }
  if (!RELEASE_ID_PATTERN.test(segments[1]) || segments[1] === '.' || segments[1] === '..') {
    return false;
  }
  if (!segments[3].endsWith(IMAGE_OBJECT_EXTENSION)) return false;

  const productId = segments[3].slice(0, -IMAGE_OBJECT_EXTENSION.length);
  return isUuid(productId);
}

export function assertSafeReleaseId(releaseId) {
  if (typeof releaseId !== 'string'
    || !RELEASE_ID_PATTERN.test(releaseId)
    || releaseId === '.'
    || releaseId === '..'
    || !isSafeObjectKey(releaseId)) {
    throw new ImageObjectKeyError(
      'releaseId must be a safe single path component',
      { code: 'INVALID_RELEASE_ID', releaseId },
    );
  }
}

function assertProductId(productId, releaseId) {
  if (!isUuid(productId)) {
    throw new ImageObjectKeyError('Product id must be a UUID for an image key', {
      code: 'INVALID_IMAGE_PRODUCT_ID',
      releaseId,
      productId,
    });
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
