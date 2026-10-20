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
     * @param {{idempotencyKey?: string}} [options] - Clave para reintentos seguros
     * @returns {Promise<void>}
     * @throws {QuotaExceededError} Si se alcanza el límite de productos o almacenamiento
     * @throws {StorageUnavailableError} Si el almacenamiento no está disponible
     */
    async add(product, imageDataUri, options) {
        throw new Error('Method add() must be implemented');
    }

    /**
     * Cambia el nombre de un producto existente
     * @param {string} id - ID del producto
     * @param {string} newName - Nuevo nombre
     * @param {{expectedVersion?: number, idempotencyKey?: string}} [options]
     * @returns {Promise<Object|void>} Producto actualizado cuando el adaptador lo devuelve
     * @throws {ProductNotFoundError} Si el producto no existe
     * @throws {InvalidProductError} Si el nombre o la versión son inválidos
     */
    async rename(id, newName, options = undefined) {
        throw new Error('Method rename() must be implemented');
    }

    /**
     * Elimina un producto del repositorio
     * @param {string} id - ID del producto a eliminar
     * @param {{expectedVersion?: number, idempotencyKey?: string}} [options]
     * @returns {Promise<void>}
     */
    async remove(id, options = undefined) {
        throw new Error('Method remove() must be implemented');
    }

    /**
     * Cuenta el número de productos en el repositorio
     * @returns {Promise<number>} Cantidad de productos
     */
    async count() {
        throw new Error('Method count() must be implemented');
    }

    /**
     * Asocia una referencia de imagen confirmada usando concurrencia optimista.
     * @param {string} id - ID del producto
     * @param {{key: string, contentType: 'image/jpeg'}} imageReference
     * @param {{expectedVersion?: number, idempotencyKey?: string}} [options]
     * @returns {Promise<Object>} Producto actualizado
     */
    async associateImage(id, imageReference, options) {
        throw new Error('Method associateImage() must be implemented');
    }

    /**
     * Persists a validated import as one atomic batch. Implementations MUST
     * reject the complete batch before writing when it cannot be committed;
     * callers must not emulate this with sequential add() calls.
     * @param {Array<Object>} products - Products from a validated export package
     * @param {{ownerId?: string, idempotencyKey?: string}} [options]
     * @returns {Promise<Array<Object>>} Persisted products
     */
    async importProducts(products, options) {
        throw new Error('Method importProducts() must be implemented');
    }
}
