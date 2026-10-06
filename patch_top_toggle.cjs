const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldOverlaySection = /\{\(scanMode === 'out-rapid' \|\| \(scanMode && scanMode\.startsWith\('return-'\)\)\) && \([\s\S]*?<\/div>\n\s*<\/div>\n\s*\)\}/;

const newOverlaySection = `{scanMode && scanMode.startsWith('return-') && (
                        <div className="fixed inset-x-0 top-0 z-[10000] p-4 sm:p-6 pointer-events-none flex justify-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.5rem)' }}>
                            <div className="pointer-events-auto bg-zinc-900/95 backdrop-blur-xl shadow-xl rounded-full p-1 flex border border-zinc-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
                                <button
                                    onClick={() => { setScanMode('return-rapid'); setRapidScanSummary({}); }}
                                    className={\`px-6 py-2 rounded-full text-xs font-bold transition-all \${scanMode === 'return-rapid' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}\`}
                                >
                                    Rapid
                                </button>
                                <button
                                    onClick={() => setScanMode('return-quantity')}
                                    className={\`px-6 py-2 rounded-full text-xs font-bold transition-all \${scanMode === 'return-quantity' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}\`}
                                >
                                    Quantity
                                </button>
                            </div>
                        </div>
                      )}
                      
                      {(scanMode === 'out-rapid' || (scanMode && scanMode.startsWith('return-'))) && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 sm:p-6 pb-safe-bottom pointer-events-none flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
                          
                          {(scanMode === 'out-rapid' || scanMode === 'return-rapid') && (
                              <RapidScanSummary summary={rapidScanSummary} className="mb-1" />
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

code = code.replace(oldOverlaySection, newOverlaySection);
fs.writeFileSync('components/StockManagerApp.jsx', code);
