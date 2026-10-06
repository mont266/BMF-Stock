const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const newUI = `          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Start Date</label>
              <input type="date" id="start-date" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">End Date</label>
              <input type="date" id="end-date" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
              <label htmlFor="team-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team</label>
              <select id="team-filter" value={filters.team || 'All'} onChange={e => setFilters(prev => ({...prev, team: e.target.value}))} className={formInputStyle}>
                <option value="All">All Teams</option>
                {teams && teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-name-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Name</label>
              <select id="item-name-filter" value={filters.itemName} onChange={e => setFilters(prev => ({...prev, itemName: e.target.value}))} className={formInputStyle}>
                {uniqueItemNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="part-number-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Part Number</label>
              <input 
                type="text" 
                id="part-number-filter"
                placeholder="Enter barcode..."
                value={filters.partNumber} 
                onChange={e => setFilters(prev => ({...prev, partNumber: e.target.value}))} 
                className={formInputStyle} 
              />
            </div>
            <button onClick={handleGenerateReport} disabled={loading} className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center h-10">`;

code = code.replace(
    /<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">[\s\S]*?<button onClick=\{handleGenerateReport\} disabled=\{loading\} className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center h-10">/,
    newUI
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
