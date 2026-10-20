/**
 * Value objects para las características opcionales de un producto.
 *
 * Las constantes de este módulo son el único origen de los límites del
 * contrato de características de Stage 2.
 */
import { InvalidProductError } from './errors.js';

export const CHARACTERISTIC_LIMITS = Object.freeze({
    MIN_LABEL_LENGTH: 1,
    MAX_LABEL_LENGTH: 40,
    MIN_VALUE_LENGTH: 1,
    MAX_VALUE_LENGTH: 120,
    MAX_ITEMS: 12
});

/**
 * Error de dominio para una característica o lista de características inválida.
 */
export class InvalidCharacteristicsError extends InvalidProductError {
    constructor(message, { code = 'INVALID_CHARACTERISTICS', index = null, field = null } = {}) {
        super(message);
        this.name = 'InvalidCharacteristicsError';
        this.code = code;
        this.index = index;
        this.field = field;
    }
}

function characterLength(value) {
    return Array.from(value).length;
}

function normalizeText(value, field, index, limits) {
    if (typeof value !== 'string') {
        throw new InvalidCharacteristicsError(
            `Characteristic ${field} must be a string`,
            { code: `INVALID_CHARACTERISTIC_${field.toUpperCase()}`, index, field }
        );
    }

    const normalized = value.trim();
    const length = characterLength(normalized);
    if (length < limits.min || length > limits.max) {
        throw new InvalidCharacteristicsError(
            `Characteristic ${field} must contain between ${limits.min} and ${limits.max} characters`,
            { code: `INVALID_CHARACTERISTIC_${field.toUpperCase()}_LENGTH`, index, field }
        );
    }

    return normalized;
}

/**
 * Crea y normaliza un par ordenado de característica.
 *
 * @param {{label: string, value: string}} pair
 * @param {number|null} index - Índice de la fila para errores identificables
 * @returns {{label: string, value: string}}
 */
export function createCharacteristic(pair, index = null) {
    if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
        throw new InvalidCharacteristicsError(
            'Each characteristic must be an object with label and value',
            { code: 'INVALID_CHARACTERISTIC', index }
        );
    }

    const { label, value } = pair;
    return {
        label: normalizeText(label, 'label', index, {
            min: CHARACTERISTIC_LIMITS.MIN_LABEL_LENGTH,
            max: CHARACTERISTIC_LIMITS.MAX_LABEL_LENGTH
        }),
        value: normalizeText(value, 'value', index, {
            min: CHARACTERISTIC_LIMITS.MIN_VALUE_LENGTH,
            max: CHARACTERISTIC_LIMITS.MAX_VALUE_LENGTH
        })
    };
}

/**
 * Normaliza una lista de características sin mutar la entrada.
 * Los elementos se mantienen en el orden recibido y se permiten etiquetas repetidas.
 *
 * @param {Array<{label: string, value: string}>|undefined} characteristics
 * @returns {Array<{label: string, value: string}>}
 */
export function normalizeCharacteristics(characteristics = []) {
    if (!Array.isArray(characteristics)) {
        throw new InvalidCharacteristicsError(
            'Characteristics must be an array',
            { code: 'CHARACTERISTICS_NOT_ARRAY' }
        );
    }

    if (characteristics.length > CHARACTERISTIC_LIMITS.MAX_ITEMS) {
        throw new InvalidCharacteristicsError(
            `Characteristics cannot contain more than ${CHARACTERISTIC_LIMITS.MAX_ITEMS} items`,
            { code: 'CHARACTERISTICS_LIMIT_EXCEEDED' }
        );
    }

    return characteristics.map((pair, index) => {
        if (!pair || typeof pair !== 'object' || Array.isArray(pair)) {
            throw new InvalidCharacteristicsError(
                'Each characteristic must be an object with label and value',
                { code: 'INVALID_CHARACTERISTIC', index }
            );
        }
        return createCharacteristic(pair, index);
    });
}

/**
 * Indica si una lista puede normalizarse como características válidas.
 */
export function isValidCharacteristics(characteristics) {
    try {
        normalizeCharacteristics(characteristics);
        return true;
    } catch (error) {
        return false;
    }
}
