import { initializePublicCatalog } from './public-catalog.js';

/**
 * Public static-catalog entrypoint. It intentionally imports only the public
 * loader/renderer and never constructs a local data repository.
 */
export function startPublicCatalog(options = {}) {
  return initializePublicCatalog(options);
}

function startWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startPublicCatalog(), { once: true });
  } else {
    startPublicCatalog();
  }
}

if (typeof document !== 'undefined') startWhenReady();
