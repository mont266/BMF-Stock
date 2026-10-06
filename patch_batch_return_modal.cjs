const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const injectionPoint = `      <Modal isOpen={!!returnModalData}`;
const newModal = `      <Modal isOpen={isBatchReturnModalOpen} onClose={() => setIsBatchReturnModalOpen(false)} title="Batch Return from Team">
          <form onSubmit={handleBatchReturn} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Select a team to view all their currently assigned items. You can then specify how many of each item you want to return to stock (Leading Stores).
              </p>
              
              <div>
                  <label htmlFor="batch-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team</label>
                  <select 
                      id="batch-team" 
                      value={batchReturnTeam} 
                      onChange={(e) => {
                          setBatchReturnTeam(e.target.value);
                          setBatchReturnQuantities({});
                      }}
                      className={formInputStyle}
                      required
                  >
                      <option value="" disabled>Select a team...</option>
                      {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                  </select>
              </div>

              {batchReturnTeam && (
                  <div className="mt-4 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                          <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-10">
                              <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item Name</th>
                                  <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Currently Assigned</th>
                                  <th className="px-4 py-3 text-center text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Qty to Return</th>
                              </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                              {(() => {
                                  const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam);
                                  if (teamStock.length === 0) {
                                      return (
                                          <tr>
                                              <td colSpan="3" className="px-4 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                                  No items currently assigned to {batchReturnTeam}.
                                              </td>
                                          </tr>
                                      );
                                  }

                                  const grouped = {};
                                  teamStock.forEach(item => {
                                      if (!grouped[item.name]) grouped[item.name] = 0;
                                      grouped[item.name]++;
                                  });

                                  return Object.entries(grouped).map(([name, count]) => (
                                      <tr key={name}>
                                          <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</td>
                                          <td className="px-4 py-3 text-sm text-center text-zinc-500 dark:text-zinc-400">{count}</td>
                                          <td className="px-4 py-3 text-center">
                                              <input 
                                                  type="number"
                                                  min="0"
                                                  max={count}
                                                  value={batchReturnQuantities[name] || ''}
                                                  onChange={(e) => setBatchReturnQuantities(prev => ({...prev, [name]: e.target.value}))}
                                                  className="w-20 text-center rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm py-1"
                                                  placeholder="0"
                                              />
                                          </td>
                                      </tr>
                                  ));
                              })()}
                          </tbody>
                      </table>
                  </div>
              )}
              
              <div className="flex justify-end space-x-3 pt-6 mt-6">
                  <button type="button" onClick={() => setIsBatchReturnModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isBatchReturning || !batchReturnTeam} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center disabled:bg-blue-400">
                      {isBatchReturning && <Spinner className="w-4 h-4 mr-2" />}
                      {isBatchReturning ? 'Processing...' : 'Submit Batch Return'}
                  </button>
              </div>
          </form>
      </Modal>

      <Modal isOpen={!!returnModalData}`;

code = code.replace(injectionPoint, newModal);
fs.writeFileSync('components/StockManagerApp.jsx', code);
