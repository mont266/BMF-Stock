import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// For handleConfirmAddItem - unique
content = content.replace(
  'itemsToAdd = barcodes.map(barcode => ({\n                name,\n                description,\n                barcode,\n            }));',
  `itemsToAdd = barcodes.map(barcode => ({
                name,
                description,
                barcode,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));`
);

// For handleConfirmAddItem - not unique
content = content.replace(
  'itemsToAdd = Array.from({ length: quantity }, () => ({\n                name,\n                description,\n                barcode: barcode.trim(),\n            }));',
  `itemsToAdd = Array.from({ length: quantity }, () => ({
                name,
                description,
                barcode: barcode.trim(),
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));`
);

// For handleConfirmAddScannedItem - unique/meter
content = content.replace(
  'itemsToAdd = serials.map(barcode => ({\n                name: newScannedItemDetails.name,\n                description: newScannedItemDetails.description,\n                barcode,\n            }));',
  `itemsToAdd = serials.map(barcode => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));`
);

// For handleConfirmAddScannedItem - not unique
content = content.replace(
  'itemsToAdd = Array.from({ length: quantity }, () => ({\n                name: newScannedItemDetails.name,\n                description: newScannedItemDetails.description,\n                barcode: newScannedItemDetails.barcode,\n            }));',
  `itemsToAdd = Array.from({ length: quantity }, () => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode: newScannedItemDetails.barcode,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));`
);

// For handleConfirmAddQuantity
content = content.replace(
  'const itemsToAdd = Array.from({ length: quantity }, () => ({\n            name: itemForQuantityAdd.name,\n            description: itemForQuantityAdd.description,\n            barcode: itemForQuantityAdd.barcode,\n        }));',
  `const itemTypeDetails = itemTypes.find(it => it.name === itemForQuantityAdd.name);
        const itemsToAdd = Array.from({ length: quantity }, () => ({
            name: itemForQuantityAdd.name,
            description: itemForQuantityAdd.description,
            barcode: itemForQuantityAdd.barcode,
            purchase_price: parseFloat(itemTypeDetails?.price) || 0,
        }));`
);

fs.writeFileSync('components/StockManagerApp.jsx', content, 'utf8');
console.log('Done!');
