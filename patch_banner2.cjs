const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const bannerUI = `
      {isOffline && (
          <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-white text-center py-1.5 px-4 text-sm font-semibold z-[9999] shadow-md flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
              Offline Mode: Changes will be saved locally and synced when connection is restored.
          </div>
      )}
      {showOnlineRestored && !isOffline && (
          <div className="fixed top-0 left-0 right-0 bg-green-500 text-white text-center py-1.5 px-4 text-sm font-semibold z-[9999] shadow-md flex items-center justify-center gap-2 transition-all duration-500">
              <CheckCircleIcon className="w-4 h-4" />
              Connection Restored: Syncing changes...
          </div>
      )}
`;

code = code.replace(
    /<div className="flex h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">/,
    `${bannerUI}\n      <div className="flex h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
