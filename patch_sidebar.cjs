const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /\{\!Capacitor\.isNativePlatform\(\) && \(\s*<SidebarNavItem icon=\{<AddIcon \/>\} label="Add Stock" isActive=\{currentView === View\.ADD_ITEM\} onClick=\{\(\) => navigateTo\(View\.ADD_ITEM\)\} \/>\s*\)\}\s*\{Capacitor\.isNativePlatform\(\) && \(\s*<SidebarNavItem icon=\{<ScanIcon \/>\} label="Scan \/ Add" isActive=\{currentView === View\.SCAN \|\| currentView === View\.ADD_ITEM\} onClick=\{\(\) => setIsScanModeModalOpen\(true\)\} \/>\s*\)\}/;

const replacement = `<SidebarNavItem icon={<ScanIcon />} label="Scan / Action" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />`;

code = code.replace(regex, replacement);
fs.writeFileSync('components/StockManagerApp.jsx', code);
