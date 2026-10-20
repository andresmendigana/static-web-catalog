/**
 * Shared Stage 3 catalog contracts.
 *
 * This module intentionally contains contract declarations and stable runtime
 * constants only. Validation, normalization, projection, persistence, and
 * error translation belong to their respective application boundaries.
 *
 * Public DTOs are declared separately from backend records so internal
 * ownership, versioning, audit, and upload state cannot become part of the
 * Stage 2-compatible public manifest by accident.
 */

import { CATALOG_PRODUCT_LIMIT } from './catalog-limits.js';

export const EXPORT_SCHEMA_VERSION = 'stage2-export-v1';
export const MANIFEST_SCHEMA_VERSION = 'stage2-manifest-v1';
export const IMAGE_CONTENT_TYPE = 'image/jpeg';

export const PRICE_MODE = Object.freeze({
  AMOUNT: 'amount',
  INQUIRE: 'inquire',
});

/**
 * Lifecycle of an internal S3 upload session.
 * These values are backend state and must not be emitted in public manifests.
 */
export const UPLOAD_STATUS = Object.freeze({
  PENDING: 'pending',
  UPLOADED: 'uploaded',
  ASSOCIATED: 'associated',
  EXPIRED: 'expired',
});

/**
 * Lifecycle of an asynchronous catalog projection/publication.
 */
export const PUBLICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  RECONCILIATION_REQUIRED: 'reconciliation-required',
});

/**
 * Stable error codes returned by authenticated authoring boundaries.
 * Provider details, claims, URLs, and stack traces are never part of this DTO.
 */
export const ERROR_CODE = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN_OR_NOT_FOUND: 'FORBIDDEN_OR_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',
  UPLOAD_EXPIRED: 'UPLOAD_EXPIRED',
  UPLOAD_INVALID: 'UPLOAD_INVALID',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  PUBLICATION_FAILED: 'PUBLICATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

// Camel-case aliases match the naming convention used by existing domain
// status objects while the uppercase names remain convenient for wire values.
export const UploadSessionStatus = UPLOAD_STATUS;
export const PublicationStatus = PUBLICATION_STATUS;
export const StableErrorCode = ERROR_CODE;

/**
 * @typedef {{label: string, value: string}} CharacteristicDTO
 */

/**
 * @typedef {{key: string, contentType: 'image/jpeg'}} ProductImageReference
 */

/**
 * @typedef {{createdAt?: string, createdBy?: string, updatedAt?: string, updatedBy?: string}} AuditMetadata
 */

/**
 * Authoritative backend product record.
 *
 * `ownerId`, `version`, and `audit` are persistence/authorization fields. They
 * are deliberately not members of PublicProductDTO or PublicManifestProduct.
 * `image` may be a controlled S3 reference for server records or the existing
 * processed JPEG data URI while a local Stage 2 repository is in use.
 *
 * @typedef {Object} ProductRecord
 * @property {string} id Stable product UUID
 * @property {string} ownerId Cognito-derived internal owner key
 * @property {string} name Normalized product name
 * @property {'amount'|'inquire'} priceMode
 * @property {number|null} priceCOP Integer COP amount, or null for inquire
 * @property {string|ProductImageReference} image Processed local image or controlled S3 reference
 * @property {string|number} createdAt ISO UTC datetime or legacy epoch timestamp
 * @property {string|number} updatedAt ISO UTC datetime or epoch timestamp
 * @property {CharacteristicDTO[]} characteristics
 * @property {number} version Optimistic-concurrency version
 * @property {AuditMetadata} [audit] Internal audit metadata
 */

/**
 * Public product DTO shared by authoring responses and the public projection.
 * It is an explicit allowlist: no owner, version, audit, upload, or permission
 * fields belong here.
 *
 * @typedef {Object} PublicProductDTO
 * @property {string} id
 * @property {string} name
 * @property {'amount'|'inquire'} priceMode
 * @property {number|null} priceCOP
 * @property {string|number} createdAt
 * @property {CharacteristicDTO[]} characteristics
 * @property {ProductImageReference} image
 */

/**
 * Stage 2 export product. The processed JPEG data URI is retained because the
 * export package is the local, portable compatibility boundary.
 *
 * @typedef {Object} ExportProductDTO
 * @property {string} id
 * @property {string} name
 * @property {'amount'|'inquire'} priceMode
 * @property {number|null} priceCOP
 * @property {string} image Processed JPEG data URI
 * @property {string|number} createdAt
 * @property {CharacteristicDTO[]} characteristics
 */

/**
 * Internal upload session persisted by the authoring backend.
 *
 * @typedef {Object} UploadSession
 * @property {string} uploadId
 * @property {string} ownerId Cognito-derived internal owner key
 * @property {string} objectKey Controlled temporary S3 object key
 * @property {'image/jpeg'} contentType
 * @property {number} contentLength
 * @property {string} checksum Expected checksum
 * @property {Object} signedHeaders Headers bound into the presigned request
 * @property {Object} metadata Controlled non-PII metadata
 * @property {'pending'|'uploaded'|'associated'|'expired'} status
 * @property {number} expiresAt Epoch seconds
 * @property {string|null} productId Associated product UUID, when present
 * @property {string|number} createdAt
 */

/**
 * Safe response returned when an upload URL is prepared. The presigned URL is
 * transient API data only: it must never be persisted or logged, and it is not
 * part of UploadSession or any public catalog manifest.
 *
 * @typedef {Object} UploadPreparationDTO
 * @property {string} uploadId
 * @property {string} objectKey
 * @property {string} presignedUrl Short-lived URL used only by the direct browser upload
 * @property {'image/jpeg'} contentType
 * @property {number} contentLength
 * @property {number} expiresAt
 * @property {Object} headers Required signed request headers
 */

/**
 * @typedef {Object} PublicManifestProduct
 * @property {string} id
 * @property {string} name
 * @property {'amount'|'inquire'} priceMode
 * @property {number|null} priceCOP
 * @property {string|number} createdAt
 * @property {CharacteristicDTO[]} characteristics
 * @property {ProductImageReference} image
 */

/**
 * Stage 2-compatible public read contract.
 *
 * @typedef {Object} PublicManifest
 * @property {'stage2-manifest-v1'} schemaVersion
 * @property {string} generatedAt ISO-8601 UTC datetime
 * @property {100} catalogLimit
 * @property {PublicManifestProduct[]} products
 */

/**
 * @typedef {{productId: string, contentType: 'image/jpeg', data: string}} ExportImageDTO
 */

/**
 * Portable Stage 2 export consumed by migration and publication tooling.
 *
 * @typedef {Object} ExportPackage
 * @property {'stage2-export-v1'} schemaVersion
 * @property {string} generatedAt ISO-8601 UTC datetime
 * @property {ExportProductDTO[]} products
 * @property {ExportImageDTO[]} images
 */

/**
 * @typedef {Object} ImportIssue
 * @property {number|null} index
 * @property {string|null} productId
 * @property {string} code
 * @property {string} message Sanitized, actionable reason
 */

/**
 * Non-destructive import result. `accepted` and `rejected` are counts; details
 * are reported per source index/ID without embedding source payloads.
 *
 * @typedef {Object} ImportReport
 * @property {'stage2-export-v1'} sourceVersion
 * @property {number} accepted
 * @property {number} rejected
 * @property {ImportIssue[]} errors
 * @property {boolean} dryRun
 */

/**
 * @typedef {Object} PublicationState
 * @property {'pending'|'succeeded'|'failed'|'reconciliation-required'} status
 * @property {number} catalogVersion
 * @property {number|null} projectionVersion
 * @property {string|null} releaseId
 * @property {string} updatedAt ISO-8601 UTC datetime
 * @property {string|null} reason Sanitized failure/reconciliation reason
 */

/**
 * Stable sanitized API error DTO.
 *
 * @typedef {Object} StableErrorDTO
 * @property {'UNAUTHORIZED'|'FORBIDDEN_OR_NOT_FOUND'|'VALIDATION_ERROR'|'CONFLICT'|'IDEMPOTENCY_REPLAY'|'UPLOAD_EXPIRED'|'UPLOAD_INVALID'|'LIMIT_EXCEEDED'|'PUBLICATION_FAILED'|'INTERNAL_ERROR'} code
 * @property {string} message
 * @property {string} requestId
 * @property {Object<string, string|number|null>} [details]
 */

export { CATALOG_PRODUCT_LIMIT };
