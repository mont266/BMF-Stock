const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const injectionPoint = `  const executeConfirmationAction = async () => {`;
const newFunction = `  const handleConfirmReturn = async (e) => {
    e.preventDefault();
    if (!returnModalData) return;
    
    setIsReturningStock(true);
    setError(null);
    try {
        const qtyToReturn = parseInt(returnQuantity, 10) || 1;
        const actualItemsToReturn = (returnModalData.items || [returnModalData]).slice(0, qtyToReturn);
        
        if (actualItemsToReturn.length > 0) {
            const itemIds = actualItemsToReturn.map(i => i.id);
            if (itemIds.length === 1) {
                await updateStockItemAssignment(itemIds[0], Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
            } else {
                await bulkUpdateAssignments(itemIds, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
            }
            await refetchStock();
            setSuccessMessage(\`Successfully returned \${itemIds.length} item(s) to stock.\`);
            setTimeout(() => setSuccessMessage(null), 3000);
        }
        setReturnModalData(null);
    } catch (err) {
        setError(\`Failed to return to stock: \${err.message}\`);
    } finally {
        setIsReturningStock(false);
    }
  };

  const executeConfirmationAction = async () => {`;

code = code.replace(injectionPoint, newFunction);
fs.writeFileSync('components/StockManagerApp.jsx', code);
