const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /<button\n                  onClick=\{\(\) => \{ setScanMode\('in'\); setIsScanModeModalOpen\(false\); handleSetView\(View\.SCAN\); \}\}\n                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700\/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900\/20 hover:border-blue-400 dark:hover:border-blue-600 transition-all text-center"\n              >\n                  <PlusCircleIcon className="w-10 h-10 text-blue-600 dark:text-blue-400 mb-2" \/>\n                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan In<\/p>\n                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Add new items to stock via barcode\.<\/p>\n              <\/button>/;

const replacement = `<button
                  onClick={() => { setScanMode('return-rapid'); setIsScanModeModalOpen(false); setRapidScanSummary({}); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-400 dark:hover:border-purple-600 transition-all text-center"
              >
                  <RefreshIcon className="w-10 h-10 text-purple-600 dark:text-purple-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan Return</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Rapidly return items to stock via barcode.</p>
              </button>
              <button
                  onClick={() => { setScanMode('in'); setIsScanModeModalOpen(false); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-600 transition-all text-center"
              >
                  <PlusCircleIcon className="w-10 h-10 text-blue-600 dark:text-blue-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan In</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Add new items to stock via barcode.</p>
              </button>`;

code = code.replace(regex, replacement);
fs.writeFileSync('components/StockManagerApp.jsx', code);
