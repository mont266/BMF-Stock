import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Add UploadIcon to imports
content = content.replace(
  'CalculatorIcon, DocumentArrowDownIcon } from \'./Icons\';',
  'CalculatorIcon, DocumentArrowDownIcon, UploadIcon } from \'./Icons\';'
);

// 2. Add syncQueue, clearSyncQueue to useStock destructuring
content = content.replace(
  'refetchStock } = useStock();',
  'refetchStock, syncQueue, clearSyncQueue } = useStock();'
);

// 3. Add isQueueModalOpen state
content = content.replace(
  'const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);',
  `const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);`
);

// 4. Add Queue button to desktop sidebar 
content = content.replace(
  '<button onClick={() => setIsSettingsModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Settings" title="Settings">',
  `{syncQueue && syncQueue.length > 0 && (
      <button onClick={() => setIsQueueModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors relative" aria-label="Upload Queue" title="Upload Queue">
        <UploadIcon className="w-5 h-5 text-amber-500" />
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">{syncQueue.length}</span>
      </button>
  )}
  <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Settings" title="Settings">`
);

// 5. Add Queue button to mobile sidebar
content = content.replace(
  '<MobileNavItem icon={<SettingsIcon/>} label="Settings" isActive={isSettingsModalOpen} onClick={() => setIsSettingsModalOpen(true)} />',
  `{syncQueue && syncQueue.length > 0 && (
      <MobileNavItem icon={<div className="relative"><UploadIcon/><span className="absolute -top-1 -right-2 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-red-600 rounded-full">{syncQueue.length}</span></div>} label="Sync Queue" isActive={isQueueModalOpen} onClick={() => setIsQueueModalOpen(true)} />
  )}
  <MobileNavItem icon={<SettingsIcon/>} label="Settings" isActive={isSettingsModalOpen} onClick={() => setIsSettingsModalOpen(true)} />`
);

// 6. Add Queue Modal at the end (before return null or at the end of JSX). Let's put it before <SettingsModal ... />
const queueModalStr = `
      <Modal isOpen={isQueueModalOpen} onClose={() => setIsQueueModalOpen(false)} title="Offline Sync Queue">
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-md p-4 flex items-start space-x-3">
             <div className="text-amber-500 mt-0.5"><UploadIcon className="w-5 h-5" /></div>
             <div className="text-sm text-amber-800 dark:text-amber-200">
               <p className="font-semibold mb-1">Waiting for Internet Connection</p>
               <p>These actions were saved locally and will automatically upload when your connection improves.</p>
             </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {syncQueue && syncQueue.length > 0 ? (
                syncQueue.map(task => (
                    <div key={task.id} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm">
                        <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {task.action === 'UPDATE_ASSIGNMENT' ? 'Assign Item' : task.action}
                            </span>
                            <span className="text-xs text-zinc-500">
                                {new Date(task.timestamp).toLocaleTimeString()}
                            </span>
                        </div>
                        {task.action === 'UPDATE_ASSIGNMENT' && task.payload && (
                            <div className="text-zinc-600 dark:text-zinc-400 text-xs">
                                To: {task.payload.assigned_to} <br/>
                                By: {task.payload.assignerName}
                            </div>
                        )}
                    </div>
                ))
            ) : (
                <div className="p-4 text-center text-zinc-500">No items in queue.</div>
            )}
          </div>
          {syncQueue && syncQueue.length > 0 && (
             <button onClick={() => { clearSyncQueue(); setIsQueueModalOpen(false); }} className="w-full mt-4 px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-md transition-colors text-sm font-medium">
               Clear Queue (Discard Changes)
             </button>
          )}
        </div>
      </Modal>
`;

content = content.replace(
  '<SettingsModal',
  queueModalStr + '\n      <SettingsModal'
);

fs.writeFileSync('components/StockManagerApp.jsx', content, 'utf8');
console.log('Done!');
