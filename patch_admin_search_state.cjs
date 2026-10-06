const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const \[isAddSupplierModalOpen, setIsAddSupplierModalOpen\] = useState\(false\);/,
    "const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);\n  const [adminItemTypeSearchTerm, setAdminItemTypeSearchTerm] = useState('');\n  const [adminSupplierSearchTerm, setAdminSupplierSearchTerm] = useState('');"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
