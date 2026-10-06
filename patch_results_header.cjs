const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const newResultsHeader = `                        <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Report Results</h2>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            For period {new Date(filters.startDate).toLocaleDateString()} to {new Date(filters.endDate).toLocaleDateString()}
                            {filters.team && filters.team !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Team: {filters.team}</span>}
                            {filters.itemName && filters.itemName !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Item: {filters.itemName}</span>}
                        </p>`;

code = code.replace(
    /<h2 className="text-xl font-bold text-zinc-800 dark:text-white">Report Results<\/h2>\n                        <p className="text-sm text-zinc-500 dark:text-zinc-400">\n                            For period \{new Date\(filters\.startDate\)\.toLocaleDateString\(\)\} to \{new Date\(filters\.endDate\)\.toLocaleDateString\(\)\}\n                        <\/p>/,
    newResultsHeader
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
