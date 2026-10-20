/**
 * Entidad Product - Agregado raíz del dominio
 */
import { isValidProductName, normalizeProductName } from './product-name.js';
import {
    assertValidPrice,
    isValidPrice,
    createAmountPrice,
    createInquirePrice
} from './price.js';
import { normalizeCharacteristics, InvalidCharacteristicsError } from './characteristics.js';
import { isSupportedDate, isUuid } from './catalog-contract-primitives.js';
import { InvalidProductError } from './errors.js';

/**
 * Crea un nuevo producto
 * @param {Object} params - Parámetros del producto
 * @param {string} params.name - Nombre del producto
 * @param {'amount'|'inquire'} params.priceMode - Modo de precio
 * @param {number|null} params.priceCOP - Precio en COP (requerido si priceMode es 'amount')
 * @param {string} params.image - Data URI de la imagen
 * @param {Array<{label: string, value: string}>} [params.characteristics=[]] - Características ordenadas
 * @returns {Object} Producto válido
 */
export function createProduct({ name, priceMode, priceCOP, image, characteristics = [] }) {
    // Validar ID (se genera automáticamente)
    const id = crypto.randomUUID();
    
    // Validar nombre
    if (!isValidProductName(name)) {
        throw new InvalidProductError('Product name is required and cannot be empty');
    }
    const normalizedName = normalizeProductName(name);
    
    // Validar precio según la invariante amount/inquire.
    // InvalidPriceError mantiene InvalidProductError como tipo base.
    assertValidPrice(priceMode, priceCOP);
    
    // Validar imagen
    if (!image || typeof image !== 'string') {
        throw new InvalidProductError('Image data URI is required');
    }

    const normalizedCharacteristics = normalizeCharacteristics(characteristics);
    const createdAt = Date.now();
    
    return {
        id,
        name: normalizedName,
        priceMode,
        priceCOP,
        image,
        createdAt,
        characteristics: normalizedCharacteristics
    };
}

/**
 * Convierte un registro local Stage 1/Stage 2 sin mutar el origen.
 * Los registros Stage 1 no tienen características y reciben una lista vacía.
 * Si el campo existe, se normaliza y valida conservando el orden.
 *
 * @param {Object} record - Registro persistido
 * @returns {Object} Registro compatible con ProductRecord de Stage 2
 */
function invalidRecordError(message, code, field) {
    const error = new InvalidProductError(message);
    error.code = code;
    error.field = field;
    return error;
}

function assertValidRecordShape(record) {
    if (!isUuid(record.id)) {
        throw invalidRecordError(
            'Product id must be a UUID',
            'INVALID_PRODUCT_ID',
            'id',
        );
    }

    if (!isValidProductName(record.name)) {
        throw invalidRecordError(
            'Product name is required and cannot be empty',
            'INVALID_PRODUCT_NAME',
            'name',
        );
    }

    if (typeof record.image !== 'string' || record.image.length === 0) {
        throw invalidRecordError(
            'Image data URI is required',
            'INVALID_PRODUCT_IMAGE',
            'image',
        );
    }

    const validTimestamp = isSupportedDate(record.createdAt);

    if (!validTimestamp) {
        throw invalidRecordError(
            'Product createdAt must be a non-negative timestamp or ISO-8601 UTC datetime',
            'INVALID_CREATED_AT',
            'createdAt',
        );
    }
}

export function deserializeProductRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new InvalidProductError('Product record must be an object');
    }

    // Validar antes de construir la copia garantiza que una lectura inválida
    // nunca pueda convertirse en un registro persistible accidentalmente.
    assertValidRecordShape(record);
    assertValidPrice(record.priceMode, record.priceCOP);

    let characteristics = [];
    if (Object.hasOwn(record, 'characteristics')) {
        if (record.characteristics === undefined) {
            throw new InvalidCharacteristicsError(
                'Characteristics must be an array',
                { code: 'CHARACTERISTICS_NOT_ARRAY' }
            );
        }
        characteristics = normalizeCharacteristics(record.characteristics);
    }

    return {
        ...record,
        characteristics
    };
}

export function renameProduct(product, newName) {
    if (!product || !product.id) {
        throw new InvalidProductError('Invalid product provided');
    }

    // Renombrar no puede legitimar ni persistir un producto cuyo precio ya
    // incumple la invariante del agregado.
    assertValidPrice(product.priceMode, product.priceCOP);

    if (!isValidProductName(newName)) {
        throw new InvalidProductError('Product name is required and cannot be empty');
    }
    const normalizedName = normalizeProductName(newName);
    
    return {
        ...product,
        name: normalizedName
    };
}

/**
 * Obtiene el precio formateado de un producto
 * @param {Object} product - Producto
 * @returns {string} Precio formateado
 */
export function getFormattedPrice(product) {
    assertValidPrice(product.priceMode, product.priceCOP);
    if (product.priceMode === 'amount') {
        return createAmountPrice(product.priceCOP).formatted;
    } else {
        return createInquirePrice().formatted;
    }
}

/**
 * Verifica si un producto tiene precio monetario
 * @param {Object} product - Producto
 * @returns {boolean}
 */
export function hasMonetaryPrice(product) {
    return product.priceMode === 'amount' && isValidPrice(product.priceCOP);
}
