const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items that are below or nearing their minimum stock thresholds\.<\/p>/,
    `<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items below threshold, plus order recommendations based on your selected date range's usage.</p>`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
