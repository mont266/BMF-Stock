const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /isSettingsModalOpen,\n    isChangePinModalOpen,/,
    "isSettingsModalOpen,\n    isDevLoginModalOpen,\n    isDevPurgeModalOpen,\n    isChangePinModalOpen,"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
