/**
 * Caso de uso: Agregar productos desde items pendientes resueltos
 */
import { createProduct } from '../../domain/product.js';
import { QuotaExceededError } from '../../domain/errors.js';

/**
 * Agrega productos al catálogo desde una lista de items pendientes
 * @param {ProductRepository} repository - Repositorio de productos
 * @param {Array} resolvedItems - Items pendientes resueltos
 * @returns {Promise<Object>} Resultado con éxitos y fallos
 */
export async function addProducts(repository, resolvedItems) {
    const results = {
        successful: [],
        failed: [],
        reachedLimit: false
    };

    for (const item of resolvedItems) {
        try {
            // Verificar límite antes de cada adición
            const currentCount = await repository.count();
            if (currentCount >= 10) {
                results.reachedLimit = true;
                results.failed.push({
                    item,
                    reason: 'Se alcanzó el límite de 10 productos'
                });
                continue;
            }

            // Crear producto del dominio
            const product = createProduct({
                name: item.currentName,
                priceMode: item.priceMode,
                priceCOP: item.priceCOP,
                image: item.dataUri
            });

            // Agregar al repositorio
            await repository.add(product, item.dataUri);
            
            results.successful.push({
                item,
                productId: product.id
            });

        } catch (error) {
            let reason = 'Error interno';
            
            if (error instanceof QuotaExceededError) {
                reason = 'No hay espacio suficiente para guardar el producto';
            }
            
            results.failed.push({
                item,
                reason,
                error: error.message
            });
        }
    }

    return results;
}
