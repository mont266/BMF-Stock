const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const devSettings = `
            {isAdminProfile && (
               <div>
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Developer Tools</h3>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      {!isDevMode ? (
                          <button 
                              onClick={() => {
                                  setIsSettingsModalOpen(false);
                                  setIsDevLoginModalOpen(true);
                              }}
                              className="w-full text-left font-medium text-zinc-700 dark:text-zinc-300"
                          >
                              <div className="flex justify-between items-center">
                                  <span>Enable Developer Mode</span>
                                  <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">Unlock &rarr;</span>
                              </div>
                          </button>
                      ) : (
                          <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                  <span className="text-green-600 dark:text-green-400 font-bold text-sm uppercase tracking-wider">Dev Mode Active</span>
                                  <button onClick={() => setIsDevMode(false)} className="text-xs text-red-600 hover:underline">Disable</button>
                              </div>
                              <button 
                                  onClick={() => {
                                      setIsSettingsModalOpen(false);
                                      setIsDevPurgeModalOpen(true);
                                  }}
                                  className="w-full text-left font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800/30"
                              >
                                  <div className="flex justify-between items-center">
                                      <span>Purge Barcode Items</span>
                                      <span className="text-sm font-semibold">&rarr;</span>
                                  </div>
                              </button>
                          </div>
                      )}
                  </div>
                </div>
            )}
`;

code = code.replace(
    /<div className="pt-6 mt-6 border-t border-zinc-200 dark:border-zinc-700 flex justify-center">/,
    devSettings + '\n                        <div className="pt-6 mt-6 border-t border-zinc-200 dark:border-zinc-700 flex justify-center">'
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
