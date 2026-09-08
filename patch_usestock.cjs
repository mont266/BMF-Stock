const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

const newBulkAdd = `  const bulkAddStockItems = useCallback(async (items, assignerName) => {
    const handleOffline = () => {
        const offlineItems = [];
        const newTasks = [];
        for (const item of items) {
            const tempId = Math.random().toString(36).substr(2, 9);
            const task = {
                id: Math.random().toString(36).substr(2, 9),
                action: 'ADD_STOCK',
                payload: { item, assignerName, tempId },
                timestamp: new Date().toISOString()
            };
            newTasks.push(task);
            
            offlineItems.push({
                ...item,
                id: tempId,
                location: Location.LEADING_STORES,
                assigned_to: Team.UNASSIGNED,
                user_id: 'offline_user'
            });
        }
        setSyncQueue(prev => [...prev, ...newTasks]);
        setStock(prev => [...offlineItems, ...prev]);
    };

    if (!navigator.onLine) {
        handleOffline();
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('User not authenticated');

        const newItems = items.map(item => ({
          ...item,
          location: Location.LEADING_STORES,
          assigned_to: Team.UNASSIGNED,
          user_id: user.id
        }));
        
        const { data: insertedData, error } = await supabase.from('stock_items').insert(newItems).select();
        if (error) throw error;
        
        if (insertedData) {
            const movements = insertedData.map(d => ({
                item_id: d.id,
                item_barcode: d.barcode,
                item_name: d.name,
                movement_type: 'IN',
                location_from: 'New Stock',
                location_to: d.location,
                user_id: user.id,
                username: assignerName,
            }));
            const { error: moveError } = await supabase.from('stock_movements').insert(movements);
            if (moveError) {
                console.error("Bulk movement log failed:", moveError.message);
            }
        }
        await fetchStock();
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.message?.includes('fetch')) {
            handleOffline();
            return;
        }
        throw err;
    }
  }, [fetchStock]);`;

code = code.replace(
    /const bulkAddStockItems = useCallback\(async \(items, assignerName\) => \{[\s\S]*?\} catch \(err\) \{[\s\S]*?throw err;\n    \}\n  \}, \[fetchStock\]\);/g,
    newBulkAdd
);
// In case the above regex doesn't match, let's just use string replace on the old implementation
const oldBulkAdd = code.match(/const bulkAddStockItems = useCallback\(async \(items, assignerName\) => \{[\s\S]*?await fetchStock\(\);\n  \}, \[fetchStock\]\);/)[0];
if (oldBulkAdd) {
    code = code.replace(oldBulkAdd, newBulkAdd);
}

const newGetExistingBarcodes = `  const getExistingBarcodes = useCallback(async (barcodes) => {
    if (!navigator.onLine) {
       return new Set(stock.filter(item => barcodes.includes(item.barcode)).map(item => item.barcode));
    }
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('User not authenticated');
        
        const { data, error } = await supabase
            .from('stock_items')
            .select('barcode')
            .in('barcode', barcodes);

        if (error) throw error;
        return new Set(data.map(item => item.barcode));
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.message?.includes('fetch')) {
            return new Set(stock.filter(item => barcodes.includes(item.barcode)).map(item => item.barcode));
        }
        throw err;
    }
  }, [stock]);`;

const oldGetExistingBarcodes = code.match(/const getExistingBarcodes = useCallback\(async \(barcodes\) => \{[\s\S]*?return new Set\(data\.map\(item => item\.barcode\)\);\n  \}, \[\]\);/)[0];
if (oldGetExistingBarcodes) {
    code = code.replace(oldGetExistingBarcodes, newGetExistingBarcodes);
}

fs.writeFileSync('hooks/useStock.js', code);
