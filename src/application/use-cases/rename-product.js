/**
 * Caso de uso: Renombrar un producto
 */
import { normalizeProductName } from '../../domain/product-name.js';

/**
 * Cambia el nombre de un producto
 * @param {ProductRepository} repository - Repositorio de productos
 * @param {string} productId - ID del producto
 * @param {string} newName - Nuevo nombre
 * @returns {Promise<void>}
 */
export async function renameProduct(repository, productId, newName) {
    // La validación del nombre se hace en el repositorio
    await repository.rename(productId, newName);
}
