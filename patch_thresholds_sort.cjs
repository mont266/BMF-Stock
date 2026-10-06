const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /if \(status === a\.status\) return a\.currentStock - b\.currentStock;/,
    "if (a.status === b.status) return a.currentStock - b.currentStock;"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
