const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const overlayRegex = /\{\(scanMode === 'out-rapid' \|\| scanMode === 'return-rapid'\) && \(\n\s*<div className="fixed inset-x-0 bottom-0 z-\[10000\] p-4 pointer-events-none">\n\s*<div className="max-w-md mx-auto p-3 bg-zinc-800\/80 dark:bg-zinc-900\/80 backdrop-blur-sm pointer-events-auto shadow-lg rounded-xl flex justify-between items-center">\n\s*<div>\n\s*<p className="text-sm text-zinc-300">\{scanMode\.startsWith\('return'\) \? 'Returning from:' : 'Assigning to:'\}<\/p>\n\s*<p className="font-bold text-white">\{scanMode\.startsWith\('return'\) \? returnContext\.team : assignmentContext\.team\}<\/p>\n\s*<\/div>\n\s*<button \n\s*onClick=\{handleCancelScan\}\n\s*className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold"\n\s*>\n\s*Finish Session\n\s*<\/button>\n\s*<\/div>\n\s*<\/div>\n\s*\)\}/;

const overlayReplacement = `{(scanMode === 'out-rapid' || (scanMode && scanMode.startsWith('return-'))) && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 pointer-events-none flex flex-col items-center gap-2">
                          {scanMode && scanMode.startsWith('return-') && (
                              <div className="pointer-events-auto bg-zinc-800/80 dark:bg-zinc-900/80 backdrop-blur-sm shadow-lg rounded-full p-1 flex mb-2">
                                  <button
                                      onClick={() => { setScanMode('return-rapid'); setRapidScanSummary({}); }}
                                      className={\`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors \${scanMode === 'return-rapid' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white'}\`}
                                  >
                                      Rapid
                                  </button>
                                  <button
                                      onClick={() => setScanMode('return-quantity')}
                                      className={\`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors \${scanMode === 'return-quantity' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}\`}
                                  >
                                      Quantity
                                  </button>
                              </div>
                          )}
                          <div className="w-full max-w-md mx-auto p-3 bg-zinc-800/80 dark:bg-zinc-900/80 backdrop-blur-sm pointer-events-auto shadow-lg rounded-xl flex justify-between items-center">
                            <div>
                              <p className="text-sm text-zinc-300">{scanMode && scanMode.startsWith('return') ? 'Returning from:' : 'Assigning to:'}</p>
                              <p className="font-bold text-white">{scanMode && scanMode.startsWith('return') ? returnContext.team : assignmentContext.team}</p>
                            </div>
                            <button 
                              onClick={handleCancelScan}
                              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold"
                            >
                              Finish Session
                            </button>
                          </div>
                        </div>
                      )}`;

code = code.replace(overlayRegex, overlayReplacement);

// Also need to update `persistent` prop on Scanner.
const scannerPersistentRegex = /persistent=\{scanMode === 'out-rapid' \|\| scanMode === 'return-rapid'\}/;
const scannerPersistentReplacement = `persistent={scanMode === 'out-rapid' || scanMode === 'return-rapid' || scanMode === 'return-quantity'}`;
code = code.replace(scannerPersistentRegex, scannerPersistentReplacement);

fs.writeFileSync('components/StockManagerApp.jsx', code);
