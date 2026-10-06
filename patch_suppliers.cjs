const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const filteredAdminSuppliers = `  const filteredAdminSuppliers = useMemo(() => {
    if (!suppliers) return [];
    if (!adminSupplierSearchTerm) return suppliers;
    const lowerSearch = adminSupplierSearchTerm.toLowerCase();
    return suppliers.filter(supplier => 
        supplier.name.toLowerCase().includes(lowerSearch) || 
        (supplier.contact_person || '').toLowerCase().includes(lowerSearch) ||
        (supplier.email || '').toLowerCase().includes(lowerSearch) ||
        (supplier.phone || '').toLowerCase().includes(lowerSearch)
    );
  }, [suppliers, adminSupplierSearchTerm]);`;

code = code.replace(
    /const supplierItemCount = useMemo\(\(\) => \{/,
    `${filteredAdminSuppliers}\n\n  const supplierItemCount = useMemo(() => {`
);

code = code.replace(
    /suppliers\.map\(supplier => \{/g,
    `filteredAdminSuppliers.map(supplier => {`
);

code = code.replace(
    /\{suppliers\.length > 0 \? \(/g,
    `{filteredAdminSuppliers.length > 0 ? (`
);


fs.writeFileSync('components/StockManagerApp.jsx', code);
