/**
 * Punto de entrada de la aplicación
 */
import { CognitoAuthSession } from './infrastructure/cognito-auth-client.js';
import { LocalStorageRepository } from './infrastructure/local-storage-repository.js';
import { RemoteProductRepository } from './infrastructure/remote-product-repository.js';
import { createDirectUploadClient } from './infrastructure/direct-upload-client.js';
import { createBasicUI } from './ui/basic-ui.js';

export const RUNTIME_CONFIG_KEY = '__STATIC_WEB_CATALOG_CONFIG__';
export const AUTHORING_MODES = Object.freeze({ LOCAL: 'local', REMOTE: 'remote' });

/**
 * Creates the Cognito session only from an explicitly supplied configuration.
 * The session stores tokens in sessionStorage and exposes access-token methods;
 * persistent provider credentials are never accepted by the application root.
 */
export function createConfiguredAuthSession(config = {}, AuthSession = CognitoAuthSession) {
    if (config.authSession) return config.authSession;
    const cognitoConfig = config.cognito ?? config.cognitoConfig;
    if (!cognitoConfig) return null;
    if (typeof AuthSession !== 'function') throw new TypeError('AuthSession must be constructible');
    return new AuthSession(cognitoConfig);
}

/**
 * Selects the authoring repository at the application boundary. Local mode is
 * the safe default and is also used when remote Stage 3 configuration is
 * absent or cannot be constructed. A runtime network failure is not silently
 * switched to local storage, so the user cannot accidentally write to a
 * different catalog after an authenticated remote session fails.
 */
export function createConfiguredRuntime(
    config = globalThis[RUNTIME_CONFIG_KEY],
    {
        LocalRepository = LocalStorageRepository,
        RemoteRepository = RemoteProductRepository,
        AuthSession = CognitoAuthSession,
    } = {},
) {
    const runtimeConfig = config && typeof config === 'object' ? config : {};

    if (runtimeConfig.repository) {
        const authSession = runtimeConfig.mode === AUTHORING_MODES.LOCAL
            ? null
            : createConfiguredAuthSession(runtimeConfig, AuthSession);
        return Object.freeze({
            repository: runtimeConfig.repository,
            authSession,
            mode: runtimeConfig.mode === AUTHORING_MODES.LOCAL
                ? AUTHORING_MODES.LOCAL
                : AUTHORING_MODES.REMOTE,
        });
    }

    if (runtimeConfig.mode !== AUTHORING_MODES.REMOTE
        || typeof runtimeConfig.authoringApiBaseUrl !== 'string'
        || runtimeConfig.authoringApiBaseUrl.trim() === '') {
        return localRuntime(LocalRepository);
    }

    let authSession;
    try {
        authSession = createConfiguredAuthSession(runtimeConfig, AuthSession);
    } catch {
        return localRuntime(LocalRepository);
    }

    const getAccessToken = runtimeConfig.getAccessToken
        ?? (authSession ? () => authSession.accessToken() : null);
    const hasTokenProvider = typeof getAccessToken === 'function'
        || (typeof runtimeConfig.accessToken === 'string' && runtimeConfig.accessToken.length > 0);
    if (!hasTokenProvider) return localRuntime(LocalRepository);

    try {
        const repository = new RemoteRepository({
            baseUrl: runtimeConfig.authoringApiBaseUrl,
            fetchImpl: runtimeConfig.fetchImpl,
            authSession,
            getAccessToken,
            accessToken: runtimeConfig.accessToken,
            productsPath: runtimeConfig.productsPath,
            requestTimeoutMs: runtimeConfig.requestTimeoutMs,
        });
        return Object.freeze({ repository, authSession, mode: AUTHORING_MODES.REMOTE });
    } catch {
        return localRuntime(LocalRepository);
    }
}

export function createConfiguredRepository(config = globalThis[RUNTIME_CONFIG_KEY], dependencies) {
    return createConfiguredRuntime(config, dependencies).repository;
}

/**
 * Builds the optional authoring upload port from the same remote configuration
 * as the repository. The client receives only a short-lived upload URL; it
 * never receives cloud credentials or a storage client.
 */
export function createConfiguredUploadClient(
    config = globalThis[RUNTIME_CONFIG_KEY],
    authSession = config?.authSession ?? null,
    UploadClient = createDirectUploadClient,
) {
    if (!config?.authoringApiBaseUrl) return null;

    return UploadClient({
        baseUrl: config.authoringApiBaseUrl,
        authSession,
        getAccessToken: config.getAccessToken ?? (authSession ? () => authSession.accessToken() : null),
        accessToken: config.accessToken,
        requestTimeoutMs: config.requestTimeoutMs,
        fetchImpl: config.fetchImpl,
    });
}

function localRuntime(LocalRepository) {
    return Object.freeze({
        repository: new LocalRepository(),
        authSession: null,
        mode: AUTHORING_MODES.LOCAL,
    });
}

export async function initializeApp({
    config = globalThis[RUNTIME_CONFIG_KEY],
    uiFactory = createBasicUI,
    dependencies = {},
} = {}) {
    const runtimeConfig = config && typeof config === 'object' ? config : {};
    const runtime = createConfiguredRuntime(runtimeConfig, dependencies);
    const uploadClient = runtimeConfig.uploadClient
        ?? (runtime.mode === AUTHORING_MODES.REMOTE
            ? createConfiguredUploadClient(runtimeConfig, runtime.authSession, dependencies.UploadClient)
            : null);

    await uiFactory(runtime.repository, { uploadClient });
    return Object.freeze({ ...runtime, uploadClient });
}

function showInitializationError(error) {
    console.error('Failed to initialize app:', error);
    document.body.innerHTML = `
        <div style="padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; border-radius: 4px; margin: 20px;">
            <h3>Error de inicialización</h3>
            <p>${error.message}</p>
            <p><small>Verifica que tu navegador soporte localStorage y que no estés en modo privado.</small></p>
        </div>
    `;
}

async function startApplication() {
    try {
        await initializeApp();
        console.log('StaticWebCatalog initialized successfully');
    } catch (error) {
        showInitializationError(error);
    }
}

// El entrypoint de autoría solo arranca cuando existe un DOM. Esto permite
// probar la fábrica de composición en Node sin inicializar una vista.
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApplication, { once: true });
    } else {
        void startApplication();
    }
}
