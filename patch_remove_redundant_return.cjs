const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /\} else if \(actionType === 'RETURN_TO_STOCK'\) \{[\s\S]*?await refetchStock\(\);\n        /;

code = code.replace(regex, "");
fs.writeFileSync('components/StockManagerApp.jsx', code);
