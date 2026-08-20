/**
 * Implementación del repositorio sobre localStorage
 */
import { ProductRepository } from '../application/ports/product-repository.js';
import { normalizeProductName } from '../domain/product-name.js';
import { QuotaExceededError, StorageUnavailableError, ProductNotFoundError, InvalidProductError } from '../domain/errors.js';

const STORAGE_KEY = 'staticwebcatalog_products';
const MAX_PRODUCTS = 10;

export class LocalStorageRepository extends ProductRepository {
    constructor() {
        super();
        this._checkStorageAvailability();
    }

    async list() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return [];
            
            const products = JSON.parse(data);
            // Ordenar por createdAt descendente (más reciente primero)
            return products.sort((a, b) => b.createdAt - a.createdAt);
        } catch (error) {
            throw new StorageUnavailableError('Failed to read from localStorage');
        }
    }

    async add(product, imageDataUri) {
        try {
            // Verificar límite
            const currentCount = await this.count();
            if (currentCount >= MAX_PRODUCTS) {
                throw new QuotaExceededError(`Cannot add more than ${MAX_PRODUCTS} products`);
            }

            // Leer productos existentes
            const products = await this.list();
            
            // Agregar nuevo producto
            const productToStore = {
                ...product,
                image: imageDataUri
            };
            
            products.push(productToStore);
            
            // Guardar
            localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
            
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                throw error;
            }
            
            if (error.name === 'QUOTA_EXCEEDED_ERR' || 
                error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                throw new QuotaExceededError('Storage quota exceeded');
            }
            
            throw new StorageUnavailableError(`Failed to save product: ${error.message}`);
        }
    }

    async rename(id, newName) {
        try {
            const normalizedName = normalizeProductName(newName);
            const products = await this.list();
            
            const productIndex = products.findIndex(p => p.id === id);
            if (productIndex === -1) {
                throw new ProductNotFoundError(id);
            }
            
            products[productIndex].name = normalizedName;
            
            localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
            
        } catch (error) {
            if (error instanceof ProductNotFoundError || 
                error instanceof InvalidProductError) {
                throw error;
            }
            
            throw new StorageUnavailableError(`Failed to rename product: ${error.message}`);
        }
    }

    async remove(id) {
        try {
            const products = await this.list();
            const filteredProducts = products.filter(p => p.id !== id);
            
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredProducts));
            
        } catch (error) {
            throw new StorageUnavailableError(`Failed to remove product: ${error.message}`);
        }
    }

    async count() {
        const products = await this.list();
        return products.length;
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
