const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const newPdfHeader = `        doc.setFontSize(20);
        doc.text(\`Inventory Report\`, 14, 22);
        doc.setFontSize(12);
        let headerText = \`Period: \${new Date(filters.startDate).toLocaleDateString()} to \${new Date(filters.endDate).toLocaleDateString()}\`;
        if (filters.team && filters.team !== 'All') {
            headerText += \` | Team: \${filters.team}\`;
        }
        if (filters.itemName && filters.itemName !== 'All') {
            headerText += \` | Item: \${filters.itemName}\`;
        }
        doc.text(headerText, 14, 32);`;

code = code.replace(
    /doc\.setFontSize\(20\);\n        doc\.text\(\`Inventory Report\`, 14, 22\);\n        doc\.setFontSize\(12\);\n        doc\.text\(\`Period: \$\{new Date\(filters\.startDate\)\.toLocaleDateString\(\)\} to \$\{new Date\(filters\.endDate\)\.toLocaleDateString\(\)\}\`, 14, 32\);/,
    newPdfHeader
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
