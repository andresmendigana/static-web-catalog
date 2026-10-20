/**
 * Caso de uso: Agregar productos desde items pendientes resueltos
 */
import { createProduct } from '../../domain/product.js';
import { isItemResolved } from '../../domain/pending-item.js';
import { normalizeCharacteristics } from '../../domain/characteristics.js';
import { CATALOG_PRODUCT_LIMIT } from '../../domain/catalog-limits.js';
import {
    InvalidProductError,
    QuotaExceededError,
    StorageUnavailableError,
} from '../../domain/errors.js';

/**
 * Agrega productos al catálogo desde una lista de items pendientes
 * @param {ProductRepository} repository - Repositorio de productos
 * @param {Array} resolvedItems - Items pendientes resueltos
 * @returns {Promise<Object>} Resultado con éxitos y fallos
 */
function validationFailure(item, message, error = new InvalidProductError(message)) {
    return {
        item,
        failureType: 'validation',
        reason: message,
        error: error.message,
    };
}

/**
 * Valida la frontera de confirmación sin tocar el repositorio.
 * La UI filtra estas filas para habilitar el botón, pero el caso de uso debe
 * seguir siendo seguro cuando se invoca directamente o desde otro adaptador.
 */
function validatePendingItem(item) {
    if (!item || !isItemResolved(item)) {
        return validationFailure(
            item,
            'La fila no está resuelta. Completa el precio antes de agregarla.',
        );
    }

    if (item.characteristicsError) {
        return validationFailure(
            item,
            'Corrige las características inválidas antes de agregar la fila.',
            item.characteristicsError,
        );
    }

    try {
        normalizeCharacteristics(item.characteristics ?? []);
    } catch (error) {
        return validationFailure(
            item,
            'Corrige las características inválidas antes de agregar la fila.',
            error,
        );
    }

    return null;
}

function validateUploadAssociation(item) {
    if (item.uploadState === undefined) return null;
    const confirmed = item.uploadState === 'loaded'
        && item.imageReference
        && typeof item.imageReference === 'object'
        && !Array.isArray(item.imageReference)
        && typeof item.imageReference.key === 'string'
        && item.imageReference.key.length > 0
        && item.imageReference.contentType === 'image/jpeg';
    return confirmed
        ? null
        : validationFailure(item, 'Confirma la carga de imagen antes de asociarla al producto.');
}

export async function addProducts(repository, resolvedItems) {
    const results = {
        successful: [],
        failed: [],
        reachedLimit: false
    };

    for (const item of resolvedItems) {
        const invalidFailure = validatePendingItem(item);
        if (invalidFailure) {
            results.failed.push(invalidFailure);
            continue;
        }

        const uploadFailure = validateUploadAssociation(item);
        if (uploadFailure) {
            results.failed.push(uploadFailure);
            continue;
        }

        try {
            // Crear el producto antes de consultar o escribir el repositorio.
            // Así ningún registro inválido puede llegar a repository.add().
            const imageReference = item.imageReference ?? item.dataUri;
            const product = createProduct({
                name: item.currentName,
                priceMode: item.priceMode,
                priceCOP: item.priceCOP,
                // The domain model keeps the processed local bytes while the
                // repository receives the confirmed S3 reference separately.
                // This preserves local mode and prevents an unconfirmed object
                // from being treated as a local image.
                image: item.dataUri,
                characteristics: item.characteristics ?? []
            });

            // Verificar límite antes de cada adición para conservar confirmación parcial.
            const currentCount = await repository.count();
            if (currentCount >= CATALOG_PRODUCT_LIMIT) {
                results.reachedLimit = true;
                results.failed.push({
                    item,
                    failureType: 'capacity',
                    reason: `Se alcanzó el límite de ${CATALOG_PRODUCT_LIMIT} productos. Elimina un producto para liberar un cupo`,
                    error: `Cannot add more than ${CATALOG_PRODUCT_LIMIT} products`,
                });
                continue;
            }

            // Agregar al repositorio; el repositorio conserva la autoridad final.
            await repository.add(product, imageReference);

            results.successful.push({
                item,
                productId: product.id
            });

        } catch (error) {
            let reason = 'Error interno al guardar el producto';
            let failureType = 'storage';

            if (error instanceof QuotaExceededError
                && error.message.includes(`Cannot add more than ${CATALOG_PRODUCT_LIMIT}`)) {
                reason = `Se alcanzó el límite de ${CATALOG_PRODUCT_LIMIT} productos. Elimina un producto para liberar un cupo`;
                failureType = 'capacity';
                results.reachedLimit = true;
            } else if (error instanceof QuotaExceededError || error instanceof StorageUnavailableError) {
                reason = 'No se pudo guardar el producto. Revisa el almacenamiento e inténtalo de nuevo';
            } else if (error instanceof InvalidProductError) {
                reason = error.message;
                failureType = 'validation';
            }

            results.failed.push({
                item,
                failureType,
                reason,
                error: error.message
            });
        }
    }

    return results;
}
