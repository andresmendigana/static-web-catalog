/**
 * Extensión de UI para cargar imágenes aleatorias de DummyJSON
 * Esta función añade un botón para cargar camisetas aleatorias
 */

import { getRandomMensShirtImage, preloadImages } from '../infrastructure/dummyjson-image-service.js';

export async function createDummyJsonImageLoader(stagingArea, addButton, pendingItems) {
  // Crear contenedor para los botones de DummyJSON
  const dummyJsonContainer = document.createElement('div');
  dummyJsonContainer.style.cssText = `
    padding: 15px;
    background: #f0f0f0;
    border-radius: 4px;
    margin-bottom: 15px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  `;

  // Botón para precargar imágenes
  const preloadBtn = document.createElement('button');
  preloadBtn.textContent = '📦 Precarga imágenes DummyJSON';
  preloadBtn.style.cssText = `
    padding: 8px 12px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;

  // Botón para agregar producto con imagen aleatoria
  const addRandomBtn = document.createElement('button');
  addRandomBtn.textContent = '➕ Agregar camiseta aleatoria';
  addRandomBtn.style.cssText = `
    padding: 8px 12px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;

  // Estado
  let preloadedCount = 0;
  let isLoading = false;

  preloadBtn.addEventListener('click', async () => {
    isLoading = true;
    preloadBtn.disabled = true;
    preloadBtn.textContent = '⏳ Cargando...';

    try {
      preloadedCount = await preloadImages();
      preloadBtn.textContent = `✅ Listas ${preloadedCount} imágenes`;
      addRandomBtn.disabled = false;
    } catch (error) {
      console.error('Error preloading images:', error);
      preloadBtn.textContent = '❌ Error al cargar';
    } finally {
      isLoading = false;
    }
  });

  addRandomBtn.addEventListener('click', async () => {
    if (isLoading) return;

    addRandomBtn.disabled = true;
    addRandomBtn.textContent = '⏳ Obteniendo imagen...';

    try {
      const imageUrl = await getRandomMensShirtImage();
      
      if (!imageUrl) {
        addRandomBtn.textContent = '➕ Agregar camiseta aleatoria';
        addRandomBtn.disabled = false;
        alert('No se pudo obtener una imagen. Intenta precargar primero.');
        return;
      }

      // Crear item pendiente con URL de imagen
      const pendingItem = {
        id: crypto.randomUUID?.() || 'temp-' + Date.now(),
        name: '',
        priceMode: 'amount',
        priceCOP: null,
        image: imageUrl,
        characteristics: [],
        nameError: 'El nombre es requerido',
        priceError: null,
        characteristicsError: null,
      };

      pendingItems.push(pendingItem);
      renderPendingItem(pendingItem);
      
      addRandomBtn.textContent = '➕ Agregar camiseta aleatoria';
      addRandomBtn.disabled = false;
    } catch (error) {
      console.error('Error adding random item:', error);
      addRandomBtn.textContent = '❌ Error';
      setTimeout(() => {
        addRandomBtn.textContent = '➕ Agregar camiseta aleatoria';
        addRandomBtn.disabled = false;
      }, 2000);
    }
  });

  addRandomBtn.disabled = true; // Deshabilitado hasta precargar

  dummyJsonContainer.appendChild(preloadBtn);
  dummyJsonContainer.appendChild(addRandomBtn);
  stagingArea.parentElement.insertBefore(dummyJsonContainer, stagingArea);

  return { dummyJsonContainer, preloadBtn, addRandomBtn };
}

function renderPendingItem(item) {
  // Esta función será llamada por la UI principal
  // para renderizar cada item pendiente
  console.log('Renderizando item pendiente:', item);
}
