const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const replacement = `  const filteredAdminItemTypes = useMemo(() => {
    if (!itemTypes) return [];
    if (!adminItemTypeSearchTerm) return itemTypes;
    const lowerSearch = adminItemTypeSearchTerm.toLowerCase();
    return itemTypes.filter(type => 
        type.name.toLowerCase().includes(lowerSearch) || 
        (type.category || '').toLowerCase().includes(lowerSearch) ||
        (type.item_subcategory?.name || '').toLowerCase().includes(lowerSearch)
    );
  }, [itemTypes, adminItemTypeSearchTerm]);

  const groupedItemTypes = useMemo(() => {
    if (!filteredAdminItemTypes) return {};
    return filteredAdminItemTypes.reduce((acc, type) => {
        const category = type.category || 'Uncategorized';
        const subCategory = type.item_subcategory?.name || 'General';

        if (!acc[category]) {
            acc[category] = {};
        }
        if (!acc[category][subCategory]) {
            acc[category][subCategory] = [];
        }
        acc[category][subCategory].push(type);
        return acc;
    }, {});
  }, [filteredAdminItemTypes]);`;

code = code.replace(
    /const groupedItemTypes = useMemo\(\(\) => \{[\s\S]*?\}, \[itemTypes\]\);/,
    replacement
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
