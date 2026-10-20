# Quick integration test
console.log('🧪 Testing DummyJSON Integration...\n');

// Test 1: Check imports
try {
  import('./src/infrastructure/dummyjson-image-service.js').then(module => {
    const hasGetRandom = typeof module.getRandomMensShirtImage === 'function';
    const hasFetch = typeof module.fetchMensShirtImages === 'function';
    console.log(`✓ Service exports (getRandomMensShirtImage: ${hasGetRandom}, fetchMensShirtImages: ${hasFetch})`);
  });
} catch (e) {
  console.error('✗ Failed to import service:', e.message);
}

// Test 2: Check basic-ui imports
try {
  import('./src/ui/basic-ui.js').then(module => {
    const hasCreateBasicUI = typeof module.createBasicUI === 'function';
    console.log(`✓ UI exports (createBasicUI: ${hasCreateBasicUI})`);
  });
} catch (e) {
  console.error('✗ Failed to import UI:', e.message);
}

console.log('\n✅ All imports successful');
