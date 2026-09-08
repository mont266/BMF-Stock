import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Page, Spinner, EmptyState, formInputStyle } from './StockManagerApp';
import Modal from './Modal';
import { PlusCircleIcon, ClipboardCheckIcon, ArchiveIcon, ChartBarIcon, TrashIcon } from './Icons';

const StockTakePage = ({ stock, setStock, setError, logUnrecognizedBarcode }) => {
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('active');
    const [activeStockTake, setActiveStockTake] = useState(null);
    const [stockTakeItems, setStockTakeItems] = useState([]);
    
    const [isInitiateModalOpen, setIsInitiateModalOpen] = useState(false);
    const [stockTakeType, setStockTakeType] = useState('FULL');
    
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isFinaliseModalOpen, setIsFinaliseModalOpen] = useState(false);

    const [lastScanned, setLastScanned] = useState(null);
    
    const [scanMode, setScanMode] = useState('RAPID');
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [quantityItem, setQuantityItem] = useState(null);
    const [quantityInput, setQuantityInput] = useState('1');
    
    const [historicalTakes, setHistoricalTakes] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedHistoryReport, setSelectedHistoryReport] = useState(null);
    const [selectedHistoryItems, setSelectedHistoryItems] = useState([]);
    
    const [isDeleteHistoryModalOpen, setIsDeleteHistoryModalOpen] = useState(false);
    const [historyToDelete, setHistoryToDelete] = useState(null);

    const stockTakeItemsRef = useRef(stockTakeItems);
    const activeStockTakeRef = useRef(activeStockTake);
    const scanModeRef = useRef(scanMode);
    
    useEffect(() => {
        stockTakeItemsRef.current = stockTakeItems;
        activeStockTakeRef.current = activeStockTake;
        scanModeRef.current = scanMode;
    }, [stockTakeItems, activeStockTake, scanMode]);
    
    const fetchActiveStockTake = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('stock_takes')
                .select('*')
                .in('status', ['IN_PROGRESS', 'REVIEW'])
                .limit(1)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error(error);
            } else if (data) {
                setActiveStockTake(data);
                const { data: items, error: itemsError } = await supabase
                    .from('stock_take_items')
                    .select('*, stock_items(name, barcode, purchase_price)')
                    .eq('stock_take_id', data.id);
                if (!itemsError && items) {
                    setStockTakeItems(items);
                }
            } else {
                setActiveStockTake(null);
                setStockTakeItems([]);
            }
        } catch (err) {
            console.error("Error fetching active stock take", err);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const { data, error } = await supabase
                .from('stock_takes')
                .select('*')
                .eq('status', 'COMPLETED')
                .order('completed_at', { ascending: false });
            if (error) throw error;
            setHistoricalTakes(data || []);
        } catch(err) {
            console.error("Error fetching history", err);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    const fetchHistoryReport = async (st) => {
        setHistoryLoading(true);
        try {
            setSelectedHistoryReport(st);
            const { data: items, error } = await supabase
                .from('stock_take_items')
                .select('*, stock_items(name, barcode, purchase_price)')
                .eq('stock_take_id', st.id);
            if (error) throw error;
            setSelectedHistoryItems(items || []);
        } catch(err) {
            console.error(err);
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'history' && !selectedHistoryReport) {
            fetchHistory();
        }
    }, [activeTab, fetchHistory, selectedHistoryReport]);

    useEffect(() => {
        fetchActiveStockTake();
    }, [fetchActiveStockTake]);

    const handleInitiateStockTake = async () => {
        setIsInitiateModalOpen(false);
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            // 1. Create Stock Take Record
            const { data: st, error: stError } = await supabase
                .from('stock_takes')
                .insert({
                    type: stockTakeType,
                    status: 'IN_PROGRESS',
                    started_by: user.id
                }).select().single();
            
            if (stError) throw stError;

            // 2. Snapshot existing stock (only for FULL stock take)
            if (stockTakeType === 'FULL') {
                const { data: allStockItems, error: fetchError } = await supabase
                    .from('stock_items')
                    .select('id');
                    
                if (fetchError) throw fetchError;

                if (allStockItems && allStockItems.length > 0) {
                    // Batch insert into stock_take_items
                    const itemsToInsert = allStockItems.map(item => ({
                        stock_take_id: st.id,
                        item_id: item.id,
                        expected_quantity: 1, // each row in stock_items is 1 physical item
                        counted_quantity: 0,
                        status: 'PENDING'
                    }));
                    
                    // Supabase insert supports arrays
                    const { error: insertItemsError } = await supabase
                        .from('stock_take_items')
                        .insert(itemsToInsert);
                        
                    if (insertItemsError) throw insertItemsError;
                }
            }

            await fetchActiveStockTake();
            
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleFinalise = async () => {
        setIsFinaliseModalOpen(false);
        setLoading(true);
        try {
            const completedAt = new Date().toISOString();
            const { error } = await supabase
                .from('stock_takes')
                .update({ status: 'COMPLETED', completed_at: completedAt })
                .eq('id', activeStockTake.id);
            if (error) throw error;
            
            const completedST = { ...activeStockTake, status: 'COMPLETED', completed_at: completedAt };
            await fetchActiveStockTake();
            
            // Navigate directly to the new report
            await fetchHistoryReport(completedST);
            setActiveTab('history');
        } catch(err) {
             setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelStockTake = async () => {
        if (!activeStockTake) return;
        setIsCancelModalOpen(false);
        setLoading(true);
        try {
            const { error } = await supabase
                .from('stock_takes')
                .delete()
                .eq('id', activeStockTake.id);
                
            if (error) throw error;
            await fetchActiveStockTake();
        } catch(err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const confirmDeleteHistory = (take) => {
        setHistoryToDelete(take);
        setIsDeleteHistoryModalOpen(true);
    };

    const handleDeleteHistory = async () => {
        if (!historyToDelete) return;
        setIsDeleteHistoryModalOpen(false);
        setHistoryLoading(true);
        try {
            // Because of foreign keys, we might need to delete items first, or ON DELETE CASCADE handles it. 
            // Assuming Supabase takes care of it or we do it explicitly:
            const { error: itemsError } = await supabase
                .from('stock_take_items')
                .delete()
                .eq('stock_take_id', historyToDelete.id);
            
            if (itemsError) throw itemsError;

            const { error: takeError } = await supabase
                .from('stock_takes')
                .delete()
                .eq('id', historyToDelete.id);
            
            if (takeError) throw takeError;

            // Update local state
            setHistoricalTakes(prev => prev.filter(t => t.id !== historyToDelete.id));
            if (selectedHistoryReport && selectedHistoryReport.id === historyToDelete.id) {
                setSelectedHistoryReport(null);
                setSelectedHistoryItems([]);
            }
        } catch(err) {
            console.error("Failed to delete stock take:", err);
            setError(`Failed to delete stock take: ${err.message}`);
        } finally {
            setHistoryLoading(false);
            setHistoryToDelete(null);
        }
    };

    const handleScan = async (barcode) => {
        if (!barcode || !activeStockTakeRef.current) return;
        
        try {
            // 1. Fetch all stock items for this barcode
            const { data: stockItems, error: fetchError } = await supabase
                .from('stock_items')
                .select('id, name, barcode, purchase_price')
                .eq('barcode', barcode);
                
            if (fetchError || !stockItems || stockItems.length === 0) {
                if (logUnrecognizedBarcode) {
                    logUnrecognizedBarcode(barcode);
                }
                setLastScanned({ success: false, message: `Barcode ${barcode} not found in system.` });
                return;
            }
            
            const currentStockTakeItems = stockTakeItemsRef.current;
            let takeItemsForBarcode = currentStockTakeItems.filter(i => 
                stockItems.some(si => si.id === i.item_id)
            );

            let newItemsInserted = [];

            // If ROLLING and we haven't added these items yet, dynamically inject them
            if (activeStockTakeRef.current.type === 'ROLLING' && takeItemsForBarcode.length === 0) {
                const itemsToInsert = stockItems.map(item => ({
                    stock_take_id: activeStockTakeRef.current.id,
                    item_id: item.id,
                    expected_quantity: 1,
                    counted_quantity: 0,
                    status: 'PENDING'
                }));
                
                const { data: insertedItems, error: insertError } = await supabase
                    .from('stock_take_items')
                    .insert(itemsToInsert)
                    .select('*, stock_items(name, barcode, purchase_price)');
                    
                if (insertError) throw insertError;
                
                takeItemsForBarcode = insertedItems;
                newItemsInserted = insertedItems;
            }

            if (takeItemsForBarcode.length === 0) {
                setLastScanned({ success: false, message: `Item ${stockItems[0].name} is not part of this stock take.` });
                return;
            }
            
            // If we dynamically inserted items, immediately update local state so they aren't lost if the user cancels quantity mode
            if (newItemsInserted.length > 0) {
                setStockTakeItems(prev => [...prev, ...newItemsInserted]);
            }

            // 2. Find which physical takeItem to increment
            // Prefer an item that hasn't been counted yet (counted_quantity === 0)
            let takeItemToUpdate = takeItemsForBarcode.find(i => (i.counted_quantity || 0) === 0);
            
            // If all have been counted at least once, over-count the first one
            if (!takeItemToUpdate) {
                takeItemToUpdate = takeItemsForBarcode[0];
            }
            
            if (scanModeRef.current === 'QUANTITY') {
                setQuantityItem(takeItemToUpdate);
                setQuantityInput('1');
                setIsQuantityModalOpen(true);
                return;
            }

            // 3. Increment counted_quantity
            const newQuantity = (takeItemToUpdate.counted_quantity || 0) + 1;
            
            const { error: updateError } = await supabase
                .from('stock_take_items')
                .update({ counted_quantity: newQuantity, status: 'COUNTED' })
                .eq('id', takeItemToUpdate.id);
                
            if (updateError) throw updateError;
            
            // 4. Update local state
            setStockTakeItems(prev => prev.map(i => 
                i.id === takeItemToUpdate.id 
                    ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' } 
                    : i
            ));
            
            setLastScanned({ success: true, message: `Scanned ${stockItems[0].name} (Count: ${newQuantity})` });
            
            // Clear message after 3 seconds
            setTimeout(() => {
                setLastScanned(null);
            }, 3000);
            
        } catch (err) {
            console.error(err);
            setLastScanned({ success: false, message: "Error recording scan: " + err.message });
        }
    };

    const handleQuantitySubmit = async (e) => {
        e.preventDefault();
        const addedQty = parseInt(quantityInput, 10);
        if (isNaN(addedQty) || addedQty < 1 || !quantityItem) return;

        setLoading(true);
        try {
            const newQuantity = (quantityItem.counted_quantity || 0) + addedQty;
            
            const { error: updateError } = await supabase
                .from('stock_take_items')
                .update({ counted_quantity: newQuantity, status: 'COUNTED' })
                .eq('id', quantityItem.id);
                
            if (updateError) throw updateError;
            
            // Update local state
            setStockTakeItems(prev => prev.map(i => 
                i.id === quantityItem.id
                    ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' }
                    : i
            ));
            
            setLastScanned({ success: true, message: `Added ${addedQty} to ${quantityItem.stock_items?.name || 'item'} (Total: ${newQuantity})` });
            
            setTimeout(() => {
                setLastScanned(null);
            }, 3000);

            setIsQuantityModalOpen(false);
            setQuantityItem(null);
        } catch (err) {
            console.error(err);
            setLastScanned({ success: false, message: "Error updating quantity: " + err.message });
        } finally {
            setLoading(false);
        }
    };

    // Bluetooth Scanner Listener
    useEffect(() => {
        if (activeTab !== 'active' || !activeStockTake) return;

        let barcodeBuffer = '';
        let timeoutId = null;

        const handleKeyDown = (e) => {
            // Ignore keystrokes inside actual input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            // Clear the inactivity timeout on every keystroke
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (e.key === 'Enter') {
                if (barcodeBuffer.length > 2) {
                    e.preventDefault();
                    handleScan(barcodeBuffer);
                }
                barcodeBuffer = '';
            } else if (e.key.length === 1) { // Standard character
                barcodeBuffer += e.key;
            }
            
            // If 500ms passes without a keystroke, clear the buffer
            // This allows slower Bluetooth scanners to work without clearing mid-scan
            timeoutId = setTimeout(() => {
                barcodeBuffer = '';
            }, 500);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [activeTab, activeStockTake]); // dependencies don't include handleScan intentionally since it relies on refs

    return (
        <Page title="Stock Takes" actions={
            !activeStockTake && (
                <button onClick={() => setIsInitiateModalOpen(true)} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
                    <PlusCircleIcon className="w-5 h-5 mr-2" />
                    New Stock Take
                </button>
            )
        }>
            <div className="border-b border-zinc-200 dark:border-zinc-700 mb-6">
                <nav className="-mb-px flex space-x-6">
                    <button onClick={() => setActiveTab('active')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'active' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>Active Count</button>
                    <button onClick={() => setActiveTab('history')} className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}>History</button>
                </nav>
            </div>

            {loading ? (
                <div className="flex justify-center p-12"><Spinner /></div>
            ) : activeTab === 'active' ? (
                <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 p-6 text-center">
                    {!activeStockTake ? (
                        <EmptyState 
                            icon={<ClipboardCheckIcon className="w-8 h-8" />}
                            title="No Active Stock Take"
                            message="Start a new Full or Rolling stock take to begin counting inventory."
                            action={
                                <button onClick={() => setIsInitiateModalOpen(true)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
                                    Start Stock Take
                                </button>
                            }
                        />
                    ) : (
                        <div>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold">Active {activeStockTake.type} Stock Take</h2>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setIsCancelModalOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 text-sm font-medium border border-red-200">
                                        Stop & Cancel
                                    </button>
                                    <button onClick={() => setIsFinaliseModalOpen(true)} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium">
                                        Finalise Count
                                    </button>
                                </div>
                            </div>
                            
                            {activeStockTake.type === 'FULL' && (
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded border border-amber-200 dark:border-amber-800 mb-6 text-left">
                                    <strong>System Frozen:</strong> While a Full Stock Take is active, all other inventory movements should be avoided.
                                </div>
                            )}

                            <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-12 flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-800/50 relative overflow-hidden">
                                
                                {lastScanned && (
                                    <div className={`absolute top-0 left-0 right-0 p-3 text-sm font-medium text-white transition-all ${lastScanned.success ? 'bg-green-600' : 'bg-red-600'}`}>
                                        {lastScanned.message}
                                    </div>
                                )}
                                
                                <div className="absolute top-4 right-4 flex bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 p-1">
                                    <button
                                        onClick={() => setScanMode('RAPID')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${scanMode === 'RAPID' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                                    >
                                        Rapid Scan
                                    </button>
                                    <button
                                        onClick={() => setScanMode('QUANTITY')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${scanMode === 'QUANTITY' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                                    >
                                        Quantity Mode
                                    </button>
                                </div>

                                <ClipboardCheckIcon className="w-16 h-16 text-zinc-400 mb-4" />
                                <p className="text-xl font-medium text-zinc-800 dark:text-zinc-200 mb-2">Bluetooth Scanner Ready</p>
                                <p className="text-zinc-500 max-w-sm text-center mb-6">Simply scan barcodes with your connected bluetooth scanner. The system is listening in the background.</p>
                                
                                <div className="flex items-center space-x-2 text-sm text-blue-600 dark:text-blue-400">
                                    <span className="relative flex h-3 w-3">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                                    </span>
                                    <span>Listening for scans...</span>
                                </div>
                            </div>
                            
                            {/* Summary Stats */}
                            <div className="mt-8 text-left">
                                <h3 className="text-lg font-bold mb-4">Progress Summary</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Items Expected</p>
                                        <p className="text-2xl font-bold">{stockTakeItems.length}</p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Items Counted</p>
                                        <p className="text-2xl font-bold">{stockTakeItems.filter(i => i.counted_quantity > 0).length}</p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Expected Value</p>
                                        <p className="text-2xl font-bold">
                                            £{stockTakeItems.reduce((acc, i) => acc + ((i.expected_quantity || 1) * (parseFloat(i.stock_items?.purchase_price) || 0)), 0).toFixed(2)}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Counted Value</p>
                                        <p className="text-2xl font-bold">
                                            £{stockTakeItems.reduce((acc, i) => acc + ((i.counted_quantity || 0) * (parseFloat(i.stock_items?.purchase_price) || 0)), 0).toFixed(2)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            {activeTab === 'history' && (
                <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden min-h-[400px]">
                    {historyLoading ? (
                        <div className="flex justify-center p-12"><Spinner /></div>
                    ) : selectedHistoryReport ? (
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h2 className="text-xl font-bold">Stock Take Report</h2>
                                    <p className="text-zinc-500 dark:text-zinc-400 text-sm">Completed on {new Date(selectedHistoryReport.completed_at).toLocaleString()}</p>
                                </div>
                                <button onClick={() => setSelectedHistoryReport(null)} className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-600 text-sm font-medium transition-colors">
                                    &larr; Back to History
                                </button>
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Type</p>
                                    <p className="text-xl font-bold">{selectedHistoryReport.type}</p>
                                </div>
                                <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Items Counted</p>
                                    <p className="text-xl font-bold">
                                        {selectedHistoryItems.reduce((acc, curr) => acc + (curr.counted_quantity || 0), 0)}
                                        <span className="text-sm font-normal text-zinc-500 ml-1">
                                            / {selectedHistoryItems.reduce((acc, curr) => acc + (curr.expected_quantity || 1), 0)}
                                        </span>
                                    </p>
                                </div>
                                <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Variance</p>
                                    <p className="text-xl font-bold">
                                        {(() => {
                                            const v = selectedHistoryItems.reduce((acc, item) => {
                                                return acc + ((item.counted_quantity || 0) - (item.expected_quantity || 1));
                                            }, 0);
                                            return <span className={v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : ''}>{v > 0 ? '+' : ''}{v} units</span>;
                                        })()}
                                    </p>
                                </div>
                                <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Value Variance</p>
                                    <p className="text-xl font-bold">
                                        {(() => {
                                            const v = selectedHistoryItems.reduce((acc, item) => {
                                                const diff = (item.counted_quantity || 0) - (item.expected_quantity || 1);
                                                const price = parseFloat(item.stock_items?.purchase_price) || 0;
                                                return acc + (diff * price);
                                            }, 0);
                                            return <span className={v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : ''}>{v < 0 ? '-' : v > 0 ? '+' : ''}£{Math.abs(v).toFixed(2)}</span>;
                                        })()}
                                    </p>
                                </div>
                            </div>

                            <h3 className="text-lg font-bold mb-4">Detailed Breakdown</h3>
                            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg">
                                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                    <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Item Name</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Barcode</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Price</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Expected</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Counted</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Variance</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Value Var</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-700">
                                        {selectedHistoryItems.sort((a, b) => {
                                            // Sort by absolute monetary discrepancy to surface highest value missing/extra items
                                            const vA = Math.abs((a.counted_quantity || 0) - (a.expected_quantity || 1)) * (parseFloat(a.stock_items?.purchase_price) || 0);
                                            const vB = Math.abs((b.counted_quantity || 0) - (b.expected_quantity || 1)) * (parseFloat(b.stock_items?.purchase_price) || 0);
                                            
                                            if (vB !== vA) return vB - vA;
                                            
                                            // Fallback to absolute unit variance if value is 0 or same
                                            const uA = Math.abs((a.counted_quantity || 0) - (a.expected_quantity || 1));
                                            const uB = Math.abs((b.counted_quantity || 0) - (b.expected_quantity || 1));
                                            return uB - uA;
                                        }).map(item => {
                                            const variance = (item.counted_quantity || 0) - (item.expected_quantity || 1);
                                            const hasDiscrepancy = variance !== 0;
                                            const price = parseFloat(item.stock_items?.purchase_price) || 0;
                                            const valueVar = variance * price;
                                            
                                            return (
                                                <tr key={item.id} className={hasDiscrepancy ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">{item.stock_items?.name}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">{item.stock_items?.barcode}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">£{price.toFixed(2)}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">{item.expected_quantity || 1}</td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">{item.counted_quantity || 0}</td>
                                                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (variance > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                        {variance > 0 ? '+' : ''}{variance}
                                                    </td>
                                                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (valueVar > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                        {valueVar > 0 ? '+' : ''}{valueVar < 0 ? '-' : ''}£{Math.abs(valueVar).toFixed(2)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {selectedHistoryItems.length === 0 && (
                                            <tr>
                                                <td colSpan="7" className="px-4 py-8 text-center text-sm text-zinc-500">No items were recorded in this stock take.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="p-6">
                            {historicalTakes.length > 0 ? (
                                <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                    {historicalTakes.map(take => (
                                        <li key={take.id} className="py-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-700/30 px-4 -mx-4 rounded-lg transition-colors">
                                            <div>
                                                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{take.type} Stock Take</p>
                                                <p className="text-sm text-zinc-500">Completed: {new Date(take.completed_at).toLocaleString()}</p>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <button onClick={() => confirmDeleteHistory(take)} className="px-3 py-2 text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors" title="Delete record">
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => fetchHistoryReport(take)} className="px-4 py-2 text-sm text-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md font-medium transition-colors">
                                                    View Report
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="text-center py-16">
                                    <ClipboardCheckIcon className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
                                    <p className="text-zinc-500 font-medium">No historical stock takes found.</p>
                                    <p className="text-sm text-zinc-400 mt-1">Completed reports will appear here automatically.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <Modal isOpen={isInitiateModalOpen} onClose={() => setIsInitiateModalOpen(false)} title="Initiate Stock Take">
                <div className="space-y-4 py-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Choose the type of stock take you want to perform.
                    </p>
                    <div>
                        <label className="flex items-start space-x-3 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                            <input type="radio" name="st_type" value="FULL" checked={stockTakeType === 'FULL'} onChange={(e) => setStockTakeType(e.target.value)} className="mt-1" />
                            <div>
                                <span className="block font-medium text-zinc-900 dark:text-white">Full Stock Take</span>
                                <span className="block text-sm text-zinc-500 dark:text-zinc-400">Counts all items in the database. Intended to be used when the whole store is being audited.</span>
                            </div>
                        </label>
                    </div>
                    <div>
                        <label className="flex items-start space-x-3 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                            <input type="radio" name="st_type" value="ROLLING" checked={stockTakeType === 'ROLLING'} onChange={(e) => setStockTakeType(e.target.value)} className="mt-1" />
                            <div>
                                <span className="block font-medium text-zinc-900 dark:text-white">Rolling Stock Take</span>
                                <span className="block text-sm text-zinc-500 dark:text-zinc-400">Allows you to count specific item types or locations progressively. Does not imply a full store audit.</span>
                            </div>
                        </label>
                    </div>
                    <button onClick={handleInitiateStockTake} className="w-full mt-4 flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700">
                        Start Count
                    </button>
                </div>
            </Modal>

            <Modal isOpen={isCancelModalOpen} onClose={() => setIsCancelModalOpen(false)} title="Cancel Stock Take">
                <div className="space-y-4 py-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Are you sure you want to stop and cancel this stock take? All progress will be lost and the stock take will be permanently deleted.
                    </p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setIsCancelModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md font-medium text-sm">
                            Go Back
                        </button>
                        <button onClick={handleCancelStockTake} className="px-4 py-2 bg-red-600 text-white rounded-md font-medium text-sm hover:bg-red-700">
                            Confirm Cancel
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isFinaliseModalOpen} onClose={() => setIsFinaliseModalOpen(false)} title="Finalise Stock Take">
                <div className="space-y-4 py-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Are you sure you want to finalise this stock take? This will mark it as complete and generate the final variance report.
                    </p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setIsFinaliseModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md font-medium text-sm">
                            Keep Counting
                        </button>
                        <button onClick={handleFinalise} className="px-4 py-2 bg-green-600 text-white rounded-md font-medium text-sm hover:bg-green-700">
                            Confirm Finalise
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isDeleteHistoryModalOpen} onClose={() => setIsDeleteHistoryModalOpen(false)} title="Delete Historical Record">
                <div className="space-y-4 py-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Are you sure you want to permanently delete this stock take record? This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setIsDeleteHistoryModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md font-medium text-sm">
                            Cancel
                        </button>
                        <button onClick={handleDeleteHistory} className="px-4 py-2 bg-red-600 text-white rounded-md font-medium text-sm hover:bg-red-700">
                            Delete Record
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isQuantityModalOpen} onClose={() => setIsQuantityModalOpen(false)} title="Enter Quantity">
                {quantityItem && (
                    <form onSubmit={handleQuantitySubmit} className="space-y-4">
                        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">Item</p>
                            <p className="font-medium text-zinc-900 dark:text-zinc-100">{quantityItem.stock_items?.name}</p>
                            <p className="text-xs text-zinc-500 mt-1">Barcode: {quantityItem.stock_items?.barcode}</p>
                            <p className="text-xs text-zinc-500 mt-1">Current Count: {quantityItem.counted_quantity || 0}</p>
                        </div>
                        <div>
                            <label htmlFor="qty" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Add</label>
                            <input 
                                type="number" 
                                id="qty" 
                                value={quantityInput} 
                                onChange={(e) => setQuantityInput(e.target.value)} 
                                min="1" 
                                step="1" 
                                className={formInputStyle} 
                                autoFocus 
                            />
                        </div>
                        <div className="flex justify-end pt-4 space-x-3">
                            <button type="button" onClick={() => setIsQuantityModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600">
                                Cancel
                            </button>
                            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 flex items-center justify-center">
                                {loading ? <Spinner /> : 'Add Quantity'}
                            </button>
                        </div>
                    </form>
                )}
            </Modal>
        </Page>
    );
};

export default StockTakePage;
