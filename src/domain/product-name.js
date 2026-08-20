/**
 * Value Object para nombres de productos
 */

/**
 * Deriva un nombre legible desde el nombre de archivo
 * @param {string} filename - Nombre del archivo
 * @returns {string} Nombre legible capitalizado
 */
export function deriveProductName(filename) {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Filename is required and must be a string');
    }

    // Quitar extensión
    const nameWithoutExtension = filename.replace(/\.[^/.]+$/, '');
    
    // Reemplazar separadores por espacios
    const withSpaces = nameWithoutExtension
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ') // Colapsar espacios múltiples
        .trim();
    
    // Capitalizar cada palabra
    return withSpaces
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Valida que un nombre de producto sea válido
 * @param {string} name - Nombre a validar
 * @returns {boolean}
 */
export function isValidProductName(name) {
    return typeof name === 'string' && name.trim().length > 0;
}

/**
 * Normaliza un nombre de producto
 * @param {string} name - Nombre a normalizar
 * @returns {string} Nombre normalizado
 */
export function normalizeProductName(name) {
    if (!isValidProductName(name)) {
        throw new Error('Product name cannot be empty');
    }
    
    return name.trim();
}
