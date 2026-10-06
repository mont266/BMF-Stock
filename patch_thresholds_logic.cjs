const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldThresholdLogic = /const thresholdData = useMemo\(\(\) => \{[\s\S]*?\}, \[stock, itemTypes, reportData\]\);/;

const newThresholdLogic = `  const thresholdData = useMemo(() => {
    const stockCounts = {};
    stock.forEach(item => {
        if (!item.assigned_to || item.assigned_to === 'Unassigned') {
            if (!stockCounts[item.name]) stockCounts[item.name] = 0;
            stockCounts[item.name]++;
        }
    });

    const itemUsage = {};
    if (reportData) {
        reportData.forEach(move => {
            if (move.movement_type === 'OUT') {
                if (!itemUsage[move.item_name]) itemUsage[move.item_name] = 0;
                itemUsage[move.item_name]++;
            }
        });
    }

    const startDate = new Date(filters.startDate);
    const endDate = new Date(filters.endDate);
    const daysInPeriod = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)));

    const report = [];
    itemTypes.forEach(type => {
        const currentStock = stockCounts[type.name] || 0;
        const manualThreshold = parseInt(type.stock_threshold) || 0;
        const usage = itemUsage[type.name] || 0;
        
        // Calculate 6 weeks (42 days) of projected usage based on the period's daily rate
        const dailyUsage = usage / daysInPeriod;
        const sixWeeksProjectedUsage = Math.ceil(dailyUsage * 42);
        
        // Effective threshold uses the higher of manual setting or 6-weeks projection
        const threshold = Math.max(manualThreshold, sixWeeksProjectedUsage);

        let status = 'OK';
        if (currentStock <= threshold) {
            status = 'CRITICAL';
        } else if (threshold > 0 && currentStock <= threshold * 1.5) {
            status = 'WARNING';
        }

        let suggestedOrder = 0;
        if (currentStock <= threshold) {
            // Order enough to get back to the 6-week target + a buffer
            suggestedOrder = Math.max((threshold - currentStock) + sixWeeksProjectedUsage, threshold);
        } else if (status === 'WARNING') {
            suggestedOrder = Math.max(sixWeeksProjectedUsage, threshold);
        } else if (sixWeeksProjectedUsage > 0 && currentStock - sixWeeksProjectedUsage <= threshold) {
            suggestedOrder = sixWeeksProjectedUsage;
            if (status === 'OK') status = 'WARNING';
        }

        if (status !== 'OK' || suggestedOrder > 0 || currentStock <= threshold) {
            report.push({
                name: type.name,
                currentStock,
                threshold, // This is now the effective threshold (max of manual or 6-week)
                usage,
                sixWeeksProjectedUsage,
                suggestedOrder,
                status
            });
        }
    });
    
    return report.sort((a, b) => {
        if (a.status === b.status) return a.currentStock - b.currentStock;
        return a.status === 'CRITICAL' ? -1 : 1;
    });
  }, [stock, itemTypes, reportData, filters]);`;

code = code.replace(oldThresholdLogic, newThresholdLogic);

fs.writeFileSync('components/StockManagerApp.jsx', code);
