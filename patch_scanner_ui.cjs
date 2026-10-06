const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Update RapidScanSummary to not be fixed position so it stacks nicely
const oldRapidScanSummary = /const RapidScanSummary = \(\{ summary \}\) => \{\n\s*const summaryItems = Object\.entries\(summary\);\n\n\s*return \(\n\s*<div className="fixed bottom-24 left-1\/2 -translate-x-1\/2 w-full max-w-sm p-4 z-\[10001\]">\n\s*<div className="bg-zinc-800\/90 dark:bg-zinc-900\/90 backdrop-blur-sm shadow-lg rounded-xl p-4 text-white">/;

const newRapidScanSummary = `const RapidScanSummary = ({ summary, className = '' }) => {
    const summaryItems = Object.entries(summary);

    return (
        <div className={\`w-full max-w-md mx-auto pointer-events-auto \${className}\`}>
            <div className="bg-zinc-800/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-xl rounded-2xl p-4 text-white border border-zinc-700/50">`;
code = code.replace(oldRapidScanSummary, newRapidScanSummary);

// 2. Remove the old standalone RapidScanSummary rendering
const oldStandaloneSummary = /\{\(scanMode === 'out-rapid' \|\| scanMode === 'return-rapid'\) && \(\n\s*<RapidScanSummary summary=\{rapidScanSummary\} \/>\n\s*\)\}/;
code = code.replace(oldStandaloneSummary, "");

// 3. Update the bottom overlay
const oldOverlay = /\{\(scanMode === 'out-rapid' \|\| \(scanMode && scanMode\.startsWith\('return-'\)\)\) && \([\s\S]*?<\/div>\n\s*<\/div>\n\s*\)\}/;

const newOverlay = `{(scanMode === 'out-rapid' || (scanMode && scanMode.startsWith('return-'))) && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 sm:p-6 pb-8 pointer-events-none flex flex-col items-center gap-3">
                          
                          {(scanMode === 'out-rapid' || scanMode === 'return-rapid') && (
                              <RapidScanSummary summary={rapidScanSummary} className="mb-2" />
                          )}

                          {scanMode && scanMode.startsWith('return-') && (
                              <div className="pointer-events-auto bg-zinc-900/90 dark:bg-zinc-950/90 backdrop-blur-xl shadow-2xl rounded-full p-1.5 flex border border-zinc-700/50">
                                  <button
                                      onClick={() => { setScanMode('return-rapid'); setRapidScanSummary({}); }}
                                      className={\`px-6 py-2.5 rounded-full text-sm font-bold transition-all \${scanMode === 'return-rapid' ? 'bg-purple-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'}\`}
                                  >
                                      Rapid Mode
                                  </button>
                                  <button
                                      onClick={() => setScanMode('return-quantity')}
                                      className={\`px-6 py-2.5 rounded-full text-sm font-bold transition-all \${scanMode === 'return-quantity' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'}\`}
                                  >
                                      Quantity Mode
                                  </button>
                              </div>
                          )}

                          <div className="w-full max-w-md mx-auto p-4 bg-zinc-900/90 dark:bg-zinc-950/90 backdrop-blur-xl pointer-events-auto shadow-2xl rounded-2xl flex justify-between items-center border border-zinc-700/50">
                            <div>
                              <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-0.5">{scanMode && scanMode.startsWith('return') ? 'Returning from' : 'Assigning to'}</p>
                              <p className="font-bold text-white text-lg">{scanMode && scanMode.startsWith('return') ? returnContext.team : assignmentContext.team}</p>
                            </div>
                            <button 
                              onClick={handleCancelScan}
                              className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold shadow-md transition-colors flex items-center gap-2"
                            >
                              <XIcon className="w-4 h-4" />
                              Finish
                            </button>
                          </div>
                        </div>
                      )}`;
code = code.replace(oldOverlay, newOverlay);

fs.writeFileSync('components/StockManagerApp.jsx', code);
