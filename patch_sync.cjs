const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

const processSyncCode = `  const processSyncQueue = useCallback(async () => {
    if (isSyncing || syncQueue.length === 0 || !navigator.onLine) return;
    setIsSyncing(true);
    
    let currentQueue = [...syncQueue];
    let hasError = false;
    let tempIdMap = {}; // Maps temp IDs to real Supabase UUIDs

    for (const task of currentQueue) {
      if (!navigator.onLine) {
        hasError = true;
        break;
      }
      try {
        if (task.action === 'UPDATE_ASSIGNMENT') {
          let { itemId, location, assigned_to, assignerName } = task.payload;
          if (tempIdMap[itemId]) {
              itemId = tempIdMap[itemId]; // Map temp ID to real ID
          }
          await performUpdateAssignment(itemId, location, assigned_to, assignerName);
        } else if (task.action === 'ADD_STOCK') {
          const { item, assignerName, tempId } = task.payload;
          const { data: { session } } = await supabase.auth.getSession();
          const user = session?.user;
          const newItem = { ...item, location: 'Leading Stores', assigned_to: 'Unassigned', user_id: user?.id };
          const { data: insertedData, error } = await supabase.from('stock_items').insert([newItem]).select().single();
          if (error) throw error;
          
          if (tempId) {
              tempIdMap[tempId] = insertedData.id;
          }
          
          const movement = { item_id: insertedData.id, item_barcode: insertedData.barcode, item_name: insertedData.name, movement_type: 'IN', location_from: 'New Stock', location_to: insertedData.location, user_id: user?.id, username: assignerName };
          await supabase.from('stock_movements').insert(movement);
        }
        
        // Remove from currentQueue if successful
        currentQueue = currentQueue.filter(t => t.id !== task.id);
      } catch (err) {
        console.error("Failed to process queue task:", err);
        // If it's a conflict or foreign key error (like item not found), we should probably drop it or flag it
        // but for now, network errors will break the loop, others will drop the task
        if (err.message === 'Failed to fetch' || err.message?.includes('fetch') || err.message?.includes('Network')) {
          hasError = true;
          break;
        } else {
           // Skip/Drop task if it's a hard error (e.g. invalid UUID) to prevent infinite sync loops
           currentQueue = currentQueue.filter(t => t.id !== task.id);
        }
      }
    }
    
    setSyncQueue(currentQueue);
    setIsSyncing(false);
    if (!hasError && currentQueue.length < syncQueue.length) {
      fetchStock(); 
    }
  }, [syncQueue, isSyncing, fetchStock, performUpdateAssignment]);`;

code = code.replace(
    /const processSyncQueue = useCallback\(async \(\) => \{[\s\S]*?\}, \[syncQueue, isSyncing, fetchStock, performUpdateAssignment\]\);/,
    processSyncCode
);

fs.writeFileSync('hooks/useStock.js', code);
