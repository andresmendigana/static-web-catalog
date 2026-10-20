/**
 * DummyJSON Image Service
 * Obtiene imágenes aleatorias de camisetas desde DummyJSON
 */

const DUMMY_JSON_API = 'https://dummyjson.com/products/category/mens-shirts';

/**
 * Obtiene todas las imágenes disponibles de la API
 * @returns {Promise<Array>} Array de URLs de imágenes
 */
export async function fetchMensShirtImages() {
  try {
    const response = await fetch(DUMMY_JSON_API);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const images = [];
    
    // Extraer todas las imágenes de todos los productos
    if (data.products && Array.isArray(data.products)) {
      data.products.forEach(product => {
        if (product.images && Array.isArray(product.images)) {
          images.push(...product.images);
        } else if (product.thumbnail) {
          images.push(product.thumbnail);
        }
      });
    }
    
    return images;
  } catch (error) {
    console.error('Failed to fetch images from DummyJSON:', error);
    return [];
  }
}

/**
 * Obtiene una imagen aleatoria de la colección
 * @param {Array} images - Array de URLs de imágenes
 * @returns {string} URL aleatoria de imagen
 */
export function getRandomImageUrl(images) {
  if (!images || images.length === 0) {
    return '';
  }
  return images[Math.floor(Math.random() * images.length)];
}

/**
 * Cache global de imágenes
 */
let imageCache = null;

/**
 * Obtiene imagen aleatoria con caché
 * @returns {Promise<string>} URL aleatoria de imagen
 */
export async function getRandomMensShirtImage() {
  // Si no hay caché, carga las imágenes
  if (!imageCache || imageCache.length === 0) {
    imageCache = await fetchMensShirtImages();
  }
  
  return getRandomImageUrl(imageCache);
}

/**
 * Precarga las imágenes en el caché
 * @returns {Promise<number>} Cantidad de imágenes cargadas
 */
export async function preloadImages() {
  if (!imageCache) {
    imageCache = await fetchMensShirtImages();
  }
  return imageCache.length;
}

/**
 * Limpia el caché de imágenes
 */
export function clearImageCache() {
  imageCache = null;
}
