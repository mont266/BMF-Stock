const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Remove current banner
code = code.replace(
    /\{isOffline && \([\s\S]*?Connection Restored: Syncing changes\.\.\.\n          <\/div>\n      \)\}/,
    ''
);

// Insert new banner before <main>
const newBanner = `
          {isOffline && (
              <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-semibold flex items-center justify-center gap-2 flex-shrink-0 shadow-sm z-40 relative w-full">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  Offline Mode: Changes will be saved locally and synced when connection is restored.
              </div>
          )}
          {showOnlineRestored && !isOffline && (
              <div className="bg-emerald-500 text-white text-center py-2 px-4 text-sm font-semibold flex items-center justify-center gap-2 flex-shrink-0 shadow-sm transition-all duration-500 z-40 relative w-full">
                  <CheckCircleIcon className="w-4 h-4" />
                  Connection Restored: Syncing changes...
              </div>
          )}
`;

code = code.replace(
    /\{\/\* --- MAIN CONTENT --- \*\/\}/,
    `${newBanner}\n          {/* --- MAIN CONTENT --- */}`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
