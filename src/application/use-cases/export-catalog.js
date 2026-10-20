import { CATALOG_PRODUCT_LIMIT } from '../../domain/catalog-limits.js';
import { normalizeCharacteristics } from '../../domain/characteristics.js';
import {
  isProcessedJpeg,
  isUuid,
} from '../../domain/catalog-contract-primitives.js';
import { deserializeProductRecord } from '../../domain/product.js';
import { normalizeProductName } from '../../domain/product-name.js';
import {
  EXPORT_SCHEMA_VERSION,
  IMAGE_CONTENT_TYPE,
  validateExportPackage,
} from '../validation/catalog-contracts.js';

export { EXPORT_SCHEMA_VERSION, IMAGE_CONTENT_TYPE, validateExportPackage };

/**
 * Error de frontera para una exportación inválida. Los metadatos identifican
 * la fila o producto afectado sin conservar el registro fuente completo.
 */
export class ExportPackageError extends Error {
  constructor(message, {
    code = 'EXPORT_PACKAGE_INVALID',
    recordIndex = null,
    recordId = null,
    field = null,
    errors = [],
  } = {}) {
    super(message);
    this.name = 'ExportPackageError';
    this.code = code;
    this.recordIndex = recordIndex;
    this.recordId = recordId;
    this.field = field;
    this.errors = [...errors];
  }
}

/**
 * Convierte registros locales Stage 1/Stage 2 en un paquete portable.
 * La entrada no se modifica y el resultado contiene solo campos públicos del
 * contrato; no conoce localStorage, AWS ni el publicador externo.
 */
export function createExportPackage(records, { generatedAt = new Date() } = {}) {
  if (!Array.isArray(records)) {
    throw new ExportPackageError('Export source must be an array of product records', {
      code: 'EXPORT_SOURCE_MUST_BE_ARRAY',
    });
  }

  if (records.length > CATALOG_PRODUCT_LIMIT) {
    throw new ExportPackageError(
      `Cannot export more than ${CATALOG_PRODUCT_LIMIT} products`,
      { code: 'EXPORT_CATALOG_LIMIT_EXCEEDED' },
    );
  }

  const normalized = records.map((record, recordIndex) => normalizeExportProduct(record, recordIndex));
  const products = normalized
    .map(({ product }) => product)
    .sort((left, right) => timestampOf(right.createdAt) - timestampOf(left.createdAt));
  const imageByProductId = new Map(normalized.map(({ product }) => [product.id, product.image]));

  const exportPackage = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: normalizeGeneratedAt(generatedAt),
    products,
    images: products.map((product) => ({
      productId: product.id,
      contentType: IMAGE_CONTENT_TYPE,
      data: imageByProductId.get(product.id),
    })),
  };

  const validation = validateExportPackage(exportPackage);
  if (!validation.valid) {
    throw new ExportPackageError('Generated export package is invalid', {
      code: 'GENERATED_EXPORT_PACKAGE_INVALID',
      errors: validation.errors,
    });
  }

  return exportPackage;
}

/**
 * Obtiene registros del repositorio y los convierte sin modificar su estado.
 * Los problemas que el repositorio detectó al leer localStorage son errores de
 * exportación: no se silencian ni se convierten en productos incompletos.
 */
export async function exportCatalog(repository, options = {}) {
  if (!repository || typeof repository.list !== 'function') {
    throw new ExportPackageError('A product repository with list() is required', {
      code: 'EXPORT_REPOSITORY_REQUIRED',
    });
  }

  let records;
  try {
    records = await repository.list();
  } catch (error) {
    if (error instanceof ExportPackageError) throw error;
    throw new ExportPackageError('Could not read the local catalog for export', {
      code: 'EXPORT_SOURCE_READ_FAILED',
    });
  }

  const issues = typeof repository.getLastReadIssues === 'function'
    ? repository.getLastReadIssues()
    : [];
  if (Array.isArray(issues) && issues.length > 0) {
    throw new ExportPackageError('The local catalog contains invalid records', {
      code: 'EXPORT_SOURCE_HAS_INVALID_RECORDS',
      errors: issues.map((issue) => ({
        recordIndex: issue.recordIndex ?? null,
        recordId: issue.recordId ?? null,
        error: issue.error?.code ?? 'INVALID_PRODUCT_RECORD',
      })),
    });
  }

  return createExportPackage(records, options);
}

function normalizeExportProduct(record, recordIndex) {
  const recordId = isRecord(record) ? record.id ?? null : null;
  if (!isRecord(record)) {
    throw new ExportPackageError('Product record must be an object', {
      code: 'INVALID_PRODUCT_RECORD', recordIndex, recordId,
    });
  }

  if (!isUuid(record.id)) {
    throw new ExportPackageError('Product id must be a UUID', {
      code: 'INVALID_PRODUCT_ID', recordIndex, recordId, field: 'id',
    });
  }

  let deserialized;
  try {
    deserialized = deserializeProductRecord(record);
  } catch (error) {
    throw new ExportPackageError(error.message, {
      code: error.code ?? 'INVALID_PRODUCT_RECORD',
      recordIndex,
      recordId,
      field: error.field ?? null,
    });
  }

  if (!isProcessedJpeg(deserialized.image)) {
    throw new ExportPackageError('Product image must be a processed JPEG data URI', {
      code: 'INVALID_PROCESSED_IMAGE',
      recordIndex,
      recordId,
      field: 'image',
    });
  }

  let characteristics;
  try {
    characteristics = normalizeCharacteristics(deserialized.characteristics);
  } catch (error) {
    throw new ExportPackageError(error.message, {
      code: error.code ?? 'INVALID_CHARACTERISTICS',
      recordIndex,
      recordId,
      field: error.field ?? null,
    });
  }

  return {
    product: {
      id: deserialized.id,
      name: normalizeProductName(deserialized.name),
      priceMode: deserialized.priceMode,
      priceCOP: deserialized.priceCOP,
      image: deserialized.image,
      createdAt: deserialized.createdAt,
      characteristics,
    },
  };
}

function normalizeGeneratedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ExportPackageError('generatedAt must be a valid ISO UTC datetime', {
      code: 'INVALID_GENERATED_AT',
      field: 'generatedAt',
    });
  }
  return date.toISOString();
}

function timestampOf(value) {
  return typeof value === 'number' ? value : Date.parse(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
