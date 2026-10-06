const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Refactor RapidScanSummary to be ultra compact and hide when empty
const oldRapidScanSummary = /const RapidScanSummary = \(\{ summary, className = '' \}\) => \{\n\s*const summaryItems = Object\.entries\(summary\);\n\n\s*return \(\n\s*<div className=\{\`w-full max-w-md mx-auto pointer-events-auto \$\{className\}\`\}>\n\s*<div className="bg-zinc-800\/95 dark:bg-zinc-900\/95 backdrop-blur-md shadow-xl rounded-2xl p-4 text-white border border-zinc-700\/50">\n\s*<h3 className="text-lg font-bold mb-2 border-b border-zinc-700 pb-2">Session Summary<\/h3>\n\s*\{summaryItems\.length === 0 \? \(\n\s*<p className="text-zinc-400 text-sm">Scan an item to begin\.\.\.<\/p>\n\s*\) : \(\n\s*<ul className="space-y-2 max-h-40 overflow-y-auto">\n\s*\{summaryItems\.map\(\(\[name, count\]\) => \(\n\s*<li key=\{name\} className="flex justify-between items-center text-sm">\n\s*<span className="font-medium text-zinc-200">\{name\}<\/span>\n\s*<span className="font-mono bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full">\{count\}<\/span>\n\s*<\/li>\n\s*\)\)\}\n\s*<\/ul>\n\s*\)\}\n\s*<\/div>\n\s*<\/div>\n\s*\);\n\};/;

const newRapidScanSummary = `const RapidScanSummary = ({ summary, className = '' }) => {
    const summaryItems = Object.entries(summary);
    if (summaryItems.length === 0) return null;

    return (
        <div className={\`w-full max-w-sm mx-auto pointer-events-auto \${className}\`}>
            <div className="bg-zinc-900/95 backdrop-blur-md shadow-xl rounded-xl p-3 text-white border border-zinc-700/50">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2 border-b border-zinc-700/50 pb-1.5">Session Summary</h3>
                <ul className="space-y-1.5 max-h-[25vh] overflow-y-auto pr-1">
                    {summaryItems.map(([name, count]) => (
                        <li key={name} className="flex justify-between items-center text-sm">
                            <span className="font-medium text-zinc-200 truncate pr-3">{name}</span>
                            <span className="font-mono bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{count}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};`;
code = code.replace(oldRapidScanSummary, newRapidScanSummary);

// 2. Overhaul the bottom overlay structure
const oldOverlay = /\{\(scanMode === 'out-rapid' \|\| \(scanMode && scanMode\.startsWith\('return-'\)\)\) && \([\s\S]*?<\/div>\n\s*<\/div>\n\s*\)\}/;

const newOverlay = `{(scanMode === 'out-rapid' || (scanMode && scanMode.startsWith('return-'))) && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 sm:p-6 pb-safe-bottom pointer-events-none flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
                          
                          {(scanMode === 'out-rapid' || scanMode === 'return-rapid') && (
                              <RapidScanSummary summary={rapidScanSummary} className="mb-1" />
                          )}

                          {scanMode && scanMode.startsWith('return-') && (
                              <div className="pointer-events-auto bg-zinc-900/95 backdrop-blur-xl shadow-xl rounded-full p-1 flex border border-zinc-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
                                  <button
                                      onClick={() => { setScanMode('return-rapid'); setRapidScanSummary({}); }}
                                      className={\`px-4 py-1.5 rounded-full text-xs font-bold transition-all \${scanMode === 'return-rapid' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}\`}
                                  >
                                      Rapid
                                  </button>
                                  <button
                                      onClick={() => setScanMode('return-quantity')}
                                      className={\`px-4 py-1.5 rounded-full text-xs font-bold transition-all \${scanMode === 'return-quantity' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}\`}
                                  >
                                      Quantity
                                  </button>
                              </div>
                          )}

                          <div className="w-full max-w-sm mx-auto p-2.5 bg-zinc-900/95 backdrop-blur-xl pointer-events-auto shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl flex justify-between items-center border border-zinc-700/50">
                            <div className="flex flex-col px-2 overflow-hidden">
                              <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold leading-tight mb-0.5">{scanMode && scanMode.startsWith('return') ? 'Returning from' : 'Assigning to'}</p>
                              <p className="font-bold text-white text-sm leading-tight truncate">{scanMode && scanMode.startsWith('return') ? returnContext.team : assignmentContext.team}</p>
                            </div>
                            <button 
                              onClick={handleCancelScan}
                              className="shrink-0 ml-3 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center gap-1.5"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                              Finish
                            </button>
                          </div>
                        </div>
                      )}`;
code = code.replace(oldOverlay, newOverlay);

fs.writeFileSync('components/StockManagerApp.jsx', code);
