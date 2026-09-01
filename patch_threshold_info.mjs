import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Import InformationCircleIcon
content = content.replace(
  "import { BrandIcon, ScanIcon",
  "import { BrandIcon, ScanIcon, InformationCircleIcon"
);

// 2. Add state
const stateTarget = "const [isThresholdSummaryModalOpen, setIsThresholdSummaryModalOpen] = useState(false);";
const stateCode = `const [isThresholdSummaryModalOpen, setIsThresholdSummaryModalOpen] = useState(false);
  const [isThresholdInfoModalOpen, setIsThresholdInfoModalOpen] = useState(false);`;
content = content.replace(stateTarget, stateCode);

// 3. Update AdminActionCard definition
const adminActionCardTarget = `const AdminActionCard = ({ icon, title, description, onClick, buttonText, disabled = false }) => (
    <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center">
                {React.cloneElement(icon, { className: "w-5 h-5 mr-3 text-zinc-500" })}
                <span>{title}</span>
            </h2>
        </div>`;
const adminActionCardCode = `const AdminActionCard = ({ icon, title, description, onClick, buttonText, disabled = false, infoAction = null }) => (
    <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center">
                {React.cloneElement(icon, { className: "w-5 h-5 mr-3 text-zinc-500" })}
                <span>{title}</span>
            </h2>
            {infoAction && (
                <button onClick={infoAction} className="text-zinc-400 hover:text-blue-500 transition-colors" title="How is this calculated?">
                    <InformationCircleIcon className="w-5 h-5" />
                </button>
            )}
        </div>`;
content = content.replace(adminActionCardTarget, adminActionCardCode);

// 4. Update the "Automate Stock Thresholds" AdminActionCard usage
const usageTarget = `<AdminActionCard 
                                icon={<CalculatorIcon/>}
                                title="Automate Stock Thresholds"
                                description="Automatically calculate and update the re-order threshold for all item types based on usage over the last 4 weeks."
                                onClick={handleCalculateThresholds}
                                buttonText={isCalculatingThresholds ? 'Calculating...' : 'Calculate Thresholds'}
                                disabled={isCalculatingThresholds}
                             />`;
const usageCode = `<AdminActionCard 
                                icon={<CalculatorIcon/>}
                                title="Automate Stock Thresholds"
                                description="Automatically calculate and update the re-order threshold for all item types based on usage over the last 4 weeks."
                                onClick={handleCalculateThresholds}
                                buttonText={isCalculatingThresholds ? 'Calculating...' : 'Calculate Thresholds'}
                                disabled={isCalculatingThresholds}
                                infoAction={() => setIsThresholdInfoModalOpen(true)}
                             />`;
content = content.replace(usageTarget, usageCode);

// 5. Add the Info Modal
const modalTarget = `<Modal isOpen={isThresholdSummaryModalOpen} onClose={() => setIsThresholdSummaryModalOpen(false)} title="Threshold Update Summary">`;
const modalCode = `<Modal isOpen={isThresholdInfoModalOpen} onClose={() => setIsThresholdInfoModalOpen(false)} title="How Thresholds Are Calculated">
        <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
            <p>
                When you run the <strong>Calculate Thresholds</strong> action, the system analyzes the past 4 weeks of "OUT" movements (items assigned to teams) to determine a safe reorder point for each item type.
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md p-4">
                <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">The Formula</h4>
                <ul className="list-disc pl-5 space-y-1">
                    <li>We calculate the total usage over the last <strong>4 weeks</strong>.</li>
                    <li>We target a <strong>6-week stock cover</strong> buffer, which means multiplying the 4-week usage by <strong>1.5</strong> (or 150%).</li>
                    <li>Any calculated threshold below <strong>5</strong> is automatically rounded up to <strong>5</strong> to ensure low-usage items aren't caught off guard.</li>
                </ul>
            </div>
            <p>
                <em>Example: If you used 10 items in the last 4 weeks, the new threshold will be set to 15. If you only used 2, the threshold will be safely clamped to the minimum of 5.</em>
            </p>
            <div className="flex justify-end pt-4">
                <button onClick={() => setIsThresholdInfoModalOpen(false)} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Understood</button>
            </div>
        </div>
      </Modal>
      
      <Modal isOpen={isThresholdSummaryModalOpen} onClose={() => setIsThresholdSummaryModalOpen(false)} title="Threshold Update Summary">`;
content = content.replace(modalTarget, modalCode);

fs.writeFileSync('components/StockManagerApp.jsx', content);
