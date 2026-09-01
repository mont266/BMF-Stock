import fs from 'fs';

let content = fs.readFileSync('components/PurchasingPage.jsx', 'utf8');

content = content.replace(
  'name: item.item_types.name,\n                            barcode: barcodeToUse,\n                            location: Location.LEADING_STORES,\n                            assigned_to: Team.UNASSIGNED,\n                            user_id: user.id',
  `name: item.item_types.name,
                            barcode: barcodeToUse,
                            location: Location.LEADING_STORES,
                            assigned_to: Team.UNASSIGNED,
                            user_id: user.id,
                            purchase_price: parseFloat(item.cost_per_item) || 0`
);

fs.writeFileSync('components/PurchasingPage.jsx', content, 'utf8');
console.log('Done!');
