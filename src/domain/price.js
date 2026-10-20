/**
 * Value Object para precios en pesos colombianos
 */
import { InvalidPriceError } from './errors.js';

export const PRICE_ERROR_CODES = Object.freeze({
    INVALID_MODE: 'INVALID_PRICE_MODE',
    AMOUNT_MUST_BE_NON_NEGATIVE_INTEGER: 'AMOUNT_PRICE_MUST_BE_NON_NEGATIVE_INTEGER',
    INQUIRE_MUST_BE_NULL: 'INQUIRE_PRICE_MUST_BE_NULL'
});

/**
 * Valida que un precio sea un entero no negativo.
 * @param {number} price - Precio a validar
 * @returns {boolean}
 */
export function isValidPrice(price) {
    return typeof price === 'number' &&
           Number.isInteger(price) &&
           price >= 0;
}

/**
 * Valida la relación completa entre el modo y el monto del precio.
 * Esta función es la única frontera de la invariante amount/inquire.
 *
 * @param {'amount'|'inquire'} priceMode
 * @param {number|null} priceCOP
 * @returns {true}
 * @throws {InvalidPriceError}
 */
export function assertValidPrice(priceMode, priceCOP) {
    if (priceMode === 'amount') {
        if (!isValidPrice(priceCOP)) {
            throw new InvalidPriceError(
                'Price must be a non-negative integer when priceMode is amount',
                {
                    code: PRICE_ERROR_CODES.AMOUNT_MUST_BE_NON_NEGATIVE_INTEGER,
                    priceMode,
                    priceCOP
                }
            );
        }
        return true;
    }

    if (priceMode === 'inquire') {
        if (priceCOP !== null) {
            throw new InvalidPriceError(
                'Price must be null when priceMode is inquire',
                {
                    code: PRICE_ERROR_CODES.INQUIRE_MUST_BE_NULL,
                    priceMode,
                    priceCOP
                }
            );
        }
        return true;
    }

    throw new InvalidPriceError(
        'priceMode must be either "amount" or "inquire"',
        {
            code: PRICE_ERROR_CODES.INVALID_MODE,
            field: 'priceMode',
            priceMode,
            priceCOP
        }
    );
}

// Alias semántico para consumidores que prefieren una función de validación.
export const validatePrice = assertValidPrice;

/**
 * Formatea un precio en pesos colombianos sin decimales
 * @param {number} price - Precio a formatear
 * @returns {string} Precio formateado (ej: $1.234.567)
 */
export function formatPriceCOP(price) {
    assertValidPrice('amount', price);

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
    assertValidPrice('amount', amount);

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
