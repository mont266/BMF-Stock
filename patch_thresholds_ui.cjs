const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldHeader = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Current Stock</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold</th>`;

const newHeader = `                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Current Stock</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Usage (Period)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Suggested Order</th>`;

const oldRow = `                                      <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">{item.name}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{item.currentStock}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                                  </tr>`;

const newRow = `                                      <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">{item.name}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{item.currentStock}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.usage || 0}</td>
                                      <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600 dark:text-blue-400">{item.suggestedOrder || 0}</td>
                                  </tr>`;

code = code.replace(oldHeader, newHeader);
code = code.replace(oldRow, newRow);

fs.writeFileSync('components/StockManagerApp.jsx', code);
