const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const \[isSettingsModalOpen,\n    isDevLoginModalOpen,\n    isDevPurgeModalOpen, setIsSettingsModalOpen\] = useState\(false\);/,
    "const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
