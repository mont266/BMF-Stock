const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /if \(isSettingsModalOpen\) \{ setIsSettingsModalOpen\(false\); return; \}/,
    `if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return; }
        if (isDevLoginModalOpen) { setIsDevLoginModalOpen(false); return; }
        if (isDevPurgeModalOpen) { setIsDevPurgeModalOpen(false); return; }`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
