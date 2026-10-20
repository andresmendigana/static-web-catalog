import {
  isSafeObjectKey,
  isUuid,
  isProcessedJpeg,
} from '../../domain/catalog-contract-primitives.js';
import {
  IMAGE_CONTENT_TYPE,
  validateExportPackage,
  validateManifest,
} from '../validation/catalog-contracts.js';
import {
  createImageObjectKey,
  assertSafeReleaseId,
  isControlledImageObjectKey,
  ImageObjectKeyError,
  IMAGE_OBJECT_CONTENT_TYPE,
} from './image-object-keys.js';
import {
  generateManifest,
  serializeManifest,
} from '../use-cases/generate-manifest.js';

export const RELEASE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const MANIFEST_CACHE_CONTROL = RELEASE_CACHE_CONTROL;
export const CURRENT_POINTER_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';
export const PUBLICATION_POINTER_KEY = 'releases/current.json';
export const PUBLICATION_MANIFEST_FILENAME = 'manifest.json';

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/u,
  /ASIA[0-9A-Z]{16}/u,
  /aws[_-]?(?:access[_-]?key|secret|session[_-]?token)/iu,
  /(?:secretAccessKey|sessionToken|accessKeyId)\s*[:=]/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._~-]+/iu,
];
const MIME_TYPES_BY_EXTENSION = Object.freeze({
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

/**
 * Error raised when a complete static publication package cannot be assembled.
 * It reports a stable code and safe validation details, never source payloads.
 */
export class PublicationPackageError extends Error {
  constructor(message, { code = 'PUBLICATION_PACKAGE_INVALID', errors = [], issues = [] } = {}) {
    super(message);
    this.name = 'PublicationPackageError';
    this.code = code;
    this.errors = [...errors];
    this.issues = [...issues];
  }
}

/**
 * Assemble an in-memory, deterministic set of release artifacts. This function
 * deliberately performs no filesystem, network, browser, or AWS I/O.
 *
 * `input` accepts either `manifest` plus `images`, or an `exportPackage` plus
 * `application`. Application files are entries with `{ path, data|body }`.
 * Export image data URIs are decoded into JPEG bytes for the release.
 */
export function assemblePublicationPackage({
  releaseId,
  application,
  manifest,
  exportPackage,
  images,
  generatedAt,
  includeCurrentPointer = true,
} = {}) {
  assertReleaseId(releaseId);
  if (typeof includeCurrentPointer !== 'boolean') {
    throw packageError('includeCurrentPointer must be a boolean', 'INVALID_POINTER_OPTION');
  }
  if (manifest !== undefined && exportPackage !== undefined) {
    throw packageError('Provide a manifest or an export package, not both', 'CONFLICTING_MANIFEST_INPUTS');
  }

  const resolvedManifest = resolveManifest({ manifest, exportPackage, releaseId, generatedAt });
  const applicationArtifacts = normalizeApplication(application, releaseId);
  const imageRecords = resolveImages({ images, exportPackage });
  const imageArtifacts = normalizeImageArtifacts(imageRecords, resolvedManifest, releaseId);
  const manifestArtifact = createJsonArtifact(
    `${releasePrefix(releaseId)}${PUBLICATION_MANIFEST_FILENAME}`,
    resolvedManifest,
    MANIFEST_CACHE_CONTROL,
    { manifest: true },
  );
  const pointerArtifact = includeCurrentPointer
    ? createPointerArtifact(releaseId)
    : null;

  const artifacts = [...applicationArtifacts, manifestArtifact, ...imageArtifacts];
  if (pointerArtifact) artifacts.push(pointerArtifact);
  assertUniqueArtifactKeys(artifacts);

  const publicationPackage = Object.freeze({
    releaseId,
    releasePrefix: releasePrefix(releaseId),
    manifest: resolvedManifest,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze(artifact))),
    pointer: pointerArtifact ? Object.freeze({ ...pointerArtifact }) : null,
  });
  assertPublicationPackageReady(publicationPackage);
  return publicationPackage;
}

/**
 * Performs the final, side-effect-free publication preflight. Unlike the
 * source validators, this checks the assembled artifact graph: every manifest
 * image must have exactly one matching object, every object must be confined
 * to the release prefix (except the explicit current pointer), and the
 * generated key must be derived from the release ID and product UUID only.
 *
 * The result contains safe issue metadata and never includes artifact bodies
 * or user-controlled product text.
 */
export function verifyPublicationPackage(publicationPackage) {
  const issues = [];
  if (!isRecord(publicationPackage)) {
    addPublicationIssue(issues, 'INVALID_PUBLICATION_PACKAGE', 'publicationPackage',
      'publicationPackage must be an object');
    return publicationValidationResult(issues);
  }

  const { releaseId } = publicationPackage;
  try {
    assertSafeReleaseId(releaseId);
  } catch (error) {
    addPublicationIssue(issues, error.code ?? 'INVALID_RELEASE_ID', 'releaseId',
      'releaseId must be a safe single path component');
  }
  const expectedPrefix = typeof releaseId === 'string' ? releasePrefix(releaseId) : null;
  if (publicationPackage.releasePrefix !== expectedPrefix) {
    addPublicationIssue(issues, 'INVALID_RELEASE_PREFIX', 'releasePrefix',
      'releasePrefix must match releases/<releaseId>/');
  }

  const manifestValidation = validateManifest(publicationPackage.manifest);
  if (!manifestValidation.valid) {
    addPublicationIssues(issues, manifestValidation.issues, 'MANIFEST_INVALID');
  }
  const products = Array.isArray(publicationPackage.manifest?.products)
    ? publicationPackage.manifest.products
    : [];
  const expectedImageKeys = new Map();
  products.forEach((product, index) => {
    if (!isRecord(product) || !isUuid(product.id) || expectedPrefix === null) return;
    let expectedKey;
    try {
      expectedKey = createControlledImageKey(releaseId, product.id);
    } catch (error) {
      addPublicationIssue(
        issues,
        error.code ?? 'INVALID_IMAGE_REFERENCE',
        `manifest.products[${index}].image.key`,
        'manifest image key cannot be derived from controlled release and product identifiers',
      );
      return;
    }
    expectedImageKeys.set(expectedKey, product.id);
    if (product.image?.key !== expectedKey) {
      addPublicationIssue(
        issues,
        'IMAGE_REFERENCE_MISMATCH',
        `manifest.products[${index}].image.key`,
        'manifest image key must be derived from the release ID and product UUID',
        product.id,
      );
    }
  });

  if (!Array.isArray(publicationPackage.artifacts)) {
    addPublicationIssue(issues, 'INVALID_PUBLICATION_ARTIFACTS', 'artifacts',
      'artifacts must be an array');
    return publicationValidationResult(issues);
  }

  const artifactsByKey = new Map();
  publicationPackage.artifacts.forEach((artifact, index) => {
    const path = `artifacts[${index}]`;
    if (!isRecord(artifact)) {
      addPublicationIssue(issues, 'INVALID_PUBLICATION_ARTIFACT', path,
        `${path} must be an object`);
      return;
    }
    if (typeof artifact.key !== 'string' || !isSafeObjectKey(artifact.key)) {
      addPublicationIssue(issues, 'UNSAFE_ARTIFACT_KEY', `${path}.key`,
        `${path}.key must be a safe relative object key`);
      return;
    }
    if (artifactsByKey.has(artifact.key)) {
      addPublicationIssue(issues, 'ARTIFACT_PATH_COLLISION', `${path}.key`,
        `artifact key ${artifact.key} is duplicated`);
    } else {
      artifactsByKey.set(artifact.key, artifact);
    }
    if (expectedPrefix !== null
      && artifact.key !== PUBLICATION_POINTER_KEY
      && !artifact.key.startsWith(expectedPrefix)) {
      addPublicationIssue(issues, 'ARTIFACT_OUTSIDE_RELEASE_PREFIX', `${path}.key`,
        'artifact key must remain inside the release prefix');
    }
    if (!(artifact.body instanceof Uint8Array)) {
      addPublicationIssue(issues, 'INVALID_PUBLICATION_ARTIFACT_BODY', `${path}.body`,
        `${path}.body must be a byte sequence`);
    }
    if (typeof artifact.contentType !== 'string' || artifact.contentType.length === 0) {
      addPublicationIssue(issues, 'INVALID_PUBLICATION_CONTENT_TYPE', `${path}.contentType`,
        `${path}.contentType must be a non-empty string`);
    }
    if (typeof artifact.cacheControl !== 'string' || artifact.cacheControl.length === 0) {
      addPublicationIssue(issues, 'INVALID_PUBLICATION_CACHE_CONTROL', `${path}.cacheControl`,
        `${path}.cacheControl must be a non-empty string`);
    }

    const expectedMetadata = expectedArtifactMetadata(artifact.key, expectedPrefix);
    if (expectedMetadata !== null) {
      if (artifact.contentType !== expectedMetadata.contentType) {
        addPublicationIssue(issues, 'NON_DETERMINISTIC_ARTIFACT_CONTENT_TYPE', `${path}.contentType`,
          `${path}.contentType must be ${expectedMetadata.contentType}`);
      }
      if (artifact.cacheControl !== expectedMetadata.cacheControl) {
        addPublicationIssue(issues, 'NON_DETERMINISTIC_ARTIFACT_CACHE_CONTROL', `${path}.cacheControl`,
          `${path}.cacheControl must be ${expectedMetadata.cacheControl}`);
      }
    }
  });

  const manifestKey = expectedPrefix === null ? null : `${expectedPrefix}${PUBLICATION_MANIFEST_FILENAME}`;
  const manifestArtifact = manifestKey === null ? null : artifactsByKey.get(manifestKey);
  if (!manifestArtifact) {
    addPublicationIssue(issues, 'MISSING_MANIFEST_ARTIFACT', 'artifacts',
      'artifacts must include the release manifest');
  } else {
    verifyManifestArtifact(manifestArtifact, publicationPackage.manifest, issues);
  }
  const indexKey = expectedPrefix === null ? null : `${expectedPrefix}index.html`;
  if (indexKey !== null && !artifactsByKey.has(indexKey)) {
    addPublicationIssue(issues, 'MISSING_APPLICATION_ENTRYPOINT', 'artifacts',
      'artifacts must include the release index.html');
  }

  for (const [imageKey, productId] of expectedImageKeys) {
    const artifact = artifactsByKey.get(imageKey);
    if (!artifact) {
      addPublicationIssue(issues, 'MISSING_IMAGE_ARTIFACT', imageKey,
        `manifest image for product ${productId} has no matching artifact`, productId);
      continue;
    }
    if (artifact.contentType !== IMAGE_OBJECT_CONTENT_TYPE) {
      addPublicationIssue(issues, 'INVALID_IMAGE_ARTIFACT_CONTENT_TYPE', imageKey,
        `image artifact for product ${productId} must be ${IMAGE_OBJECT_CONTENT_TYPE}`, productId);
    }
    if (!(artifact.body instanceof Uint8Array) || artifact.body.byteLength === 0) {
      addPublicationIssue(issues, 'EMPTY_IMAGE_ARTIFACT', imageKey,
        `image artifact for product ${productId} must contain bytes`, productId);
    }
  }

  for (const [key] of artifactsByKey) {
    if (expectedPrefix !== null && key.startsWith(`${expectedPrefix}images/`)
      && !expectedImageKeys.has(key)) {
      addPublicationIssue(issues, 'ORPHAN_IMAGE_ARTIFACT', key,
        'image artifacts must correspond one-to-one with manifest image references');
    }
  }

  const pointerArtifact = artifactsByKey.get(PUBLICATION_POINTER_KEY);
  if (publicationPackage.pointer === null || publicationPackage.pointer === undefined) {
    if (pointerArtifact) {
      addPublicationIssue(issues, 'UNEXPECTED_CURRENT_POINTER', PUBLICATION_POINTER_KEY,
        'current pointer artifact is not allowed when pointer is omitted');
    }
  } else {
    verifyPointer(publicationPackage.pointer, pointerArtifact, releaseId, expectedPrefix, issues);
  }

  return publicationValidationResult(issues);
}

/**
 * Throws a typed error when the assembled package is not safe to deliver or
 * materialize. Keeping this assertion at both boundaries protects callers
 * that construct or mutate package objects outside the assembler.
 */
export function assertPublicationPackageReady(publicationPackage) {
  const validation = verifyPublicationPackage(publicationPackage);
  if (!validation.valid) {
    throw new PublicationPackageError('Publication package failed final verification', {
      code: 'PUBLICATION_PACKAGE_PREFLIGHT_FAILED',
      errors: validation.errors,
      issues: validation.issues,
    });
  }
  return publicationPackage;
}

function expectedArtifactMetadata(key, expectedPrefix) {
  if (key === PUBLICATION_POINTER_KEY) {
    return {
      contentType: 'application/json',
      cacheControl: CURRENT_POINTER_CACHE_CONTROL,
    };
  }
  if (expectedPrefix === null || !key.startsWith(expectedPrefix)) return null;
  if (key === `${expectedPrefix}${PUBLICATION_MANIFEST_FILENAME}`) {
    return {
      contentType: 'application/json',
      cacheControl: MANIFEST_CACHE_CONTROL,
    };
  }
  if (isControlledImageObjectKey(key)) {
    return {
      contentType: IMAGE_OBJECT_CONTENT_TYPE,
      cacheControl: RELEASE_CACHE_CONTROL,
    };
  }
  return {
    contentType: inferContentType(key.slice(expectedPrefix.length)),
    cacheControl: RELEASE_CACHE_CONTROL,
  };
}

function verifyManifestArtifact(artifact, manifest, issues) {
  if (artifact.contentType !== 'application/json') {
    addPublicationIssue(issues, 'INVALID_MANIFEST_ARTIFACT_CONTENT_TYPE', artifact.key,
      'manifest artifact must use application/json');
  }
  if (!(artifact.body instanceof Uint8Array)) return;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(artifact.body));
    if (JSON.stringify(parsed) !== JSON.stringify(manifest)) {
      addPublicationIssue(issues, 'MANIFEST_ARTIFACT_MISMATCH', artifact.key,
        'manifest artifact content must match the assembled manifest');
    }
  } catch {
    addPublicationIssue(issues, 'INVALID_MANIFEST_ARTIFACT_JSON', artifact.key,
      'manifest artifact must contain valid JSON');
  }
}

function verifyPointer(pointer, artifact, releaseId, expectedPrefix, issues) {
  if (!isRecord(pointer)) {
    addPublicationIssue(issues, 'INVALID_CURRENT_POINTER', 'pointer',
      'pointer must be an artifact object');
    return;
  }
  if (!artifact) {
    addPublicationIssue(issues, 'MISSING_CURRENT_POINTER_ARTIFACT', PUBLICATION_POINTER_KEY,
      'pointer metadata must have a matching artifact');
    return;
  }
  if (pointer.key !== PUBLICATION_POINTER_KEY || pointer.key !== artifact.key) {
    addPublicationIssue(issues, 'INVALID_CURRENT_POINTER', 'pointer.key',
      'pointer must use the explicit current pointer key');
  }
  if (pointer.contentType !== 'application/json' || artifact.contentType !== 'application/json') {
    addPublicationIssue(issues, 'INVALID_POINTER_ARTIFACT_CONTENT_TYPE', artifact.key,
      'current pointer artifact must use application/json');
  }
  if (!(pointer.body instanceof Uint8Array) || !(artifact.body instanceof Uint8Array)
    || !bytesEqual(pointer.body, artifact.body)) {
    addPublicationIssue(issues, 'INVALID_CURRENT_POINTER', 'pointer.body',
      'pointer metadata must match the current pointer artifact');
  }
  if (!(artifact.body instanceof Uint8Array)) return;
  try {
    const expected = { releaseId, manifest: `${expectedPrefix}${PUBLICATION_MANIFEST_FILENAME}` };
    const parsed = JSON.parse(new TextDecoder().decode(artifact.body));
    if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
      addPublicationIssue(issues, 'INVALID_CURRENT_POINTER', 'pointer.body',
        'pointer must reference the assembled release manifest');
    }
  } catch {
    addPublicationIssue(issues, 'INVALID_CURRENT_POINTER', 'pointer.body',
      'pointer artifact must contain valid JSON');
  }
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function addPublicationIssue(issues, code, path, message, productId = null) {
  issues.push(Object.freeze({ code, path, index: null, productId, field: null, message }));
}

function addPublicationIssues(target, source, fallbackCode) {
  source.forEach((issue) => target.push(Object.freeze({
    ...issue,
    code: issue.code ?? fallbackCode,
  })));
}

function publicationValidationResult(issues) {
  return Object.freeze({
    valid: issues.length === 0,
    errors: Object.freeze(issues.map(({ message }) => message)),
    issues: Object.freeze([...issues]),
  });
}

function resolveManifest({ manifest, exportPackage, releaseId, generatedAt }) {
  if (exportPackage !== undefined) {
    const packageValidation = validateExportPackage(exportPackage);
    if (!packageValidation.valid) {
      throw new PublicationPackageError('Export package is invalid', {
        code: 'EXPORT_PACKAGE_INVALID',
        errors: packageValidation.errors,
        issues: packageValidation.issues,
      });
    }
    return generateManifest(exportPackage, releaseId, { generatedAt });
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new PublicationPackageError('Public manifest is invalid', {
      code: 'MANIFEST_INVALID',
      errors: validation.errors,
      issues: validation.issues,
    });
  }
  return manifest;
}

function resolveImages({ images, exportPackage }) {
  const source = images ?? exportPackage?.images;
  if (!Array.isArray(source)) {
    throw packageError('images must be supplied as an array or through exportPackage', 'IMAGES_REQUIRED');
  }
  return source;
}

function normalizeApplication(application, releaseId) {
  const entries = applicationEntries(application);
  if (entries.length === 0) {
    throw packageError('application must include at least index.html', 'APPLICATION_REQUIRED');
  }

  const seen = new Set();
  const normalized = entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw packageError(`application[${index}] must be an object`, 'INVALID_APPLICATION_FILE');
    }
    const relativePath = normalizeRelativePath(entry.path, `application[${index}].path`);
    const body = toBytes(entry.body ?? entry.data ?? entry.content, `application[${index}]`);
    const inferredContentType = inferContentType(relativePath);
    const contentType = entry.contentType === undefined
      ? inferredContentType
      : entry.contentType;
    if (typeof contentType !== 'string' || contentType !== inferredContentType) {
      throw packageError(
        `application[${index}].contentType must be ${inferredContentType}`,
        'INVALID_APPLICATION_CONTENT_TYPE',
      );
    }
    if (seen.has(relativePath)) {
      throw packageError(`Application path collides with another artifact: ${relativePath}`, 'ARTIFACT_PATH_COLLISION');
    }
    seen.add(relativePath);
    scanForSecrets(body, contentType, relativePath);
    return {
      key: relativePath,
      body,
      contentType,
      cacheControl: RELEASE_CACHE_CONTROL,
    };
  });

  if (!seen.has('index.html')) {
    throw packageError('application must include index.html', 'APPLICATION_ENTRYPOINT_MISSING');
  }

  return normalized
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((artifact) => ({
      ...artifact,
      key: `${releasePrefix(releaseId)}${artifact.key}`,
    }));
}

function applicationEntries(application) {
  if (Array.isArray(application)) return application;
  if (!isRecord(application)) return [];
  if (Array.isArray(application.files)) return application.files;

  const entries = [];
  if (application.indexHtml !== undefined) {
    entries.push({ path: 'index.html', data: application.indexHtml, contentType: 'text/html' });
  }
  if (application.assets !== undefined) {
    entries.push(...applicationEntriesFromAssets(application.assets));
  }
  if (entries.length > 0) return entries;

  return Object.entries(application).map(([path, data]) => ({ path, data }));
}

function applicationEntriesFromAssets(assets) {
  if (Array.isArray(assets)) return assets;
  if (!isRecord(assets)) {
    throw packageError('application.assets must be an array or object', 'INVALID_APPLICATION_ASSETS');
  }
  return Object.entries(assets).map(([assetPath, data]) => ({ path: assetPath, data }));
}

function normalizeImageArtifacts(imageRecords, manifest, releaseId) {
  const products = manifest.products;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const seen = new Set();
  const artifacts = [];

  imageRecords.forEach((image, index) => {
    if (!isRecord(image) || !isUuid(image.productId)) {
      throw packageError(`images[${index}].productId must be a UUID`, 'INVALID_IMAGE_PRODUCT_ID');
    }
    if (seen.has(image.productId)) {
      throw packageError(`images[${index}].productId must be unique`, 'DUPLICATE_IMAGE_PRODUCT_ID');
    }
    const product = productsById.get(image.productId);
    if (!product) {
      throw packageError(`images[${index}].productId must reference a manifest product`, 'ORPHAN_IMAGE');
    }
    if (image.contentType !== IMAGE_CONTENT_TYPE) {
      throw packageError(`images[${index}].contentType must be ${IMAGE_CONTENT_TYPE}`, 'INVALID_IMAGE_CONTENT_TYPE');
    }

    const expectedKey = createControlledImageKey(releaseId, image.productId);
    if (product.image.key !== expectedKey || product.image.contentType !== IMAGE_OBJECT_CONTENT_TYPE) {
      throw packageError(`Manifest image reference for ${image.productId} does not match release`, 'IMAGE_REFERENCE_MISMATCH');
    }

    artifacts.push({
      key: expectedKey,
      body: decodeImage(image.data, index),
      contentType: IMAGE_OBJECT_CONTENT_TYPE,
      cacheControl: RELEASE_CACHE_CONTROL,
    });
    seen.add(image.productId);
  });

  for (const product of products) {
    if (!seen.has(product.id)) {
      throw packageError(`No image supplied for product ${product.id}`, 'MISSING_PRODUCT_IMAGE');
    }
  }

  return artifacts.sort((left, right) => left.key.localeCompare(right.key));
}

function createJsonArtifact(key, value, cacheControl, { manifest = false } = {}) {
  const serialized = manifest
    ? serializeManifest(value, { pretty: true })
    : JSON.stringify(value, null, 2);
  const body = textBytes(`${serialized}\n`);
  scanForSecrets(body, 'application/json', key);
  return {
    key,
    body,
    contentType: 'application/json',
    cacheControl,
  };
}

function createPointerArtifact(releaseId) {
  const pointer = {
    releaseId,
    manifest: `${releasePrefix(releaseId)}${PUBLICATION_MANIFEST_FILENAME}`,
  };
  return createJsonArtifact(PUBLICATION_POINTER_KEY, pointer, CURRENT_POINTER_CACHE_CONTROL);
}

function createControlledImageKey(releaseId, productId) {
  try {
    return createImageObjectKey(releaseId, productId);
  } catch (error) {
    if (error instanceof ImageObjectKeyError) {
      throw packageError(error.message, error.code);
    }
    throw error;
  }
}

function assertReleaseId(releaseId) {
  try {
    assertSafeReleaseId(releaseId);
  } catch (error) {
    if (error instanceof ImageObjectKeyError) throw packageError(error.message, error.code);
    throw error;
  }
}

function assertUniqueArtifactKeys(artifacts) {
  const keys = new Set();
  for (const artifact of artifacts) {
    if (!isSafeObjectKey(artifact.key)) {
      throw packageError('Artifact key must be a safe relative object key', 'UNSAFE_ARTIFACT_KEY');
    }
    if (keys.has(artifact.key)) {
      throw packageError(`Artifact key collides with another artifact: ${artifact.key}`, 'ARTIFACT_PATH_COLLISION');
    }
    keys.add(artifact.key);
  }
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/')
    || value.includes('\\') || value.includes('..') || !isSafeObjectKey(value)
    || value.startsWith('releases/')) {
    throw packageError(`${label} must be a safe path inside the release`, 'UNSAFE_APPLICATION_PATH');
  }
  return value;
}

function inferContentType(relativePath) {
  const dot = relativePath.lastIndexOf('.');
  return MIME_TYPES_BY_EXTENSION[dot === -1 ? '' : relativePath.slice(dot).toLowerCase()]
    ?? 'application/octet-stream';
}

function decodeImage(value, index) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (!isProcessedJpeg(value)) {
    throw packageError(`images[${index}].data must be a processed JPEG data URI or bytes`, 'INVALID_IMAGE_DATA');
  }
  const encoded = value.slice(value.indexOf(',') + 1);
  try {
    const binary = globalThis.atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw packageError(`images[${index}].data is not valid base64`, 'INVALID_IMAGE_DATA');
  }
}

function toBytes(value, label) {
  if (typeof value === 'string') return textBytes(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw packageError(`${label} must contain string or byte content`, 'INVALID_APPLICATION_FILE_BODY');
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function scanForSecrets(bytes, contentType, path) {
  if (!contentType.startsWith('text/') && !contentType.includes('json') && contentType !== 'application/javascript') return;
  const source = new TextDecoder().decode(bytes);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(source))) {
    throw packageError(`Application asset contains a secret-like value: ${path}`, 'PUBLICATION_SECRET_DETECTED');
  }
}

function releasePrefix(releaseId) {
  return `releases/${releaseId}/`;
}

function packageError(message, code) {
  return new PublicationPackageError(message, { code, errors: [message] });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
