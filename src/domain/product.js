/**
 * Entidad Product - Agregado raíz del dominio
 */
import { isValidProductName, normalizeProductName } from './product-name.js';
import { isValidPrice, createAmountPrice, createInquirePrice } from './price.js';
import { InvalidProductError } from './errors.js';

/**
 * Crea un nuevo producto
 * @param {Object} params - Parámetros del producto
 * @param {string} params.name - Nombre del producto
 * @param {'amount'|'inquire'} params.priceMode - Modo de precio
 * @param {number|null} params.priceCOP - Precio en COP (requerido si priceMode es 'amount')
 * @param {string} params.image - Data URI de la imagen
 * @returns {Object} Producto válido
 */
export function createProduct({ name, priceMode, priceCOP, image }) {
    // Validar ID (se genera automáticamente)
    const id = crypto.randomUUID();
    
    // Validar nombre
    if (!isValidProductName(name)) {
        throw new InvalidProductError('Product name is required and cannot be empty');
    }
    const normalizedName = normalizeProductName(name);
    
    // Validar precio según el modo
    if (priceMode === 'amount') {
        if (!isValidPrice(priceCOP)) {
            throw new InvalidProductError('Price must be a non-negative integer when priceMode is amount');
        }
    } else if (priceMode === 'inquire') {
        if (priceCOP !== null) {
            throw new InvalidProductError('Price must be null when priceMode is inquire');
        }
    } else {
        throw new InvalidProductError('priceMode must be either "amount" or "inquire"');
    }
    
    // Validar imagen
    if (!image || typeof image !== 'string') {
        throw new InvalidProductError('Image data URI is required');
    }
    
    const createdAt = Date.now();
    
    return {
        id,
        name: normalizedName,
        priceMode,
        priceCOP,
        image,
        createdAt
    };
}

/**
 * Cambia el nombre de un producto existente
 * @param {Object} product - Producto existente
 * @param {string} newName - Nuevo nombre
 * @returns {Object} Producto con nombre actualizado
 */
export function renameProduct(product, newName) {
    if (!product || !product.id) {
        throw new InvalidProductError('Invalid product provided');
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
