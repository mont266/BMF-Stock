const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// Add states
const stateInjection = `  const [confirmationModal, setConfirmationModal] = useState({`;
const newStates = `  const [returnModalData, setReturnModalData] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [isReturningStock, setIsReturningStock] = useState(false);

  const [confirmationModal, setConfirmationModal] = useState({`;
code = code.replace(stateInjection, newStates);

// Modify handleReturnToStock
const oldHandleReturn = /const handleReturnToStock = \(groupOrItem\) => \{[\s\S]*?\}\);\n  \};/;
const newHandleReturn = `const handleReturnToStock = (groupOrItem) => {
    setReturnQuantity(groupOrItem.quantity || 1);
    setReturnModalData(groupOrItem);
  };`;
code = code.replace(oldHandleReturn, newHandleReturn);

fs.writeFileSync('components/StockManagerApp.jsx', code);
