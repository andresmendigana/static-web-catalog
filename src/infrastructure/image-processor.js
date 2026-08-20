/**
 * Procesador de imágenes - Escalado y conversión a data URI
 */

/**
 * Escala una imagen y la convierte a data URI JPEG
 * @param {File} file - Archivo de imagen
 * @param {number} maxSize - Tamaño máximo del lado mayor (por defecto 800)
 * @param {number} quality - Calidad JPEG 0-1 (por defecto 0.8)
 * @returns {Promise<string>} Data URI de la imagen escalada
 */
export async function processImage(file, maxSize = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        // Validar que sea un archivo de imagen
        if (!file.type.startsWith('image/')) {
            reject(new Error(`File ${file.name} is not a valid image`));
            return;
        }

        const img = new Image();
        
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calcular dimensiones preservando proporción
                const { width, height } = calculateDimensions(img.width, img.height, maxSize);
                
                // Configurar canvas
                canvas.width = width;
                canvas.height = height;
                
                // Dibujar imagen escalada
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convertir a data URI JPEG
                const dataUri = canvas.toDataURL('image/jpeg', quality);
                
                // Cleanup
                canvas.remove();
                
                resolve(dataUri);
            } catch (error) {
                reject(new Error(`Failed to process image ${file.name}: ${error.message}`));
            }
        };
        
        img.onerror = () => {
            reject(new Error(`Failed to load image ${file.name}`));
        };
        
        // Cargar la imagen
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
        };
        reader.onerror = () => {
            reject(new Error(`Failed to read file ${file.name}`));
        };
        
        reader.readAsDataURL(file);
    });
}

/**
 * Calcula las dimensiones finales preservando proporción
 * @param {number} originalWidth - Ancho original
 * @param {number} originalHeight - Alto original  
 * @param {number} maxSize - Tamaño máximo del lado mayor
 * @returns {Object} Dimensiones {width, height}
 */
function calculateDimensions(originalWidth, originalHeight, maxSize) {
    const isWider = originalWidth > originalHeight;
    
    if (isWider) {
        const width = Math.min(originalWidth, maxSize);
        const height = Math.round((originalHeight * width) / originalWidth);
        return { width, height };
    } else {
        const height = Math.min(originalHeight, maxSize);
        const width = Math.round((originalWidth * height) / originalHeight);
        return { width, height };
    }
}

/**
 * Procesa múltiples imágenes secuencialmente
 * @param {FileList|Array} files - Lista de archivos
 * @param {Function} onProgress - Callback de progreso (índice, total, resultado)
 * @returns {Promise<Array>} Array de resultados {file, dataUri, error}
 */
export async function processImagesSequentially(files, onProgress) {
    const results = [];
    const fileArray = Array.from(files);
    
    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        
        try {
            const dataUri = await processImage(file);
            const result = { file, dataUri, error: null };
            results.push(result);
            
            if (onProgress) {
                onProgress(i, fileArray.length, result);
            }
        } catch (error) {
            const result = { file, dataUri: null, error: error.message };
            results.push(result);
            
            if (onProgress) {
                onProgress(i, fileArray.length, result);
            }
        }
        
        // Ceder control al navegador entre imágenes
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return results;
}
