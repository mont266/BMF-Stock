const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /\{scanMode === 'out-rapid' && \(/g,
    "{(scanMode === 'out-rapid' || scanMode === 'return-rapid') && ("
);

code = code.replace(
    /persistent=\{scanMode === 'out-rapid'\}/g,
    "persistent={scanMode === 'out-rapid' || scanMode === 'return-rapid'}"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
