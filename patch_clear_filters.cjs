const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const regex = /<div className="flex justify-start lg:justify-end">\n                                          <button \n                                              onClick=\{\(\) => setAssignmentFilters\(\{ team: 'All', itemType: 'All', location: 'All', assignedByMe: false \}\)\}/;

const replacement = `<div className="flex justify-start lg:justify-end space-x-2">
                                          <button 
                                              onClick={handleOpenBatchReturn}
                                              className="w-full lg:w-auto px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors text-sm font-medium flex items-center justify-center whitespace-nowrap"
                                          >
                                              Batch Return
                                          </button>
                                          <button 
                                              onClick={() => setAssignmentFilters({ team: 'All', itemType: 'All', location: 'All', assignedByMe: false })}`;

code = code.replace(regex, replacement);
fs.writeFileSync('components/StockManagerApp.jsx', code);
