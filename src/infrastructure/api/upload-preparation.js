import { IMAGE_CONTENT_TYPE, UPLOAD_STATUS } from '../../domain/catalog-contracts.js';
import { isUuid } from '../../domain/catalog-contract-primitives.js';
import { LimitExceededError, UploadInvalidError } from '../../domain/errors.js';

const OWNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHECKSUM_PATTERN = /^[A-Za-z0-9+/=_:-]{8,256}$/u;
const DEFAULT_SERVER_SIDE_ENCRYPTION = 'AES256';
const DEFAULT_UPLOAD_PREFIX = 'uploads/pending';
const MAX_PRESIGNED_URL_MINUTES = 7 * 24 * 60;

/**
 * Creates the application service for POST /uploads/prepare.
 *
 * The persistence and signing ports are injected so this module can be tested
 * without AWS. The runtime adapter supplies those ports in the deployed
 * execution environment.
 */
export function createUploadPreparationService({
  bucketName,
  uploadUrlTtlMinutes = 15,
  maxImageBytes,
  serverSideEncryption = DEFAULT_SERVER_SIDE_ENCRYPTION,
  uploadPrefix = DEFAULT_UPLOAD_PREFIX,
  createPresignedPutObject,
  saveUploadSession,
  now = () => Date.now(),
  createUploadId = createUuid,
}) {
  validateConfiguration({
    bucketName,
    uploadUrlTtlMinutes,
    maxImageBytes,
    serverSideEncryption,
    uploadPrefix,
    createPresignedPutObject,
    saveUploadSession,
  });

  return Object.freeze({
    prepare: async ({ ownerId, contentType, contentLength, checksum }) => {
      validateRequest({ ownerId, contentType, contentLength, checksum, maxImageBytes });

      const uploadId = createUploadId();
      if (!isUuid(uploadId)) {
        throw new UploadInvalidError('Upload identifier generation failed', {
          field: 'uploadId',
        });
      }

      const objectKey = `${uploadPrefix}/${ownerId}/${uploadId}.jpg`;
      const expiresIn = uploadUrlTtlMinutes * 60;
      const expiresAt = Math.floor(now() / 1000) + expiresIn;
      const signedHeaders = Object.freeze({
        'content-type': IMAGE_CONTENT_TYPE,
        'content-length': String(contentLength),
        'x-amz-checksum-sha256': checksum,
        'x-amz-server-side-encryption': serverSideEncryption,
        'x-amz-meta-upload-id': uploadId,
      });
      const metadata = Object.freeze({ 'upload-id': uploadId });

      // Signing precedes persistence so a signer/provider failure cannot leave
      // an unusable pending session. Neither URL nor checksum is persisted in
      // logs; the URL is returned only in this transient response.
      const presignedUrl = await createPresignedPutObject({
        bucketName,
        objectKey,
        expiresIn,
        contentType: IMAGE_CONTENT_TYPE,
        contentLength,
        checksum,
        serverSideEncryption,
        metadata,
        signedHeaders,
      });
      if (typeof presignedUrl !== 'string' || presignedUrl.length === 0) {
        throw new UploadInvalidError('The upload URL could not be generated');
      }

      const session = Object.freeze({
        uploadId,
        ownerId,
        objectKey,
        contentType: IMAGE_CONTENT_TYPE,
        contentLength,
        checksum,
        signedHeaders,
        metadata,
        serverSideEncryption,
        status: UPLOAD_STATUS.PENDING,
        expiresAt,
        productId: null,
        createdAt: now(),
      });
      await saveUploadSession(session);

      return Object.freeze({
        uploadId,
        objectKey,
        presignedUrl,
        contentType: IMAGE_CONTENT_TYPE,
        contentLength,
        expiresAt,
        headers: signedHeaders,
      });
    },
  });
}

function validateConfiguration({
  bucketName,
  uploadUrlTtlMinutes,
  maxImageBytes,
  serverSideEncryption,
  uploadPrefix,
  createPresignedPutObject,
  saveUploadSession,
}) {
  if (typeof bucketName !== 'string' || bucketName.trim() === '') {
    throw new Error('UPLOADS_BUCKET_NAME is required');
  }
  if (!Number.isInteger(uploadUrlTtlMinutes)
      || uploadUrlTtlMinutes <= 0
      || uploadUrlTtlMinutes > MAX_PRESIGNED_URL_MINUTES) {
    throw new Error(`uploadUrlTtlMinutes must be an integer between 1 and ${MAX_PRESIGNED_URL_MINUTES}`);
  }
  if (!Number.isInteger(maxImageBytes) || maxImageBytes <= 0) {
    throw new Error('maxImageBytes must be a positive integer');
  }
  if (typeof serverSideEncryption !== 'string' || serverSideEncryption !== DEFAULT_SERVER_SIDE_ENCRYPTION) {
    throw new Error('serverSideEncryption must be AES256');
  }
  if (typeof uploadPrefix !== 'string' || !/^uploads\/[a-z0-9-]+$/u.test(uploadPrefix)) {
    throw new Error('uploadPrefix must be a controlled uploads prefix');
  }
  if (typeof createPresignedPutObject !== 'function') {
    throw new Error('createPresignedPutObject is required');
  }
  if (typeof saveUploadSession !== 'function') {
    throw new Error('saveUploadSession is required');
  }
}

function validateRequest({ ownerId, contentType, contentLength, checksum, maxImageBytes }) {
  if (typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new UploadInvalidError('A controlled owner identifier is required', { field: 'ownerId' });
  }
  if (contentType !== IMAGE_CONTENT_TYPE) {
    throw new UploadInvalidError('Only JPEG images are accepted', { field: 'contentType' });
  }
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    throw new UploadInvalidError('Image size must be a positive integer', { field: 'contentLength' });
  }
  if (contentLength > maxImageBytes) {
    throw new LimitExceededError('Image size exceeds the configured limit', {
      status: 422,
      details: { field: 'contentLength' },
    });
  }
  if (typeof checksum !== 'string' || !CHECKSUM_PATTERN.test(checksum)) {
    throw new UploadInvalidError('A valid checksum is required', { field: 'checksum' });
  }
}

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('A UUID generator is required to prepare an upload');
}
