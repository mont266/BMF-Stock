const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Add States
const stateInjection = `  const [isAssignRangeModalOpen, setIsAssignRangeModalOpen] = useState(false);`;
const newStates = `  const [isAssignRangeModalOpen, setIsAssignRangeModalOpen] = useState(false);
  const [isReturnSetupModalOpen, setIsReturnSetupModalOpen] = useState(false);
  const [returnContext, setReturnContext] = useState({ team: '' });
  const [isReturnModeSelectionOpen, setIsReturnModeSelectionOpen] = useState(false);
  const [isReturnQuantityModalOpen, setIsReturnQuantityModalOpen] = useState(false);
  const [itemForQuantityReturn, setItemForQuantityReturn] = useState(null);
  const [quantityToReturn, setQuantityToReturn] = useState('1');`;
code = code.replace(stateInjection, newStates);

// 2. Add Modals
const modalsInjection = `      <Modal isOpen={isScanModeModalOpen}`;
const newModals = `      <Modal isOpen={isReturnSetupModalOpen} onClose={() => setIsReturnSetupModalOpen(false)} title="Return From...">
        <div className="space-y-4">
            <div>
                <label htmlFor="return-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team</label>
                <select 
                    id="return-team" 
                    value={returnContext.team} 
                    onChange={(e) => setReturnContext(prev => ({...prev, team: e.target.value}))}
                    className={formInputStyle}
                >
                    <option value="" disabled>Select a team...</option>
                    {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                </select>
            </div>
            <div className="flex justify-end space-x-3 pt-6 border-t border-zinc-200 dark:border-zinc-700">
                <button type="button" onClick={() => setIsReturnSetupModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button type="button" disabled={!returnContext.team} onClick={() => { setIsReturnSetupModalOpen(false); setIsReturnModeSelectionOpen(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50">Next</button>
            </div>
        </div>
      </Modal>

      <Modal isOpen={isReturnModeSelectionOpen} onClose={() => setIsReturnModeSelectionOpen(false)} title="Select Return Mode">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                  onClick={() => { setScanMode('return-rapid'); setIsReturnModeSelectionOpen(false); setRapidScanSummary({}); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-400 dark:hover:border-purple-600 transition-all text-center"
              >
                  <RefreshIcon className="w-10 h-10 text-purple-600 dark:text-purple-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Rapid Scan</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Scan each item barcode individually to return.</p>
              </button>
              <button
                  onClick={() => { setScanMode('return-quantity'); setIsReturnModeSelectionOpen(false); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all text-center"
              >
                  <ArchiveIcon className="w-10 h-10 text-indigo-600 dark:text-indigo-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Quantity Scan</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Scan one item, then enter the quantity to return.</p>
              </button>
          </div>
      </Modal>

      <Modal isOpen={isReturnQuantityModalOpen} onClose={() => { setIsReturnQuantityModalOpen(false); setItemForQuantityReturn(null); setQuantityToReturn('1'); handleSetView(View.SCAN); }} title="Return Quantity">
        {itemForQuantityReturn && itemForQuantityReturn.length > 0 && (
          <form onSubmit={async (e) => {
              e.preventDefault();
              const numToReturn = parseInt(quantityToReturn, 10) || 1;
              if (numToReturn > itemForQuantityReturn.length) {
                  setError(\`Cannot return more than \${itemForQuantityReturn.length} items.\`);
                  return;
              }
              try {
                  const itemsToUpdate = itemForQuantityReturn.slice(0, numToReturn).map(i => i.id);
                  if (itemsToUpdate.length === 1) {
                      await updateStockItemAssignment(itemsToUpdate[0], Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
                  } else {
                      await bulkUpdateAssignments(itemsToUpdate, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
                  }
                  await refetchStock();
                  addToast(\`Returned \${numToReturn} x \${itemForQuantityReturn[0].name}\`, 'success');
                  setIsReturnQuantityModalOpen(false);
                  setItemForQuantityReturn(null);
                  handleSetView(View.SCAN);
              } catch (err) {
                  setError(err.message);
              }
          }} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Item: <span className="font-semibold">{itemForQuantityReturn[0].name}</span>
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Currently assigned to {returnContext.team} in last 24h: <span className="font-semibold">{itemForQuantityReturn.length}</span>
              </p>
              <div>
                  <label htmlFor="return-qty" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Return</label>
                  <input type="number" id="return-qty" min="1" max={itemForQuantityReturn.length} value={quantityToReturn} onChange={(e) => setQuantityToReturn(e.target.value)} className={formInputStyle} required autoFocus />
              </div>
              <div className="flex justify-end space-x-3 pt-6">
                  <button type="button" onClick={() => { setIsReturnQuantityModalOpen(false); setItemForQuantityReturn(null); handleSetView(View.SCAN); }} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">Return Items</button>
              </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={isScanModeModalOpen}`;
code = code.replace(modalsInjection, newModals);


// 3. Update Scan Action Modal
const oldScanActionModal = /<Modal isOpen=\{isScanModeModalOpen\} onClose=\{\(\) => setIsScanModeModalOpen\(false\)\} title="Select Action">\n          <div className="grid grid-cols-1 gap-4">/
const newScanActionModal = `<Modal isOpen={isScanModeModalOpen} onClose={() => setIsScanModeModalOpen(false)} title="Select Action">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">`
code = code.replace(oldScanActionModal, newScanActionModal);

const oldScanReturnButton = /onClick=\{\(\) => \{ setScanMode\('return-rapid'\); setIsScanModeModalOpen\(false\); setRapidScanSummary\(\{\}\); handleSetView\(View\.SCAN\); \}\}/;
const newScanReturnButton = `onClick={() => { setIsScanModeModalOpen(false); setIsReturnSetupModalOpen(true); }}`;
code = code.replace(oldScanReturnButton, newScanReturnButton);

// 4. Update the rapid return scanning logic in handleScanSuccess
const oldReturnRapidLogic = /\} else if \(scanMode === 'return-rapid'\) \{[\s\S]*?\} else if \(scanMode === 'out-quantity'\) \{/;
const newReturnRapidLogic = `} else if (scanMode === 'return-rapid') {
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
                    
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const itemToReturn = items.find(i => i.assigned_to === returnContext.team && i.assigned_at && new Date(i.assigned_at) >= twentyFourHoursAgo);
                    
                    if (!itemToReturn) {
                        triggerScanFeedback('warning');
                        addToast(\`Not assigned to \${returnContext.team} recently\`, 'warning', decodedText);
                        return;
                    }
                    await updateStockItemAssignment(itemToReturn.id, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
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
        } else if (scanMode === 'return-quantity') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner
            
            const items = await getStockItemsByBarcode(decodedText);
            if (items.length === 0) {
                logUnrecognizedBarcode(decodedText);
                addToast(\`Unrecognized barcode: \${decodedText}\`, 'error');
                return;
            }
            
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const teamItems = items.filter(i => i.assigned_to === returnContext.team && i.assigned_at && new Date(i.assigned_at) >= twentyFourHoursAgo);
            
            if (teamItems.length === 0) {
                addToast(\`No items of this type assigned to \${returnContext.team} in last 24h\`, 'warning');
                return;
            }
            
            setItemForQuantityReturn(teamItems);
            setQuantityToReturn('1');
            setIsReturnQuantityModalOpen(true);
        } else if (scanMode === 'out-quantity') {`;
code = code.replace(oldReturnRapidLogic, newReturnRapidLogic);

// 5. Update scanner summary text
const oldSummaryText = /<p className="text-sm text-zinc-300">Assigning to:<\/p>\s*<p className="font-bold text-white">\{assignmentContext\.team\}<\/p>/;
const newSummaryText = `<p className="text-sm text-zinc-300">{scanMode.startsWith('return') ? 'Returning from:' : 'Assigning to:'}</p>
                              <p className="font-bold text-white">{scanMode.startsWith('return') ? returnContext.team : assignmentContext.team}</p>`;
code = code.replace(oldSummaryText, newSummaryText);

fs.writeFileSync('components/StockManagerApp.jsx', code);
