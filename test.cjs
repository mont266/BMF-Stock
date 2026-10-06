const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /else if \(scanMode === 'out-rapid'\) \{[\s\S]*?\}\(\);/;

console.log(code.match(regex)[0]);
