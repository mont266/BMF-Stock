const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /scanned_by: user\?\.id\n          \}\);/g,
    `scanned_by: user?.id,\n              profile_name: selectedProfile?.name\n          });`
);

code = code.replace(
    /\}, \[fetchUnrecognizedScans\]\);/g,
    `}, [fetchUnrecognizedScans, selectedProfile]);`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
