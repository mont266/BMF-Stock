const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /BellIcon \} from '\.\/Icons';/,
    "BellIcon, SearchIcon } from './Icons';"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
