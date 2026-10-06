const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldDescription = `<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items below threshold, plus order recommendations based on your selected date range's usage.</p>`;
const newDescription = `<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items falling below the manual threshold or a strict 6-week stock target based on your selected date range's usage.</p>`;

const oldHeaders = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Usage (Period)</th>`;

const newHeaders = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Target (6-Weeks)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Usage (Period)</th>`;

code = code.replace(oldDescription, newDescription);
code = code.replace(oldHeaders, newHeaders);

fs.writeFileSync('components/StockManagerApp.jsx', code);
