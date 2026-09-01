import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// For out-rapid
content = content.replace(
  'const items = await getStockItemsByBarcode(decodedText);\n                    const itemToAssign = items.find(i => i.assigned_to === Team.UNASSIGNED);',
  `const items = await getStockItemsByBarcode(decodedText);
                    
                    // FIFO: Prioritize older items with the lowest purchase price
                    items.sort((a, b) => {
                        const priceA = parseFloat(a.purchase_price) || 0;
                        const priceB = parseFloat(b.purchase_price) || 0;
                        if (priceA !== priceB) return priceA - priceB;
                        
                        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                        return dateA - dateB;
                    });

                    const itemToAssign = items.find(i => i.assigned_to === Team.UNASSIGNED);`
);

// For out-quantity
content = content.replace(
  'const items = await getStockItemsByBarcode(decodedText);\n            const availableItems = items.filter(i => i.assigned_to === Team.UNASSIGNED);',
  `const items = await getStockItemsByBarcode(decodedText);
            
            // FIFO: Prioritize older items with the lowest purchase price
            items.sort((a, b) => {
                const priceA = parseFloat(a.purchase_price) || 0;
                const priceB = parseFloat(b.purchase_price) || 0;
                if (priceA !== priceB) return priceA - priceB;
                
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateA - dateB;
            });

            const availableItems = items.filter(i => i.assigned_to === Team.UNASSIGNED);`
);

fs.writeFileSync('components/StockManagerApp.jsx', content, 'utf8');
console.log('Done!');
