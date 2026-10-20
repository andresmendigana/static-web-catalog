/**
 * OAuth scopes shared by the Cognito resource server, HTTP routes,
 * and the browser client. Values deliberately use the Cognito
 * `<resource-server>/<scope>` representation.
 */
export const COGNITO_RESOURCE_SERVER_IDENTIFIER = 'catalog';

export const AUTHORIZATION_SCOPES = Object.freeze({
  CATALOG_READ: 'catalog/read',
  CATALOG_WRITE: 'catalog/write',
  CATALOG_IMPORT: 'catalog/import',
  UPLOADS_WRITE: 'catalog/uploads',
  PUBLICATION_READ: 'catalog/publication',
});

export const COGNITO_SCOPE_DEFINITIONS = Object.freeze([
  Object.freeze({ scopeName: 'read', scopeDescription: 'Read the authenticated catalog' }),
  Object.freeze({ scopeName: 'write', scopeDescription: 'Create, update, and delete catalog products' }),
  Object.freeze({ scopeName: 'import', scopeDescription: 'Import a validated Stage 2 catalog' }),
  Object.freeze({ scopeName: 'uploads', scopeDescription: 'Prepare and complete image uploads' }),
  Object.freeze({ scopeName: 'publication', scopeDescription: 'Read catalog publication status' }),
]);

export const AUTHORIZATION_SCOPE_LIST = Object.freeze(Object.values(AUTHORIZATION_SCOPES));
