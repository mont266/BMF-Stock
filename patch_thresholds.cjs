const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /let status = 'OK';[\s\S]*?if \(status === a\.status\) return a\.currentStock - b\.currentStock;/;

const replacement = `let status = 'OK';
        if (currentStock <= threshold) {
            status = 'CRITICAL';
        } else if (threshold > 0 && currentStock <= threshold * 1.5) {
            status = 'WARNING';
        }

        let suggestedOrder = 0;
        if (currentStock <= threshold) {
            suggestedOrder = Math.max((threshold - currentStock) + usage, threshold);
        } else if (status === 'WARNING') {
            suggestedOrder = Math.max(usage, threshold);
        } else if (usage > 0 && currentStock - usage <= threshold) {
            suggestedOrder = usage;
            if (status === 'OK') status = 'WARNING'; // Elevate status if usage might bring it low
        }

        if (status !== 'OK' || suggestedOrder > 0 || currentStock <= threshold) {
            report.push({
                name: type.name,
                currentStock,
                threshold,
                usage,
                suggestedOrder,
                status
            });
        }
    });
    
    return report.sort((a, b) => {
        if (status === a.status) return a.currentStock - b.currentStock;`;

code = code.replace(regex, replacement);
fs.writeFileSync('components/StockManagerApp.jsx', code);
