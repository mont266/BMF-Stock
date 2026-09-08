const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const executeConfirmationAction = async \(\) => \{/g,
    `const executeConfirmationAction = async () => {
    if (confirmationModal.onConfirm) {
        setIsConfirmingAction(true);
        setError(null);
        try {
            await confirmationModal.onConfirm();
            setConfirmationModal({ isOpen: false });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsConfirmingAction(false);
        }
        return;
    }`
);

code = code.replace(
    /\{isConfirmingAction && <Spinner className="-ml-1 mr-3 h-5 w-5" \/>\}\n             Confirm\n          <\/button>/g,
    `{isConfirmingAction && <Spinner className="-ml-1 mr-3 h-5 w-5" />}\n             {confirmationModal.confirmText || 'Confirm'}\n          </button>`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
