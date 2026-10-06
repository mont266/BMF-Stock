const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const newLogic = `      if (filters.itemName !== 'All') {
        query = query.eq('item_name', filters.itemName);
      }
      if (filters.team && filters.team !== 'All') {
        query = query.or(\`location_from.eq.\${filters.team},location_to.eq.\${filters.team}\`);
      }
      if (filters.partNumber && filters.partNumber.trim() !== '') {`;

code = code.replace(
    /if \(filters\.itemName !== 'All'\) \{\n        query = query\.eq\('item_name', filters\.itemName\);\n      \}\n      if \(filters\.partNumber && filters\.partNumber\.trim\(\) !== ''\) \{/,
    newLogic
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
