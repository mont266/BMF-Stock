import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Location, Team } from '../types';
import { get, set } from 'idb-keyval';
import { trainingManager } from '../lib/trainingEnvironment';


const isOfflineError = (err) => {
    if (!navigator.onLine) return true;
    const msg = (err?.message || err?.toString() || '').toLowerCase();
    return msg === 'failed to fetch' || msg.includes('fetch') || msg.includes('network');
};

export const useStock = (isTrainingMode = false) => {
  const [stock, setStockState] = useState(() => {
    return isTrainingMode ? trainingManager.getStock() : [];
  });
  const [loading, setLoading] = useState(!isTrainingMode);
  const [syncQueue, setSyncQueue] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (isTrainingMode) {
      setStockState(trainingManager.getStock());
      setLoading(false);
      const unsubscribe = trainingManager.subscribe(() => {
        setStockState(trainingManager.getStock());
      });
      return unsubscribe;
    }
  }, [isTrainingMode]);

  const setStock = useCallback((newStock) => {
    if (isTrainingMode) {
      trainingManager.setStock(newStock);
      setStockState(trainingManager.getStock());
    } else {
      setStockState(newStock);
    }
  }, [isTrainingMode]);

  useEffect(() => {
    if (!isTrainingMode) {
      get('offline_sync_queue').then(queue => {
        if (queue && Array.isArray(queue)) {
          setSyncQueue(queue);
        }
      });
    }
  }, [isTrainingMode]);

  useEffect(() => {
    if (!isTrainingMode) {
      set('offline_sync_queue', syncQueue);
    }
  }, [syncQueue, isTrainingMode]);
  
  const fetchStock = useCallback(async () => {
    if (isTrainingMode) {
      setStockState(trainingManager.getStock());
      setLoading(false);
      return;
    }
    try {
        const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
        if (!user) throw new Error('User not authenticated');

        const cacheKey = `stock_items_${user.id}`;
        let cachedStock = null;
        
        // 1. Try to load from cache first for instant UI
        try {
            cachedStock = await get(cacheKey);
            if (cachedStock && cachedStock.length > 0) {
                setStock(cachedStock);
                setLoading(false); // Stop loading immediately if we have cache
            } else {
                setLoading(true);
            }
        } catch (cacheError) {
            console.warn("Failed to read from cache:", cacheError);
            setLoading(true);
        }

        // 2. Fetch total count to parallelize requests
        const { count, error: countError } = await supabase
            .from('stock_items')
            .select('*', { count: 'exact', head: true })
            ;

        if (countError) throw countError;

        const allItems = [];
        const pageSize = 1000;
        const totalPages = Math.ceil((count || 0) / pageSize);
        
        const promises = [];
        for (let i = 0; i < totalPages; i++) {
            promises.push(
                supabase
                    .from('stock_items')
                    .select('*')
                    
                    .order('created_at', { ascending: false })
                    .range(i * pageSize, (i + 1) * pageSize - 1)
            );
        }

        // 3. Fetch in parallel batches
        const batchSize = 15; // Increased parallel requests
        for (let i = 0; i < promises.length; i += batchSize) {
            const batch = promises.slice(i, i + batchSize);
            const results = await Promise.all(batch);
            for (const result of results) {
                if (result.error) throw result.error;
                if (result.data) allItems.push(...result.data);
            }
        }

        // 4. Update state and cache with fresh data ONLY if changed
        const isDifferent = JSON.stringify(allItems) !== JSON.stringify(cachedStock);
        if (isDifferent || !cachedStock || cachedStock.length === 0) {
            setStock(allItems);
            try {
                await set(cacheKey, allItems);
            } catch (cacheWriteError) {
                console.warn("Failed to write to cache:", cacheWriteError);
            }
        }
    } catch (error) {
        console.error("Error fetching stock:", error.message);
        setStock(prev => prev.length === 0 ? [] : prev);
    } finally {
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  
  const performUpdateAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
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
    } else if (oldAssignedTo !== Team.UNASSIGNED && assigned_to !== Team.UNASSIGNED && oldAssignedTo !== assigned_to) {
      movement = { item_id: itemBeforeUpdate.id, item_barcode: itemBeforeUpdate.barcode, item_name: itemBeforeUpdate.name, movement_type: 'OUT', location_from: oldAssignedTo, location_to: assigned_to, user_id: user.id, username: assignerName };
    } else if (oldLocation !== location) {
      movement = { item_id: itemBeforeUpdate.id, item_barcode: itemBeforeUpdate.barcode, item_name: itemBeforeUpdate.name, movement_type: 'IN', location_from: oldLocation, location_to: location, user_id: user.id, username: assignerName };
    }
    
    if (movement) {
      const { error: moveError } = await supabase.from('stock_movements').insert(movement);
      if (moveError) console.error("Assignment movement log failed:", moveError.message);
    }
    return updatedItem;
  }, []);

  const performBulkUpdateAssignment = useCallback(async (itemIds, location, team, assignerName) => {
    if (!itemIds || itemIds.length === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('User not authenticated');

    const isAssigning = team !== Team.UNASSIGNED;
    const chunkSize = 100;
    const allItemsBefore = [];

    // 1. Fetch current items before update
    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);
      const { data, error: fetchErr } = await supabase
        .from('stock_items')
        .select('*')
        .in('id', chunk);
      if (fetchErr) throw fetchErr;
      if (data) allItemsBefore.push(...data);
    }

    // 2. Update stock items in database
    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);
      const { error: updateErr } = await supabase
        .from('stock_items')
        .update({
          location,
          assigned_to: team,
          assigned_at: isAssigning ? new Date().toISOString() : null,
          assigned_by: isAssigning ? assignerName : null,
        })
        .in('id', chunk);
      if (updateErr) throw updateErr;
    }

    // 3. Construct accurate movement records for each item
    const movements = allItemsBefore.map(item => {
      const oldAssignedTo = item.assigned_to;
      const oldLocation = item.location;
      let movType = 'OUT';
      let locFrom = oldLocation;
      let locTo = team;

      if (oldAssignedTo === Team.UNASSIGNED && team !== Team.UNASSIGNED) {
        // Signing OUT to team or surveyor
        movType = 'OUT';
        locFrom = oldLocation || location;
        locTo = team;
      } else if (oldAssignedTo !== Team.UNASSIGNED && team === Team.UNASSIGNED) {
        // Signing IN / Returning to stock location
        movType = 'IN';
        locFrom = oldAssignedTo;
        locTo = location;
      } else if (oldAssignedTo !== Team.UNASSIGNED && team !== Team.UNASSIGNED && oldAssignedTo !== team) {
        // Transfer between teams
        movType = 'OUT';
        locFrom = oldAssignedTo;
        locTo = team;
      } else if (oldLocation !== location) {
        // Storehouse transfer
        movType = 'IN';
        locFrom = oldLocation;
        locTo = location;
      } else {
        movType = isAssigning ? 'OUT' : 'IN';
        locFrom = isAssigning ? (oldLocation || location) : (oldAssignedTo || 'Assigned');
        locTo = isAssigning ? team : location;
      }

      return {
        item_id: item.id,
        item_barcode: item.barcode,
        item_name: item.name,
        movement_type: movType,
        location_from: locFrom,
        location_to: locTo,
        user_id: user.id,
        username: assignerName
      };
    });

    // 4. Insert movements in chunks so no query payload cap is exceeded
    for (let i = 0; i < movements.length; i += chunkSize) {
      const chunk = movements.slice(i, i + chunkSize);
      const { error: moveErr } = await supabase.from('stock_movements').insert(chunk);
      if (moveErr) console.error("Bulk assignment movement log failed:", moveErr.message);
    }
  }, []);

  const processSyncQueue = useCallback(async () => {
    if (isTrainingMode || isSyncing || syncQueue.length === 0 || !navigator.onLine) return;
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
        } else if (task.action === 'BULK_UPDATE_ASSIGNMENT') {
          let { itemIds, location, team, assignerName } = task.payload;
          itemIds = (itemIds || []).map(id => tempIdMap[id] || id);
          await performBulkUpdateAssignment(itemIds, location, team, assignerName);
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
        if (isOfflineError(err)) {
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
      fetchStock(); 
    }
  }, [syncQueue, isSyncing, fetchStock, performUpdateAssignment, performBulkUpdateAssignment, isTrainingMode]);

  useEffect(() => {
    if (isTrainingMode) return;
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
  }, [processSyncQueue, syncQueue.length, isTrainingMode]);

    const addStockItem = useCallback(async (item, assignerName) => {
    if (isTrainingMode) {
        return trainingManager.addStockItem(item, assignerName);
    }

    const handleOffline = () => {
        const tempId = Math.random().toString(36).substr(2, 9);
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName, tempId },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);

        const newItem = { ...item, location: item.location || Location.LEADING_STORES, assigned_to: Team.UNASSIGNED, user_id: 'offline_user' };
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
        
        const isAssigning = item.assigned_to && item.assigned_to !== Team.UNASSIGNED;
        const newItem = {
          name: item.name,
          barcode: item.barcode,
          purchase_price: item.purchase_price ?? null,
          description: item.description || '',
          location: item.location || Location.LEADING_STORES,
          assigned_to: item.assigned_to || Team.UNASSIGNED,
          assigned_at: isAssigning ? (item.assigned_at || new Date().toISOString()) : null,
          assigned_by: isAssigning ? (item.assigned_by || assignerName) : null,
          user_id: user.id
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
        if (isOfflineError(err)) {
            handleOffline();
            return;
        }
        throw err;
    }
  }, [fetchStock, isTrainingMode]);

    const bulkAddStockItems = useCallback(async (items, assignerName) => {
    if (isTrainingMode) {
        return trainingManager.bulkAddStockItems(items, assignerName);
    }

    const handleOffline = () => {
        const offlineItems = [];
        const newTasks = [];
        for (const item of items) {
            const tempId = Math.random().toString(36).substr(2, 9);
            const isAssigning = item.assigned_to && item.assigned_to !== Team.UNASSIGNED;
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
                location: item.location || Location.LEADING_STORES,
                assigned_to: item.assigned_to || Team.UNASSIGNED,
                assigned_at: isAssigning ? (item.assigned_at || new Date().toISOString()) : null,
                assigned_by: isAssigning ? (item.assigned_by || assignerName) : null,
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

        const newItems = items.map(item => {
          const isAssigning = item.assigned_to && item.assigned_to !== Team.UNASSIGNED;
          return {
            name: item.name,
            barcode: item.barcode,
            purchase_price: item.purchase_price ?? null,
            description: item.description || '',
            location: item.location || Location.LEADING_STORES,
            assigned_to: item.assigned_to || Team.UNASSIGNED,
            assigned_at: isAssigning ? (item.assigned_at || new Date().toISOString()) : null,
            assigned_by: isAssigning ? (item.assigned_by || assignerName) : null,
            user_id: user.id
          };
        });
        
        const { data: insertedData, error } = await supabase.from('stock_items').insert(newItems).select();
        if (error) throw error;
        
        if (insertedData) {
            const movements = insertedData.map(d => {
                const isAssigning = d.assigned_to && d.assigned_to !== Team.UNASSIGNED;
                return {
                    item_id: d.id,
                    item_barcode: d.barcode,
                    item_name: d.name,
                    movement_type: isAssigning ? 'OUT' : 'IN',
                    location_from: isAssigning ? d.location : 'New Stock',
                    location_to: isAssigning ? d.assigned_to : d.location,
                    user_id: user.id,
                    username: assignerName,
                };
            });
            const { error: moveError } = await supabase.from('stock_movements').insert(movements);
            if (moveError) {
                console.error("Bulk movement log failed:", moveError.message);
            }
        }
        await fetchStock();
        return insertedData;
    } catch (err) {
        if (isOfflineError(err)) {
            handleOffline();
            return;
        }
        throw err;
    }
  }, [fetchStock, isTrainingMode]);

  const updateStockItemAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
    if (isTrainingMode) {
       return trainingManager.updateStockItemAssignment(itemId, location, assigned_to, assignerName);
    }

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
               return { ...item, location, assigned_to, assigned_at: assigned_to !== Team.UNASSIGNED ? new Date().toISOString() : null, assigned_by: assigned_to !== Team.UNASSIGNED ? assignerName : null };
           }
           return item;
       }));
       return { ...stock.find(i => i.id === itemId), location, assigned_to }; 
    }
    
    try {
        const result = await performUpdateAssignment(itemId, location, assigned_to, assignerName);
        return result;
    } catch (err) {
        if (isOfflineError(err)) {
           const task = {
               id: Math.random().toString(36).substr(2, 9),
               action: 'UPDATE_ASSIGNMENT',
               payload: { itemId, location, assigned_to, assignerName },
               timestamp: new Date().toISOString()
           };
           setSyncQueue(prev => [...prev, task]);
           setStock(prev => prev.map(item => {
               if (item.id === itemId) {
                   return { ...item, location, assigned_to, assigned_at: assigned_to !== Team.UNASSIGNED ? new Date().toISOString() : null, assigned_by: assigned_to !== Team.UNASSIGNED ? assignerName : null };
               }
               return item;
           }));
           return { ...stock.find(i => i.id === itemId), location, assigned_to }; 
        }
        throw err;
    }
  }, [performUpdateAssignment, isTrainingMode, stock]);
  
  const bulkUpdateAssignments = useCallback(async (itemIds, location, team, assignerName) => {
    if (!itemIds || itemIds.length === 0) return;
    if (isTrainingMode) {
      trainingManager.bulkUpdateAssignments(itemIds, location, team, assignerName);
      return;
    }

    const handleOffline = () => {
      const task = {
        id: Math.random().toString(36).substr(2, 9),
        action: 'BULK_UPDATE_ASSIGNMENT',
        payload: { itemIds, location, team, assignerName },
        timestamp: new Date().toISOString()
      };
      setSyncQueue(prev => [...prev, task]);
      setStock(prev => prev.map(item => {
        if (itemIds.includes(item.id)) {
          return {
            ...item,
            location,
            assigned_to: team,
            assigned_at: team !== Team.UNASSIGNED ? new Date().toISOString() : null,
            assigned_by: team !== Team.UNASSIGNED ? assignerName : null
          };
        }
        return item;
      }));
    };

    if (!navigator.onLine) {
      handleOffline();
      return;
    }

    try {
      await performBulkUpdateAssignment(itemIds, location, team, assignerName);
      await fetchStock();
    } catch (err) {
      if (isOfflineError(err)) {
        handleOffline();
        return;
      }
      throw err;
    }
  }, [performBulkUpdateAssignment, fetchStock, isTrainingMode]);

  const bulkDeleteStockItems = useCallback(async (itemIds, assignerName) => {
    if (isTrainingMode) {
      trainingManager.bulkDeleteStockItems(itemIds, assignerName);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('User not authenticated');

    const { data: itemsToDelete, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .in('id', itemIds);

    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from('stock_items')
      .delete()
      .in('id', itemIds);

    if (error) throw error;
    
    const movements = itemsToDelete.map(item => ({
      item_id: item.id,
      item_barcode: item.barcode,
      item_name: item.name,
      movement_type: 'OUT',
      location_from: item.assigned_to === Team.UNASSIGNED ? item.location : item.assigned_to,
      location_to: 'Deleted',
      user_id: user.id,
      username: assignerName
    }));

    const { error: moveError } = await supabase.from('stock_movements').insert(movements);
    if (moveError) {
      console.error("Bulk deletion movement log failed:", moveError.message);
    }

    await fetchStock();
  }, [fetchStock, isTrainingMode]);

  const deleteStockItem = useCallback(async (itemId, assignerName) => {
    if (isTrainingMode) {
      trainingManager.deleteStockItem(itemId, assignerName);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('User not authenticated');

    const { data: itemToDelete, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .eq('id', itemId)
        .single();

    if (fetchError || !itemToDelete) throw fetchError || new Error('Item not found for deletion log');

    const { error } = await supabase
      .from('stock_items')
      .delete()
      .eq('id', itemId);

    if (error) throw error;
    
    const movement = {
      item_id: itemToDelete.id,
      item_barcode: itemToDelete.barcode,
      item_name: itemToDelete.name,
      movement_type: 'OUT',
      location_from: itemToDelete.assigned_to === Team.UNASSIGNED ? itemToDelete.location : itemToDelete.assigned_to,
      location_to: 'Deleted',
      user_id: user.id,
      username: assignerName
    };
    const { error: moveError } = await supabase.from('stock_movements').insert(movement);
    if (moveError) {
      console.error("Deletion movement log failed:", moveError.message);
    }

    await fetchStock();
  }, [fetchStock, isTrainingMode]);

  const getStockItemsByBarcode = useCallback(async (barcode, fallbackItemName = null) => {
    if (isTrainingMode || !navigator.onLine) {
       const direct = stock.filter(item => item.barcode === barcode);
       if (direct.length > 0 || !fallbackItemName) return direct;
       return stock.filter(item => item.name === fallbackItemName);
    }
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('User not authenticated');
        const { data, error } = await supabase
          .from('stock_items')
          .select('*')
          .eq('barcode', barcode);
        if (error) throw error;
        if (data && data.length > 0) return data;
        
        if (fallbackItemName) {
            const { data: nameData, error: nameError } = await supabase
                .from('stock_items')
                .select('*')
                .eq('name', fallbackItemName);
            if (!nameError && nameData) return nameData;
        }
        return [];
    } catch (err) {
        if (isOfflineError(err)) {
            const direct = stock.filter(item => item.barcode === barcode);
            if (direct.length > 0 || !fallbackItemName) return direct;
            return stock.filter(item => item.name === fallbackItemName);
        }
        throw err;
    }
  }, [stock, isTrainingMode]);

    const getExistingBarcodes = useCallback(async (barcodes) => {
    if (isTrainingMode || !navigator.onLine) {
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
        if (isOfflineError(err)) {
            return new Set(stock.filter(item => barcodes.includes(item.barcode)).map(item => item.barcode));
        }
        throw err;
    }
  }, [stock, isTrainingMode]);

  return { stock, setStock, loading, addStockItem, bulkAddStockItems, updateStockItemAssignment, bulkUpdateAssignments, deleteStockItem, bulkDeleteStockItems, getStockItemsByBarcode, getExistingBarcodes, refetchStock: fetchStock, syncQueue, clearSyncQueue: () => { setSyncQueue([]); set("offline_sync_queue", []); } };
};