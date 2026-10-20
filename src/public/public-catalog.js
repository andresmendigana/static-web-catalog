import { parseManifest } from '../application/use-cases/generate-manifest.js';
import {
  assertSafeReleaseId,
  isControlledImageObjectKey,
} from '../application/publication/image-object-keys.js';
import { validateManifest } from '../application/validation/catalog-contracts.js';
import { formatPriceCOP } from '../domain/price.js';

export const PUBLIC_MANIFEST_URL = 'manifest.json';
export const PUBLIC_CURRENT_POINTER_URLS = Object.freeze([
  'releases/current.json',
  '../current.json',
]);
export const PUBLIC_READ_ONLY_NOTICE = 'Catálogo publicado · solo lectura';
export const PUBLIC_CATALOG_ERROR_MESSAGES = Object.freeze({
  PUBLIC_MANIFEST_NOT_FOUND: 'No se encontró el catálogo publicado. Intenta nuevamente más tarde.',
  PUBLIC_MANIFEST_NETWORK_ERROR: 'No fue posible conectarse al catálogo publicado. Intenta nuevamente más tarde.',
  PUBLIC_MANIFEST_HTTP_ERROR: 'El catálogo publicado no está disponible. Intenta nuevamente más tarde.',
  PUBLIC_MANIFEST_READ_FAILED: 'No fue posible leer el catálogo publicado. Intenta nuevamente más tarde.',
  PUBLIC_MANIFEST_RESPONSE_INVALID: 'El catálogo publicado no entregó un manifiesto legible.',
  PUBLIC_MANIFEST_INVALID_JSON: 'El catálogo publicado no contiene un manifiesto JSON legible.',
  PUBLIC_MANIFEST_INVALID_UTF8: 'El catálogo publicado no contiene un manifiesto de texto legible.',
  PUBLIC_MANIFEST_SCHEMA_INCOMPATIBLE: 'El catálogo publicado usa un formato incompatible.',
  PUBLIC_MANIFEST_IMAGE_REFERENCE_INVALID: 'El catálogo publicado contiene referencias de imágenes inválidas.',
  PUBLIC_POINTER_INVALID: 'La publicación actual no es válida.',
  PUBLIC_CATALOG_GRID_MISSING: 'La vista pública no está disponible.',
  PUBLIC_DOCUMENT_UNAVAILABLE: 'La vista pública no está disponible.',
});

/**
 * Error raised when a public catalog cannot be fetched or does not satisfy the
 * shared PublicManifest contract. The error is safe to expose to the UI.
 */
export class PublicCatalogLoadError extends Error {
  constructor(message, { code = 'PUBLIC_CATALOG_LOAD_FAILED', cause = null } = {}) {
    super(message);
    this.name = 'PublicCatalogLoadError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Fetches a manifest from the same static publication. The direct manifest is
 * attempted first because a release index is colocated with its manifest. A
 * current pointer is only used when the direct manifest is unavailable.
 *
 * The fetch and parser are injectable so this boundary remains deterministic
 * in tests and has no dependency on browser persistence or edit services.
 */
export async function loadPublicManifest({
  fetchImpl = globalThis.fetch,
  manifestUrl = PUBLIC_MANIFEST_URL,
  currentPointerUrls = PUBLIC_CURRENT_POINTER_URLS,
  parse = parseManifest,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new PublicCatalogLoadError('El catálogo publicado no puede realizar lecturas en este navegador.', {
      code: 'PUBLIC_FETCH_UNAVAILABLE',
    });
  }
  if (typeof parse !== 'function') {
    throw new PublicCatalogLoadError('El parser del manifiesto publicado no está disponible.', {
      code: 'PUBLIC_MANIFEST_PARSER_UNAVAILABLE',
    });
  }

  let directError;
  try {
    return await fetchAndParseManifest(manifestUrl, fetchImpl, parse);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    directError = error;
  }

  const pointerUrls = Array.isArray(currentPointerUrls)
    ? currentPointerUrls
    : [currentPointerUrls];
  for (const pointerUrl of pointerUrls) {
    if (typeof pointerUrl !== 'string' || pointerUrl.length === 0) continue;
    try {
      const pointerResponse = await fetchResponse(pointerUrl, fetchImpl);
      const pointerText = await readResponseText(pointerResponse, pointerUrl);
      const manifestPath = parseCurrentPointer(pointerText);
      return await fetchAndParseManifest(manifestPath, fetchImpl, parse);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw directError ?? new PublicCatalogLoadError(
    'No se encontró el manifiesto del catálogo publicado.',
    { code: 'PUBLIC_MANIFEST_NOT_FOUND' },
  );
}

/**
 * Renders a validated public manifest without creating edit or persistence
 * controls. All product text is assigned through textContent and all image
 * references have already passed the shared manifest validator.
 */
export function renderPublicCatalog(manifest, documentRef = globalThis.document, {
  gridSelector = '#catalog-grid',
  emptySelector = '#empty-state',
  statusSelector = '#public-catalog-status',
  imageBaseUrl = '',
} = {}) {
  const documentObject = requireDocument(documentRef);
  const grid = documentObject.querySelector(gridSelector);
  if (!grid) throw new PublicCatalogLoadError('La vista pública no contiene una grilla de catálogo.', {
    code: 'PUBLIC_CATALOG_GRID_MISSING',
  });

  try {
    assertValidManifest(manifest);
    // Build off-DOM so an invalid image reference or URL base cannot leave a
    // partially rendered catalog visible to the visitor.
    const fragment = documentObject.createDocumentFragment();
    for (const product of manifest.products) {
      fragment.append(createProductCard(product, documentObject, imageBaseUrl));
    }

    const emptyState = documentObject.querySelector(emptySelector);
    const status = ensureStatusElement(documentObject, statusSelector, grid);
    status.hidden = false;
    status.className = 'public-catalog-status public-catalog-status-read-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.dataset.state = 'read-only';
    status.dataset.mode = 'public-read-only';
    status.textContent = PUBLIC_READ_ONLY_NOTICE;

    grid.replaceChildren(fragment);
    grid.hidden = manifest.products.length === 0;
    if (emptyState) {
      emptyState.hidden = manifest.products.length !== 0;
      if (manifest.products.length === 0) {
        emptyState.textContent = 'No hay productos publicados.';
      }
    }

    return grid;
  } catch (error) {
    renderPublicCatalogError(error, documentObject, {
      gridSelector,
      emptySelector,
      statusSelector,
    });
    throw error;
  }
}

/**
 * Loads and renders the public catalog. Invalid or unavailable manifests clear
 * the grid and leave one accessible error state instead of partial cards.
 */
export async function initializePublicCatalog({ documentRef = globalThis.document, ...options } = {}) {
  try {
    const manifest = await loadPublicManifest(options);
    renderPublicCatalog(manifest, documentRef, options);
    return manifest;
  } catch (error) {
    renderPublicCatalogError(error, documentRef, options);
    return null;
  }
}

export function renderPublicCatalogError(error, documentRef = globalThis.document, {
  gridSelector = '#catalog-grid',
  emptySelector = '#empty-state',
  statusSelector = '#public-catalog-status',
} = {}) {
  const documentObject = requireDocument(documentRef);
  const grid = documentObject.querySelector(gridSelector);
  const emptyState = documentObject.querySelector(emptySelector);
  const status = ensureStatusElement(documentObject, statusSelector, grid ?? documentObject.body);

  if (grid) {
    grid.replaceChildren();
    grid.hidden = true;
  }
  if (emptyState) emptyState.hidden = true;
  status.hidden = false;
  status.className = 'public-catalog-status public-catalog-status-error';
  status.setAttribute('role', 'alert');
  status.setAttribute('aria-live', 'assertive');
  status.setAttribute('aria-atomic', 'true');
  status.dataset.state = 'error';
  status.dataset.mode = 'public-read-only';
  status.dataset.errorCode = error?.code ?? 'PUBLIC_CATALOG_LOAD_FAILED';
  status.textContent = getPublicCatalogErrorMessage(error);
  return status;
}

async function fetchAndParseManifest(url, fetchImpl, parse) {
  const response = await fetchResponse(url, fetchImpl);
  const text = await readResponseText(response, url);
  try {
    return parse(text);
  } catch (error) {
    throw new PublicCatalogLoadError('El manifiesto publicado es ilegible o incompatible.', {
      code: classifyManifestError(error),
      cause: error,
    });
  }
}

async function fetchResponse(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET' });
  } catch (error) {
    throw new PublicCatalogLoadError('No fue posible leer el catálogo publicado.', {
      code: 'PUBLIC_MANIFEST_NETWORK_ERROR',
      cause: error,
    });
  }

  if (!response || response.ok === false) {
    const status = response?.status ?? 0;
    throw new PublicCatalogLoadError('No se encontró el recurso publicado.', {
      code: status === 404 ? 'PUBLIC_MANIFEST_NOT_FOUND' : 'PUBLIC_MANIFEST_HTTP_ERROR',
    });
  }
  return response;
}

async function readResponseText(response, url) {
  if (typeof response.text !== 'function') {
    throw new PublicCatalogLoadError(`La respuesta de ${url} no contiene texto JSON.`, {
      code: 'PUBLIC_MANIFEST_RESPONSE_INVALID',
    });
  }
  try {
    return await response.text();
  } catch (error) {
    throw new PublicCatalogLoadError('No fue posible leer el manifiesto publicado.', {
      code: 'PUBLIC_MANIFEST_READ_FAILED',
      cause: error,
    });
  }
}

function parseCurrentPointer(source) {
  let pointer;
  try {
    pointer = JSON.parse(source);
  } catch {
    throw new PublicCatalogLoadError('El puntero de publicación es ilegible.', {
      code: 'PUBLIC_POINTER_INVALID',
    });
  }

  if (!isRecord(pointer) || typeof pointer.releaseId !== 'string'
    || typeof pointer.manifest !== 'string') {
    throw new PublicCatalogLoadError('El puntero de publicación es incompatible.', {
      code: 'PUBLIC_POINTER_INVALID',
    });
  }

  try {
    assertSafeReleaseId(pointer.releaseId);
  } catch {
    throw new PublicCatalogLoadError('El puntero de publicación contiene una versión insegura.', {
      code: 'PUBLIC_POINTER_INVALID',
    });
  }

  const expectedManifest = `releases/${pointer.releaseId}/manifest.json`;
  if (pointer.manifest !== expectedManifest) {
    throw new PublicCatalogLoadError('El puntero de publicación no referencia un manifiesto controlado.', {
      code: 'PUBLIC_POINTER_INVALID',
    });
  }
  return pointer.manifest;
}

function assertValidManifest(manifest) {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new PublicCatalogLoadError('El manifiesto publicado es ilegible o incompatible.', {
      code: classifyManifestValidation(validation),
      cause: validation,
    });
  }
}

function classifyManifestError(error) {
  if (error?.code === 'MANIFEST_INVALID_UTF8') return 'PUBLIC_MANIFEST_INVALID_UTF8';
  if (error?.code === 'MANIFEST_INVALID_JSON') return 'PUBLIC_MANIFEST_INVALID_JSON';
  if (error?.code === 'MANIFEST_INVALID') {
    return classifyManifestValidation(error);
  }
  if (error?.code === 'PUBLIC_MANIFEST_IMAGE_REFERENCE_INVALID'
    || error?.code === 'PUBLIC_MANIFEST_SCHEMA_INCOMPATIBLE') {
    return error.code;
  }
  return 'PUBLIC_MANIFEST_INVALID';
}

function classifyManifestValidation(validation) {
  if (validation?.issues?.some(({ code }) => [
    'UNSAFE_IMAGE_KEY',
    'INVALID_MANIFEST_IMAGE',
    'INVALID_MANIFEST_IMAGE_CONTENT_TYPE',
  ].includes(code))) {
    return 'PUBLIC_MANIFEST_IMAGE_REFERENCE_INVALID';
  }
  return 'PUBLIC_MANIFEST_SCHEMA_INCOMPATIBLE';
}

export function getPublicCatalogErrorMessage(error) {
  const code = error?.code === 'PUBLIC_IMAGE_KEY_INVALID'
    ? 'PUBLIC_MANIFEST_IMAGE_REFERENCE_INVALID'
    : error?.code;
  return PUBLIC_CATALOG_ERROR_MESSAGES[code]
    ?? 'No se pudo cargar el catálogo publicado. Intenta nuevamente más tarde.';
}

function createProductCard(product, documentObject, imageBaseUrl) {
  const card = documentObject.createElement('article');
  card.className = 'product-card';

  const imageContainer = documentObject.createElement('div');
  imageContainer.className = 'product-image-container';
  const image = documentObject.createElement('img');
  image.className = 'product-image';
  image.src = resolveImageUrl(product.image.key, imageBaseUrl, documentObject.baseURI);
  image.alt = product.name;
  image.loading = 'lazy';
  imageContainer.append(image);

  const info = documentObject.createElement('div');
  info.className = 'product-info';
  const name = documentObject.createElement('div');
  name.className = 'product-name';
  name.textContent = product.name;
  info.append(name);

  if (product.characteristics.length > 0) {
    const characteristics = documentObject.createElement('dl');
    characteristics.className = 'product-characteristics';
    for (const pair of product.characteristics) {
      const label = documentObject.createElement('dt');
      label.className = 'product-characteristic-label';
      label.textContent = pair.label;
      const value = documentObject.createElement('dd');
      value.className = 'product-characteristic-value';
      value.textContent = pair.value;
      characteristics.append(label, value);
    }
    info.append(characteristics);
  }

  const price = documentObject.createElement('div');
  price.className = `product-price${product.priceMode === 'inquire' ? ' inquire' : ''}`;
  price.textContent = product.priceMode === 'inquire'
    ? 'Consultar precio'
    : formatPriceCOP(product.priceCOP);
  info.append(price);

  // WhatsApp button
  const whatsappButton = documentObject.createElement('a');
  whatsappButton.className = 'whatsapp-button';
  whatsappButton.textContent = '💬 Consultar por este producto';
  whatsappButton.target = '_blank';
  whatsappButton.rel = 'noopener noreferrer';
  whatsappButton.href = '#';
  whatsappButton.addEventListener('click', (e) => {
    e.preventDefault();
    const priceText = product.priceMode === 'inquire' ? null : formatPriceCOP(product.priceCOP);
    const pricePart = priceText ? '\n\nPrecio: ' + priceText : '';
    let characteristicsPart = '';
    if (product.characteristics && product.characteristics.length > 0) {
      characteristicsPart = '\n\nCaracterísticas:' + product.characteristics.map(c => '\n- ' + c.label + ': ' + c.value).join('');
    }
    const message = 'Hola, estoy interesado en el producto: ' + product.name + pricePart + characteristicsPart + '\n\n¿Podrían darme más información?';
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = 'https://wa.me/573142720955?text=' + encodedMessage;
    window.open(whatsappUrl, '_blank');
  });
  info.append(whatsappButton);

  card.append(imageContainer, info);
  return card;
}

function resolveImageUrl(key, imageBaseUrl, documentBaseUrl) {
  if (!isControlledImageObjectKey(key)) {
    throw new PublicCatalogLoadError('La imagen publicada contiene una referencia insegura.', {
      code: 'PUBLIC_IMAGE_KEY_INVALID',
    });
  }
  if (!imageBaseUrl) return key;

  try {
    const base = new URL(imageBaseUrl, documentBaseUrl || undefined);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new TypeError('imageBaseUrl must use HTTP or HTTPS');
    }
    return new URL(key, base).toString();
  } catch {
    throw new PublicCatalogLoadError('La base de imágenes públicas no es válida.', {
      code: 'PUBLIC_IMAGE_BASE_INVALID',
    });
  }
}

function ensureStatusElement(documentObject, selector, insertionTarget) {
  let status = documentObject.querySelector(selector);
  if (status) return status;
  status = documentObject.createElement('p');
  status.id = selector.startsWith('#') ? selector.slice(1) : 'public-catalog-status';
  insertionTarget?.parentNode?.insertBefore(status, insertionTarget);
  return status;
}

function requireDocument(documentRef) {
  if (!documentRef || typeof documentRef.querySelector !== 'function') {
    throw new PublicCatalogLoadError('La vista pública no está disponible.', {
      code: 'PUBLIC_DOCUMENT_UNAVAILABLE',
    });
  }
  return documentRef;
}

function isNotFoundError(error) {
  return error?.code === 'PUBLIC_MANIFEST_NOT_FOUND';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
