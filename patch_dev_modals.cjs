const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const devModals = `
      <Modal isOpen={isDevLoginModalOpen} onClose={() => setIsDevLoginModalOpen(false)} title="Developer Mode">
          <form onSubmit={handleDevLogin} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Enter the developer password to access advanced tools.</p>
              <div>
                  <label htmlFor="dev-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
                  <input
                      type="password"
                      id="dev-password"
                      value={devPasswordInput}
                      onChange={(e) => setDevPasswordInput(e.target.value)}
                      className={formInputStyle}
                      autoFocus
                  />
                  {devLoginError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{devLoginError}</p>}
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  <button type="button" onClick={() => setIsDevLoginModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-300 dark:hover:bg-zinc-600 font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">Unlock</button>
              </div>
          </form>
      </Modal>

      <Modal isOpen={isDevPurgeModalOpen} onClose={() => setIsDevPurgeModalOpen(false)} title="Purge Barcode Items">
          <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Search for a barcode to delete ALL associated stock items and its item type from the database. 
                  <strong className="text-red-600 block mt-2">WARNING: This is a destructive action and cannot be undone.</strong>
              </p>
              
              <form onSubmit={handleDevPurgeSearch} className="flex gap-2">
                  <input
                      type="text"
                      placeholder="Scan or enter barcode"
                      value={devPurgeBarcode}
                      onChange={(e) => setDevPurgeBarcode(e.target.value)}
                      className={formInputStyle}
                  />
                  <button type="submit" disabled={devPurgeLoading} className="px-4 py-2 bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 rounded-md whitespace-nowrap font-medium disabled:opacity-50">
                      {devPurgeLoading ? 'Searching...' : 'Search'}
                  </button>
              </form>

              {devPurgeResults && (
                  <div className="mt-4 p-4 border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 rounded-lg">
                      <h4 className="font-bold text-red-800 dark:text-red-300 mb-2">Search Results</h4>
                      <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400 space-y-1 mb-4">
                          <li>Found <strong>{devPurgeResults.stockItems.length}</strong> physical stock items.</li>
                          <li>Found <strong>{devPurgeResults.itemType ? '1' : '0'}</strong> registered item type.</li>
                      </ul>
                      
                      {devPurgeResults.stockItems.length > 0 || devPurgeResults.itemType ? (
                          <div className="flex justify-end gap-3 pt-3 border-t border-red-200 dark:border-red-800/30">
                              <button onClick={() => setDevPurgeResults(null)} className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md">
                                  Cancel
                              </button>
                              <button onClick={() => {
                                  setConfirmationModal({
                                      isOpen: true,
                                      title: 'Confirm Total Purge',
                                      message: \`Are you absolutely sure you want to permanently delete \${devPurgeResults.stockItems.length} stock items\${devPurgeResults.itemType ? ' and the item type' : ''} for barcode \${devPurgeBarcode}? This action cannot be reversed.\`,
                                      onConfirm: handleDevPurgeConfirm,
                                      confirmText: 'Yes, Delete Everything',
                                      isDestructive: true
                                  });
                              }} className="px-4 py-2 text-sm font-bold bg-red-600 text-white hover:bg-red-700 rounded-md shadow-sm">
                                  Delete All
                              </button>
                          </div>
                      ) : (
                          <p className="text-sm font-medium text-zinc-600">No items or types found for this barcode.</p>
                      )}
                  </div>
              )}
          </div>
      </Modal>
`;

code = code.replace(
    /<Modal isOpen=\{isChangePinModalOpen\}/,
    devModals + '\n      <Modal isOpen={isChangePinModalOpen}'
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
