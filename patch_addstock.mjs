import fs from 'fs';

let content = fs.readFileSync('hooks/useStock.js', 'utf8');

const addStockItemRegex = /const addStockItem = useCallback\(async \(item, assignerName\) => \{[\s\S]*?await fetchStock\(\);\n  \}, \[fetchStock\]\);/;

const newAddStockItem = `const addStockItem = useCallback(async (item, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    const newItem = {
      ...item,
      location: Location.LEADING_STORES,
      assigned_to: Team.UNASSIGNED,
      user_id: user.id,
    };

    if (!navigator.onLine) {
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);
        
        const tempId = Math.random().toString(36).substr(2, 9);
        setStock(prev => [{ ...newItem, id: tempId }, ...prev]);
        return;
    }

    try {
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
        if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
            const task = {
                id: Math.random().toString(36).substr(2, 9),
                action: 'ADD_STOCK',
                payload: { item, assignerName },
                timestamp: new Date().toISOString()
            };
            setSyncQueue(prev => [...prev, task]);
            
            const tempId = Math.random().toString(36).substr(2, 9);
            setStock(prev => [{ ...newItem, id: tempId }, ...prev]);
            return;
        }
        throw err;
    }
  }, [fetchStock]);`;

content = content.replace(addStockItemRegex, newAddStockItem);

// Update processSyncQueue to handle ADD_STOCK
content = content.replace(
  'await performUpdateAssignment(itemId, location, assigned_to, assignerName);\n        }',
  `await performUpdateAssignment(itemId, location, assigned_to, assignerName);
        } else if (task.action === 'ADD_STOCK') {
          const { item, assignerName } = task.payload;
          // We don't have performAddStockItem, we can just duplicate logic here, but it's cleaner to reuse.
          // For simplicity, let's just make the Supabase call here.
          const { data: { user } } = await supabase.auth.getUser();
          const newItem = { ...item, location: Location.LEADING_STORES, assigned_to: Team.UNASSIGNED, user_id: user.id };
          const { data: insertedData, error } = await supabase.from('stock_items').insert([newItem]).select().single();
          if (error) throw error;
          const movement = { item_id: insertedData.id, item_barcode: insertedData.barcode, item_name: insertedData.name, movement_type: 'IN', location_from: 'New Stock', location_to: insertedData.location, user_id: user.id, username: assignerName };
          await supabase.from('stock_movements').insert(movement);
        }`
);

fs.writeFileSync('hooks/useStock.js', content, 'utf8');
console.log('Done!');
