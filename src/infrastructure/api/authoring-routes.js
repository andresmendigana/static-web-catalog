import { AUTHORIZATION_SCOPES } from '../../application/auth/auth-scopes.js';

/**
 * Authoring routes are the single source of truth used by the infrastructure
 * and the runtime defense-in-depth router. Every route is authenticated and
 * carries the least scope needed for its operation.
 */
export const AUTHORING_ROUTES = Object.freeze([
  Object.freeze({
    id: 'ListProducts',
    path: '/catalog/products',
    methods: Object.freeze(['GET']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.CATALOG_READ]),
    handler: 'catalog',
  }),
  Object.freeze({
    id: 'CreateProduct',
    path: '/catalog/products',
    methods: Object.freeze(['POST']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.CATALOG_WRITE]),
    handler: 'catalog',
  }),
  Object.freeze({
    id: 'UpdateProduct',
    path: '/catalog/products/{id}',
    methods: Object.freeze(['PATCH']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.CATALOG_WRITE]),
    handler: 'catalog',
  }),
  Object.freeze({
    id: 'DeleteProduct',
    path: '/catalog/products/{id}',
    methods: Object.freeze(['DELETE']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.CATALOG_WRITE]),
    handler: 'catalog',
  }),
  Object.freeze({
    id: 'PrepareUpload',
    path: '/uploads/prepare',
    methods: Object.freeze(['POST']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.UPLOADS_WRITE]),
    handler: 'upload',
  }),
  Object.freeze({
    id: 'CompleteUpload',
    path: '/uploads/{uploadId}/complete',
    methods: Object.freeze(['POST']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.UPLOADS_WRITE]),
    handler: 'upload',
  }),
  Object.freeze({
    id: 'ImportCatalog',
    path: '/catalog/import',
    methods: Object.freeze(['POST']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.CATALOG_IMPORT]),
    handler: 'catalog',
  }),
  Object.freeze({
    id: 'GetPublication',
    path: '/catalog/publication',
    methods: Object.freeze(['GET']),
    scopes: Object.freeze([AUTHORIZATION_SCOPES.PUBLICATION_READ]),
    handler: 'catalog',
  }),
]);

export function routeForEvent(event) {
  const routeKey = event?.routeKey;
  return AUTHORING_ROUTES.find((route) => route.methods.some((method) => `${method} ${route.path}` === routeKey)) ?? null;
}
