const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /query = query\.or\(\`location_from\.eq\.\$\{filters\.team\},location_to\.eq\.\$\{filters\.team\}\`\);/,
    "query = query.or(`location_from.eq.\\\"${filters.team}\\\",location_to.eq.\\\"${filters.team}\\\"`);"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
