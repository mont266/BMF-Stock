const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /if \(filters\.itemName !== 'All'\) \{[\s\S]*?if \(filters\.partNumber && filters\.partNumber\.trim\(\) !== ''\) \{[\s\S]*?query = query\.eq\('item_barcode', filters\.partNumber\.trim\(\)\);\n      \}/;

const replacement = `      if (filters.itemName !== 'All') {
        query = query.eq('item_name', filters.itemName);
      }
      if (filters.team && filters.team !== 'All') {
        query = query.or(\`location_from.eq."\${filters.team}",location_to.eq."\${filters.team}"\`);
      }
      if (filters.location && filters.location !== 'All') {
        query = query.or(\`location_from.eq."\${filters.location}",location_to.eq."\${filters.location}"\`);
      }
      if (filters.partNumber && filters.partNumber.trim() !== '') {
        query = query.eq('item_barcode', filters.partNumber.trim());
      }`;

code = code.replace(regex, replacement);
fs.writeFileSync('components/StockManagerApp.jsx', code);
