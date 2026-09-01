import fs from 'fs';

let content = fs.readFileSync('hooks/useStock.js', 'utf8');

// 1. Add queue state
content = content.replace(
  'const [loading, setLoading] = useState(true);',
  `const [loading, setLoading] = useState(true);
  const [syncQueue, setSyncQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    get('offline_sync_queue').then(queue => {
      if (queue && Array.isArray(queue)) {
        setSyncQueue(queue);
      }
    });
  }, []);

  useEffect(() => {
    set('offline_sync_queue', syncQueue);
  }, [syncQueue]);`
);

// 2. Add processSyncQueue logic and window online event listener. We should put it right before `addStockItem`.
const processSyncQueueStr = `
  const performUpdateAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data: itemBeforeUpdate, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .eq('id', itemId)
        .single();
    
    if (fetchError || !itemBeforeUpdate) throw fetchError || new Error('Item not found for logging movement');

    const oldAssignedTo = itemBeforeUpdate.assigned_to;
    const oldLocation = itemBeforeUpdate.location;
    const isAssigning = assigned_to !== Team.UNASSIGNED;

    const { data: updatedItem, error } = await supabase
      .from('stock_items')
      .update({ 
        location, 
        assigned_to,
        assigned_at: isAssigning ? new Date().toISOString() : null,
        assigned_by: isAssigning ? assignerName : null
      })
      .eq('id', itemId)
      .select()
      .single();
      
    if (error) throw error;

    let movement = null;
    if (oldAssignedTo === Team.UNASSIGNED && assigned_to !== Team.UNASSIGNED) {
      movement = { item_id: itemBeforeUpdate.id, item_barcode: itemBeforeUpdate.barcode, item_name: itemBeforeUpdate.name, movement_type: 'OUT', location_from: oldLocation, location_to: assigned_to, user_id: user.id, username: assignerName };
    } else if (oldAssignedTo !== Team.UNASSIGNED && assigned_to === Team.UNASSIGNED) {
      movement = { item_id: itemBeforeUpdate.id, item_barcode: itemBeforeUpdate.barcode, item_name: itemBeforeUpdate.name, movement_type: 'IN', location_from: oldAssignedTo, location_to: location, user_id: user.id, username: assignerName };
    } else if (oldLocation !== location) {
      movement = { item_id: itemBeforeUpdate.id, item_barcode: itemBeforeUpdate.barcode, item_name: itemBeforeUpdate.name, movement_type: 'IN', location_from: oldLocation, location_to: location, user_id: user.id, username: assignerName };
    }
    
    if (movement) {
      const { error: moveError } = await supabase.from('stock_movements').insert(movement);
      if (moveError) console.error("Assignment movement log failed:", moveError.message);
    }
    return updatedItem;
  }, []);

  const processSyncQueue = useCallback(async () => {
    if (isSyncing || syncQueue.length === 0 || !navigator.onLine) return;
    setIsSyncing(true);
    
    let currentQueue = [...syncQueue];
    let hasError = false;

    for (const task of currentQueue) {
      if (!navigator.onLine) {
        hasError = true;
        break;
      }
      try {
        if (task.action === 'UPDATE_ASSIGNMENT') {
          const { itemId, location, assigned_to, assignerName } = task.payload;
          await performUpdateAssignment(itemId, location, assigned_to, assignerName);
        }
        // Remove from currentQueue if successful
        currentQueue = currentQueue.filter(t => t.id !== task.id);
      } catch (err) {
        console.error("Failed to process queue task:", err);
        if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
          hasError = true;
          break;
        } else {
           currentQueue = currentQueue.filter(t => t.id !== task.id);
        }
      }
    }
    
    setSyncQueue(currentQueue);
    setIsSyncing(false);
    if (!hasError && currentQueue.length < syncQueue.length) {
      fetchStock(); // refresh if we uploaded anything
    }
  }, [syncQueue, isSyncing, fetchStock, performUpdateAssignment]);

  useEffect(() => {
    const handleOnline = () => processSyncQueue();
    window.addEventListener('online', handleOnline);
    const interval = setInterval(() => {
       if (navigator.onLine && syncQueue.length > 0) {
           processSyncQueue();
       }
    }, 5000); 
    return () => {
        window.removeEventListener('online', handleOnline);
        clearInterval(interval);
    };
  }, [processSyncQueue, syncQueue.length]);
`;

content = content.replace(
  'const addStockItem = useCallback(async',
  processSyncQueueStr + '\n  const addStockItem = useCallback(async'
);

// 3. Rewrite updateStockItemAssignment to use offline logic
const updateStockAssignmentRegex = /const updateStockItemAssignment = useCallback\(async \(\w+, \w+, \w+, \w+\) => \{[\s\S]*?return \w+;\n  \}, \[\]\);/;

const newUpdateStockItemAssignment = `const updateStockItemAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
    const isAssigning = assigned_to !== Team.UNASSIGNED;
    if (!navigator.onLine) {
       const task = {
           id: Math.random().toString(36).substr(2, 9),
           action: 'UPDATE_ASSIGNMENT',
           payload: { itemId, location, assigned_to, assignerName },
           timestamp: new Date().toISOString()
       };
       setSyncQueue(prev => [...prev, task]);
       
       setStock(prev => prev.map(item => {
           if (item.id === itemId) {
               return { ...item, location, assigned_to, assigned_at: isAssigning ? new Date().toISOString() : null, assigned_by: isAssigning ? assignerName : null };
           }
           return item;
       }));
       return { id: itemId, location, assigned_to }; 
    }
    
    try {
        const result = await performUpdateAssignment(itemId, location, assigned_to, assignerName);
        return result;
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
           const task = {
               id: Math.random().toString(36).substr(2, 9),
               action: 'UPDATE_ASSIGNMENT',
               payload: { itemId, location, assigned_to, assignerName },
               timestamp: new Date().toISOString()
           };
           setSyncQueue(prev => [...prev, task]);
           setStock(prev => prev.map(item => {
               if (item.id === itemId) {
                   return { ...item, location, assigned_to, assigned_at: isAssigning ? new Date().toISOString() : null, assigned_by: isAssigning ? assignerName : null };
               }
               return item;
           }));
           return { id: itemId, location, assigned_to }; 
        }
        throw err;
    }
  }, [performUpdateAssignment]);`;

content = content.replace(updateStockAssignmentRegex, newUpdateStockItemAssignment);

// 4. Rewrite getStockItemsByBarcode
const getStockItemsRegex = /const getStockItemsByBarcode = useCallback\(async \(barcode\) => \{[\s\S]*?return data \|\| \[\];\n  \}, \[\]\);/;

const newGetStockItemsByBarcode = `const getStockItemsByBarcode = useCallback(async (barcode) => {
    if (!navigator.onLine) {
       return stock.filter(item => item.barcode === barcode);
    }
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');
        const { data, error } = await supabase
          .from('stock_items')
          .select('*')
          .eq('barcode', barcode)
          .eq('user_id', user.id);
        if (error) throw error;
        return data || [];
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.message.includes('fetch')) {
            return stock.filter(item => item.barcode === barcode);
        }
        throw err;
    }
  }, [stock]);`;

content = content.replace(getStockItemsRegex, newGetStockItemsByBarcode);

// 5. Update return statement to include syncQueue
content = content.replace(
  'refetchStock: fetchStock };',
  'refetchStock: fetchStock, syncQueue, clearSyncQueue: () => { setSyncQueue([]); set("offline_sync_queue", []); } };'
);

fs.writeFileSync('hooks/useStock.js', content, 'utf8');
console.log('Done!');
