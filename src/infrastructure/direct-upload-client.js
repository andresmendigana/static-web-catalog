import {
  AuthorizationError,
  TransportError,
  UploadExpiredError,
  UploadInvalidError,
} from '../domain/errors.js';
import { isSafeObjectKey } from '../domain/catalog-contract-primitives.js';

const DEFAULT_PREPARE_PATH = '/uploads/prepare';
const IMAGE_CONTENT_TYPE = 'image/jpeg';
const SAFE_ERROR_CODES = new Set([
  'UNAUTHORIZED',
  'UPLOAD_EXPIRED',
  'UPLOAD_INVALID',
  'LIMIT_EXCEEDED',
  'VALIDATION_ERROR',
]);

/**
 * Browser port for the two-phase upload flow. The API receives only metadata;
 * the image bytes are sent to the presigned S3 URL returned by preparation.
 */
export function createDirectUploadClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  authSession = null,
  accessToken = null,
  getAccessToken = null,
  preparePath = DEFAULT_PREPARE_PATH,
  requestTimeoutMs = 15000,
  clock = () => Date.now(),
  cryptoImpl = globalThis.crypto,
  dataUriToBlob = dataUriToBlobDefault,
  checksum = checksumSha256,
} = {}) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new Error('Direct upload API base URL is required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  if (typeof dataUriToBlob !== 'function' || typeof checksum !== 'function') {
    throw new Error('Upload byte helpers are required');
  }

  const apiBaseUrl = new URL(`${baseUrl.replace(/\/+$/u, '')}/`);

  return Object.freeze({
    upload: async (dataUri, { signal } = {}) => {
      const blob = await dataUriToBlob(dataUri);
      if (!blob || typeof blob.arrayBuffer !== 'function') {
        throw new UploadInvalidError('The processed image is invalid');
      }
      const contentType = blob.type || IMAGE_CONTENT_TYPE;
      if (contentType !== IMAGE_CONTENT_TYPE) {
        throw new UploadInvalidError('Only JPEG images are accepted');
      }
      const bytes = await blob.arrayBuffer();
      const contentLength = bytes.byteLength;
      const checksumValue = await checksum(bytes, cryptoImpl);
      const preparation = await requestJson('POST', preparePath, {
        contentType,
        contentLength,
        checksum: checksumValue,
      }, { signal });

      assertPreparation(preparation, clock(), contentLength);
      const putHeaders = { ...(preparation.headers ?? {}) };
      if (!putHeaders['content-type']) putHeaders['content-type'] = contentType;

      await requestPresignedPut(preparation.presignedUrl, blob, putHeaders, { signal });
      const completion = await requestJson(
        'POST',
        `/uploads/${encodeURIComponent(preparation.uploadId)}/complete`,
        {},
        { signal },
      );

      return extractConfirmedReference(completion, preparation);
    },
  });

  async function requestJson(method, path, body, { signal } = {}) {
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    const token = await resolveAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;

    const controller = typeof AbortController === 'function' && requestTimeoutMs > 0
      ? new AbortController()
      : null;
    const timeout = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    try {
      const response = await fetchImpl(resolveUrl(path), {
        method,
        headers,
        body: JSON.stringify(body),
        ...(controller ? { signal: mergeAbortSignals(signal, controller.signal) } : { signal }),
      });
      const payload = await readPayload(response);
      if (!response.ok) throw mapUploadError(response.status, payload);
      return payload;
    } catch (error) {
      if (error?.code) throw error;
      throw new TransportError('The upload service is unavailable', { cause: error });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function requestPresignedPut(url, blob, headers, { signal } = {}) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new UploadInvalidError('The upload URL is invalid');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'PUT',
        headers,
        body: blob,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new TransportError('The image upload could not be completed', { cause: error });
    }
    if (response.ok) return;
    const payload = await readPayload(response);
    if (response.status === 401 || response.status === 403) {
      throw new UploadExpiredError('The upload URL has expired or is not authorized');
    }
    throw mapUploadError(response.status, payload);
  }

  async function resolveAccessToken() {
    if (typeof getAccessToken === 'function') {
      const token = await getAccessToken();
      if (!token) throw new AuthorizationError('A remote upload access token is required');
      return token;
    }
    if (authSession && typeof authSession.accessToken === 'function') {
      const token = await authSession.accessToken();
      if (!token) throw new AuthorizationError('A remote upload access token is required');
      return token;
    }
    if (typeof accessToken === 'string' && accessToken.length > 0) return accessToken;
    return null;
  }

  function resolveUrl(path) {
    return new URL(String(path).replace(/^\/+/, ''), apiBaseUrl).toString();
  }
}

function assertPreparation(preparation, nowMs, expectedContentLength) {
  if (!preparation || typeof preparation !== 'object') {
    throw new UploadInvalidError('The upload preparation response is invalid');
  }
  if (typeof preparation.uploadId !== 'string'
      || typeof preparation.objectKey !== 'string'
      || typeof preparation.presignedUrl !== 'string'
      || typeof preparation.contentType !== 'string'
      || !Number.isInteger(preparation.contentLength)
      || !Number.isFinite(Number(preparation.expiresAt))) {
    throw new UploadInvalidError('The upload preparation response is incomplete');
  }
  if (!isSafeObjectKey(preparation.objectKey)
      || preparation.contentType !== IMAGE_CONTENT_TYPE
      || preparation.contentLength !== expectedContentLength) {
    throw new UploadInvalidError('The prepared upload does not match the image');
  }
  if (Number(preparation.expiresAt) * 1000 <= nowMs) {
    throw new UploadExpiredError('The upload URL has expired');
  }
}

function extractConfirmedReference(payload, preparation) {
  const candidate = payload?.image ?? payload?.imageReference ?? payload?.upload?.image;
  const key = candidate?.key;
  const contentType = candidate?.contentType;
  if (typeof key !== 'string'
      || !isSafeObjectKey(key)
      || key !== preparation.objectKey
      || contentType !== IMAGE_CONTENT_TYPE) {
    throw new UploadInvalidError('The upload confirmation did not return a valid image reference');
  }
  return Object.freeze({ key, contentType: IMAGE_CONTENT_TYPE });
}

function mapUploadError(status, payload) {
  const code = payload?.error?.code ?? payload?.code;
  if (code === 'UNAUTHORIZED' || status === 401) {
    return new AuthorizationError('Remote upload authentication failed');
  }
  if (code === 'UPLOAD_EXPIRED' || status === 410) {
    return new UploadExpiredError('The upload URL has expired');
  }
  if (code === 'UPLOAD_INVALID' || code === 'VALIDATION_ERROR' || code === 'LIMIT_EXCEEDED'
      || status === 400 || status === 422) {
    return new UploadInvalidError('The upload was rejected by the authoring service');
  }
  return new TransportError('The upload service is unavailable', { status });
}

async function readPayload(response) {
  if (response?.status === 204) return null;
  if (typeof response?.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mergeAbortSignals(requestSignal, timeoutSignal) {
  if (!requestSignal) return timeoutSignal;
  if (typeof AbortSignal?.any === 'function') return AbortSignal.any([requestSignal, timeoutSignal]);
  return requestSignal;
}

async function dataUriToBlobDefault(dataUri) {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
    throw new UploadInvalidError('The processed image must be a data URI');
  }
  const match = /^data:([^;,]+)(;base64)?,(.*)$/u.exec(dataUri);
  if (!match) throw new UploadInvalidError('The processed image data URI is invalid');
  const contentType = match[1];
  const encoded = match[3];
  const binary = match[2]
    ? decodeBase64(encoded)
    : decodeURIComponent(encoded);
  const bytes = match[2]
    ? Uint8Array.from(binary, character => character.charCodeAt(0))
    : new TextEncoder().encode(binary);
  return new Blob([bytes], { type: contentType });
}

async function checksumSha256(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle?.digest) throw new UploadInvalidError('Web Crypto is required for image uploads');
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  return encodeBase64(new Uint8Array(digest));
}

function decodeBase64(value) {
  if (typeof atob === 'function') return atob(value);
  return Buffer.from(value, 'base64').toString('binary');
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

export { dataUriToBlobDefault, checksumSha256 };
