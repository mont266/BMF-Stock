const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const handlers = `
  const handleDevLogin = (e) => {
      e.preventDefault();
      if (devPasswordInput === '153501') {
          setIsDevMode(true);
          setIsDevLoginModalOpen(false);
          setDevPasswordInput('');
          setDevLoginError('');
      } else {
          setDevLoginError('Incorrect password');
      }
  };

  const handleDevPurgeSearch = async (e) => {
      e.preventDefault();
      if (!devPurgeBarcode.trim()) return;
      setDevPurgeLoading(true);
      setDevPurgeResults(null);
      setError(null);
      try {
          const items = await getStockItemsByBarcode(devPurgeBarcode);
          const { data: itemType } = await supabase.from('item_types').select('*').eq('barcode', devPurgeBarcode).maybeSingle();
          
          setDevPurgeResults({
              stockItems: items || [],
              itemType: itemType || null
          });
      } catch (err) {
          setError(\`Search failed: \${err.message}\`);
      } finally {
          setDevPurgeLoading(false);
      }
  };

  const handleDevPurgeConfirm = async () => {
      if (!devPurgeResults) return;
      
      const itemIds = devPurgeResults.stockItems.map(i => i.id);
      
      try {
          if (itemIds.length > 0) {
              await bulkDeleteStockItems(itemIds, selectedProfile.name);
          }
          if (devPurgeResults.itemType) {
              await supabase.from('item_types').delete().eq('id', devPurgeResults.itemType.id);
              await fetchItemTypes();
          }
          
          setSuccessMessage(\`Successfully purged \${itemIds.length} items\${devPurgeResults.itemType ? ' and associated type data' : ''}.\`);
          setIsDevPurgeModalOpen(false);
          setDevPurgeResults(null);
          setDevPurgeBarcode('');
      } catch (err) {
          setError(\`Purge failed: \${err.message}\`);
      }
  };
`;

code = code.replace(
    /const handleDeleteItemType = async \(type\) => \{/,
    handlers + '\n  const handleDeleteItemType = async (type) => {'
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
