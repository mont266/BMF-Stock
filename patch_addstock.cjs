const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

const newAddStock = `  const addStockItem = useCallback(async (item, assignerName) => {
    const handleOffline = () => {
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);
        
        const tempId = Math.random().toString(36).substr(2, 9);
        const newItem = { ...item, location: 'Leading Stores', assigned_to: 'Unassigned', user_id: 'offline_user' };
        setStock(prev => [{ ...newItem, id: tempId }, ...prev]);
    };

    if (!navigator.onLine) {
        handleOffline();
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('User not authenticated');
        
        const newItem = {
          ...item,
          location: 'Leading Stores',
          assigned_to: 'Unassigned',
          user_id: user.id,
        };

        const { data: insertedData, error } = await supabase.from('stock_items').insert([newItem]).select().single();
        if (error) throw error;
        
        const movement = {
          item_id: insertedData.id,
          item_barcode: insertedData.barcode,
          item_name: insertedData.name,
          movement_type: 'IN',
          location_from: 'New Stock',
          location_to: insertedData.location,
          user_id: user.id,
          username: assignerName,
        };
        const { error: moveError } = await supabase.from('stock_movements').insert(movement);
        if (moveError) console.error("Movement log failed for new item:", moveError.message);
        
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
    /const addStockItem = useCallback\(async \(item, assignerName\) => \{[\s\S]*?\} catch \(err\) \{[\s\S]*?throw err;\n    \}\n  \}, \[fetchStock\]\);/,
    newAddStock
);

fs.writeFileSync('hooks/useStock.js', code);
