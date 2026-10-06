const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(/const \[isReturnModeSelectionOpen, setIsReturnModeSelectionOpen\] = useState\(false\);\n\s*/, '');
code = code.replace(/if \(isReturnModeSelectionOpen\) \{ setIsReturnModeSelectionOpen\(false\); return; \}\n\s*/, '');
code = code.replace(/isReturnModeSelectionOpen,\n\s*/, '');

fs.writeFileSync('components/StockManagerApp.jsx', code);
