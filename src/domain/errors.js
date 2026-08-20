/**
 * Errores específicos del dominio
 */

export class InvalidProductError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidProductError';
    }
}

export class QuotaExceededError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QuotaExceededError';
    }
}

export class StorageUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StorageUnavailableError';
    }
}

export class ProductNotFoundError extends Error {
    constructor(id) {
        super(`Product with id ${id} not found`);
        this.name = 'ProductNotFoundError';
        this.productId = id;
    }
}
