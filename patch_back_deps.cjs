const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /isSettingsModalOpen,/,
    `isSettingsModalOpen,\n    isDevLoginModalOpen,\n    isDevPurgeModalOpen,`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
