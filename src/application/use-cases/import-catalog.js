import {
  EXPORT_SCHEMA_VERSION,
} from '../../domain/catalog-contracts.js';
import {
  InMemoryIdempotencyStore,
} from '../concurrency/idempotency.js';
import {
  validateExportPackage,
} from '../validation/catalog-contracts.js';

const IMPORT_OPERATION = 'import-catalog';

/**
 * Raised when a caller asks for a confirmed import without the explicit
 * confirmation flag. The report is attached so an operator can inspect the
 * dry-run result before retrying.
 */
export class ImportConfirmationRequiredError extends Error {
  constructor(report) {
    super('Explicit confirmation is required before importing a validated package');
    this.name = 'ImportConfirmationRequiredError';
    this.code = 'VALIDATION_ERROR';
    this.status = 422;
    this.field = 'confirm';
    this.report = report;
  }
}

/**
 * Raises a sanitized validation failure only when a caller explicitly needs an
 * exception. Normal import calls return the report so invalid records can be
 * reviewed without leaking source payloads.
 */
export class ImportPackageError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'ImportPackageError';
    this.code = 'INVALID_EXPORT_PACKAGE';
    this.report = report;
  }
}

/**
 * Validates an export without writing anything. The returned records are new
 * objects, and the source package is never normalized in place.
 *
 * @returns {{valid: boolean, records: object[], report: object}}
 */
export function inspectImport(exportPackage) {
  const validation = validateExportPackage(exportPackage);
  const products = Array.isArray(exportPackage?.products) ? exportPackage.products : [];
  const issues = [...validation.issues];

  // The shared validator checks that every image ID is unique and present. The
  // import boundary additionally checks that the bytes associated with an ID
  // are the same in both parts of the portable package.
  const imagesByProductId = new Map(
    (Array.isArray(exportPackage?.images) ? exportPackage.images : [])
      .filter((image) => isRecord(image) && typeof image.productId === 'string')
      .map((image) => [image.productId, image]),
  );

  products.forEach((product, index) => {
    const image = isRecord(product) ? imagesByProductId.get(product.id) : undefined;
    if (image && image.data !== product.image) {
      issues.push(Object.freeze({
        code: 'IMAGE_DATA_MISMATCH',
        path: `images[${findImageIndex(exportPackage.images, image)}].data`,
        index,
        productId: isUuidLike(product.id) ? product.id : null,
        field: 'data',
        message: `images entry for products[${index}].id must match products[${index}].image`,
      }));
    }
  });

  const acceptedRecords = products
    .map((product, index) => ({ product, index }))
    .filter(({ product, index }) => !issues.some((issue) => issueBelongsToProduct(issue, product, index)))
    .map(({ product }) => normalizeImportProduct(product, imagesByProductId.get(product.id)));

  const accepted = acceptedRecords.length;
  const report = createReport({
    accepted,
    rejected: Math.max(0, products.length - accepted),
    errors: issues,
    dryRun: true,
  });

  return Object.freeze({
    valid: validation.valid && issues.length === 0,
    records: Object.freeze(acceptedRecords),
    report,
  });
}

/**
 * Runs a non-destructive Stage 2 export import. Validation always completes
 * before the writer is resolved or called. Confirmed writes use one injected
 * batch operation, which is required to provide atomic/all-or-nothing
 * persistence; there is deliberately no sequential add() fallback.
 *
 * The function accepts either `importCatalog(exportPackage, options)` or
 * `importCatalog({ exportPackage, ...options })` for handler and test usage.
 */
export async function importCatalog(sourceOrRequest, suppliedOptions = {}) {
  const { exportPackage, options } = resolveRequest(sourceOrRequest, suppliedOptions);
  const inspection = inspectImport(exportPackage);
  const optionsWithDefaults = options ?? {};
  const dryRun = optionsWithDefaults.dryRun !== false;

  if (!inspection.valid) return inspection.report;
  if (dryRun) return inspection.report;

  const confirmed = optionsWithDefaults.confirm === true
    || optionsWithDefaults.confirmed === true
    || optionsWithDefaults.confirmation === true;
  if (!confirmed) throw new ImportConfirmationRequiredError(inspection.report);

  const writer = resolveBatchWriter(optionsWithDefaults);
  const idempotencyStore = optionsWithDefaults.idempotencyStore ?? new InMemoryIdempotencyStore();
  const ownerId = optionsWithDefaults.ownerId ?? 'global';
  const idempotencyKey = optionsWithDefaults.idempotencyKey
    ?? defaultIdempotencyKey(ownerId, inspection.records);
  const intent = {
    sourceVersion: EXPORT_SCHEMA_VERSION,
    ownerId,
    products: inspection.records,
  };

  const report = createReport({
    accepted: inspection.report.accepted,
    rejected: inspection.report.rejected,
    errors: inspection.report.errors,
    dryRun: false,
  });

  return idempotencyStore.execute({
    scope: ownerId,
    key: idempotencyKey,
    operation: IMPORT_OPERATION,
    intent,
    action: async () => {
      // A structured copy prevents an injected test double or persistence
      // adapter from mutating the import plan or the caller's source object.
      await writer(structuredClone(inspection.records), {
        ownerId,
        sourceVersion: EXPORT_SCHEMA_VERSION,
        idempotencyKey,
      });
      return report;
    },
  });
}

export const importExportPackage = importCatalog;
export const runImport = importCatalog;

/** Creates a reusable importer with one idempotency store for repeated calls. */
export function createCatalogImporter(defaultOptions = {}) {
  const idempotencyStore = defaultOptions.idempotencyStore ?? new InMemoryIdempotencyStore();
  return (sourceOrRequest, options = {}) => importCatalog(sourceOrRequest, {
    ...defaultOptions,
    ...options,
    idempotencyStore: options.idempotencyStore ?? idempotencyStore,
  });
}

function resolveRequest(sourceOrRequest, suppliedOptions) {
  if (isRecord(sourceOrRequest) && Object.hasOwn(sourceOrRequest, 'exportPackage')) {
    const { exportPackage, ...requestOptions } = sourceOrRequest;
    return {
      exportPackage,
      options: { ...requestOptions, ...suppliedOptions },
    };
  }
  return { exportPackage: sourceOrRequest, options: suppliedOptions };
}

function resolveBatchWriter(options) {
  if (typeof options.writeBatch === 'function') return options.writeBatch;
  if (typeof options.writer === 'function') return options.writer;
  if (typeof options.repository?.importProducts === 'function') {
    return (records, metadata) => options.repository.importProducts(records, {
      ownerId: metadata.ownerId,
      idempotencyKey: metadata.idempotencyKey,
    });
  }
  throw new TypeError('A batch import writer is required for confirmed imports');
}

function normalizeImportProduct(product, image) {
  return {
    id: product.id,
    name: product.name.trim(),
    priceMode: product.priceMode,
    priceCOP: product.priceCOP,
    image: image?.data ?? product.image,
    createdAt: product.createdAt,
    characteristics: product.characteristics.map((pair) => ({
      label: pair.label.trim(),
      value: pair.value.trim(),
    })),
  };
}

function issueBelongsToProduct(issue, product, index) {
  if (issue.path === `products[${index}]` || issue.path.startsWith(`products[${index}].`)) return true;
  if (issue.productId && issue.productId === product?.id) return true;
  return false;
}

function createReport({ accepted, rejected, errors, dryRun }) {
  return Object.freeze({
    sourceVersion: EXPORT_SCHEMA_VERSION,
    accepted,
    rejected,
    errors: Object.freeze(errors.map((issue) => Object.freeze({
      index: issue.index ?? null,
      productId: issue.productId ?? null,
      code: issue.code,
      message: issue.message,
    }))),
    dryRun,
  });
}

function defaultIdempotencyKey(ownerId, records) {
  const serialized = JSON.stringify({ ownerId, records });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `import-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function findImageIndex(images, target) {
  return Array.isArray(images) ? images.indexOf(target) : null;
}

function isUuidLike(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
