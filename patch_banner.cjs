const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const bannerState = `
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showOnlineRestored, setShowOnlineRestored] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
        setIsOffline(true);
        setShowOnlineRestored(false);
    };
    const handleOnline = () => {
        setIsOffline(false);
        setShowOnlineRestored(true);
        setTimeout(() => setShowOnlineRestored(false), 3000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
    };
  }, []);
`;

code = code.replace(
    /const \[currentView, setCurrentView\] = useState\(View\.LIST\);/,
    `const [currentView, setCurrentView] = useState(View.LIST);\n${bannerState}`
);

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
    /<div className="min-h-screen bg-zinc-100 dark:bg-zinc-900">/,
    `<div className="min-h-screen bg-zinc-100 dark:bg-zinc-900">\n${bannerUI}`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
