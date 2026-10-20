/**
 * UI básica de autoría local.
 *
 * La UI refleja la capacidad, pero el repositorio y addProducts siguen siendo
 * la autoridad para aceptar o rechazar cada producto.
 */
import { getRandomMensShirtImage } from '../infrastructure/dummyjson-image-service.js';
import { processImagesSequentially } from '../infrastructure/image-processor.js';
import { addProducts } from '../application/use-cases/add-products.js';
import { listProducts, getProductCount } from '../application/use-cases/list-products.js';
import { removeProduct } from '../application/use-cases/remove-product.js';
import {
    createPendingItem,
    createErrorPendingItem,
    resolveWithAmount,
    resolveWithInquire,
    addPendingCharacteristic,
    updatePendingCharacteristic,
    removePendingCharacteristic,
    isItemResolved,
} from '../domain/pending-item.js';
import { getFormattedPrice } from '../domain/product.js';
import { parsePriceInput } from '../domain/price.js';
import { CATALOG_PRODUCT_LIMIT } from '../domain/catalog-limits.js';
import { CHARACTERISTIC_LIMITS, normalizeCharacteristics, isValidCharacteristics } from '../domain/characteristics.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function characteristicErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error?.code === 'CHARACTERISTICS_LIMIT_EXCEEDED') {
        return `Una fila no puede tener más de ${CHARACTERISTIC_LIMITS.MAX_ITEMS} características.`;
    }
    if (error?.field === 'label') {
        return 'Cada etiqueta debe tener entre 1 y 40 caracteres.';
    }
    if (error?.field === 'value') {
        return 'Cada valor debe tener entre 1 y 120 caracteres.';
    }
    return 'Completa las características o elimínalas antes de agregar el producto.';
}

function isConfirmedImageReference(reference) {
    return reference
        && typeof reference === 'object'
        && !Array.isArray(reference)
        && typeof reference.key === 'string'
        && reference.key.length > 0
        && reference.contentType === 'image/jpeg';
}

function authorImageSource(image) {
    if (typeof image === 'string') return image;
    return isConfirmedImageReference(image) ? image.key : '';
}

export async function createBasicUI(repository, { uploadClient = null } = {}) {
    let pendingItems = [];
    let catalogCount = 0;
    const remoteUpload = uploadClient && typeof uploadClient.upload === 'function';

    // Inputs y botones para ambos modos
    const fileInputManual = document.getElementById('file-input-manual');
    const fileInputDummyJson = document.getElementById('file-input-dummyjson');
    const fileButtonManual = document.getElementById('file-button-manual');
    const fileButtonDummyJson = document.getElementById('file-button-dummyjson');
    
    // Variables para rastrear el modo actual
    let currentImageMode = 'dummyjson';
    const stagingArea = document.getElementById('staging-area');
    const addButton = document.getElementById('add-button');
    const catalogGrid = document.getElementById('catalog-grid');
    const emptyState = document.getElementById('empty-state');
    const productCount = document.getElementById('product-count');
    const capacityStatus = document.getElementById('capacity-status');
    const backgroundInput = document.getElementById('background-input');
    const backgroundOverlay = document.getElementById('background-overlay');
    const removeBackgroundBtn = document.getElementById('remove-background');

    await updateCatalogDisplay();
    await updateProductCount();
    loadSavedBackground();

    // Event listeners para modo manual
    fileInputManual.addEventListener('change', (e) => handleFileSelectionMode(e, 'manual'));
    fileButtonManual.addEventListener('click', () => {
        if (!fileButtonManual.disabled) {
            currentImageMode = 'manual';
            fileInputManual.click();
        }
    });
    
    // Event listeners para modo DummyJSON
    fileInputDummyJson.addEventListener('change', (e) => handleFileSelectionMode(e, 'dummyjson'));
    fileButtonDummyJson.addEventListener('click', () => {
        if (!fileButtonDummyJson.disabled) {
            currentImageMode = 'dummyjson';
            fileInputDummyJson.click();
        }
    });
    addButton.addEventListener('click', handleAddProducts);
    backgroundInput.addEventListener('change', handleBackgroundChange);
    removeBackgroundBtn.addEventListener('click', removeBackground);

    function handleBackgroundChange(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            backgroundOverlay.style.backgroundImage = `url(${dataUrl})`;
            localStorage.setItem('catalogBackground', dataUrl);
        };
        reader.readAsDataURL(file);
    }

    function removeBackground() {
        backgroundOverlay.style.backgroundImage = '';
        localStorage.removeItem('catalogBackground');
        backgroundInput.value = '';
    }

    function loadSavedBackground() {
        const savedBg = localStorage.getItem('catalogBackground');
        if (savedBg) backgroundOverlay.style.backgroundImage = `url(${savedBg})`;
    }

    async function handleFileSelectionMode(event, mode) {
        const files = event.target.files;
        if (!files.length) return;

        if (catalogCount >= CATALOG_PRODUCT_LIMIT) {
            updateCapacityUI();
            return;
        }

        addButton.disabled = true;
        
        // Detectar modo desde localStorage
        const imageMode = mode;
        
        if (imageMode === 'manual') {
            // ===== MODO MANUAL: Procesar imágenes locales =====
            stagingArea.innerHTML = '<p>Procesando imágenes...</p>';
            const results = await processImagesSequentially(files, (index, total) => {
                stagingArea.innerHTML = `<p>Procesando ${index + 1} de ${total} imágenes...</p>`;
            });
            
            pendingItems = results.map(result => (
                result.error
                    ? createErrorPendingItem(result.file, result.error)
                    : {
                        ...createPendingItem(result.file, result.dataUri),
                        ...(remoteUpload
                            ? { uploadState: 'pending', imageReference: null }
                            : {}),
                    }
            ));
        } else {
            // ===== MODO DUMMYJSON: Obtener URLs aleatorias =====
            stagingArea.innerHTML = '<p>Obteniendo imágenes de DummyJSON...</p>';
            const results = [];
            const fileArray = Array.from(files);
            
            for (let i = 0; i < fileArray.length; i++) {
                try {
                    const file = fileArray[i];
                    stagingArea.innerHTML = `<p>Obteniendo imágenes de DummyJSON... ${i + 1} de ${fileArray.length}</p>`;
                    
                    const imageUrl = await getRandomMensShirtImage();
                    
                    if (!imageUrl) {
                        results.push({
                            file,
                            error: 'No se pudo obtener imagen de DummyJSON'
                        });
                    } else {
                        results.push({
                            file,
                            imageUrl
                        });
                    }
                } catch (error) {
                    results.push({
                        file: fileArray[i],
                        error: error.message || 'Error obteniendo imagen'
                    });
                }
            }

            pendingItems = results.map(result => (
                result.error
                    ? createErrorPendingItem(result.file, result.error)
                    : {
                        ...createPendingItem(result.file, result.imageUrl),
                        ...(remoteUpload
                            ? { uploadState: 'pending', imageReference: null }
                            : {}),
                    }
            ));
        }

        updateStagingDisplay();
        fileInputManual.value = ''; fileInputDummyJson.value = '';
        if (remoteUpload) setTimeout(() => { void uploadPendingImages(); }, 0);
    }

    async function uploadPendingImages() {
        const uploadableItems = pendingItems.filter(item => item.status !== 'error' && item.uploadState === 'pending');
        await Promise.all(uploadableItems.map(async (item) => {
            pendingItems = pendingItems.map(candidate => candidate.id === item.id
                ? { ...candidate, uploadState: 'loading', uploadError: null }
                : candidate);
            updateStagingDisplay();

            try {
                const imageReference = await uploadClient.upload(item.dataUri, { file: item.file });
                pendingItems = pendingItems.map(candidate => candidate.id === item.id
                    ? { ...candidate, imageReference, uploadState: 'loaded', uploadError: null }
                    : candidate);
            } catch (error) {
                const uploadState = error?.code === 'UPLOAD_EXPIRED' || error?.name === 'UploadExpiredError'
                    ? 'expired'
                    : 'failed';
                pendingItems = pendingItems.map(candidate => candidate.id === item.id
                    ? { ...candidate, imageReference: null, uploadState, uploadError: error?.message ?? 'No se pudo cargar la imagen' }
                    : candidate);
            }
            updateStagingDisplay();
        }));
    }

    function uploadStatusMessage(item) {
        if (!remoteUpload || !item.uploadState) return '';
        const messages = {
            pending: 'Pendiente de carga',
            loading: 'Cargando imagen…',
            loaded: 'Imagen cargada y confirmada',
            expired: 'La carga expiró. Selecciona la imagen nuevamente.',
            failed: `Falló la carga: ${item.uploadError || 'inténtalo de nuevo.'}`,
        };
        return messages[item.uploadState] ?? '';
    }

    function isReady(item) {
        const imageReady = !remoteUpload
            || (item.uploadState === 'loaded' && isConfirmedImageReference(item.imageReference));
        return imageReady
            && isItemResolved(item)
            && !item.characteristicsError
            && isValidCharacteristics(item.characteristics ?? []);
    }

    function clearSubmissionErrors(item) {
        return {
            ...item,
            capacityError: null,
            submissionError: null,
        };
    }

    function updateAddButtonState() {
        const resolvedCount = pendingItems.filter(isReady).length;
        const isFull = catalogCount >= CATALOG_PRODUCT_LIMIT;
        addButton.disabled = isFull || resolvedCount === 0;
        addButton.textContent = resolvedCount > 0
            ? `Agregar ${resolvedCount} productos`
            : 'Agregar al catálogo';
    }

    function updateStagingDisplay() {
        if (!pendingItems.length) {
            stagingArea.innerHTML = '';
            updateAddButtonState();
            return;
        }

        stagingArea.innerHTML = pendingItems.map(item => {
            const characteristics = item.characteristics ?? [];
            const characteristicsValidation = (() => {
                try {
                    normalizeCharacteristics(characteristics);
                    return null;
                } catch (error) {
                    return error;
                }
            })();
            const characteristicsError = item.characteristicsError
                ? characteristicErrorMessage(item.characteristicsError)
                : (characteristicsValidation ? characteristicErrorMessage(characteristicsValidation) : '');
            const rows = characteristics.map((characteristic, index) => `
                <div class="characteristic-row" data-characteristic-index="${index}">
                    <input type="text" class="input characteristic-label" value="${escapeHtml(characteristic.label)}"
                        maxlength="${CHARACTERISTIC_LIMITS.MAX_LABEL_LENGTH}"
                        aria-label="Etiqueta de característica ${index + 1}"
                        onchange="updateItemCharacteristic('${item.id}', ${index}, 'label', this.value)">
                    <input type="text" class="input characteristic-value" value="${escapeHtml(characteristic.value)}"
                        maxlength="${CHARACTERISTIC_LIMITS.MAX_VALUE_LENGTH}"
                        aria-label="Valor de característica ${index + 1}"
                        onchange="updateItemCharacteristic('${item.id}', ${index}, 'value', this.value)">
                    <button type="button" class="btn-delete remove-characteristic"
                        onclick="removeItemCharacteristic('${item.id}', ${index})" aria-label="Eliminar característica ${index + 1}">×</button>
                </div>
            `).join('');
            const canAddCharacteristic = characteristics.length < CHARACTERISTIC_LIMITS.MAX_ITEMS;

            return `
                    <div class="pending-item" data-item-id="${escapeHtml(item.id)}"${remoteUpload ? ` data-upload-state="${escapeHtml(item.uploadState)}"` : ''} style="border: 1px solid #ddd; padding: 16px; margin: 8px 0; display: flex; gap: 16px; align-items: center; background: rgba(255, 255, 255, 0.95); border-radius: 8px;">
                    ${item.dataUri
                        ? `<img src="${escapeHtml(item.dataUri)}" alt="Vista previa" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">`
                        : '<div style="width: 60px; height: 60px; background: #f5f5f5; display: flex; align-items: center; justify-content: center; border-radius: 4px;">Imagen no disponible</div>'}
                    ${uploadStatusMessage(item)
                        ? `<div class="upload-status upload-status-${escapeHtml(item.uploadState)}" role="status" aria-live="polite">${escapeHtml(uploadStatusMessage(item))}</div>`
                        : ''}
                    <div style="flex: 1;">
                        <input type="text" value="${escapeHtml(item.currentName)}" onchange="updateItemName('${item.id}', this.value)" class="input" style="width: 100%; margin-bottom: 8px;">
                        ${item.status === 'error'
                            ? `<div style="color: #d32f2f; font-size: 12px;">${escapeHtml(item.error)}</div>`
                            : `<div style="display: flex; gap: 8px; align-items: center;">
                                <input type="text" placeholder="Precio en COP"
                                    value="${item.priceMode === 'amount' ? escapeHtml(item.priceCOP) : ''}"
                                    onchange="updateItemPrice('${item.id}', this.value)" class="input" style="width: 120px;">
                                <label style="font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                    <input type="checkbox" ${item.priceMode === 'inquire' ? 'checked' : ''}
                                        onchange="toggleInquirePrice('${item.id}', this.checked)"> Consultar precio
                                </label>
                                <button type="button" onclick="removeItem('${item.id}')" class="btn-delete">×</button>
                            </div>`}
                        ${item.status !== 'error' ? `
                            <div class="characteristics-editor" aria-labelledby="characteristics-label-${item.id}">
                                <div class="characteristics-header">
                                    <span id="characteristics-label-${item.id}">Características</span>
                                    <span class="characteristics-count" aria-live="polite" aria-label="${characteristics.length} de ${CHARACTERISTIC_LIMITS.MAX_ITEMS} características">${characteristics.length}/${CHARACTERISTIC_LIMITS.MAX_ITEMS}</span>
                                </div>
                                ${rows}
                                <button type="button" class="add-characteristic" onclick="addItemCharacteristic('${item.id}')" ${canAddCharacteristic ? '' : 'disabled'}>Añadir característica</button>
                                ${characteristicsError ? `<div class="characteristics-error" role="alert" aria-live="assertive">${escapeHtml(characteristicsError)}</div>` : ''}
                            </div>` : ''}
                        ${(item.capacityError || item.submissionError) ? `<div class="pending-submission-error" role="status">${escapeHtml(item.capacityError || item.submissionError)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        updateAddButtonState();
        window.updateItemName = updateItemName;
        window.updateItemPrice = updateItemPrice;
        window.toggleInquirePrice = toggleInquirePrice;
        window.addItemCharacteristic = addItemCharacteristic;
        window.updateItemCharacteristic = updateItemCharacteristic;
        window.removeItemCharacteristic = removeItemCharacteristic;
        window.removeItem = removeItem;
    }

    function updateItemName(itemId, newName) {
        pendingItems = pendingItems.map(item => item.id === itemId
            ? clearSubmissionErrors({ ...item, currentName: newName.trim() })
            : item);
        updateStagingDisplay();
    }

    function updateItemPrice(itemId, priceStr) {
        const item = pendingItems.find(candidate => candidate.id === itemId);
        if (!item) return;

        const price = parsePriceInput(priceStr);
        if (price !== null) {
            pendingItems = pendingItems.map(candidate => candidate.id === itemId
                ? clearSubmissionErrors(resolveWithAmount(candidate, price))
                : candidate);
        } else if (item.priceMode !== 'inquire') {
            pendingItems = pendingItems.map(candidate => candidate.id === itemId
                ? clearSubmissionErrors({ ...candidate, status: 'unresolved', priceMode: undefined, priceCOP: null })
                : candidate);
        }
        updateStagingDisplay();
    }

    function toggleInquirePrice(itemId, isChecked) {
        pendingItems = pendingItems.map(item => {
            if (item.id !== itemId) return item;
            return isChecked
                ? clearSubmissionErrors(resolveWithInquire(item))
                : clearSubmissionErrors({ ...item, status: 'unresolved', priceMode: undefined, priceCOP: null });
        });
        updateStagingDisplay();
    }

    function addItemCharacteristic(itemId) {
        pendingItems = pendingItems.map(item => item.id === itemId
            ? clearSubmissionErrors(addPendingCharacteristic(item))
            : item);
        updateStagingDisplay();
    }

    function updateItemCharacteristic(itemId, index, field, value) {
        pendingItems = pendingItems.map(item => item.id === itemId
            ? clearSubmissionErrors(updatePendingCharacteristic(item, index, field, value))
            : item);
        updateStagingDisplay();
    }

    function removeItemCharacteristic(itemId, index) {
        pendingItems = pendingItems.map(item => item.id === itemId
            ? clearSubmissionErrors(removePendingCharacteristic(item, index))
            : item);
        updateStagingDisplay();
    }

    function removeItem(itemId) {
        pendingItems = pendingItems.filter(item => item.id !== itemId);
        updateStagingDisplay();
    }

    async function handleAddProducts() {
        const resolvedItems = pendingItems.filter(isReady);
        if (!resolvedItems.length || catalogCount >= CATALOG_PRODUCT_LIMIT) return;

        addButton.disabled = true;
        addButton.textContent = 'Agregando...';

        try {
            const result = await addProducts(repository, resolvedItems);
            const successfulIds = new Set(result.successful.map(success => success.item.id));
            const failures = new Map(result.failed.map(failure => [failure.item.id, failure]));

            pendingItems = pendingItems
                .filter(item => !successfulIds.has(item.id))
                .map(item => {
                    const failure = failures.get(item.id);
                    if (!failure) return item;

                    return failure.failureType === 'capacity'
                        ? { ...item, capacityError: failure.reason, submissionError: null }
                        : { ...item, capacityError: null, submissionError: failure.reason };
                });

            if (result.failed.length > 0) {
                alert(`Algunos productos no se pudieron agregar:\n${result.failed.map(failure => failure.reason).join('\n')}`);
            }

            updateStagingDisplay();
            await updateCatalogDisplay();
            await updateProductCount();
        } catch (error) {
            alert(`Error: ${error.message}`);
            await updateProductCount();
            updateStagingDisplay();
        }
    }

    async function updateCatalogDisplay() {
        try {
            const products = await listProducts(repository);
            if (products.length === 0) {
                catalogGrid.style.display = 'none';
                emptyState.style.display = 'block';
                catalogGrid.innerHTML = '';
                return;
            }

            catalogGrid.style.display = 'grid';
            emptyState.style.display = 'none';
            catalogGrid.innerHTML = products.map(product => `
                <div class="product-card">
                    <div class="product-image-container">
                        <img src="${escapeHtml(authorImageSource(product.image))}" alt="${escapeHtml(product.name)}" class="product-image">
                    </div>
                    <div class="product-info">
                        <div class="product-name">${escapeHtml(product.name)}</div>
                        <div class="product-price ${product.priceMode === 'inquire' ? 'inquire' : ''}">${escapeHtml(getFormattedPrice(product))}</div>
                    </div>
                    <div class="product-actions">
                        <button type="button" onclick="handleRemoveProduct('${escapeHtml(product.id)}')" class="btn-delete">Eliminar</button>
                    </div>
                </div>
            `).join('');

            window.handleRemoveProduct = async (productId) => {
                if (!confirm('¿Estás seguro de que quieres eliminar este producto?')) return;
                await removeProduct(repository, productId);
                await updateCatalogDisplay();
                await updateProductCount();
            };
        } catch (error) {
            catalogGrid.innerHTML = `<div style="color: #d32f2f;">Error al cargar productos: ${escapeHtml(error.message)}</div>`;
        }
    }

    function updateCapacityUI() {
        const isFull = catalogCount >= CATALOG_PRODUCT_LIMIT;
        const remaining = Math.max(0, CATALOG_PRODUCT_LIMIT - catalogCount);

        productCount.textContent = `${catalogCount}/${CATALOG_PRODUCT_LIMIT} productos`;
        productCount.setAttribute('aria-label', `${catalogCount} de ${CATALOG_PRODUCT_LIMIT} productos`);
        if (capacityStatus) {
            capacityStatus.setAttribute('role', isFull ? 'alert' : 'status');
            capacityStatus.setAttribute('aria-live', 'polite');
            capacityStatus.textContent = isFull
                ? `Capacidad ${catalogCount}/${CATALOG_PRODUCT_LIMIT}. Se alcanzó el límite. Elimina un producto para agregar otro.`
                : `Capacidad ${catalogCount}/${CATALOG_PRODUCT_LIMIT}. ${remaining} cupos disponibles.`;
            capacityStatus.className = isFull ? 'capacity-status capacity-full' : 'capacity-status';
        }

        fileInputManual.disabled = isFull; fileInputDummyJson.disabled = isFull;
        fileButtonManual.disabled = isFull; fileButtonDummyJson.disabled = isFull;
        fileButtonManual.setAttribute('aria-disabled', String(isFull)); fileButtonDummyJson.setAttribute('aria-disabled', String(isFull));
        updateAddButtonState();
    }

    async function updateProductCount() {
        try {
            catalogCount = await getProductCount(repository);
            updateCapacityUI();
        } catch (error) {
            productCount.textContent = 'Error';
            if (capacityStatus) {
                capacityStatus.setAttribute('role', 'alert');
                capacityStatus.textContent = `No se pudo comprobar la capacidad: ${error.message}`;
            }
        }
    }
}














