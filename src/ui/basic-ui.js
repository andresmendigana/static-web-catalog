/**
 * UI básica funcional - Arreglo del botón de archivos
 */
import { processImagesSequentially } from '../infrastructure/image-processor.js';
import { addProducts } from '../application/use-cases/add-products.js';
import { listProducts, getProductCount } from '../application/use-cases/list-products.js';
import { removeProduct } from '../application/use-cases/remove-product.js';
import { createPendingItem, resolveWithAmount, resolveWithInquire, isItemResolved } from '../domain/pending-item.js';
import { getFormattedPrice } from '../domain/product.js';
import { parsePriceInput } from '../domain/price.js';

export async function createBasicUI(repository) {
    // Estado local para items pendientes
    let pendingItems = [];
    
    // Referencias DOM
    const fileInput = document.getElementById('file-input');
    const fileButton = document.getElementById('file-button');
    const stagingArea = document.getElementById('staging-area');
    const addButton = document.getElementById('add-button');
    const catalogGrid = document.getElementById('catalog-grid');
    const emptyState = document.getElementById('empty-state');
    const productCount = document.getElementById('product-count');
    const backgroundInput = document.getElementById('background-input');
    const backgroundOverlay = document.getElementById('background-overlay');
    const removeBackgroundBtn = document.getElementById('remove-background');

    // Inicializar
    await updateCatalogDisplay();
    await updateProductCount();
    loadSavedBackground();

    // Event listeners
    fileInput.addEventListener('change', handleFileSelection);
    fileButton.addEventListener('click', () => fileInput.click()); // Conectar botón personalizado
    addButton.addEventListener('click', handleAddProducts);
    backgroundInput.addEventListener('change', handleBackgroundChange);
    removeBackgroundBtn.addEventListener('click', removeBackground);

    // Funcionalidad de fondo
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
        if (savedBg) {
            backgroundOverlay.style.backgroundImage = `url(${savedBg})`;
        }
    }

    async function handleFileSelection(event) {
        const files = event.target.files;
        if (!files.length) return;

        // Procesar imágenes
        addButton.disabled = true;
        stagingArea.innerHTML = '<p>Procesando imágenes...</p>';

        const results = await processImagesSequentially(files, (index, total, result) => {
            stagingArea.innerHTML = `<p>Procesando ${index + 1} de ${total} imágenes...</p>`;
        });

        // Crear items pendientes
        pendingItems = results.map(result => {
            if (result.error) {
                return createErrorPendingItem(result.file, result.error);
            }
            return createPendingItem(result.file, result.dataUri);
        });

        updateStagingDisplay();
        fileInput.value = ''; // Reset input
    }

    function updateStagingDisplay() {
        if (!pendingItems.length) {
            stagingArea.innerHTML = '';
            addButton.disabled = true;
            return;
        }

        stagingArea.innerHTML = pendingItems.map(item => `
            <div class="pending-item" style="border: 1px solid #ddd; padding: 16px; margin: 8px 0; display: flex; gap: 16px; align-items: center; background: rgba(255, 255, 255, 0.95); border-radius: 8px;">
                ${item.dataUri ? `<img src="${item.dataUri}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">` : '<div style="width: 60px; height: 60px; background: #f5f5f5; display: flex; align-items: center; justify-content: center; border-radius: 4px;">❌</div>'}
                
                <div style="flex: 1;">
                    <input type="text" value="${item.currentName}" onchange="updateItemName('${item.id}', this.value)" class="input" style="width: 100%; margin-bottom: 8px;">
                    
                    ${item.status === 'error' ? 
                        `<div style="color: #d32f2f; font-size: 12px;">${item.error}</div>` :
                        `<div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" placeholder="Precio en COP" onchange="updateItemPrice('${item.id}', this.value)" class="input" style="width: 120px;">
                            <label style="font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                <input type="checkbox" onchange="toggleInquirePrice('${item.id}', this.checked)"> Consultar precio
                            </label>
                            <button onclick="removeItem('${item.id}')" class="btn-delete">×</button>
                        </div>`
                    }
                </div>
            </div>
        `).join('');

        // Actualizar estado del botón
        const resolvedCount = pendingItems.filter(isItemResolved).length;
        addButton.disabled = resolvedCount === 0;
        addButton.textContent = resolvedCount > 0 ? `Agregar ${resolvedCount} productos` : 'Agregar al catálogo';

        // Exponer funciones al scope global (simplificación para el prototipo)
        window.updateItemName = updateItemName;
        window.updateItemPrice = updateItemPrice;
        window.toggleInquirePrice = toggleInquirePrice;
        window.removeItem = removeItem;
    }

    function updateItemName(itemId, newName) {
        const item = pendingItems.find(i => i.id === itemId);
        if (item) {
            item.currentName = newName.trim();
        }
    }

    function updateItemPrice(itemId, priceStr) {
        const item = pendingItems.find(i => i.id === itemId);
        if (!item) return;

        const price = parsePriceInput(priceStr);
        if (price !== null) {
            pendingItems = pendingItems.map(i => 
                i.id === itemId ? resolveWithAmount(i, price) : i
            );
        } else {
            if (item.priceMode !== 'inquire') {
                pendingItems = pendingItems.map(i => 
                    i.id === itemId ? { ...i, status: 'unresolved', priceMode: undefined, priceCOP: null } : i
                );
            }
        }
        updateStagingDisplay();
    }

    function toggleInquirePrice(itemId, isChecked) {
        const item = pendingItems.find(i => i.id === itemId);
        if (!item) return;

        if (isChecked) {
            pendingItems = pendingItems.map(i => 
                i.id === itemId ? resolveWithInquire(i) : i
            );
        } else {
            pendingItems = pendingItems.map(i => 
                i.id === itemId ? { ...i, status: 'unresolved', priceMode: undefined, priceCOP: null } : i
            );
        }
        updateStagingDisplay();
    }

    function removeItem(itemId) {
        pendingItems = pendingItems.filter(i => i.id !== itemId);
        updateStagingDisplay();
    }

    async function handleAddProducts() {
        const resolvedItems = pendingItems.filter(isItemResolved);
        if (!resolvedItems.length) return;

        addButton.disabled = true;
        addButton.textContent = 'Agregando...';

        try {
            const result = await addProducts(repository, resolvedItems);
            
            const successfulIds = result.successful.map(s => s.item.id);
            pendingItems = pendingItems.filter(item => !successfulIds.includes(item.id));
            
            if (result.failed.length > 0) {
                const errors = result.failed.map(f => f.reason).join('\\n');
                alert(`Algunos productos no se pudieron agregar:\\n${errors}`);
            }

            updateStagingDisplay();
            await updateCatalogDisplay();
            await updateProductCount();

        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            addButton.disabled = false;
        }
    }

    async function updateCatalogDisplay() {
        try {
            const products = await listProducts(repository);
            
            if (products.length === 0) {
                catalogGrid.style.display = 'none';
                emptyState.style.display = 'block';
                return;
            }

            catalogGrid.style.display = 'grid';
            emptyState.style.display = 'none';

            catalogGrid.innerHTML = products.map(product => `
                <div class="product-card">
                    <div class="product-image-container">
                        <img src="${product.image}" alt="${product.name}" class="product-image">
                    </div>
                    <div class="product-info">
                        <div class="product-name">${product.name}</div>
                        <div class="product-price ${product.priceMode === 'inquire' ? 'inquire' : ''}">${getFormattedPrice(product)}</div>
                    </div>
                    <div class="product-actions">
                        <button onclick="handleRemoveProduct('${product.id}')" class="btn-delete">Eliminar</button>
                    </div>
                </div>
            `).join('');

            window.handleRemoveProduct = async (productId) => {
                if (confirm('¿Estás seguro de que quieres eliminar este producto?')) {
                    await removeProduct(repository, productId);
                    await updateCatalogDisplay();
                    await updateProductCount();
                }
            };

        } catch (error) {
            catalogGrid.innerHTML = `<div style="color: #d32f2f;">Error al cargar productos: ${error.message}</div>`;
        }
    }

    async function updateProductCount() {
        try {
            const count = await getProductCount(repository);
            productCount.textContent = `${count} de 10 productos`;
        } catch (error) {
            productCount.textContent = 'Error';
        }
    }
}
