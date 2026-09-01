import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Replace totalInventoryValue
content = content.replace(
  /const details = itemTypeDetailsMap\[item\.name\];\s*const price = details \? details\.price : 0;\s*return total \+ parseFloat\(price\);/g,
  `const details = itemTypeDetailsMap[item.name];
        const price = item.purchase_price != null ? item.purchase_price : (details ? details.price : 0);
        return total + parseFloat(price);`
);

// Replace stockGroupValues
content = content.replace(
  /const details = itemTypeDetailsMap\[name\];\s*const price = details \? details\.price : 0;\s*acc\[name\] = items\.length \* parseFloat\(price\);/g,
  `const details = itemTypeDetailsMap[name];
        // For groups, since items might have different historical prices, we need to sum them individually
        const groupTotal = items.reduce((sum, item) => {
             const p = item.purchase_price != null ? item.purchase_price : (details ? details.price : 0);
             return sum + parseFloat(p);
        }, 0);
        acc[name] = groupTotal;`
);

fs.writeFileSync('components/StockManagerApp.jsx', content, 'utf8');
console.log('Done!');
