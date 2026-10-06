const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const itemToReturn = items\.find\(i => i\.assigned_to !== 'Unassigned'\);/,
    "const itemToReturn = items.find(i => i.assigned_to !== Team.UNASSIGNED);"
);

code = code.replace(
    /await updateStockItemAssignment\(itemToReturn\.id, 'Leading Stores', 'Unassigned', selectedProfile\.name\);/,
    "await updateStockItemAssignment(itemToReturn.id, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
