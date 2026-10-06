const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Add team: 'All' to initial reportFilters
code = code.replace(
    /itemName: 'All',\n    partNumber: '',\n  \}\);/,
    "itemName: 'All',\n    partNumber: '',\n    team: 'All',\n  });"
);

// Add teams={teams} to <ReportingPage ... />
code = code.replace(
    /<ReportingPage\n                          filters=\{reportFilters\}/,
    "<ReportingPage\n                          teams={teams}\n                          filters={reportFilters}"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
