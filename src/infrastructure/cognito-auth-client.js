const DEFAULT_SESSION_KEY = 'stage3.cognito.session';
const DEFAULT_PKCE_KEY_PREFIX = 'stage3.cognito.pkce.';
const REFRESH_SKEW_SECONDS = 60;

/**
 * Browser-only Cognito public-client session. It uses Authorization Code +
 * PKCE and sessionStorage; it never requests or stores AWS credentials.
 */
export class CognitoAuthSession {
  constructor({
    issuer,
    oauthEndpoint = issuer,
    clientId,
    redirectUri,
    logoutUri,
    scopes = ['openid'],
    storage = globalThis.sessionStorage,
    fetchImpl = globalThis.fetch,
    cryptoImpl = globalThis.crypto,
    clock = () => Date.now(),
    location = globalThis.location,
    sessionKey = DEFAULT_SESSION_KEY,
  } = {}) {
    this.config = validateConfig({ issuer, oauthEndpoint, clientId, redirectUri, logoutUri, scopes });
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.crypto = cryptoImpl;
    this.clock = clock;
    this.location = location;
    this.sessionKey = sessionKey;
  }

  async beginLogin({ state = randomToken(this.crypto), extraParams = {} } = {}) {
    const request = await createPkceAuthorizationRequest({
      ...this.config,
      state,
      storage: this.storage,
      cryptoImpl: this.crypto,
    });
    for (const [key, value] of Object.entries(extraParams)) {
      if (typeof key === 'string' && typeof value === 'string' && !request.url.searchParams.has(key)) {
        request.url.searchParams.set(key, value);
      }
    }
    return request.url.toString();
  }

  async completeLogin({ code, state }) {
    const tokenSet = await exchangeAuthorizationCode({
      ...this.config,
      code,
      state,
      storage: this.storage,
      fetchImpl: this.fetchImpl,
      clock: this.clock,
    });
    this._save(tokenSet);
    return Object.freeze({ ...tokenSet });
  }

  restore() {
    const session = readJson(this.storage, this.sessionKey);
    if (!session || typeof session.refreshToken !== 'string') return null;
    if (isExpiredWithoutRefresh(session, this.clock())) {
      this.clear();
      return null;
    }
    return Object.freeze({ ...session });
  }

  async accessToken() {
    let session = this.restore();
    if (!session) return null;
    if (!needsRefresh(session, this.clock())) return session.accessToken;
    session = await this.refresh(session);
    return session?.accessToken ?? null;
  }

  async refresh(session = this.restore()) {
    if (!session?.refreshToken) return null;
    const response = await this.fetchImpl(`${this.config.oauthEndpoint}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: session.refreshToken,
      }).toString(),
    });
    if (!response.ok) {
      this.clear();
      return null;
    }
    const refreshed = await parseTokenResponse(response, this.clock, session.refreshToken);
    this._save(refreshed);
    return Object.freeze({ ...refreshed });
  }

  logout({ redirect = true } = {}) {
    this.clear();
    const url = new URL(`${this.config.oauthEndpoint}/logout`);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('logout_uri', this.config.logoutUri);
    if (redirect && this.location && typeof this.location.assign === 'function') {
      this.location.assign(url.toString());
    }
    return url.toString();
  }

  clear() {
    this.storage?.removeItem?.(this.sessionKey);
  }

  _save(tokenSet) {
    this.storage?.setItem?.(this.sessionKey, JSON.stringify(tokenSet));
  }
}

export async function createPkceAuthorizationRequest({
  issuer,
  oauthEndpoint = issuer,
  clientId,
  redirectUri,
  logoutUri,
  scopes = ['openid'],
  state,
  storage = globalThis.sessionStorage,
  cryptoImpl = globalThis.crypto,
  pkceKeyPrefix = DEFAULT_PKCE_KEY_PREFIX,
} = {}) {
  const config = validateConfig({ issuer, oauthEndpoint, clientId, redirectUri, logoutUri, scopes });
  const verifier = randomToken(cryptoImpl, 64);
  const challenge = await createCodeChallenge(verifier, cryptoImpl);
  const resolvedState = state ?? randomToken(cryptoImpl);
  const request = new URL(`${config.oauthEndpoint}/oauth2/authorize`);
  request.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state: resolvedState,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString();
  storage?.setItem?.(`${pkceKeyPrefix}${resolvedState}`, JSON.stringify({
    codeVerifier: verifier,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    issuer: config.issuer,
  }));
  return Object.freeze({ url: request, state: resolvedState });
}

export async function exchangeAuthorizationCode({
  issuer,
  oauthEndpoint = issuer,
  clientId,
  redirectUri,
  logoutUri,
  scopes = ['openid'],
  code,
  state,
  storage = globalThis.sessionStorage,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  pkceKeyPrefix = DEFAULT_PKCE_KEY_PREFIX,
} = {}) {
  const config = validateConfig({ issuer, oauthEndpoint, clientId, redirectUri, logoutUri, scopes });
  if (typeof code !== 'string' || code.length === 0 || typeof state !== 'string' || state.length === 0) {
    throw new Error('Authorization callback requires code and state');
  }
  const key = `${pkceKeyPrefix}${state}`;
  const transaction = readJson(storage, key);
  storage?.removeItem?.(key);
  if (!transaction || transaction.clientId !== config.clientId || transaction.redirectUri !== config.redirectUri) {
    throw new Error('Authorization callback state is invalid or expired');
  }

  const response = await fetchImpl(`${config.oauthEndpoint}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: transaction.codeVerifier,
    }).toString(),
  });
  if (!response.ok) throw new Error('Authorization code exchange failed');
  return parseTokenResponse(response, clock());
}

async function parseTokenResponse(response, clock, existingRefreshToken = undefined) {
  const payload = await response.json();
  if (!payload || typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new Error('Token response did not contain an access token');
  }
  const expiresIn = Number.isFinite(Number(payload.expires_in)) ? Number(payload.expires_in) : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? existingRefreshToken ?? null,
    idToken: payload.id_token ?? null,
    expiresAt: clock() + expiresIn * 1000,
  };
}

function validateConfig(config) {
  for (const field of ['issuer', 'oauthEndpoint', 'clientId', 'redirectUri', 'logoutUri']) {
    if (typeof config[field] !== 'string' || config[field].length === 0) throw new Error(`${field} is required`);
  }
  if (!Array.isArray(config.scopes) || config.scopes.length === 0 || config.scopes.some((scope) => typeof scope !== 'string')) {
    throw new Error('scopes must contain at least one string');
  }
  return {
    issuer: config.issuer.replace(/\/$/u, ''),
    oauthEndpoint: config.oauthEndpoint.replace(/\/$/u, ''),
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    logoutUri: config.logoutUri,
    scopes: [...config.scopes],
  };
}

function needsRefresh(session, now) {
  return Number(session.expiresAt) - now <= REFRESH_SKEW_SECONDS * 1000;
}

function isExpiredWithoutRefresh(session, now) {
  return !session.accessToken || (Number(session.expiresAt) <= now && !session.refreshToken);
}

function readJson(storage, key) {
  try {
    const value = storage?.getItem?.(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function randomToken(cryptoImpl, byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') throw new Error('Web Crypto is required for PKCE');
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

async function createCodeChallenge(verifier, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) throw new Error('Web Crypto SubtleCrypto is required for PKCE');
  const encoded = new TextEncoder().encode(verifier);
  const digest = await cryptoImpl.subtle.digest('SHA-256', encoded);
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
