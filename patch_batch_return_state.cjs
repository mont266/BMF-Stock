const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const stateInjection = `  const [isReturningStock, setIsReturningStock] = useState(false);`;
const newStates = `  const [isReturningStock, setIsReturningStock] = useState(false);
  
  // --- Batch Return State ---
  const [isBatchReturnModalOpen, setIsBatchReturnModalOpen] = useState(false);
  const [batchReturnTeam, setBatchReturnTeam] = useState('');
  const [batchReturnQuantities, setBatchReturnQuantities] = useState({});
  const [isBatchReturning, setIsBatchReturning] = useState(false);`;

code = code.replace(stateInjection, newStates);

fs.writeFileSync('components/StockManagerApp.jsx', code);
