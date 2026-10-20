import { AuthorizationError, InvalidProductError } from '../../domain/errors.js';

const SAFE_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Returns the owner context injected by the verified JWT authorizer.
 * Only the verified claim location is accepted; request bodies,
 * query parameters, and arbitrary event fields are never consulted.
 */
export function resolveAuthorContext(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AuthorizationError('A verified Cognito JWT is required');
  }

  const subject = claims.sub;
  const issuer = claims.iss;
  const audience = claims.aud;
  if (!isSafeSubject(subject) || typeof issuer !== 'string' || issuer.length === 0 || !hasAudience(audience)) {
    throw new AuthorizationError('The verified Cognito claims are incomplete');
  }

  return Object.freeze({
    ownerId: subject,
    subject,
    issuer,
    audience: Array.isArray(audience) ? [...audience] : audience,
    scopes: parseScopes(claims.scope ?? claims.scp),
  });
}

/**
 * Rejects client-controlled ownership fields before a handler reaches a
 * repository. Ownership is always derived from `resolveAuthorContext`.
 */
export function rejectClientOwnerOverride(event) {
  const ownerInQuery = event?.queryStringParameters?.ownerId
    ?? event?.multiValueQueryStringParameters?.ownerId;
  if (ownerInQuery !== undefined) {
    throw invalidOwnerOverride();
  }

  const body = parseBody(event);
  if (body && Object.prototype.hasOwnProperty.call(body, 'ownerId')) {
    throw invalidOwnerOverride();
  }
  return body;
}

export function requireAuthorScope(context, requiredScope) {
  if (!context?.scopes?.has(requiredScope)) {
    throw new AuthorizationError('The verified JWT does not grant the required scope');
  }
  return context;
}

function parseBody(event) {
  if (event?.body === undefined || event?.body === null || event.body === '') return null;
  if (typeof event.body === 'object' && !Array.isArray(event.body)) return event.body;
  if (typeof event.body !== 'string') return null;

  try {
    const decoded = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    const value = JSON.parse(decoded);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseScopes(value) {
  if (Array.isArray(value)) return new Set(value.filter((scope) => typeof scope === 'string'));
  if (typeof value === 'string') return new Set(value.split(/\s+/u).filter(Boolean));
  return new Set();
}

function hasAudience(value) {
  return (typeof value === 'string' && value.length > 0)
    || (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0));
}

function isSafeSubject(value) {
  return typeof value === 'string' && SAFE_SUBJECT.test(value);
}

function invalidOwnerOverride() {
  const error = new InvalidProductError('ownerId is derived from the verified JWT');
  error.code = 'INVALID_OWNER_ID';
  error.field = 'ownerId';
  return error;
}
