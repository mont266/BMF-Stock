import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

content = content.replace(
  'itemsToAdd = barcodes.map(barcode => ({',
  `itemsToAdd = barcodes.map(barcode => ({
                purchase_price: parseFloat(selectedItemType.price) || 0,`
);

content = content.replace(
  'itemsToAdd = Array.from({ length: quantity }, () => ({',
  `itemsToAdd = Array.from({ length: quantity }, () => ({
                purchase_price: parseFloat(selectedItemType.price) || 0,`
);

content = content.replace(
  'itemsToAdd = serials.map(barcode => ({',
  `itemsToAdd = serials.map(barcode => ({
                purchase_price: parseFloat(selectedItemType.price) || 0,`
);

// We need to handle handleConfirmAddQuantity carefully as it doesn't have selectedItemType defined.
// The second replace might have caught it, but selectedItemType is not defined!
// Let's check if it did.
