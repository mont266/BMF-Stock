const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const injectionPoint = `      <Modal isOpen={confirmationModal.isOpen}`;
const newModal = `      <Modal isOpen={!!returnModalData} onClose={() => setReturnModalData(null)} title="Return Items to Stock">
        {returnModalData && (
          <form onSubmit={handleConfirmReturn} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  You are returning <strong>{returnModalData.name}</strong> from <strong>{returnModalData.assigned_to}</strong> back to stock (Leading Stores).
              </p>
              
              {(returnModalData.quantity > 1 || (returnModalData.items && returnModalData.items.length > 1)) && (
                  <div>
                      <label htmlFor="return-quantity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Quantity to Return (Max {returnModalData.quantity || returnModalData.items.length})
                      </label>
                      <input 
                          type="number" 
                          id="return-quantity" 
                          min="1" 
                          max={returnModalData.quantity || returnModalData.items.length} 
                          value={returnQuantity} 
                          onChange={(e) => setReturnQuantity(e.target.value)}
                          className={formInputStyle}
                          required
                      />
                  </div>
              )}
              
              <div className="flex justify-end space-x-3 pt-6 border-t border-zinc-200 dark:border-zinc-700 mt-6">
                  <button type="button" onClick={() => setReturnModalData(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isReturningStock} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center disabled:bg-blue-400">
                      {isReturningStock && <Spinner className="w-4 h-4 mr-2" />}
                      {isReturningStock ? 'Returning...' : 'Confirm Return'}
                  </button>
              </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={confirmationModal.isOpen}`;

code = code.replace(injectionPoint, newModal);
fs.writeFileSync('components/StockManagerApp.jsx', code);
