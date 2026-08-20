/**
 * Caso de uso: Listar productos
 */

/**
 * Lista todos los productos del catálogo
 * @param {ProductRepository} repository - Repositorio de productos
 * @returns {Promise<Array>} Lista de productos ordenada por fecha (más reciente primero)
 */
export async function listProducts(repository) {
    return await repository.list();
}

/**
 * Obtiene el conteo actual de productos
 * @param {ProductRepository} repository - Repositorio de productos
 * @returns {Promise<number>} Cantidad de productos
 */
export async function getProductCount(repository) {
    return await repository.count();
}
