const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /team: 'All',\n  \}\);/,
    "team: 'All',\n    location: 'All',\n  });"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
