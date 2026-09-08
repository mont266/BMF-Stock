import fs from 'fs';

const code = `import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Page, Spinner, EmptyState, formInputStyle } from './StockManagerApp';
import Scanner from './Scanner';
import Modal from './Modal';
import { PlusCircleIcon, ClipboardCheckIcon, ArchiveIcon, ChartBarIcon } from './Icons';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const StockTakePage = ({ stock, setStock, setError }) => {
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('active');
    const [activeStockTake, setActiveStockTake] = useState(null);
    const [stockTakeItems, setStockTakeItems] = useState([]);
    
    const [isInitiateModalOpen, setIsInitiateModalOpen] = useState(false);
    const [stockTakeType, setStockTakeType] = useState('FULL');
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    
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
                    .select('*, stock_items(name, barcode)')
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

            // 2. Snapshot existing stock
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

            await fetchActiveStockTake();
            
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleScan = async (barcode) => {
        if (!barcode || !activeStockTake) return;
        
        try {
            if (Capacitor.isNativePlatform()) {
                await Haptics.impact({ style: ImpactStyle.Light });
            }
            
            // 1. Find the stock_item by barcode
            const { data: stockItem, error: fetchError } = await supabase
                .from('stock_items')
                .select('id, name')
                .eq('barcode', barcode)
                .single();
                
            if (fetchError || !stockItem) {
                alert(\`Barcode \${barcode} not found in system.\`);
                return;
            }
            
            // 2. Find the corresponding stock_take_item
            const takeItem = stockTakeItems.find(i => i.item_id === stockItem.id);
            if (!takeItem) {
                alert(\`Item \${stockItem.name} is not part of this stock take.\`);
                return;
            }
            
            // 3. Increment counted_quantity
            const newQuantity = (takeItem.counted_quantity || 0) + 1;
            
            const { error: updateError } = await supabase
                .from('stock_take_items')
                .update({ counted_quantity: newQuantity, status: 'COUNTED' })
                .eq('id', takeItem.id);
                
            if (updateError) throw updateError;
            
            // 4. Update local state
            setStockTakeItems(prev => prev.map(i => 
                i.id === takeItem.id 
                    ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' } 
                    : i
            ));
            
            if (Capacitor.isNativePlatform()) {
                await Haptics.impact({ style: ImpactStyle.Heavy });
            }
            
            // Note: Since persistent=true, the scanner will stay open and let them scan again.
        } catch (err) {
            console.error(err);
            alert("Error recording scan: " + err.message);
        }
    };
    
    const handleFinalise = async () => {
        if (!window.confirm("Are you sure you want to finalise this stock take? This will mark it as complete.")) return;
        setLoading(true);
        try {
            const { error } = await supabase
                .from('stock_takes')
                .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
                .eq('id', activeStockTake.id);
            if (error) throw error;
            await fetchActiveStockTake();
        } catch(err) {
             setError(err.message);
        } finally {
            setLoading(false);
        }
    };

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
                    <button onClick={() => setActiveTab('active')} className={\`py-4 px-1 border-b-2 font-medium text-sm \${activeTab === 'active' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}\`}>Active Count</button>
                    <button onClick={() => setActiveTab('history')} className={\`py-4 px-1 border-b-2 font-medium text-sm \${activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'}\`}>History</button>
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
                                <button onClick={handleFinalise} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium">
                                    Finalise Count
                                </button>
                            </div>
                            
                            {activeStockTake.type === 'FULL' && (
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded border border-amber-200 dark:border-amber-800 mb-6 text-left">
                                    <strong>System Frozen:</strong> While a Full Stock Take is active, all other inventory movements should be avoided. Use the scanner below to count items.
                                </div>
                            )}

                            <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-12 flex flex-col items-center justify-center">
                                <p className="text-zinc-500 mb-4">Ready to scan physical inventory items.</p>
                                <button onClick={() => setIsScannerOpen(true)} className="px-6 py-3 bg-blue-600 text-white rounded-md font-medium text-sm shadow flex items-center">
                                    <ClipboardCheckIcon className="w-5 h-5 mr-2" />
                                    Open Barcode Scanner
                                </button>
                            </div>
                            
                            {/* Summary Stats */}
                            <div className="mt-8 text-left">
                                <h3 className="text-lg font-bold mb-4">Progress Summary</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Items Expected</p>
                                        <p className="text-2xl font-bold">{stockTakeItems.length}</p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Items Counted</p>
                                        <p className="text-2xl font-bold">{stockTakeItems.filter(i => i.counted_quantity > 0).length}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            {activeTab === 'history' && (
                <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 p-6 text-center">
                    <p className="text-zinc-500">Historical stock take reports will appear here.</p>
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
            
            {isScannerOpen && (
                <Scanner 
                    persistent={true}
                    onScanSuccess={handleScan}
                    onCancel={() => setIsScannerOpen(false)}
                />
            )}
        </Page>
    );
};

export default StockTakePage;
`;
fs.writeFileSync('components/StockTakePage.jsx', code);
