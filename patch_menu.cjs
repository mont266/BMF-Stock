const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Replace Sidebar Nav
code = code.replace(
    /\{Capacitor\.isNativePlatform\(\) && \(\s*<SidebarNavItem icon=\{<ScanIcon \/>\} label="Scan \/ Add" isActive=\{currentView === View\.SCAN \|\| currentView === View\.ADD_ITEM\} onClick=\{\(\) => setIsScanModeModalOpen\(true\)\} \/>\s*\)\}\s*\{!Capacitor\.isNativePlatform\(\) && \(\s*<SidebarNavItem icon=\{<AddIcon \/>\} label="Add Stock" isActive=\{currentView === View\.ADD_ITEM\} onClick=\{\(\) => navigateTo\(View\.ADD_ITEM\)\} \/>\s*\)\}/g,
    `<SidebarNavItem icon={<ScanIcon />} label="Scan / Add / Return" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />`
);

// Replace Mobile Nav
code = code.replace(
    /\{Capacitor\.isNativePlatform\(\) && \(\s*<MobileNavItem icon=\{<ScanIcon\/>\} label="Scan \/ Add" isActive=\{currentView === View\.SCAN \|\| currentView === View\.ADD_ITEM\} onClick=\{\(\) => setIsScanModeModalOpen\(true\)\} \/>\s*\)\}\s*\{!Capacitor\.isNativePlatform\(\) && \(\s*<MobileNavItem icon=\{<AddIcon\/>\} label="Add" isActive=\{currentView === View\.ADD_ITEM\} onClick=\{\(\) => navigateTo\(View\.ADD_ITEM\)\} \/>\s*\)\}/g,
    `<MobileNavItem icon={<ScanIcon/>} label="Scan" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
