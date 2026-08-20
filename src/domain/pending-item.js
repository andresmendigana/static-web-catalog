/**
 * Entidad para items en la zona de staging (no persistidos)
 */
import { deriveProductName } from './product-name.js';

/**
 * Estados posibles de un item pendiente
 */
export const PendingItemStatus = {
    PROCESSING: 'processing',
    UNRESOLVED: 'unresolved', 
    RESOLVED: 'resolved',
    ERROR: 'error'
};

/**
 * Crea un nuevo item pendiente desde un archivo
 * @param {File} file - Archivo de imagen
 * @param {string} dataUri - Data URI de la imagen procesada
 * @returns {Object} Item pendiente
 */
export function createPendingItem(file, dataUri) {
    const id = crypto.randomUUID();
    const derivedName = deriveProductName(file.name);
    
    return {
        id,
        file,
        derivedName,
        currentName: derivedName, // Editable por el usuario
        dataUri,
        status: PendingItemStatus.UNRESOLVED,
        priceMode: undefined, // Sin resolver inicialmente
        priceCOP: null,
        error: null
    };
}

/**
 * Crea un item pendiente en estado de error
 * @param {File} file - Archivo que falló
 * @param {string} errorMessage - Mensaje de error
 * @returns {Object} Item pendiente con error
 */
export function createErrorPendingItem(file, errorMessage) {
    const id = crypto.randomUUID();
    const derivedName = deriveProductName(file.name);
    
    return {
        id,
        file,
        derivedName,
        currentName: derivedName,
        dataUri: null,
        status: PendingItemStatus.ERROR,
        priceMode: undefined,
        priceCOP: null,
        error: errorMessage
    };
}

/**
 * Resuelve un item con precio monetario
 * @param {Object} item - Item pendiente
 * @param {number} price - Precio en COP
 * @returns {Object} Item resuelto
 */
export function resolveWithAmount(item, price) {
    return {
        ...item,
        status: PendingItemStatus.RESOLVED,
        priceMode: 'amount',
        priceCOP: price,
        error: null
    };
}

/**
 * Resuelve un item para consultar precio
 * @param {Object} item - Item pendiente
 * @returns {Object} Item resuelto
 */
export function resolveWithInquire(item) {
    return {
        ...item,
        status: PendingItemStatus.RESOLVED,
        priceMode: 'inquire',
        priceCOP: null,
        error: null
    };
}

/**
 * Vuelve un item al estado sin resolver
 * @param {Object} item - Item pendiente
 * @returns {Object} Item sin resolver
 */
export function unresolveItem(item) {
    return {
        ...item,
        status: PendingItemStatus.UNRESOLVED,
        priceMode: undefined,
        priceCOP: null,
        error: null
    };
}

/**
 * Actualiza el nombre de un item pendiente
 * @param {Object} item - Item pendiente
 * @param {string} newName - Nuevo nombre
 * @returns {Object} Item con nombre actualizado
 */
export function updateItemName(item, newName) {
    return {
        ...item,
        currentName: newName.trim()
    };
}

/**
 * Verifica si un item está resuelto
 * @param {Object} item - Item pendiente
 * @returns {boolean}
 */
export function isItemResolved(item) {
    return item.status === PendingItemStatus.RESOLVED && 
           item.priceMode !== undefined;
}

/**
 * Verifica si un item tiene error
 * @param {Object} item - Item pendiente
 * @returns {boolean}
 */
export function isItemError(item) {
    return item.status === PendingItemStatus.ERROR;
}
