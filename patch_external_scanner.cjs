const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Add persistent prop
code = code.replace(
    /const ExternalScannerPage = \(\{ onScanSuccess, onCancel \}\) => \{/,
    "const ExternalScannerPage = ({ onScanSuccess, onCancel, persistent = false }) => {"
);

// Conditionally render cancel button
const oldCancelBtn = /<button\n\s*type="button"\n\s*onClick=\{onCancel\}\n\s*className="mt-8 px-8 py-3 bg-white\/80 dark:bg-zinc-800\/80 text-zinc-800 dark:text-zinc-100 rounded-lg backdrop-blur-md text-lg font-semibold border border-zinc-300 dark:border-zinc-700"\n\s*>\n\s*Cancel\n\s*<\/button>/;

const newCancelBtn = `{!persistent && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="mt-8 px-8 py-3 bg-white/80 dark:bg-zinc-800/80 text-zinc-800 dark:text-zinc-100 rounded-lg backdrop-blur-md text-lg font-semibold border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                        Cancel
                    </button>
                )}`;

code = code.replace(oldCancelBtn, newCancelBtn);

// Pass persistent prop where ExternalScannerPage is used
const oldUsage = /<ExternalScannerPage\n\s*onScanSuccess=\{handleScanSuccess\}\n\s*onCancel=\{handleCancelScan\}\n\s*\/>/;
const newUsage = `<ExternalScannerPage
                              onScanSuccess={handleScanSuccess}
                              onCancel={handleCancelScan}
                              persistent={scanMode === 'out-rapid' || scanMode === 'return-rapid' || scanMode === 'return-quantity'}
                          />`;

code = code.replace(oldUsage, newUsage);

fs.writeFileSync('components/StockManagerApp.jsx', code);
