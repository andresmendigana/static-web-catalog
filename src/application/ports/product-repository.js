/**
 * Puerto del repositorio - Define la interfaz que debe implementar cualquier repositorio de productos
 */

/**
 * @interface ProductRepository
 */
export class ProductRepository {
    /**
     * Lista todos los productos ordenados por fecha de creación (más reciente primero)
     * @returns {Promise<Array>} Array de productos
     */
    async list() {
        throw new Error('Method list() must be implemented');
    }

    /**
     * Agrega un nuevo producto al repositorio
     * @param {Object} product - Producto a agregar
     * @param {string} imageDataUri - Data URI de la imagen
     * @returns {Promise<void>}
     * @throws {QuotaExceededError} Si se alcanza el límite de productos o almacenamiento
     * @throws {StorageUnavailableError} Si el almacenamiento no está disponible
     */
    async add(product, imageDataUri) {
        throw new Error('Method add() must be implemented');
    }

    /**
     * Cambia el nombre de un producto existente
     * @param {string} id - ID del producto
     * @param {string} newName - Nuevo nombre
     * @returns {Promise<void>}
     * @throws {ProductNotFoundError} Si el producto no existe
     * @throws {InvalidProductError} Si el nombre es inválido
     */
    async rename(id, newName) {
        throw new Error('Method rename() must be implemented');
    }

    /**
     * Elimina un producto del repositorio
     * @param {string} id - ID del producto a eliminar
     * @returns {Promise<void>}
     */
    async remove(id) {
        throw new Error('Method remove() must be implemented');
    }

    /**
     * Cuenta el número de productos en el repositorio
     * @returns {Promise<number>} Cantidad de productos
     */
    async count() {
        throw new Error('Method count() must be implemented');
    }
}
