const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const scanOutQuantityRegex = /\} else if \(scanMode === 'out-quantity'\) \{/;

const returnRapidLogic = `} else if (scanMode === 'return-rapid') {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
            (async () => {
                try {
                    const items = await getStockItemsByBarcode(decodedText);
                    if (items.length === 0) {
                        logUnrecognizedBarcode(decodedText);
                        triggerScanFeedback('error');
                        addToast(\`Unrecognized: \${decodedText}\`, 'error', decodedText);
                        return;
                    }
                    const itemToReturn = items.find(i => i.assigned_to !== 'Unassigned');
                    if (!itemToReturn) {
                        triggerScanFeedback('warning');
                        addToast(\`Already in stock\`, 'warning', decodedText);
                        return;
                    }
                    await updateStockItemAssignment(itemToReturn.id, 'Leading Stores', 'Unassigned', selectedProfile.name);
                    triggerScanFeedback('success');
                    addToast(\`Returned \${itemToReturn.name}\`, 'success', decodedText);
                    setRapidScanSummary(prev => {
                        const newSummary = { ...prev };
                        if (!newSummary[itemToReturn.name]) newSummary[itemToReturn.name] = 0;
                        newSummary[itemToReturn.name]++;
                        return newSummary;
                    });
                } catch (err) {
                    triggerScanFeedback('error');
                    addToast(\`Failed: \${err.message}\`, 'error', decodedText);
                } finally {
                    isProcessingScanRef.current = false;
                }
            })();
        } else if (scanMode === 'out-quantity') {`;

code = code.replace(scanOutQuantityRegex, returnRapidLogic);
fs.writeFileSync('components/StockManagerApp.jsx', code);
