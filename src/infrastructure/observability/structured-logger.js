import { createHash } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_OPERATION = /^[A-Za-z0-9_./{} -]{1,128}$/u;

/**
 * Emits an allowlisted JSON record for CloudWatch. The logger deliberately
 * accepts individual fields instead of an event/error object so claims,
 * request bodies, signed URLs, checksums, and image metadata cannot leak by
 * accident.
 */
export function logOperation({
  requestId,
  correlationId,
  operation,
  result,
  durationMs,
  ownerId,
  statusCode,
  errorCode,
  phase,
  logger = console.log,
}) {
  const record = {
    requestId: safeId(requestId, 'unknown-request'),
    correlationId: safeId(correlationId, safeId(requestId, 'unknown-request')),
    operation: safeOperation(operation),
    result: safeResult(result),
    durationMs: safeDuration(durationMs),
  };
  if (ownerId !== undefined && ownerId !== null) record.ownerHash = anonymizeOwner(ownerId);
  if (Number.isInteger(statusCode)) record.status = statusCode;
  if (typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(errorCode)) record.errorCode = errorCode;
  if (typeof phase === 'string' && SAFE_OPERATION.test(phase)) record.phase = phase;
  logger(JSON.stringify(record));
  return Object.freeze(record);
}

export function correlationIdFromEvent(event, requestId) {
  const headers = event?.headers;
  if (!headers || typeof headers !== 'object') return safeId(requestId, 'unknown-request');
  const supplied = headers['x-correlation-id'] ?? headers['X-Correlation-Id'];
  return safeId(supplied, safeId(requestId, 'unknown-request'));
}

export function anonymizeOwner(ownerId) {
  const value = typeof ownerId === 'string' ? ownerId : String(ownerId ?? 'unknown-owner');
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function safeId(value, fallback) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : fallback;
}

function safeOperation(value) {
  return typeof value === 'string' && SAFE_OPERATION.test(value) ? value : 'unknown-operation';
}

function safeResult(value) {
  return new Set([
    'success',
    'succeeded',
    'error',
    'failed',
    'rejected',
    'pending',
    'expired',
    'reconciliation-required'
  ]).has(value) ? value : 'unknown';
}

function safeDuration(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
