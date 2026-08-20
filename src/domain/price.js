/**
 * Value Object para precios en pesos colombianos
 */

/**
 * Valida que un precio sea un entero no negativo
 * @param {number} price - Precio a validar
 * @returns {boolean}
 */
export function isValidPrice(price) {
    return typeof price === 'number' && 
           Number.isInteger(price) && 
           price >= 0;
}

/**
 * Formatea un precio en pesos colombianos sin decimales
 * @param {number} price - Precio a formatear
 * @returns {string} Precio formateado (ej: $1.234.567)
 */
export function formatPriceCOP(price) {
    if (!isValidPrice(price)) {
        throw new Error('Price must be a non-negative integer');
    }

    const formatter = new Intl.NumberFormat('es-CO', {
        maximumFractionDigits: 0
    });
    
    return `$${formatter.format(price)}`;
}

/**
 * Parsea un string de precio a número entero
 * Solo acepta dígitos, ignora otros caracteres
 * @param {string} priceStr - String del precio
 * @returns {number|null} Precio como entero o null si está vacío
 */
export function parsePriceInput(priceStr) {
    if (!priceStr || typeof priceStr !== 'string') {
        return null;
    }

    // Extraer solo dígitos
    const digits = priceStr.replace(/\D/g, '');
    
    if (digits === '') {
        return null;
    }

    // Convertir a número y eliminar ceros iniciales
    const price = parseInt(digits, 10);
    return isNaN(price) ? null : price;
}

/**
 * Crea un objeto Price válido
 * @param {number} amount - Monto en COP
 * @returns {Object} Price object
 */
export function createAmountPrice(amount) {
    if (!isValidPrice(amount)) {
        throw new Error('Price must be a non-negative integer');
    }

    return {
        mode: 'amount',
        amount,
        formatted: formatPriceCOP(amount)
    };
}

/**
 * Crea un price object para "consultar precio"
 * @returns {Object} Price object para consulta
 */
export function createInquirePrice() {
    return {
        mode: 'inquire',
        amount: null,
        formatted: 'Consultar precio'
    };
}
