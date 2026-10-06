const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldLogic = /  const thresholdData = useMemo\(\(\) => \{[\s\S]*?\}, \[stock, itemTypes, reportData, filters\]\);/;

const newLogic = `  const thresholdData = useMemo(() => {
    const stockCounts = {};
    stock.forEach(item => {
        if (!item.assigned_to || item.assigned_to === 'Unassigned') {
            if (!stockCounts[item.name]) stockCounts[item.name] = 0;
            stockCounts[item.name]++;
        }
    });

    const report = [];
    itemTypes.forEach(type => {
        const currentStock = stockCounts[type.name] || 0;
        // The stock_threshold on the item type is already the 6-week calculated buffer
        const threshold = parseInt(type.stock_threshold) || 0;
        
        let status = 'OK';
        if (currentStock <= threshold) {
            status = 'CRITICAL';
        } else if (threshold > 0 && currentStock <= threshold * 1.5) {
            status = 'WARNING';
        }

        if (status !== 'OK') {
            // Replenish stock back up to the 6-week threshold
            const suggestedOrder = Math.max(0, threshold - currentStock);
            
            report.push({
                name: type.name,
                currentStock,
                threshold,
                suggestedOrder,
                status
            });
        }
    });
    
    return report.sort((a, b) => {
        if (a.status === b.status) return a.currentStock - b.currentStock;
        return a.status === 'CRITICAL' ? -1 : 1;
    });
  }, [stock, itemTypes]);`;

code = code.replace(oldLogic, newLogic);
fs.writeFileSync('components/StockManagerApp.jsx', code);
