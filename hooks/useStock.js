import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Location, Team } from '../types';
import { get, set } from 'idb-keyval';

export const useStock = () => {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
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
  }, [syncQueue]);
  
  const fetchStock = useCallback(async () => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
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
            .eq('user_id', user.id);

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
                    .eq('user_id', user.id)
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

  const addStockItem = useCallback(async (item, assignerName) => {
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
  }, [fetchStock]);

  const bulkAddStockItems = useCallback(async (items, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
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
  }, [fetchStock]);

  const updateStockItemAssignment = useCallback(async (itemId, location, assigned_to, assignerName) => {
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
       return { ...stock.find(i => i.id === itemId), location, assigned_to }; 
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
           return { ...stock.find(i => i.id === itemId), location, assigned_to }; 
        }
        throw err;
    }
  }, [performUpdateAssignment]);
  
  const bulkUpdateAssignments = useCallback(async (itemIds, location, team, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // For logging, fetch the items before updating
    const { data: itemsBeforeUpdate, error: fetchError } = await supabase
        .from('stock_items')
        .select('*')
        .in('id', itemIds);
    if (fetchError) throw fetchError;

    const isAssigning = team !== Team.UNASSIGNED;
    const { error } = await supabase
        .from('stock_items')
        .update({
            location,
            assigned_to: team,
            assigned_at: isAssigning ? new Date().toISOString() : null,
            assigned_by: isAssigning ? assignerName : null,
        })
        .in('id', itemIds);
    if (error) throw error;

    // Create movement logs
    const movements = itemsBeforeUpdate.map(item => ({
        item_id: item.id,
        item_barcode: item.barcode,
        item_name: item.name,
        movement_type: 'OUT',
        location_from: item.location,
        location_to: team,
        user_id: user.id,
        username: assignerName
    }));

    const { error: moveError } = await supabase.from('stock_movements').insert(movements);
    if (moveError) console.error("Bulk assignment movement log failed:", moveError.message);
    
}, []);

  const bulkDeleteStockItems = useCallback(async (itemIds, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
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
  }, [fetchStock]);

  const deleteStockItem = useCallback(async (itemId, assignerName) => {
    const { data: { user } } = await supabase.auth.getUser();
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
  }, [fetchStock]);

  const getStockItemsByBarcode = useCallback(async (barcode) => {
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
  }, [stock]);

  const getExistingBarcodes = useCallback(async (barcodes) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
        .from('stock_items')
        .select('barcode')
        .eq('user_id', user.id)
        .in('barcode', barcodes);

    if (error) throw error;
    return new Set(data.map(item => item.barcode));
  }, []);

  return { stock, setStock, loading, addStockItem, bulkAddStockItems, updateStockItemAssignment, bulkUpdateAssignments, deleteStockItem, bulkDeleteStockItems, getStockItemsByBarcode, getExistingBarcodes, refetchStock: fetchStock, syncQueue, clearSyncQueue: () => { setSyncQueue([]); set("offline_sync_queue", []); } };
};