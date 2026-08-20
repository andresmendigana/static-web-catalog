/**
 * Punto de entrada de la aplicación
 */
import { LocalStorageRepository } from './infrastructure/local-storage-repository.js';
import { createBasicUI } from './ui/basic-ui.js';

// Inicializar aplicación
async function initializeApp() {
    try {
        // Crear repositorio
        const repository = new LocalStorageRepository();
        
        // Inicializar UI básica
        await createBasicUI(repository);
        
        console.log('StaticWebCatalog initialized successfully');
    } catch (error) {
        console.error('Failed to initialize app:', error);
        document.body.innerHTML = `
            <div style="padding: 20px; background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; border-radius: 4px; margin: 20px;">
                <h3>Error de inicialización</h3>
                <p>${error.message}</p>
                <p><small>Verifica que tu navegador soporte localStorage y que no estés en modo privado.</small></p>
            </div>
        `;
    }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
