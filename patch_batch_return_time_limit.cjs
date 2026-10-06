const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const oldLogic1 = `        // Find all stock assigned to this team
        const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam);`;

const newLogic1 = `        // Find all stock assigned to this team in the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam && s.assigned_at && new Date(s.assigned_at) >= twentyFourHoursAgo);`;


const oldLogic2 = `                              {(() => {
                                  const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam);
                                  if (teamStock.length === 0) {`;

const newLogic2 = `                              {(() => {
                                  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                                  const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam && s.assigned_at && new Date(s.assigned_at) >= twentyFourHoursAgo);
                                  if (teamStock.length === 0) {`;

const oldLogic3 = `No items currently assigned to {batchReturnTeam}.`;
const newLogic3 = `No items assigned to {batchReturnTeam} in the last 24 hours.`;

const oldDescription = `Select a team to view all their currently assigned items. You can then specify how many of each item you want to return to stock (Leading Stores).`;
const newDescription = `Select a team to view items assigned to them within the last 24 hours. You can then specify how many of each item you want to return to stock (Leading Stores).`;

const oldHeader = `<th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Currently Assigned</th>`;
const newHeader = `<th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Assigned (Last 24h)</th>`;


code = code.replace(oldLogic1, newLogic1);
code = code.replace(oldLogic2, newLogic2);
code = code.replace(oldLogic3, newLogic3);
code = code.replace(oldDescription, newDescription);
code = code.replace(oldHeader, newHeader);

fs.writeFileSync('components/StockManagerApp.jsx', code);
