# Quick Start - DummyJSON Integration

## 1️⃣ Start the Dev Server

```bash
npm start
```

Server runs at http://localhost:8000

## 2️⃣ Clear localStorage

Open browser DevTools (F12) → Console tab, paste:

```javascript
localStorage.clear();
console.log('✅ localStorage cleared');
```

Refresh the page.

## 3️⃣ Add Products

1. Click "Seleccionar archivo" button
2. Select ANY files (1-100)
3. Wait for "Obteniendo imágenes de DummyJSON..." progress
4. Each file gets a random image URL
5. Images appear in preview

## 4️⃣ Fill in Details

For each product:
- Enter price (e.g., "50000")
- OR check "Consultar precio"
- Add characteristics (optional)

## 5️⃣ Add to Catalog

- Click "Agregar N productos"
- Products saved with image URLs
- localStorage stays tiny (~1 KB per 10 products)

## 6️⃣ Verify

In Console:
```javascript
const products = JSON.parse(localStorage.getItem('static_web_catalog_products'));
console.log(`${products.length} products`);
console.log('First image:', products[0].image);
// Output: https://cdn.dummyjson.com/...
```

## 7️⃣ Export & Test

```bash
# Export products
npm run export [package-id]

# Dry run
npm run dry-run [package-id]

# Generate manifest
npm run manifest [package-id]
```

## ✨ That's It!

Your Stage 2 catalog now:
- Uses random product images
- Keeps localStorage lightweight
- Is ready for publication

## 🔧 Troubleshooting

**Images not loading?**
- Check browser console for network errors
- DummyJSON API may be temporarily down
- Try clearing cache and reloading

**Prices not saving?**
- Make sure you hit Enter or click outside the field
- Check that price is valid (numbers only)

**Too slow?**
- First image fetch takes ~500ms (API call)
- Subsequent images are instant (cached)

## 📊 What Changed?

| Item | Before | After |
|------|--------|-------|
| File Processing | ✗ Complex canvas logic | ✓ Simple URL fetch |
| Storage Size | ✗ ~50 MB per 100 items | ✓ ~10 KB per 100 items |
| Image Source | ✗ Local uploads | ✓ DummyJSON API |
| Load Time | ✗ Slow (encoding) | ✓ Instant |

---

**Next Steps**: Publish to S3 or generate PDFs with `npm run export`
