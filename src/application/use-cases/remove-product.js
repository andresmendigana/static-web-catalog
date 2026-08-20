/**
 * Caso de uso: Eliminar un producto
 */

/**
 * Elimina un producto del catálogo
 * @param {ProductRepository} repository - Repositorio de productos
 * @param {string} productId - ID del producto a eliminar
 * @returns {Promise<void>}
 */
export async function removeProduct(repository, productId) {
    await repository.remove(productId);
}
