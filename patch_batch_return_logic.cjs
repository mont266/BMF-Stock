const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const injectionPoint = `  const executeConfirmationAction = async () => {`;
const newLogic = `  const handleBatchReturn = async (e) => {
    e.preventDefault();
    if (!batchReturnTeam) return;
    
    setIsBatchReturning(true);
    setError(null);
    try {
        const itemsToUpdate = [];
        
        // Find all stock assigned to this team
        const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam);
        
        // Group them by item name
        const groupedStock = {};
        teamStock.forEach(item => {
            if (!groupedStock[item.name]) groupedStock[item.name] = [];
            groupedStock[item.name].push(item);
        });

        // Collect items to return based on quantities provided
        Object.entries(batchReturnQuantities).forEach(([itemName, qtyToReturn]) => {
            const qty = parseInt(qtyToReturn, 10) || 0;
            if (qty > 0 && groupedStock[itemName]) {
                const itemsToReturn = groupedStock[itemName].slice(0, qty);
                itemsToUpdate.push(...itemsToReturn.map(i => i.id));
            }
        });
        
        if (itemsToUpdate.length > 0) {
            await bulkUpdateAssignments(itemsToUpdate, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
            await refetchStock();
            setSuccessMessage(\`Successfully returned \${itemsToUpdate.length} item(s) from \${batchReturnTeam}.\`);
            setTimeout(() => setSuccessMessage(null), 3000);
            setIsBatchReturnModalOpen(false);
            setBatchReturnQuantities({});
        } else {
            setError("No quantities specified to return.");
        }
    } catch (err) {
        setError(\`Failed to process batch return: \${err.message}\`);
    } finally {
        setIsBatchReturning(false);
    }
  };

  const handleOpenBatchReturn = () => {
      setBatchReturnTeam(assignmentFilters.team !== 'All' ? assignmentFilters.team : '');
      setBatchReturnQuantities({});
      setIsBatchReturnModalOpen(true);
  };

  const executeConfirmationAction = async () => {`;

code = code.replace(injectionPoint, newLogic);
fs.writeFileSync('components/StockManagerApp.jsx', code);
