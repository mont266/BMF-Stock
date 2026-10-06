const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldHeader = `        if (filters.team && filters.team !== 'All') {
            headerText += \` | Team: \${filters.team}\`;
        }
        if (filters.itemName && filters.itemName !== 'All') {`;
        
const newHeader = `        if (filters.team && filters.team !== 'All') {
            headerText += \` | Team: \${filters.team}\`;
        }
        if (filters.location && filters.location !== 'All') {
            headerText += \` | Location: \${filters.location}\`;
        }
        if (filters.itemName && filters.itemName !== 'All') {`;

code = code.replace(oldHeader, newHeader);

const oldResultsHeader = `                            {filters.team && filters.team !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Team: {filters.team}</span>}
                            {filters.itemName && filters.itemName !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Item: {filters.itemName}</span>}`;

const newResultsHeader = `                            {filters.team && filters.team !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Team: {filters.team}</span>}
                            {filters.location && filters.location !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Location: {filters.location}</span>}
                            {filters.itemName && filters.itemName !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Item: {filters.itemName}</span>}`;

code = code.replace(oldResultsHeader, newResultsHeader);

fs.writeFileSync('components/StockManagerApp.jsx', code);
