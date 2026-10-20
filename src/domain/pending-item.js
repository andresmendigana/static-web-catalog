/**
 * Entidad para items en la zona de staging (no persistidos)
 */
import { deriveProductName } from './product-name.js';
import {
    CHARACTERISTIC_LIMITS,
    InvalidCharacteristicsError,
    normalizeCharacteristics,
} from './characteristics.js';

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
        characteristics: [],
        characteristicsError: null,
        capacityError: null,
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
        characteristics: [],
        characteristicsError: null,
        capacityError: null,
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
 * Crea el borrador vacío que se muestra antes de completar un par.
 * El borrador puede ser temporalmente inválido, pero nunca muta el item.
 *
 * @returns {{label: string, value: string}}
 */
export function createCharacteristicDraft() {
    return { label: '', value: '' };
}

/**
 * Agrega un par de característica al borrador pendiente.
 *
 * @param {Object} item - Item pendiente
 * @returns {Object} Item con el nuevo par, o con un error si alcanzó el límite
 */
export function addPendingCharacteristic(item) {
    const characteristics = item.characteristics ?? [];
    if (characteristics.length >= CHARACTERISTIC_LIMITS.MAX_ITEMS) {
        return {
            ...item,
            characteristicsError: new InvalidCharacteristicsError(
                `Characteristics cannot contain more than ${CHARACTERISTIC_LIMITS.MAX_ITEMS} items`,
                { code: 'CHARACTERISTICS_LIMIT_EXCEEDED' },
            ),
        };
    }

    return {
        ...item,
        characteristics: [...characteristics, createCharacteristicDraft()],
        characteristicsError: new InvalidCharacteristicsError(
            'Complete the new characteristic or remove it',
            { code: 'INCOMPLETE_CHARACTERISTIC' },
        ),
    };
}

/**
 * Actualiza una celda del borrador y normaliza la lista cuando queda válida.
 * Si queda inválida, conserva los valores escritos y el error para que el
 * usuario pueda corregirlos sin perder nombre, precio o imagen.
 *
 * @param {Object} item - Item pendiente
 * @param {number} index - Índice del par
 * @param {'label'|'value'} field - Campo a actualizar
 * @param {string} value - Texto introducido
 * @returns {Object} Item pendiente actualizado
 */
export function updatePendingCharacteristic(item, index, field, value) {
    if (!['label', 'value'].includes(field)) return item;

    const characteristics = [...(item.characteristics ?? [])];
    if (!characteristics[index]) return item;

    characteristics[index] = { ...characteristics[index], [field]: value };
    try {
        return {
            ...item,
            characteristics: normalizeCharacteristics(characteristics),
            characteristicsError: null,
        };
    } catch (error) {
        return {
            ...item,
            characteristics,
            characteristicsError: error,
        };
    }
}

/**
 * Elimina un par del borrador y conserva el orden de los restantes.
 *
 * @param {Object} item - Item pendiente
 * @param {number} index - Índice del par a eliminar
 * @returns {Object} Item pendiente actualizado
 */
export function removePendingCharacteristic(item, index) {
    const characteristics = (item.characteristics ?? [])
        .filter((_, itemIndex) => itemIndex !== index);

    try {
        return {
            ...item,
            characteristics: normalizeCharacteristics(characteristics),
            characteristicsError: null,
        };
    } catch (error) {
        return {
            ...item,
            characteristics,
            characteristicsError: error,
        };
    }
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
