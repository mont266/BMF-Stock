const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /<Modal isOpen=\{isReturnModeSelectionOpen\}[\s\S]*?<\/Modal>/;
code = code.replace(regex, "");

const nextButtonRegex = /setIsReturnModeSelectionOpen\(true\);/;
code = code.replace(nextButtonRegex, "setScanMode('return-rapid'); setRapidScanSummary({}); handleSetView(View.SCAN);");

fs.writeFileSync('components/StockManagerApp.jsx', code);
