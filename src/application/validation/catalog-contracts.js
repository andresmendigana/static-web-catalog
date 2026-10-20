import { CATALOG_PRODUCT_LIMIT } from '../../domain/catalog-limits.js';
import { isValidPrice } from '../../domain/price.js';
import {
  CHARACTERISTIC_LIMITS,
} from '../../domain/characteristics.js';
import {
  isIsoDateTime,
  isProcessedJpeg,
  isSupportedDate,
  isUuid,
} from '../../domain/catalog-contract-primitives.js';
import { isControlledImageObjectKey } from '../publication/image-object-keys.js';

export const EXPORT_SCHEMA_VERSION = 'stage2-export-v1';
export const MANIFEST_SCHEMA_VERSION = 'stage2-manifest-v1';
export const IMAGE_CONTENT_TYPE = 'image/jpeg';

const FORBIDDEN_KEY_PATTERN = /(?:access.?key|secret|token|credential|password|private.?key|permission|role)/iu;
const INTERNAL_PROJECTION_KEY_PATTERN = /^(?:audit|claims|createdBy|expiresAt|ownerId|status|updatedAt|updatedBy|uploadId|uploadStatus|version)$/u;

/**
 * Valida un ProductRecord sin modificarlo. `index` y `path` permiten reutilizar
 * la misma regla desde una fila local, un paquete de exportación o un manifiesto.
 */
export function validateProduct(product, {
  index = null,
  path = index === null ? 'product' : `products[${index}]`,
  productId = isRecord(product) && isUuid(product.id) ? product.id : null,
  imageMode = 'processed',
  requireCharacteristics = true,
} = {}) {
  const issues = [];
  const label = path;

  if (!isRecord(product)) {
    addIssue(issues, {
      code: 'INVALID_PRODUCT', path: label, index, productId,
      message: `${label} must be an object`,
    });
    return validationResult(issues);
  }

  const resolvedProductId = isUuid(product.id) ? product.id : productId;
  if (!isUuid(product.id)) {
    addIssue(issues, {
      code: 'INVALID_PRODUCT_ID', path: `${label}.id`, index, productId: resolvedProductId,
      field: 'id', message: `${label}.id must be a UUID`,
    });
  }

  if (typeof product.name !== 'string' || product.name.trim().length === 0) {
    addIssue(issues, {
      code: 'INVALID_PRODUCT_NAME', path: `${label}.name`, index, productId: resolvedProductId,
      field: 'name', message: `${label}.name must be a non-empty string`,
    });
  }

  validatePrice(product, label, index, resolvedProductId, issues);
  validateCreatedAt(product.createdAt, label, index, resolvedProductId, issues);
  validateImage(product.image, label, index, resolvedProductId, imageMode, issues);
  validateCharacteristics(
    product.characteristics,
    label,
    index,
    resolvedProductId,
    requireCharacteristics,
    issues,
  );

  return validationResult(issues);
}

/**
 * Valida el contrato ExportPackage v1. No realiza I/O, normalización ni acceso
 * a AWS; sus issues siempre señalan el índice y, cuando es posible, el UUID.
 */
export function validateExportPackage(exportPackage) {
  const issues = [];

  if (!isRecord(exportPackage)) {
    addIssue(issues, {
      code: 'INVALID_EXPORT_PACKAGE', path: '',
      message: 'export package must be an object',
    });
    return validationResult(issues);
  }

  collectForbiddenKeys(exportPackage, '', issues, 'EXPORT_PACKAGE_FORBIDDEN_FIELD');

  if (exportPackage.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    addIssue(issues, {
      code: 'INVALID_EXPORT_SCHEMA', path: 'schemaVersion', field: 'schemaVersion',
      message: `schemaVersion must be ${EXPORT_SCHEMA_VERSION}`,
    });
  }
  if (!isIsoDateTime(exportPackage.generatedAt)) {
    addIssue(issues, {
      code: 'INVALID_EXPORT_GENERATED_AT', path: 'generatedAt', field: 'generatedAt',
      message: 'generatedAt must be an ISO-8601 UTC datetime',
    });
  }

  const products = exportPackage.products;
  if (!Array.isArray(products)) {
    addIssue(issues, {
      code: 'INVALID_EXPORT_PRODUCTS', path: 'products', field: 'products',
      message: 'products must be an array',
    });
  } else {
    if (products.length > CATALOG_PRODUCT_LIMIT) {
      addIssue(issues, {
        code: 'EXPORT_CATALOG_LIMIT_EXCEEDED', path: 'products', field: 'products',
        message: `products cannot contain more than ${CATALOG_PRODUCT_LIMIT} products`,
      });
    }

    const productIds = new Set();
    products.forEach((product, index) => {
      const result = validateProduct(product, {
        index,
        path: `products[${index}]`,
        imageMode: 'processed',
        requireCharacteristics: true,
      });
      issues.push(...result.issues);
      if (isRecord(product) && isUuid(product.id)) {
        if (productIds.has(product.id)) {
          addIssue(issues, {
            code: 'DUPLICATE_PRODUCT_ID',
            path: `products[${index}].id`,
            index,
            productId: product.id,
            field: 'id',
            message: `products[${index}].id must be unique`,
          });
        }
        productIds.add(product.id);
      }
    });
  }

  const images = exportPackage.images;
  if (!Array.isArray(images)) {
    addIssue(issues, {
      code: 'INVALID_EXPORT_IMAGES', path: 'images', field: 'images',
      message: 'images must be an array',
    });
  } else {
    validateExportImages(images, products, issues);
  }

  return validationResult(issues);
}

/**
 * Valida el contrato público stage2-manifest-v1, incluida la referencia de
 * imagen segura. La función no asume un release concreto y por eso valida la
 * forma confinable de la clave, no una ruta de almacenamiento externa.
 */
export function validateManifest(manifest) {
  const issues = [];

  if (!isRecord(manifest)) {
    addIssue(issues, {
      code: 'INVALID_PUBLIC_MANIFEST', path: '',
      message: 'public manifest must be an object',
    });
    return validationResult(issues);
  }

  collectForbiddenKeys(manifest, '', issues, 'MANIFEST_FORBIDDEN_FIELD', {
    rejectInternalProjectionFields: true,
  });

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_SCHEMA', path: 'schemaVersion', field: 'schemaVersion',
      message: `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`,
    });
  }
  if (!isIsoDateTime(manifest.generatedAt)) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_GENERATED_AT', path: 'generatedAt', field: 'generatedAt',
      message: 'generatedAt must be an ISO-8601 UTC datetime',
    });
  }
  if (manifest.catalogLimit !== CATALOG_PRODUCT_LIMIT) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_CATALOG_LIMIT', path: 'catalogLimit', field: 'catalogLimit',
      message: `catalogLimit must be ${CATALOG_PRODUCT_LIMIT}`,
    });
  }

  if (!Array.isArray(manifest.products)) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_PRODUCTS', path: 'products', field: 'products',
      message: 'products must be an array',
    });
    return validationResult(issues);
  }

  if (manifest.products.length > CATALOG_PRODUCT_LIMIT) {
    addIssue(issues, {
      code: 'MANIFEST_CATALOG_LIMIT_EXCEEDED', path: 'products', field: 'products',
      message: `products cannot contain more than ${CATALOG_PRODUCT_LIMIT} products`,
    });
  }

  const productIds = new Set();
  manifest.products.forEach((product, index) => {
    const label = `products[${index}]`;
    const result = validateProduct(product, {
      index,
      path: label,
      imageMode: 'manifest',
      requireCharacteristics: true,
    });
    issues.push(...result.issues);

    if (isRecord(product) && isUuid(product.id)) {
      if (productIds.has(product.id)) {
        addIssue(issues, {
          code: 'DUPLICATE_MANIFEST_PRODUCT_ID',
          path: `${label}.id`, index, productId: product.id, field: 'id',
          message: `${label}.id must be unique`,
        });
      }
      productIds.add(product.id);
    }
    validateManifestImage(product, label, index, issues);
  });

  return validationResult(issues);
}

export class CatalogValidationError extends Error {
  constructor(message, result, code = 'CATALOG_VALIDATION_FAILED') {
    super(message);
    this.name = 'CatalogValidationError';
    this.code = code;
    this.errors = [...(result?.errors ?? [])];
    this.issues = [...(result?.issues ?? [])];
    const firstIssue = this.issues[0] ?? {};
    this.index = firstIssue.index ?? null;
    this.productId = firstIssue.productId ?? null;
    this.field = firstIssue.field ?? null;
  }
}

function validatePrice(product, label, index, productId, issues) {
  if (product.priceMode === 'amount') {
    if (!isValidPrice(product.priceCOP)) {
      addIssue(issues, {
        code: 'AMOUNT_PRICE_MUST_BE_NON_NEGATIVE_INTEGER',
        path: `${label}.priceCOP`, index, productId, field: 'priceCOP',
        message: `${label}.priceCOP must be a non-negative integer for amount prices`,
      });
    }
    return;
  }

  if (product.priceMode === 'inquire') {
    if (product.priceCOP !== null) {
      addIssue(issues, {
        code: 'INQUIRE_PRICE_MUST_BE_NULL',
        path: `${label}.priceCOP`, index, productId, field: 'priceCOP',
        message: `${label}.priceCOP must be null for inquire prices`,
      });
    }
    return;
  }

  addIssue(issues, {
    code: 'INVALID_PRICE_MODE',
    path: `${label}.priceMode`, index, productId, field: 'priceMode',
    message: `${label}.priceMode must be amount or inquire`,
  });
}

function validateCreatedAt(value, label, index, productId, issues) {
  if (!isSupportedDate(value)) {
    addIssue(issues, {
      code: 'INVALID_CREATED_AT',
      path: `${label}.createdAt`, index, productId, field: 'createdAt',
      message: `${label}.createdAt must be a non-negative timestamp or ISO-8601 UTC datetime`,
    });
  }
}

function validateImage(value, label, index, productId, imageMode, issues) {
  if (imageMode === 'manifest') return;
  if (!isProcessedJpeg(value)) {
    addIssue(issues, {
      code: 'INVALID_PROCESSED_IMAGE',
      path: `${label}.image`, index, productId, field: 'image',
      message: `${label}.image must be a processed JPEG data URI`,
    });
  }
}

function validateCharacteristics(value, label, index, productId, required, issues) {
  if (!Array.isArray(value)) {
    if (required || value !== undefined) {
      addIssue(issues, {
        code: 'INVALID_CHARACTERISTICS',
        path: `${label}.characteristics`, index, productId, field: 'characteristics',
        message: `${label}.characteristics must be an array`,
      });
    }
    return;
  }

  if (value.length > CHARACTERISTIC_LIMITS.MAX_ITEMS) {
    addIssue(issues, {
      code: 'CHARACTERISTICS_LIMIT_EXCEEDED',
      path: `${label}.characteristics`, index, productId, field: 'characteristics',
      message: `${label}.characteristics cannot contain more than ${CHARACTERISTIC_LIMITS.MAX_ITEMS} pairs`,
    });
  }

  value.forEach((pair, characteristicIndex) => {
    const pairPath = `${label}.characteristics[${characteristicIndex}]`;
    if (!isRecord(pair)) {
      addIssue(issues, {
        code: 'INVALID_CHARACTERISTIC',
        path: pairPath,
        index,
        productId,
        field: 'characteristics',
        message: `${pairPath} must be an object`,
      });
      return;
    }

    validateCharacteristicText(
      pair.label,
      `${pairPath}.label`,
      'label',
      CHARACTERISTIC_LIMITS.MIN_LABEL_LENGTH,
      CHARACTERISTIC_LIMITS.MAX_LABEL_LENGTH,
      index,
      productId,
      issues,
    );
    validateCharacteristicText(
      pair.value,
      `${pairPath}.value`,
      'value',
      CHARACTERISTIC_LIMITS.MIN_VALUE_LENGTH,
      CHARACTERISTIC_LIMITS.MAX_VALUE_LENGTH,
      index,
      productId,
      issues,
    );
  });
}

function validateCharacteristicText(value, path, field, min, max, index, productId, issues) {
  if (typeof value !== 'string') {
    addIssue(issues, {
      code: `INVALID_CHARACTERISTIC_${field.toUpperCase()}`,
      path, index, productId, field,
      message: `${path} must be a string`,
    });
    return;
  }

  const length = Array.from(value.trim()).length;
  if (length < min || length > max) {
    addIssue(issues, {
      code: `INVALID_CHARACTERISTIC_${field.toUpperCase()}_LENGTH`,
      path, index, productId, field,
      message: `${path} must contain between ${min} and ${max} characters after trimming`,
    });
  }
}

function validateManifestImage(product, label, index, issues) {
  const productId = isRecord(product) && isUuid(product.id) ? product.id : null;
  if (!isRecord(product?.image)) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_IMAGE',
      path: `${label}.image`, index, productId, field: 'image',
      message: `${label}.image must be an object`,
    });
    return;
  }

  if (!isControlledImageObjectKey(product.image.key)) {
    addIssue(issues, {
      code: 'UNSAFE_IMAGE_KEY',
      path: `${label}.image.key`, index, productId, field: 'image.key',
      message: `${label}.image.key must be a safe relative object key`,
    });
  }
  if (product.image.contentType !== IMAGE_CONTENT_TYPE) {
    addIssue(issues, {
      code: 'INVALID_MANIFEST_IMAGE_CONTENT_TYPE',
      path: `${label}.image.contentType`, index, productId, field: 'image.contentType',
      message: `${label}.image.contentType must be ${IMAGE_CONTENT_TYPE}`,
    });
  }
}

function validateExportImages(images, products, issues) {
  const productIds = new Set(
    Array.isArray(products) ? products.filter(isRecord).map((product) => product.id) : [],
  );
  const imageIds = new Set();

  images.forEach((image, index) => {
    const label = `images[${index}]`;
    if (!isRecord(image)) {
      addIssue(issues, {
        code: 'INVALID_EXPORT_IMAGE', path: label, index,
        message: `${label} must be an object`,
      });
      return;
    }

    const productId = isUuid(image.productId) ? image.productId : null;
    if (!isUuid(image.productId)) {
      addIssue(issues, {
        code: 'INVALID_IMAGE_PRODUCT_ID', path: `${label}.productId`, index,
        productId, field: 'productId', message: `${label}.productId must be a UUID`,
      });
    } else if (!productIds.has(image.productId)) {
      addIssue(issues, {
        code: 'ORPHAN_IMAGE', path: `${label}.productId`, index,
        productId, field: 'productId', message: `${label}.productId must reference a product`,
      });
    } else if (imageIds.has(image.productId)) {
      addIssue(issues, {
        code: 'DUPLICATE_IMAGE_PRODUCT_ID', path: `${label}.productId`, index,
        productId, field: 'productId', message: `${label}.productId must be unique`,
      });
    } else {
      imageIds.add(image.productId);
    }

    if (image.contentType !== IMAGE_CONTENT_TYPE) {
      addIssue(issues, {
        code: 'INVALID_IMAGE_CONTENT_TYPE', path: `${label}.contentType`, index,
        productId, field: 'contentType', message: `${label}.contentType must be ${IMAGE_CONTENT_TYPE}`,
      });
    }
    if (!isProcessedJpeg(image.data)) {
      addIssue(issues, {
        code: 'INVALID_IMAGE_DATA', path: `${label}.data`, index,
        productId, field: 'data', message: `${label}.data must be a processed JPEG data URI`,
      });
    }
  });

  if (Array.isArray(products)) {
    products.forEach((product, index) => {
      if (isRecord(product) && isUuid(product.id) && !imageIds.has(product.id)) {
        addIssue(issues, {
          code: 'MISSING_PRODUCT_IMAGE', path: `images`, index, productId: product.id,
          field: 'images', message: `images must include an image for products[${index}].id`,
        });
      }
    });
  }
}

function collectForbiddenKeys(value, path, issues, code, {
  rejectInternalProjectionFields = false,
  context = null,
} = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      const itemContext = context ?? getProductContext(itemPath, item);
      collectForbiddenKeys(item, itemPath, issues, code, {
        rejectInternalProjectionFields,
        context: itemContext.index === null ? null : itemContext,
      });
    });
    return;
  }
  if (!isRecord(value)) return;

  const productContext = context ?? getProductContext(path, value);
  Object.entries(value).forEach(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const isCredentialOrPermissionField = FORBIDDEN_KEY_PATTERN.test(key);
    const isInternalProjectionField = rejectInternalProjectionFields
      && INTERNAL_PROJECTION_KEY_PATTERN.test(key);

    if (isCredentialOrPermissionField || isInternalProjectionField) {
      addIssue(issues, {
        code: isInternalProjectionField ? 'MANIFEST_INTERNAL_FIELD' : code,
        path: childPath,
        ...productContext,
        field: key,
        message: isInternalProjectionField
          ? 'public projection contains an unsupported internal field'
          : 'artifact contains an unsupported credential or permission field',
      });
    }
    collectForbiddenKeys(child, childPath, issues, code, {
      rejectInternalProjectionFields,
      context: productContext.index === null ? null : productContext,
    });
  });
}

function getProductContext(path, value) {
  const match = path.match(/(?:^|\.)products\[(\d+)\]/u);
  return {
    index: match ? Number(match[1]) : null,
    productId: match && isRecord(value) && isUuid(value.id) ? value.id : null,
  };
}

function addIssue(issues, issue) {
  issues.push(Object.freeze({
    code: issue.code,
    path: issue.path,
    index: issue.index ?? null,
    productId: issue.productId ?? null,
    field: issue.field ?? null,
    message: issue.message,
  }));
}

function validationResult(issues) {
  return Object.freeze({
    valid: issues.length === 0,
    errors: Object.freeze(issues.map(({ message }) => message)),
    issues: Object.freeze([...issues]),
  });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
