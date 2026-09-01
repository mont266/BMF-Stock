import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const modalTarget = `<Modal isOpen={isThresholdSummaryModalOpen} onClose={() => setIsThresholdSummaryModalOpen(false)} title="Stock Threshold Update Summary">`;
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
      
      <Modal isOpen={isThresholdSummaryModalOpen} onClose={() => setIsThresholdSummaryModalOpen(false)} title="Stock Threshold Update Summary">`;

content = content.replace(modalTarget, modalCode);
fs.writeFileSync('components/StockManagerApp.jsx', content);
