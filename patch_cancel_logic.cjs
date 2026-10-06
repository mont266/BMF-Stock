const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const cancelInject = `        if (isAddQuantityModalOpen) { setIsAddQuantityModalOpen(false); return; }`;
const cancelReplacement = `        if (isAddQuantityModalOpen) { setIsAddQuantityModalOpen(false); return; }
        if (isReturnSetupModalOpen) { setIsReturnSetupModalOpen(false); return; }
        if (isReturnModeSelectionOpen) { setIsReturnModeSelectionOpen(false); return; }
        if (isReturnQuantityModalOpen) { setIsReturnQuantityModalOpen(false); return; }`;
code = code.replace(cancelInject, cancelReplacement);

const depsInject = `    isAddQuantityModalOpen,`;
const depsReplacement = `    isAddQuantityModalOpen,
    isReturnSetupModalOpen,
    isReturnModeSelectionOpen,
    isReturnQuantityModalOpen,`;
code = code.replace(depsInject, depsReplacement);

fs.writeFileSync('components/StockManagerApp.jsx', code);
