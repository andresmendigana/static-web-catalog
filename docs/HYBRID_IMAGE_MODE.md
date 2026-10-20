# VERSIÓN HÍBRIDA: DOS MODOS DE IMAGEN

## ✅ Implementado:
- Modo 1: MANUAL (Cargar tus fotos)
- Modo 2: DUMMYJSON (Camisetas aleatorias)

## 🔧 Cómo Cambiar de Modo:

En la consola del navegador (F12 → Console):

### MODO 1: Fotos Manuales
\\\javascript
localStorage.setItem('imageMode', 'manual');
location.reload();
\\\

Ahora:
- Selecciona archivos
- Se procesan como data URIs
- Espacio: ~500KB por foto

### MODO 2: Camisetas Aleatorias (Defecto)
\\\javascript
localStorage.setItem('imageMode', 'dummyjson');
location.reload();
\\\

Ahora:
- Selecciona archivos (cualquier archivo)
- Se obtienen URLs de DummyJSON
- Espacio: ~100 bytes por foto

## 📊 Comparativa:

| Aspecto | Manual | DummyJSON |
|---------|--------|-----------|
| Fuente | Tu PC | API DummyJSON |
| Procesamiento | Canvas (lento) | HTTP fetch (rápido) |
| Storage | ~500KB/foto | ~100B/foto |
| Cualidad | Tu elección | Camisetas variadas |

## 🛠️ Código:

En handleFileSelection():
\\\javascript
const imageMode = localStorage.getItem('imageMode') || 'dummyjson';

if (imageMode === 'manual') {
    // Usar processImagesSequentially()
    const results = await processImagesSequentially(files, ...);
} else {
    // Usar getRandomMensShirtImage()
    const imageUrl = await getRandomMensShirtImage();
}
\\\

## ⚠️ Considera:

- Cambiar el modo borra el modo anterior
- Los productos guardados NO cambian
- Cada producto recuerda cómo fue agregado

