const fs = require('fs');
let code = fs.readFileSync('App.jsx', 'utf8');

if (!code.includes("import Modal from './components/Modal';")) {
    code = code.replace("import ProfileSelection from './components/ProfileSelection';", "import ProfileSelection from './components/ProfileSelection';\nimport Modal from './components/Modal';");
}

code = code.replace(
    /useInactivityTimeout\(handleSwitchProfile, 600000\);/g,
    `const { showWarning, countdown, resetTimer } = useInactivityTimeout(handleSwitchProfile, 300000, 60000, !!selectedProfile);`
);

const modalContent = `
            <Modal isOpen={showWarning} onClose={resetTimer} title="Session Timeout Warning">
                <div className="space-y-4 py-4 text-center">
                    <p className="text-zinc-600 dark:text-zinc-300">
                        You have been inactive for a while. For your security, your session will automatically lock in:
                    </p>
                    <div className="text-4xl font-mono font-bold text-red-600 dark:text-red-500 py-4">
                        {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                    </div>
                    <button 
                        onClick={resetTimer} 
                        className="w-full px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
                    >
                        Continue Session
                    </button>
                </div>
            </Modal>
`;

code = code.replace(
    /<StockManagerApp\n\s+key=\{session\.user\.id\}/,
    modalContent + '\n            <StockManagerApp\n                key={session.user.id}'
);

fs.writeFileSync('App.jsx', code);
