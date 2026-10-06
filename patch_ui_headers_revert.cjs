const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldDescription = `<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items falling below the manual threshold or a strict 6-week stock target based on your selected date range's usage.</p>`;
const newDescription = `<p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items falling below their 6-week stock threshold, along with the order quantity required to replenish them.</p>`;

const oldHeaders = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Target (6-Weeks)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Usage (Period)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Suggested Order</th>`;

const newHeaders = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold (6-Weeks)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Order to Replenish</th>`;

const oldRow = `                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.usage || 0}</td>
                                      <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600 dark:text-blue-400">{item.suggestedOrder || 0}</td>`;

const newRow = `                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                                      <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600 dark:text-blue-400">{item.suggestedOrder || 0}</td>`;


code = code.replace(oldDescription, newDescription);
code = code.replace(oldHeaders, newHeaders);
code = code.replace(oldRow, newRow);

fs.writeFileSync('components/StockManagerApp.jsx', code);
