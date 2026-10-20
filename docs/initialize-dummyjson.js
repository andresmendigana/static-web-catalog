/**
 * Script de inicialización para Stage 2 con DummyJSON
 * Limpia localStorage y precarga imágenes
 */

// Ejecuta esto en la Console del navegador (F12)

(async function() {
  console.log('🧹 Limpiando localStorage...');
  localStorage.clear();
  console.log('✅ localStorage limpiado');
  
  console.log('📦 Precargando imágenes de DummyJSON...');
  
  try {
    const response = await fetch('https://dummyjson.com/products/category/mens-shirts');
    const data = await response.json();
    
    const images = [];
    data.products.forEach(product => {
      if (product.images && Array.isArray(product.images)) {
        images.push(...product.images);
      }
    });
    
    console.log(`✅ ${images.length} imágenes disponibles`);
    console.log('Primeras 5 imágenes:', images.slice(0, 5));
    
    // Guardas las URLs en localStorage para referencia
    localStorage.setItem('dummyjson_image_urls', JSON.stringify(images));
    localStorage.setItem('dummyjson_preloaded', new Date().toISOString());
    
    console.log('✅ Imágenes precargadas en localStorage');
  } catch (error) {
    console.error('❌ Error al cargar imágenes:', error);
  }
  
  console.log('🚀 Recarga la página para empezar');
})();
