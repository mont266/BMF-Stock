const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const newStates = `
  const [isDevMode, setIsDevMode] = useState(false);
  const [isDevLoginModalOpen, setIsDevLoginModalOpen] = useState(false);
  const [devPasswordInput, setDevPasswordInput] = useState('');
  const [devLoginError, setDevLoginError] = useState('');
  const [isDevPurgeModalOpen, setIsDevPurgeModalOpen] = useState(false);
  const [devPurgeBarcode, setDevPurgeBarcode] = useState('');
  const [devPurgeResults, setDevPurgeResults] = useState(null);
  const [devPurgeLoading, setDevPurgeLoading] = useState(false);
`;

code = code.replace(
    /const \[isSettingsModalOpen, setIsSettingsModalOpen\] = useState\(false\);/,
    `const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);\n${newStates}`
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
