/**
 * Implementación del repositorio sobre localStorage.
 *
 * Las lecturas son no destructivas: los registros que no cumplen el contrato
 * se excluyen del resultado y quedan disponibles mediante getLastReadIssues().
 * Ningún método reescribe el almacenamiento como efecto de una validación.
 * 
 * MODIFICADO PARA STAGE 2 CON URLs:
 * Acepta URLs de imágenes en lugar de data URIs para reducir tamaño de localStorage
 */
import { ProductRepository } from '../application/ports/product-repository.js';
import { CATALOG_PRODUCT_LIMIT } from '../domain/catalog-limits.js';
import { deserializeProductRecord, renameProduct } from '../domain/product.js';
import {
    QuotaExceededError,
    StorageUnavailableError,
    ProductNotFoundError,
    InvalidProductError,
} from '../domain/errors.js';

const STORAGE_KEY = 'staticwebcatalog_products';

function toTimestampMilliseconds(value) {
    return typeof value === 'number' ? value : Date.parse(value);
}

export class LocalStorageRepository extends ProductRepository {
    constructor() {
        super();
        this._lastReadIssues = [];
        this._checkStorageAvailability();
    }

    async list() {
        this._lastReadIssues = [];

        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return [];

            const products = JSON.parse(data);
            if (!Array.isArray(products)) {
                throw new StorageUnavailableError('Persisted product catalog must be an array');
            }

            const validProducts = [];
            products.forEach((record, recordIndex) => {
                try {
                    validProducts.push(deserializeProductRecord(record));
                } catch (error) {
                    this._lastReadIssues.push({
                        recordIndex,
                        recordId: record && typeof record === 'object' ? record.id ?? null : null,
                        error,
                    });
                }
            });

            // Ordenar una copia creada por JSON.parse no muta el valor guardado.
            // Stage 1 usa timestamps numéricos; los registros exportables también
            // pueden usar fechas ISO-8601. La comparación se hace en milisegundos
            // sin cambiar la representación persistida.
            return validProducts.sort((a, b) => (
                toTimestampMilliseconds(b.createdAt) - toTimestampMilliseconds(a.createdAt)
            ));
        } catch (error) {
            if (error instanceof StorageUnavailableError) {
                throw error;
            }
            throw new StorageUnavailableError('Failed to read from localStorage');
        }
    }

    /**
     * Devuelve los problemas de la última lectura sin exponer una referencia
     * mutable al estado interno del repositorio.
     */
    getLastReadIssues() {
        return this._lastReadIssues.map((issue) => ({ ...issue }));
    }

    /**
     * Añade un producto con su imagen.
     * 
     * MODIFICADO: Acepta URL de imagen (string) en lugar de data URI.
     * Ejemplo: image = "https://dummyjson.com/image/1/200"
     * 
     * @param {Object} product - Producto a agregar
     * @param {string} imageUrl - URL de la imagen (puede ser data URI o URL pública)
     */
    async add(product, imageUrl) {
        try {
            // Validar antes de cualquier escritura o cambio de estado.
            const normalizedProduct = deserializeProductRecord(product);
            const products = await this.list();
            this._throwOnReadIssues();

            if (products.length >= CATALOG_PRODUCT_LIMIT) {
                throw new QuotaExceededError(`Cannot add more than ${CATALOG_PRODUCT_LIMIT} products`);
            }

            const productToStore = {
                ...normalizedProduct,
                image: imageUrl ?? normalizedProduct.image,
            };

            products.push(productToStore);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
        } catch (error) {
            if (error instanceof InvalidProductError
                || error instanceof ProductNotFoundError
                || error instanceof QuotaExceededError
                || error instanceof StorageUnavailableError) {
                throw error;
            }

            if (error?.name === 'QUOTA_EXCEEDED_ERR'
                || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                throw new QuotaExceededError('Storage quota exceeded');
            }

            throw new StorageUnavailableError(`Failed to save product: ${error.message}`);
        }
    }

    async rename(id, newName) {
        try {
            const products = await this.list();
            this._throwOnReadIssues();

            const productIndex = products.findIndex((product) => product.id === id);
            if (productIndex === -1) {
                throw new ProductNotFoundError(id);
            }

            const renamedProduct = renameProduct(products[productIndex], newName);
            const updatedProducts = products.map((product, index) => (
                index === productIndex ? renamedProduct : product
            ));

            localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProducts));
        } catch (error) {
            if (error instanceof ProductNotFoundError
                || error instanceof InvalidProductError
                || error instanceof StorageUnavailableError) {
                throw error;
            }

            if (error?.name === 'QUOTA_EXCEEDED_ERR'
                || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                throw new QuotaExceededError('Storage quota exceeded');
            }

            throw new StorageUnavailableError(`Failed to rename product: ${error.message}`);
        }
    }

    async remove(id) {
        try {
            const products = await this.list();
            this._throwOnReadIssues();
            const filteredProducts = products.filter((product) => product.id !== id);

            localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredProducts));
        } catch (error) {
            if (error instanceof InvalidProductError || error instanceof StorageUnavailableError) {
                throw error;
            }
            throw new StorageUnavailableError(`Failed to remove product: ${error.message}`);
        }
    }

    async count() {
        const products = await this.list();
        return products.length;
    }

    _throwOnReadIssues() {
        const firstIssue = this._lastReadIssues[0];
        if (!firstIssue) return;

        // El error tipado original conserva su código y recibe el contexto de
        // la fila solo para que la autoría pueda identificarla.
        if (firstIssue.error && firstIssue.error.recordIndex === undefined) {
            firstIssue.error.recordIndex = firstIssue.recordIndex;
        }
        throw firstIssue.error;
    }

    _checkStorageAvailability() {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
        } catch (error) {
            throw new StorageUnavailableError('localStorage is not available');
        }
    }
}
