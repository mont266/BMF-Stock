const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldGrid = `<div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">`;
const newGrid = `<div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4 items-end">`;

const locationDropdown = `
            <div>
              <label htmlFor="location-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location</label>
              <select id="location-filter" value={filters.location || 'All'} onChange={e => setFilters(prev => ({...prev, location: e.target.value}))} className={formInputStyle}>
                <option value="All">All Locations</option>
                {dbLocations && dbLocations.map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
              </select>
            </div>`;

code = code.replace(oldGrid, newGrid);

code = code.replace(
    /<\/select>\n            <\/div>\n            <div>\n              <label htmlFor="item-name-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Name<\/label>/,
    `</select>\n            </div>${locationDropdown}\n            <div>\n              <label htmlFor="item-name-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Name</label>`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
