import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Page, Spinner, EmptyState, formInputStyle } from './StockManagerApp';
import Modal from './Modal';
import { PlusCircleIcon, ClipboardCheckIcon, ArchiveIcon, ChartBarIcon, TrashIcon, BuildingStoreIcon, ChevronDownIcon, TagIcon, BarcodeIcon } from './Icons';
import { trainingManager } from '../lib/trainingEnvironment';
import { Team, Location } from '../types';

// --- Helper functions for serial number range expansion in Stock Take ---
const parseSerial = (serial) => {
    let lastDigitIndex = -1;
    for (let i = serial.length - 1; i >= 0; i--) {
        if (!isNaN(parseInt(serial[i], 10))) {
            lastDigitIndex = i;
            break;
        }
    }
    if (lastDigitIndex === -1) return null;

    let firstDigitIndex = lastDigitIndex;
    while (firstDigitIndex > 0 && !isNaN(parseInt(serial[firstDigitIndex - 1], 10))) {
        firstDigitIndex--;
    }

    const prefix = serial.substring(0, firstDigitIndex);
    const numStr = serial.substring(firstDigitIndex, lastDigitIndex + 1);
    const suffix = serial.substring(lastDigitIndex + 1);
    return { prefix, numStr, suffix };
};

const expandRange = (start, end) => {
    const startParts = parseSerial(start);
    const endParts = parseSerial(end);

    if (!startParts || !endParts) {
        return { error: "Invalid format. Serials must contain a number part for range expansion." };
    }
    
    const { prefix: startPrefix, numStr: startNumStr, suffix: startSuffix } = startParts;
    const { prefix: endPrefix, numStr: endNumStr, suffix: endSuffix } = endParts;

    if (startPrefix !== endPrefix || startSuffix !== endSuffix) {
        return { error: "The text parts (prefix/suffix) of the serial numbers do not match." };
    }
    
    const startNum = parseInt(startNumStr, 10);
    const endNum = parseInt(endNumStr, 10);

    if (startNum > endNum) {
        return { error: "The start number cannot be greater than the end number." };
    }

    const results = [];
    const padLength = Math.max(startNumStr.length, endNumStr.length);

    for (let i = startNum; i <= endNum; i++) {
        const paddedNum = String(i).padStart(padLength, '0');
        results.push(`${startPrefix}${paddedNum}${startSuffix}`);
    }

    return { result: results };
};

const StockTakePage = ({ 
    stock = [], 
    setStock, 
    setError, 
    logUnrecognizedBarcode, 
    dbLocations = [], 
    activeLocation = 'All', 
    itemTypes = [], 
    supplierPartNumbers = [], 
    refetchStock,
    userProfile,
    selectedProfile,
    profiles = [],
    isTrainingMode = false
}) => {
    const locationsList = useMemo(() => {
        const list = dbLocations.length > 0 
            ? dbLocations.map(l => typeof l === 'string' ? l : l.name) 
            : ['Flamstead', 'Leading Stores', 'Secondary Store'];
        return list.filter(l => l && l !== 'All' && l !== 'Unassigned');
    }, [dbLocations]);

    const [stockTakeLocation, setStockTakeLocation] = useState(() => (activeLocation && activeLocation !== 'All') ? activeLocation : (locationsList[0] || 'Flamstead'));
    const [historyLocationFilter, setHistoryLocationFilter] = useState('All');
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('active');
    const [activeStockTake, setActiveStockTake] = useState(null);
    const [stockTakeItems, setStockTakeItems] = useState([]);
    
    // Grouping, search and filter states
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const [activeCategoryFilter, setActiveCategoryFilter] = useState('All');
    const [expandedActiveTypes, setExpandedActiveTypes] = useState({});

    const [historySearchTerm, setHistorySearchTerm] = useState('');
    const [historyCategoryFilter, setHistoryCategoryFilter] = useState('All');
    const [expandedHistoryTypes, setExpandedHistoryTypes] = useState({});
    
    const [isInitiateModalOpen, setIsInitiateModalOpen] = useState(false);
    const [stockTakeType, setStockTakeType] = useState('FULL');
    
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isFinaliseModalOpen, setIsFinaliseModalOpen] = useState(false);

    const [lastScanned, setLastScanned] = useState(null);
    
    const [scanMode, setScanMode] = useState('RAPID');
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [quantityItem, setQuantityItem] = useState(null);
    const [quantityInput, setQuantityInput] = useState('1');

    // --- Range Count State ---
    const [isRangeCountModalOpen, setIsRangeCountModalOpen] = useState(false);
    const [rangeCountDetails, setRangeCountDetails] = useState({ firstSerial: '', lastSerial: '', selectedItemType: '' });
    const [rangeCountSubmitting, setRangeCountSubmitting] = useState(false);
    const [rangeCountError, setRangeCountError] = useState('');
    
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

    useEffect(() => {
        if (!activeStockTake) {
            setStockTakeLocation(prev => {
                if (activeLocation && activeLocation !== 'All') return activeLocation;
                if (prev && prev !== 'All' && locationsList.includes(prev)) return prev;
                return locationsList[0] || 'Flamstead';
            });
        }
    }, [activeLocation, activeStockTake, locationsList]);

    const stockMap = useMemo(() => {
        const map = new Map();
        if (Array.isArray(stock)) {
            for (const s of stock) {
                if (s && s.id) map.set(s.id, s);
            }
        }
        return map;
    }, [stock]);

    const itemTypesMap = useMemo(() => {
        const map = {};
        if (Array.isArray(itemTypes)) {
            itemTypes.forEach(it => {
                if (it && it.name) {
                    map[it.name] = it;
                }
                if (it && it.id) {
                    map[it.id] = it;
                }
            });
        }
        return map;
    }, [itemTypes]);

    const partNumberLookupMap = useMemo(() => {
        const map = {};
        if (Array.isArray(supplierPartNumbers)) {
            supplierPartNumbers.forEach(sp => {
                const itemType = itemTypes.find(it => it.id === sp.item_type_id);
                const info = {
                    itemTypeId: sp.item_type_id,
                    itemTypeName: itemType?.name || sp.item_types?.name,
                    partNumber: sp.part_number,
                    barcode: sp.barcode,
                    supplierName: sp.suppliers?.name
                };
                if (sp.part_number) {
                    map[String(sp.part_number).trim().toLowerCase()] = info;
                }
                if (sp.barcode) {
                    map[String(sp.barcode).trim().toLowerCase()] = info;
                }
            });
        }
        return map;
    }, [supplierPartNumbers, itemTypes]);
    
    const fetchActiveStockTake = useCallback(async () => {
        if (isTrainingMode) {
            const active = trainingManager.getActiveStockTake();
            if (active) {
                setActiveStockTake(active);
                setStockTakeItems(trainingManager.getStockTakeItems(active.id));
            } else {
                setActiveStockTake(null);
                setStockTakeItems([]);
            }
            return;
        }
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
                    .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to, created_at)')
                    .eq('stock_take_id', data.id);
                if (!itemsError && items) {
                    const takeCreatedAt = data.created_at ? new Date(data.created_at).getTime() : 0;
                    const itemsToFixInDb = [];
                    const normalizedItems = items.map(item => {
                        const itemCreatedAt = item.stock_items?.created_at ? new Date(item.stock_items.created_at).getTime() : 0;
                        const wasCreatedDuringTake = itemCreatedAt > 0 && takeCreatedAt > 0 && itemCreatedAt >= (takeCreatedAt - 3000);
                        if (wasCreatedDuringTake && (item.expected_quantity || 0) > 0) {
                            itemsToFixInDb.push(item.id);
                            return { ...item, expected_quantity: 0 };
                        }
                        return item;
                    });

                    if (itemsToFixInDb.length > 0) {
                        supabase
                            .from('stock_take_items')
                            .update({ expected_quantity: 0 })
                            .in('id', itemsToFixInDb)
                            .then();
                    }

                    setStockTakeItems(normalizedItems);
                }
            } else {
                setActiveStockTake(null);
                setStockTakeItems([]);
            }
        } catch (err) {
            console.error("Error fetching active stock take", err);
        }
    }, [isTrainingMode]);

    // Robust grouping by Item Type with full fallbacks
    const groupStockTakeByItemType = useCallback((items) => {
        if (!items || items.length === 0) return [];
        const groups = {};
        for (const item of items) {
            const stockItemFallback = stockMap.get(item.item_id);
            const rawName = item.stock_items?.name || stockItemFallback?.name;
            const matchedType = rawName 
                ? (itemTypesMap[rawName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === rawName) : null))
                : (item.item_id && Array.isArray(itemTypes) ? itemTypes.find(it => it.id === item.item_id) : null);

            const itemTypeName = rawName || matchedType?.name || item.name || 'Uncategorised Item';
            const meta = matchedType || itemTypesMap[itemTypeName] || {};
            const category = meta.category || stockItemFallback?.category || 'General';
            const price = parseFloat(item.stock_items?.purchase_price ?? stockItemFallback?.purchase_price ?? meta.price ?? 0) || 0;
            const defaultBarcode = item.stock_items?.barcode || stockItemFallback?.barcode || meta.barcode || '';

            if (!groups[itemTypeName]) {
                groups[itemTypeName] = {
                    key: itemTypeName,
                    name: itemTypeName,
                    category: category,
                    price: price,
                    is_unique: !!meta.is_unique,
                    expected_quantity: 0,
                    counted_quantity: 0,
                    rawItems: [],
                    status: 'PENDING'
                };
            }
            // If the physical item was created during/after the stock take started, it was not in the system at the start
            const takeCreatedAt = activeStockTake?.created_at ? new Date(activeStockTake.created_at).getTime() : 0;
            const itemCreatedAt = item.stock_items?.created_at ? new Date(item.stock_items.created_at).getTime() : 0;
            const wasCreatedDuringTake = itemCreatedAt > 0 && takeCreatedAt > 0 && itemCreatedAt >= (takeCreatedAt - 3000);

            const exp = wasCreatedDuringTake 
                ? 0 
                : (typeof item.expected_quantity === 'number' ? item.expected_quantity : 1);
            const cnt = typeof item.counted_quantity === 'number' ? item.counted_quantity : 0;
            groups[itemTypeName].expected_quantity += exp;
            groups[itemTypeName].counted_quantity += cnt;
            groups[itemTypeName].rawItems.push({
                ...item,
                expected_quantity: wasCreatedDuringTake ? 0 : (item.expected_quantity ?? 1),
                stock_items: item.stock_items || stockItemFallback || {
                    id: item.item_id,
                    name: itemTypeName,
                    barcode: defaultBarcode,
                    purchase_price: price,
                    created_at: item.stock_items?.created_at
                }
            });
            if (cnt > 0) {
                groups[itemTypeName].status = 'COUNTED';
            }
        }
        return Object.values(groups).map(g => {
            const uniqueBarcodes = Array.from(new Set(g.rawItems.map(i => i.stock_items?.barcode).filter(Boolean)));
            const fallbackBarcode = itemTypesMap[g.name]?.barcode || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === g.name)?.barcode : '') || '—';
            return {
                ...g,
                uniqueBarcodes,
                barcodeDisplay: uniqueBarcodes.length === 1 
                    ? uniqueBarcodes[0] 
                    : uniqueBarcodes.length > 1 
                        ? `${uniqueBarcodes.length} serials` 
                        : fallbackBarcode,
                variance: g.counted_quantity - g.expected_quantity,
                value_variance: (g.counted_quantity - g.expected_quantity) * g.price
            };
        });
    }, [itemTypesMap, itemTypes, stockMap, activeStockTake?.created_at]);

    const activeGroupedItems = useMemo(() => {
        return groupStockTakeByItemType(stockTakeItems);
    }, [stockTakeItems, groupStockTakeByItemType]);

    const activeAvailableCategories = useMemo(() => {
        const cats = new Set();
        activeGroupedItems.forEach(g => { if (g.category) cats.add(g.category); });
        return ['All', ...Array.from(cats)];
    }, [activeGroupedItems]);

    const filteredActiveGroups = useMemo(() => {
        return activeGroupedItems.filter(g => {
            const matchesCat = activeCategoryFilter === 'All' || g.category === activeCategoryFilter;
            if (!matchesCat) return false;
            if (!activeSearchTerm.trim()) return true;
            const term = activeSearchTerm.toLowerCase();
            const matchesName = (g.name || '').toLowerCase().includes(term);
            const matchesCatText = (g.category || '').toLowerCase().includes(term);
            const matchesBarcode = g.rawItems.some(i => (i.stock_items?.barcode || '').toLowerCase().includes(term));
            return matchesName || matchesCatText || matchesBarcode;
        });
    }, [activeGroupedItems, activeCategoryFilter, activeSearchTerm]);

    const toggleActiveGroup = (name) => {
        setExpandedActiveTypes(prev => ({ ...prev, [name]: !prev[name] }));
    };

    const toggleAllActiveGroups = () => {
        const allExpanded = filteredActiveGroups.length > 0 && filteredActiveGroups.every(g => expandedActiveTypes[g.name]);
        if (allExpanded) {
            setExpandedActiveTypes({});
        } else {
            const next = {};
            filteredActiveGroups.forEach(g => { next[g.name] = true; });
            setExpandedActiveTypes(next);
        }
    };

    const fetchHistory = useCallback(async () => {
        if (isTrainingMode) {
            setHistoryLoading(false);
            setHistoricalTakes(trainingManager.getCompletedStockTakes());
            return;
        }
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
    }, [isTrainingMode]);

    const fetchHistoryReport = async (st) => {
        if (isTrainingMode) {
            setSelectedHistoryReport(st);
            setSelectedHistoryItems(st.items || []);
            setHistoryLoading(false);
            return;
        }
        setHistoryLoading(true);
        try {
            setSelectedHistoryReport(st);
            const { data: items, error } = await supabase
                .from('stock_take_items')
                .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to, created_at)')
                .eq('stock_take_id', st.id);
            if (error) throw error;
            
            // Enrich items with fallbacks from stockMap and itemTypes
            const enriched = (items || []).map(item => {
                const stockItemFallback = stockMap.get(item.item_id);
                const rawName = item.stock_items?.name || stockItemFallback?.name;
                const meta = itemTypesMap[rawName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === rawName || it.id === item.item_id) : null) || {};
                
                return {
                    ...item,
                    stock_items: item.stock_items || stockItemFallback || {
                        id: item.item_id,
                        name: rawName || meta.name || 'Uncategorised Item',
                        barcode: stockItemFallback?.barcode || meta.barcode || '',
                        purchase_price: stockItemFallback?.purchase_price ?? meta.price ?? 0,
                        location: stockItemFallback?.location || st.location || 'Flamstead',
                        assigned_to: stockItemFallback?.assigned_to || 'Unassigned'
                    }
                };
            });

            setSelectedHistoryItems(enriched);
        } catch(err) {
            console.error("Error fetching history report", err);
            setError(`Failed to load history report: ${err.message}`);
        } finally {
            setHistoryLoading(false);
        }
    };

    const historyGroupedItems = useMemo(() => {
        return groupStockTakeByItemType(selectedHistoryItems);
    }, [selectedHistoryItems, groupStockTakeByItemType]);

    const historyAvailableCategories = useMemo(() => {
        const cats = new Set();
        historyGroupedItems.forEach(g => { if (g.category) cats.add(g.category); });
        return ['All', ...Array.from(cats)];
    }, [historyGroupedItems]);

    const filteredHistoryGroups = useMemo(() => {
        return historyGroupedItems.filter(g => {
            const matchesCat = historyCategoryFilter === 'All' || g.category === historyCategoryFilter;
            if (!matchesCat) return false;
            if (!historySearchTerm.trim()) return true;
            const term = historySearchTerm.toLowerCase();
            const matchesName = (g.name || '').toLowerCase().includes(term);
            const matchesCatText = (g.category || '').toLowerCase().includes(term);
            const matchesBarcode = g.rawItems.some(i => (i.stock_items?.barcode || '').toLowerCase().includes(term));
            return matchesName || matchesCatText || matchesBarcode;
        });
    }, [historyGroupedItems, historyCategoryFilter, historySearchTerm]);

    const toggleHistoryGroup = (name) => {
        setExpandedHistoryTypes(prev => ({ ...prev, [name]: !prev[name] }));
    };

    const toggleAllHistoryGroups = () => {
        const allExpanded = filteredHistoryGroups.length > 0 && filteredHistoryGroups.every(g => expandedHistoryTypes[g.name]);
        if (allExpanded) {
            setExpandedHistoryTypes({});
        } else {
            const next = {};
            filteredHistoryGroups.forEach(g => { next[g.name] = true; });
            setExpandedHistoryTypes(next);
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
        if (isTrainingMode) {
            try {
                const targetLocation = (stockTakeLocation && stockTakeLocation !== 'All') 
                    ? stockTakeLocation 
                    : ((activeLocation && activeLocation !== 'All' && locationsList.includes(activeLocation)) ? activeLocation : (locationsList[0] || 'Flamstead'));

                if (!targetLocation || targetLocation === 'All') {
                    throw new Error("Please select a specific storehouse location. Company-wide stock take is not permitted.");
                }

                const { stockTake, items } = trainingManager.startStockTake({
                    type: stockTakeType,
                    location: targetLocation,
                    userId: selectedProfile?.id || 'training_user'
                });
                setActiveStockTake(stockTake);
                setStockTakeItems(items);
                if (typeof refetchStock === 'function') refetchStock();
            } catch (err) {
                console.error(err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
            return;
        }
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            // 1. Determine Storehouse Location (company-wide is not permitted for stock take)
            const targetLocation = (stockTakeLocation && stockTakeLocation !== 'All') 
                ? stockTakeLocation 
                : ((activeLocation && activeLocation !== 'All' && locationsList.includes(activeLocation)) ? activeLocation : (locationsList[0] || 'Flamstead'));

            if (!targetLocation || targetLocation === 'All') {
                throw new Error("Please select a specific storehouse location. Company-wide stock take is not permitted.");
            }

            const payload = {
                type: stockTakeType,
                status: 'IN_PROGRESS',
                started_by: user.id,
                location: targetLocation
            };

            let { data: st, error: stError } = await supabase
                .from('stock_takes')
                .insert(payload)
                .select().single();
            
            if (stError && (stError.code === '42703' || stError.message?.includes('location'))) {
                delete payload.location;
                const retry = await supabase.from('stock_takes').insert(payload).select().single();
                st = retry.data;
                stError = retry.error;
            }
            if (stError) throw stError;

            // 2. Snapshot existing stock (only for FULL stock take)
            if (stockTakeType === 'FULL') {
                const { data: allStockItems, error: fetchError } = await supabase
                    .from('stock_items')
                    .select('id, location, assigned_to')
                    .eq('assigned_to', 'Unassigned')
                    .eq('location', targetLocation);
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
        if (!activeStockTake) return;
        setIsFinaliseModalOpen(false);
        setLoading(true);
        if (isTrainingMode) {
            try {
                const auditorName = selectedProfile?.name || userProfile?.full_name || 'Trainee Auditor';
                trainingManager.finaliseStockTake(auditorName);
                setActiveStockTake(null);
                setStockTakeItems([]);
                if (typeof refetchStock === 'function') refetchStock();
                setLastScanned({
                    success: true,
                    message: "Training Stock Take completed successfully! Inventory & audit movements updated in sandbox."
                });
                setTimeout(() => setLastScanned(null), 5000);
            } catch (err) {
                console.error("Error finalising training stock take:", err);
                setError(`Error finalising training stock take: ${err.message}`);
            } finally {
                setLoading(false);
            }
            return;
        }
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            const targetLocation = activeStockTake.location || 'Flamstead';
            const completedAt = new Date().toISOString();
            const auditorName = selectedProfile?.name || userProfile?.full_name || 'Stock Auditor';

            // 1. Mark stock take as COMPLETED (permanently saving audit history)
            const { error: completeError } = await supabase
                .from('stock_takes')
                .update({ status: 'COMPLETED', completed_at: completedAt })
                .eq('id', activeStockTake.id);
            if (completeError) throw completeError;

            // 2. Fetch all recorded stock take items for this audit
            const { data: takeItems, error: itemsFetchError } = await supabase
                .from('stock_take_items')
                .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to, created_at)')
                .eq('stock_take_id', activeStockTake.id);
            if (itemsFetchError) throw itemsFetchError;

            // 3. Group by product/item type to determine target counts
            const groupedTakeItems = groupStockTakeByItemType(takeItems || []);

            // For FULL stock take, reconcile all audited item types in that location
            // For ROLLING stock take, reconcile item types that were actually scanned/audited
            const itemsToReconcile = activeStockTake.type === 'FULL'
                ? groupedTakeItems
                : groupedTakeItems.filter(g => (g.counted_quantity || 0) > 0 || g.rawItems.some(i => (i.counted_quantity || 0) > 0));

            let reconciledCount = 0;

            // 4. Update live stock counts in stock_items at targetLocation for each audited item type
            for (const group of itemsToReconcile) {
                const targetCount = Math.max(0, group.counted_quantity || 0);
                const groupLoc = (activeStockTake.location && activeStockTake.location !== 'All') 
                    ? activeStockTake.location 
                    : (group.rawItems.find(r => r.stock_items?.location)?.stock_items?.location || targetLocation);

                const rawItemIds = group.rawItems.map(r => r.item_id).filter(Boolean);

                // Fetch current live stock items for this group by recorded IDs and by Name/Location
                let dbItemsById = [];
                if (rawItemIds.length > 0) {
                    const { data: byIdData, error: byIdError } = await supabase
                        .from('stock_items')
                        .select('*')
                        .in('id', rawItemIds);
                    if (!byIdError && byIdData) {
                        dbItemsById = byIdData;
                    }
                }

                let dbItemsByName = [];
                const { data: byNameData, error: byNameError } = await supabase
                    .from('stock_items')
                    .select('*')
                    .ilike('name', group.name.trim())
                    .eq('location', groupLoc)
                    .or('assigned_to.eq.Unassigned,assigned_to.is.null,assigned_to.eq.');
                if (!byNameError && byNameData) {
                    dbItemsByName = byNameData;
                }

                // Merge and filter only currently unassigned stock items
                const itemMap = new Map();
                [...dbItemsById, ...dbItemsByName].forEach(item => {
                    if (item && item.id) {
                        const isUnassigned = !item.assigned_to || item.assigned_to === 'Unassigned' || item.assigned_to === Team.UNASSIGNED;
                        if (isUnassigned) {
                            itemMap.set(item.id, item);
                        }
                    }
                });

                const currentDbItems = Array.from(itemMap.values());
                const currentCount = currentDbItems.length;
                const diff = targetCount - currentCount;

                if (diff > 0) {
                    // Scanned more than on record: ADD diff items to stock_items
                    const meta = itemTypesMap[group.name] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === group.name) : null) || {};
                    const template = currentDbItems?.[0] || group.rawItems?.find(r => r.stock_items)?.stock_items || {};
                    const baseBarcode = meta.barcode || template.barcode || (group.uniqueBarcodes?.length === 1 ? group.uniqueBarcodes[0] : (group.barcodeDisplay !== '—' && !group.barcodeDisplay?.includes('serials') ? group.barcodeDisplay : ''));
                    const purchasePrice = parseFloat(meta.price ?? template.purchase_price ?? group.price ?? 0) || 0;
                    const desc = meta.description || template.description || null;

                    const newItems = [];
                    for (let i = 0; i < diff; i++) {
                        newItems.push({
                            name: group.name,
                            barcode: group.is_unique ? `${baseBarcode || 'SN'}-${Date.now()}-${i + 1}` : (baseBarcode || `${group.name.replace(/\s+/g, '-').toUpperCase()}-${Date.now()}-${i + 1}`),
                            purchase_price: purchasePrice,
                            description: desc,
                            location: groupLoc,
                            assigned_to: 'Unassigned',
                            user_id: user?.id || null
                        });
                    }

                    const { data: inserted, error: insertError } = await supabase
                        .from('stock_items')
                        .insert(newItems)
                        .select();

                    if (insertError) {
                        console.error(`Failed to add stock items for ${group.name}:`, insertError);
                        throw insertError;
                    }

                    if (inserted && inserted.length > 0) {
                        if (typeof setStock === 'function') {
                            setStock(prev => [...prev, ...inserted]);
                        }
                        // Log inventory movement
                        const movements = inserted.map(item => ({
                            item_id: item.id,
                            item_barcode: item.barcode,
                            item_name: group.name,
                            movement_type: 'IN',
                            location_from: 'Stock Take Reconciliation',
                            location_to: groupLoc,
                            user_id: user?.id || null,
                            username: auditorName
                        }));
                        await supabase.from('stock_movements').insert(movements);
                    }
                    reconciledCount++;
                } else if (diff < 0) {
                    // Scanned fewer than on record: WRITE OFF |diff| items from active stock
                    const toRemoveCount = Math.abs(diff);

                    // Prioritize items that were NOT counted during this stock take
                    const uncountedItemIds = new Set(
                        group.rawItems
                            .filter(r => (r.counted_quantity || 0) === 0)
                            .map(r => r.item_id)
                            .filter(Boolean)
                    );

                    const sortedCurrent = [...currentDbItems].sort((a, b) => {
                        const aUncounted = uncountedItemIds.has(a.id) ? 1 : 0;
                        const bUncounted = uncountedItemIds.has(b.id) ? 1 : 0;
                        return bUncounted - aUncounted;
                    });

                    const itemsToRemove = sortedCurrent.slice(0, toRemoveCount);
                    const idsToRemove = itemsToRemove.map(i => i.id);

                    const { error: writeOffError } = await supabase
                        .from('stock_items')
                        .update({
                            assigned_to: 'Stock Take Discrepancy (Missing)',
                            location: 'Discrepancy',
                            assigned_at: completedAt,
                            assigned_by: auditorName
                        })
                        .in('id', idsToRemove);

                    if (writeOffError) {
                        console.error(`Failed to write off missing stock for ${group.name}:`, writeOffError);
                        throw writeOffError;
                    }

                    if (typeof setStock === 'function') {
                        setStock(prev => prev.map(item => {
                            if (idsToRemove.includes(item.id)) {
                                return {
                                    ...item,
                                    assigned_to: 'Stock Take Discrepancy (Missing)',
                                    location: 'Discrepancy',
                                    assigned_at: completedAt,
                                    assigned_by: auditorName
                                };
                            }
                            return item;
                        }));
                    }

                    // Log inventory movement
                    const movements = itemsToRemove.map(item => ({
                        item_id: item.id,
                        item_barcode: item.barcode || group.barcodeDisplay || 'N/A',
                        item_name: group.name,
                        movement_type: 'OUT',
                        location_from: item.location || groupLoc,
                        location_to: 'Stock Take Discrepancy (Missing)',
                        user_id: user?.id || null,
                        username: auditorName
                    }));
                    await supabase.from('stock_movements').insert(movements);
                    reconciledCount++;
                } else {
                    // diff === 0, count already matched exactly
                    reconciledCount++;
                }
            }

            // 5. Trigger live stock refetch across the entire app so all views update immediately
            if (refetchStock) {
                await refetchStock();
            }

            const completedST = { ...activeStockTake, status: 'COMPLETED', completed_at: completedAt };
            await fetchActiveStockTake();
            
            // 6. Navigate directly to the new report in History
            await fetchHistory();
            await fetchHistoryReport(completedST);
            setActiveTab('history');

            // Feedback toast
            setLastScanned({
                success: true,
                message: `Stock take finalised! Inventory counts for ${reconciledCount} product types at ${targetLocation} have been updated to match what was scanned.`
            });
            setTimeout(() => setLastScanned(null), 5000);

        } catch(err) {
             console.error("Error finalising stock take:", err);
             setError(`Error finalising stock take: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelStockTake = async () => {
        if (!activeStockTake) return;
        setIsCancelModalOpen(false);
        setLoading(true);
        if (isTrainingMode) {
            trainingManager.cancelStockTake();
            setActiveStockTake(null);
            setStockTakeItems([]);
            setLoading(false);
            return;
        }
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
        if (isTrainingMode) {
            trainingManager.completedStockTakes = trainingManager.completedStockTakes.filter(t => t.id !== historyToDelete.id);
            trainingManager.notify();
            setHistoricalTakes(trainingManager.getCompletedStockTakes());
            if (selectedHistoryReport && selectedHistoryReport.id === historyToDelete.id) {
                setSelectedHistoryReport(null);
            }
            setHistoryLoading(false);
            return;
        }
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
        const rawBarcode = String(barcode).trim();
        const lowerScan = rawBarcode.toLowerCase();
        
        if (isTrainingMode) {
            try {
                const currentTargetLocation = activeStockTakeRef.current?.location || 'Flamstead';
                const partLookup = partNumberLookupMap[lowerScan];
                let matchedItemType = partLookup
                    ? (itemTypes.find(it => it.id === partLookup.itemTypeId || it.name === partLookup.itemTypeName) || { name: partLookup.itemTypeName, barcode: partLookup.barcode || rawBarcode })
                    : itemTypes.find(it => it.barcode && String(it.barcode).trim().toLowerCase() === lowerScan);

                if (!matchedItemType) {
                    const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan);
                    if (stockMatch) {
                        matchedItemType = { name: stockMatch.name, barcode: stockMatch.barcode, price: stockMatch.purchase_price };
                    }
                }

                if (!matchedItemType) {
                    if (logUnrecognizedBarcode) logUnrecognizedBarcode(rawBarcode);
                    setLastScanned({ success: false, message: `Barcode/Part # ${rawBarcode} not found in system.` });
                    return;
                }

                const res = trainingManager.scanStockTakeItem({
                    barcode: rawBarcode,
                    location: currentTargetLocation,
                    matchedItemType
                });

                setStockTakeItems([...trainingManager.getStockTakeItems(activeStockTakeRef.current.id)]);
                if (typeof refetchStock === 'function') refetchStock();

                setLastScanned({
                    success: true,
                    message: `Counted 1x ${res.item.stock_items?.name || matchedItemType.name} (Count: ${res.item.counted_quantity})`
                });
                setTimeout(() => setLastScanned(null), 3000);
            } catch (err) {
                console.error(err);
                setLastScanned({ success: false, message: "Scan error: " + err.message });
            } finally {
                setLoading(false);
            }
            return;
        }

        try {
            const currentTargetLocation = activeStockTakeRef.current?.location || 'Flamstead';
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            // 1. Identify product type from supplier part number, item types or stock
            const partLookup = partNumberLookupMap[lowerScan];
            let matchedItemType = partLookup
                ? (itemTypes.find(it => it.id === partLookup.itemTypeId || it.name === partLookup.itemTypeName) || { name: partLookup.itemTypeName, barcode: partLookup.barcode || rawBarcode })
                : itemTypes.find(it => it.barcode && String(it.barcode).trim().toLowerCase() === lowerScan);

            let matchedItemName = matchedItemType?.name || null;
            let baseBarcode = matchedItemType?.barcode || rawBarcode;

            // 2. If not matched yet, check stock prop or database
            if (!matchedItemName) {
                const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan);
                if (stockMatch) {
                    matchedItemName = stockMatch.name;
                    baseBarcode = stockMatch.barcode;
                }
            }

            if (!matchedItemName) {
                // Query database for part number / barcode / stock_items
                const { data: partData } = await supabase
                    .from('item_supplier_part_numbers')
                    .select('*, item_types(id, name)')
                    .or(`part_number.ilike.${rawBarcode},barcode.eq.${rawBarcode}`)
                    .limit(1);

                if (partData && partData.length > 0 && partData[0].item_types?.name) {
                    matchedItemName = partData[0].item_types.name;
                } else {
                    const { data: typeData } = await supabase
                        .from('item_types')
                        .select('*')
                        .ilike('barcode', rawBarcode)
                        .limit(1);
                    if (typeData && typeData.length > 0) {
                        matchedItemName = typeData[0].name;
                        baseBarcode = typeData[0].barcode || rawBarcode;
                    } else {
                        const { data: stockData } = await supabase
                            .from('stock_items')
                            .select('*')
                            .eq('barcode', rawBarcode)
                            .limit(1);
                        if (stockData && stockData.length > 0) {
                            matchedItemName = stockData[0].name;
                            baseBarcode = stockData[0].barcode || rawBarcode;
                        }
                    }
                }
            }

            if (!matchedItemName) {
                if (logUnrecognizedBarcode) {
                    logUnrecognizedBarcode(rawBarcode);
                }
                setLastScanned({ success: false, message: `Barcode/Part # ${rawBarcode} not found in system.` });
                return;
            }

            const meta = itemTypesMap[matchedItemName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === matchedItemName) : null) || {};
            const itemPrice = parseFloat(meta.price ?? 0) || 0;

            // 3. Find or inject stock_take_items for this item at target storehouse
            const currentStockTakeItems = stockTakeItemsRef.current;
            let takeItemsForProduct = currentStockTakeItems.filter(i => {
                const itemFallback = stockMap.get(i.item_id);
                const name = i.stock_items?.name || itemFallback?.name;
                return name === matchedItemName;
            });

            let newItemsInserted = [];

            if (takeItemsForProduct.length === 0) {
                // Fetch unassigned stock items for this product physically located at targetLocation
                const { data: dbStockAtLocation } = await supabase
                    .from('stock_items')
                    .select('*')
                    .eq('name', matchedItemName)
                    .eq('location', currentTargetLocation)
                    .eq('assigned_to', 'Unassigned');

                if (dbStockAtLocation && dbStockAtLocation.length > 0) {
                    const itemsToInsert = dbStockAtLocation.map(item => ({
                        stock_take_id: activeStockTakeRef.current.id,
                        item_id: item.id,
                        expected_quantity: 1,
                        counted_quantity: 0,
                        status: 'PENDING'
                    }));

                    const { data: insertedItems, error: insertError } = await supabase
                        .from('stock_take_items')
                        .insert(itemsToInsert)
                        .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to)');

                    if (insertError) throw insertError;
                    takeItemsForProduct = insertedItems || [];
                    newItemsInserted = insertedItems || [];
                } else {
                    // 0 items currently in stock at this location: Create a physical item in stock_items and add to count
                    const { data: newStockRow, error: stockCreateError } = await supabase
                        .from('stock_items')
                        .insert([{
                            name: matchedItemName,
                            barcode: meta.barcode || baseBarcode || rawBarcode,
                            purchase_price: itemPrice,
                            location: currentTargetLocation,
                            assigned_to: 'Unassigned',
                            user_id: user?.id || null
                        }])
                        .select()
                        .single();

                    if (stockCreateError) throw stockCreateError;

                    const itemToInsert = {
                        stock_take_id: activeStockTakeRef.current.id,
                        item_id: newStockRow.id,
                        expected_quantity: 0, // 0 expected because item was not recorded at this location
                        counted_quantity: 0,
                        status: 'PENDING'
                    };

                    const { data: insertedTakeItem, error: takeInsertError } = await supabase
                        .from('stock_take_items')
                        .insert([itemToInsert])
                        .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to)')
                        .single();

                    if (takeInsertError) throw takeInsertError;
                    takeItemsForProduct = [insertedTakeItem];
                    newItemsInserted = [insertedTakeItem];
                }
            }

            if (newItemsInserted.length > 0) {
                setStockTakeItems(prev => [...prev, ...newItemsInserted]);
            }

            // 4. Find which physical takeItem to increment
            let takeItemToUpdate = takeItemsForProduct.find(i => (i.counted_quantity || 0) === 0);
            if (!takeItemToUpdate) {
                takeItemToUpdate = takeItemsForProduct[0];
            }

            if (scanModeRef.current === 'QUANTITY') {
                setQuantityItem(takeItemToUpdate);
                setQuantityInput('1');
                setIsQuantityModalOpen(true);
                return;
            }

            // 5. RAPID Mode: Increment counted_quantity
            const newQuantity = (takeItemToUpdate.counted_quantity || 0) + 1;
            
            const { error: updateError } = await supabase
                .from('stock_take_items')
                .update({ counted_quantity: newQuantity, status: 'COUNTED' })
                .eq('id', takeItemToUpdate.id);
                
            if (updateError) throw updateError;
            
            // Update local state reliably using functional updater
            setStockTakeItems(prev => {
                const baseList = newItemsInserted.length > 0 ? [...prev] : prev;
                return baseList.map(i => 
                    i.id === takeItemToUpdate.id 
                        ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' } 
                        : i
                );
            });
            
            setLastScanned({ 
                success: true, 
                message: `Scanned ${matchedItemName} (+1 Counted)` 
            });
            
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
        if (isTrainingMode) {
            const newQuantity = (quantityItem.counted_quantity || 0) + addedQty;
            setStockTakeItems(prev => prev.map(i => 
                i.id === quantityItem.id
                    ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' }
                    : i
            ));
            const stockFallback = stockMap.get(quantityItem.item_id);
            const itemName = quantityItem.stock_items?.name || stockFallback?.name || 'item';
            setLastScanned({ 
                success: true, 
                message: `Added +${addedQty} to ${itemName}` 
            });
            setTimeout(() => {
                setLastScanned(null);
            }, 3000);
            setIsQuantityModalOpen(false);
            setQuantityItem(null);
            setLoading(false);
            return;
        }
        try {
            const newQuantity = (quantityItem.counted_quantity || 0) + addedQty;
            
            const { error: updateError } = await supabase
                .from('stock_take_items')
                .update({ counted_quantity: newQuantity, status: 'COUNTED' })
                .eq('id', quantityItem.id);
                
            if (updateError) throw updateError;
            
            // Update local state using functional updater
            setStockTakeItems(prev => prev.map(i => 
                i.id === quantityItem.id
                    ? { ...i, counted_quantity: newQuantity, status: 'COUNTED' }
                    : i
            ));
            
            const stockFallback = stockMap.get(quantityItem.item_id);
            const itemName = quantityItem.stock_items?.name || stockFallback?.name || 'item';
            
            setLastScanned({ 
                success: true, 
                message: `Added +${addedQty} to ${itemName}` 
            });
            
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

    // Range Count Calculation Memo
    const rangeCountProcessingResult = useMemo(() => {
        const { firstSerial, lastSerial } = rangeCountDetails;
        const start = firstSerial?.trim();
        const end = lastSerial?.trim();

        if (!start || !end) return { serials: [], error: null };

        const expansion = expandRange(start, end);
        if (expansion.error) {
            return { serials: [], error: expansion.error };
        }

        const expanded = expansion.result;
        if (expanded.length > 1000) {
            return { serials: [], error: `Range is too large. A maximum of 1000 items can be counted at once, but this range contains ${expanded.length}.` };
        }

        return { serials: expanded, error: null };
    }, [rangeCountDetails.firstSerial, rangeCountDetails.lastSerial]);

    // Handle Range Count Submission
    const handleRangeCountSubmit = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        setRangeCountError('');

        const { serials, error: expError } = rangeCountProcessingResult;
        if (expError) {
            setRangeCountError(expError);
            return;
        }
        if (!serials || serials.length === 0) {
            setRangeCountError("Please provide a valid first and last serial number.");
            return;
        }

        if (!activeStockTakeRef.current) {
            setRangeCountError("No active stock take in progress.");
            return;
        }

        setRangeCountSubmitting(true);
        if (isTrainingMode) {
            try {
                const currentTargetLocation = activeStockTakeRef.current?.location || 'Flamstead';
                let targetTypeName = rangeCountDetails.selectedItemType;
                if (!targetTypeName) {
                    const firstLower = serials[0].toLowerCase();
                    const partLookup = partNumberLookupMap[firstLower];
                    if (partLookup) {
                        targetTypeName = partLookup.itemTypeName;
                    } else {
                        const matchedType = itemTypes.find(it => it.barcode && String(it.barcode).trim().toLowerCase() === firstLower);
                        if (matchedType) targetTypeName = matchedType.name;
                        else {
                            const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === firstLower);
                            if (stockMatch) targetTypeName = stockMatch.name;
                        }
                    }
                }
                if (!targetTypeName) {
                    const meterType = itemTypes.find(it => (it.category && it.category.toLowerCase().includes('meter')) || it.is_unique || (it.name && it.name.toLowerCase().includes('meter')));
                    if (meterType) targetTypeName = meterType.name;
                }
                if (!targetTypeName) {
                    setRangeCountError("Please select the product type for this serial number range.");
                    setRangeCountSubmitting(false);
                    return;
                }

                const meta = itemTypesMap[targetTypeName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === targetTypeName) : null) || { name: targetTypeName };

                const res = trainingManager.rangeCountStockTake({
                    itemType: meta,
                    firstSerial: rangeCountDetails.firstSerial.trim(),
                    lastSerial: rangeCountDetails.lastSerial.trim(),
                    location: currentTargetLocation
                });

                setStockTakeItems([...trainingManager.getStockTakeItems(activeStockTakeRef.current.id)]);
                if (typeof refetchStock === 'function') refetchStock();

                setLastScanned({
                    success: true,
                    message: `Counted range of ${res.count} items (${serials[0]} - ${serials[serials.length - 1]}) for ${targetTypeName}`
                });
                setTimeout(() => setLastScanned(null), 4000);

                setIsRangeCountModalOpen(false);
                setRangeCountDetails({ firstSerial: '', lastSerial: '', selectedItemType: '' });
            } catch (rangeErr) {
                console.error(rangeErr);
                setRangeCountError(rangeErr.message);
            } finally {
                setRangeCountSubmitting(false);
            }
            return;
        }

        try {
            const currentTargetLocation = activeStockTakeRef.current?.location || 'Flamstead';
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;

            // Determine item type for this range
            let targetTypeName = rangeCountDetails.selectedItemType;
            
            // If not selected, try to infer from first serial
            if (!targetTypeName) {
                const firstLower = serials[0].toLowerCase();
                const partLookup = partNumberLookupMap[firstLower];
                if (partLookup) {
                    targetTypeName = partLookup.itemTypeName;
                } else {
                    const matchedType = itemTypes.find(it => it.barcode && String(it.barcode).trim().toLowerCase() === firstLower);
                    if (matchedType) {
                        targetTypeName = matchedType.name;
                    } else {
                        const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === firstLower);
                        if (stockMatch) {
                            targetTypeName = stockMatch.name;
                        }
                    }
                }
            }

            // Fallback: check if any serialized meter item type exists
            if (!targetTypeName) {
                const meterType = itemTypes.find(it => 
                    (it.category && it.category.toLowerCase().includes('meter')) || 
                    it.is_unique || 
                    (it.name && it.name.toLowerCase().includes('meter'))
                );
                if (meterType) {
                    targetTypeName = meterType.name;
                }
            }

            if (!targetTypeName) {
                setRangeCountError("Please select the product type for this serial number range.");
                setRangeCountSubmitting(false);
                return;
            }

            const meta = itemTypesMap[targetTypeName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === targetTypeName) : null) || {};
            const itemPrice = parseFloat(meta.price ?? 0) || 0;

            // Look up existing stock items in database matching these serials
            const { data: dbMatchedStock, error: dbStockError } = await supabase
                .from('stock_items')
                .select('*')
                .in('barcode', serials);

            if (dbStockError) throw dbStockError;

            const existingByBarcode = new Map();
            (dbMatchedStock || []).forEach(item => {
                if (item.barcode) existingByBarcode.set(item.barcode, item);
            });

            // For each serial in the range, find or create the physical stock_item
            const resolvedStockItems = [];
            const newStockItemsToCreate = [];
            const newlyCreatedBarcodes = new Set();

            for (const serial of serials) {
                const existing = existingByBarcode.get(serial);
                if (existing) {
                    resolvedStockItems.push(existing);
                } else {
                    newlyCreatedBarcodes.add(serial);
                    newStockItemsToCreate.push({
                        name: targetTypeName,
                        barcode: serial,
                        purchase_price: itemPrice,
                        description: meta.description || null,
                        location: currentTargetLocation,
                        assigned_to: 'Unassigned',
                        user_id: user?.id || null
                    });
                }
            }

            // Insert new stock items in batch if any were missing from stock_items
            const newlyCreatedIds = new Set();
            if (newStockItemsToCreate.length > 0) {
                const { data: createdItems, error: createError } = await supabase
                    .from('stock_items')
                    .insert(newStockItemsToCreate)
                    .select();

                if (createError) throw createError;
                if (createdItems) {
                    createdItems.forEach(ci => newlyCreatedIds.add(ci.id));
                    resolvedStockItems.push(...createdItems);
                    if (typeof setStock === 'function') {
                        setStock(prev => [...prev, ...createdItems]);
                    }
                }
            }

            // Fetch or match stock_take_items for these stock item IDs
            const stockItemIds = resolvedStockItems.map(i => i.id);
            const currentStockTakeItems = stockTakeItemsRef.current;
            const existingTakeItemsMap = new Map();
            currentStockTakeItems.forEach(sti => {
                if (sti.item_id) existingTakeItemsMap.set(sti.item_id, sti);
            });

            const takeItemsToInsert = [];
            const takeItemIdsToUpdate = [];
            const takeCreatedAt = activeStockTakeRef.current?.created_at ? new Date(activeStockTakeRef.current.created_at).getTime() : 0;

            for (const sItem of resolvedStockItems) {
                const existingTakeItem = existingTakeItemsMap.get(sItem.id);
                if (existingTakeItem) {
                    takeItemIdsToUpdate.push(existingTakeItem.id);
                } else {
                    const isNewlyCreated = newlyCreatedIds.has(sItem.id) || newlyCreatedBarcodes.has(sItem.barcode);
                    const itemCreatedAt = sItem.created_at ? new Date(sItem.created_at).getTime() : 0;
                    const wasCreatedDuringTake = itemCreatedAt > 0 && takeCreatedAt > 0 && itemCreatedAt >= (takeCreatedAt - 3000);

                    // If item was not already in the storehouse inventory when stock take started, expected_quantity is 0
                    const wasInStockBefore = !isNewlyCreated && !wasCreatedDuringTake && 
                        sItem.location === currentTargetLocation && 
                        (!sItem.assigned_to || sItem.assigned_to === 'Unassigned');

                    takeItemsToInsert.push({
                        stock_take_id: activeStockTakeRef.current.id,
                        item_id: sItem.id,
                        expected_quantity: wasInStockBefore ? 1 : 0,
                        counted_quantity: 1,
                        status: 'COUNTED'
                    });
                }
            }

            // Insert new stock_take_items
            let insertedTakeItems = [];
            if (takeItemsToInsert.length > 0) {
                const { data: inserted, error: takeInsertError } = await supabase
                    .from('stock_take_items')
                    .insert(takeItemsToInsert)
                    .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to, created_at)');

                if (takeInsertError) throw takeInsertError;
                insertedTakeItems = inserted || [];
            }

            // Update existing stock_take_items to counted_quantity = 1, status = 'COUNTED'
            if (takeItemIdsToUpdate.length > 0) {
                const { error: takeUpdateError } = await supabase
                    .from('stock_take_items')
                    .update({ counted_quantity: 1, status: 'COUNTED' })
                    .in('id', takeItemIdsToUpdate);

                if (takeUpdateError) throw takeUpdateError;
            }

            // Update local stockTakeItems state
            const updatedIdsSet = new Set(takeItemIdsToUpdate);
            setStockTakeItems(prev => {
                const updatedList = prev.map(item => {
                    if (updatedIdsSet.has(item.id)) {
                        return { ...item, counted_quantity: 1, status: 'COUNTED' };
                    }
                    return item;
                });
                return [...updatedList, ...insertedTakeItems];
            });

            setLastScanned({
                success: true,
                message: `Successfully counted serial range (${serials.length} units of ${targetTypeName})`
            });
            setTimeout(() => setLastScanned(null), 5000);

            setIsRangeCountModalOpen(false);
            setRangeCountDetails({ firstSerial: '', lastSerial: '', selectedItemType: '' });

        } catch (err) {
            console.error("Error in handleRangeCountSubmit:", err);
            setRangeCountError(`Failed to process range count: ${err.message}`);
        } finally {
            setRangeCountSubmitting(false);
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
                                <div>
                                    <h2 className="text-xl font-bold text-left">Active {activeStockTake.type} Stock Take</h2>
                                    <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500 text-left">
                                        <span className="inline-flex items-center gap-1 font-medium bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-0.5 rounded-full text-xs">
                                            📍 Scope: {activeStockTake.location || "All Locations (Company-Wide)"}
                                        </span>
                                    </div>
                                </div>
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
                                    <button
                                        onClick={() => {
                                            setRangeCountError('');
                                            setRangeCountDetails({ firstSerial: '', lastSerial: '', selectedItemType: '' });
                                            setIsRangeCountModalOpen(true);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 flex items-center gap-1 border-l border-zinc-200 dark:border-zinc-700 ml-1 pl-2"
                                        title="Count a continuous serial number range (e.g. boxed meters)"
                                    >
                                        <BarcodeIcon className="w-3.5 h-3.5" />
                                        <span>Range Count</span>
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
                                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                                    <h3 className="text-lg font-bold">Progress Summary</h3>
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800 font-semibold flex items-center gap-1">
                                            <BuildingStoreIcon className="w-3.5 h-3.5" />
                                            Scope: {activeStockTake.location || 'All Locations (Company-Wide)'}
                                        </span>
                                        <span className="text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700/60 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700">
                                            Entire Company Inventory: <strong>{stock?.length || 0}</strong> items
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                            {activeStockTake.location && activeStockTake.location !== 'All' ? `Expected at ${activeStockTake.location}` : 'Total Items Expected'}
                                        </p>
                                        <p className="text-2xl font-bold">
                                            {stockTakeItems.reduce((acc, i) => acc + (i.expected_quantity ?? 1), 0)}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Items Counted</p>
                                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                            {stockTakeItems.reduce((acc, i) => acc + (i.counted_quantity || 0), 0)}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Variance</p>
                                        {(() => {
                                            const totalExp = stockTakeItems.reduce((acc, i) => acc + (i.expected_quantity ?? 1), 0);
                                            const totalCnt = stockTakeItems.reduce((acc, i) => acc + (i.counted_quantity || 0), 0);
                                            const diff = totalCnt - totalExp;
                                            return (
                                                <p className={`text-2xl font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-zinc-800 dark:text-zinc-100'}`}>
                                                    {diff > 0 ? `+${diff}` : diff} units
                                                </p>
                                            );
                                        })()}
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Counted Value</p>
                                        <p className="text-2xl font-bold">
                                            £{stockTakeItems.reduce((acc, i) => acc + ((i.counted_quantity || 0) * (parseFloat(i.stock_items?.purchase_price) || 0)), 0).toFixed(2)}
                                        </p>
                                        <p className="text-xs text-zinc-400 mt-0.5">
                                            Expected: £{stockTakeItems.reduce((acc, i) => acc + ((i.expected_quantity ?? 1) * (parseFloat(i.stock_items?.purchase_price) || 0)), 0).toFixed(2)}
                                        </p>
                                    </div>
                                </div>

                                {/* Live Count Breakdown Table */}
                                <div className="mt-8">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Live Count Breakdown</h3>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                Grouped by product type &bull; Click any item to view recorded scans
                                            </p>
                                        </div>
                                        {activeGroupedItems.length > 0 && (
                                            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                                {activeAvailableCategories.length > 2 && (
                                                    <select
                                                        value={activeCategoryFilter}
                                                        onChange={(e) => setActiveCategoryFilter(e.target.value)}
                                                        className={formInputStyle + " text-xs py-1.5 w-auto"}
                                                    >
                                                        {activeAvailableCategories.map(cat => (
                                                            <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                <div className="w-full sm:w-56">
                                                    <input 
                                                        type="text" 
                                                        placeholder="Search items or barcodes..." 
                                                        value={activeSearchTerm}
                                                        onChange={(e) => setActiveSearchTerm(e.target.value)}
                                                        className={formInputStyle + " text-xs py-1.5"}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={toggleAllActiveGroups}
                                                    className="text-xs font-semibold px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded transition-colors whitespace-nowrap"
                                                >
                                                    {filteredActiveGroups.length > 0 && filteredActiveGroups.every(g => expandedActiveTypes[g.name]) ? 'Collapse All' : 'Expand All'}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {activeGroupedItems.length === 0 ? (
                                        <div className="text-center py-10 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
                                            <ClipboardCheckIcon className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                                            <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">No items counted yet.</p>
                                            <p className="text-xs text-zinc-400 mt-1">Scan any item's barcode to add and count it in this {activeStockTake.type.toLowerCase()} stock take.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg">
                                            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                                <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                                    <tr>
                                                        <th className="w-8 px-3 py-3"></th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Item Type</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Barcode / Serials</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Price</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Expected</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Counted</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Variance</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Value Var</th>
                                                        <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white dark:bg-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-700">
                                                    {filteredActiveGroups.map(group => {
                                                        const hasDiscrepancy = group.variance !== 0;
                                                        const isExpanded = !!expandedActiveTypes[group.name];

                                                        return (
                                                            <React.Fragment key={group.key}>
                                                                <tr 
                                                                    onClick={() => toggleActiveGroup(group.name)}
                                                                    className={`cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700/40 ${hasDiscrepancy ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}
                                                                >
                                                                    <td className="px-3 py-3 text-center text-zinc-400">
                                                                        <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'transform rotate-180' : '-rotate-90'}`} />
                                                                    </td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                                        <div className="flex items-center gap-2">
                                                                            <span>{group.name}</span>
                                                                            {group.category && group.category !== 'General' && (
                                                                                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                                                                    {group.category}
                                                                                </span>
                                                                            )}
                                                                            {group.is_unique && (
                                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                                    Unique
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-zinc-500">
                                                                        {group.barcodeDisplay}
                                                                    </td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">£{group.price.toFixed(2)}</td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-zinc-600 dark:text-zinc-400">{group.expected_quantity}</td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">{group.counted_quantity}</td>
                                                                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (group.variance > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                                        {group.variance > 0 ? `+${group.variance}` : group.variance}
                                                                    </td>
                                                                    <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (group.value_variance > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                                        {group.value_variance > 0 ? '+' : ''}{group.value_variance < 0 ? '-' : ''}£{Math.abs(group.value_variance).toFixed(2)}
                                                                    </td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right" onClick={(e) => e.stopPropagation()}>
                                                                        <div className="flex items-center justify-end gap-1.5">
                                                                            {(group.is_unique || (group.category && group.category.toLowerCase().includes('meter')) || group.name.toLowerCase().includes('meter')) && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        setRangeCountError('');
                                                                                        const firstSerial = group.rawItems?.find(r => r.stock_items?.barcode)?.stock_items?.barcode || '';
                                                                                        setRangeCountDetails({
                                                                                            firstSerial: firstSerial,
                                                                                            lastSerial: firstSerial,
                                                                                            selectedItemType: group.name
                                                                                        });
                                                                                        setIsRangeCountModalOpen(true);
                                                                                    }}
                                                                                    className="text-xs font-semibold px-2.5 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-100 dark:hover:bg-purple-800 transition-colors flex items-center gap-1"
                                                                                    title="Count a range of serial numbers for this product"
                                                                                >
                                                                                    <BarcodeIcon className="w-3 h-3" />
                                                                                    <span>Range</span>
                                                                                </button>
                                                                            )}
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    setQuantityItem(group.rawItems[0]);
                                                                                    setQuantityInput('1');
                                                                                    setIsQuantityModalOpen(true);
                                                                                }}
                                                                                className="text-xs font-semibold px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
                                                                            >
                                                                                + Add Qty
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                {isExpanded && (
                                                                    <tr className="bg-zinc-50/70 dark:bg-zinc-900/40">
                                                                        <td colSpan="9" className="px-6 py-3">
                                                                            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-800/80 shadow-xs">
                                                                                <div className="px-3.5 py-2 bg-zinc-100/80 dark:bg-zinc-700/60 text-xs font-semibold text-zinc-600 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                                                                    <span>Recorded Scans / Serial Numbers ({group.rawItems.length})</span>
                                                                                    <span>Expected vs Counted</span>
                                                                                </div>
                                                                                <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700 text-xs">
                                                                                    {group.rawItems.map((raw, idx) => {
                                                                                        const isCounted = (raw.counted_quantity || 0) > 0;
                                                                                        return (
                                                                                            <div key={raw.id || idx} className="px-3.5 py-2 flex items-center justify-between font-mono">
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <span className="text-zinc-400 text-[11px] font-sans">#{idx + 1}</span>
                                                                                                    <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                                                                                                        {raw.stock_items?.barcode || 'No Barcode'}
                                                                                                    </span>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-3">
                                                                                                    <span className="text-zinc-500 font-sans text-xs">
                                                                                                        Counted: <strong>{raw.counted_quantity || 0}</strong> / Expected: {raw.expected_quantity ?? 1}
                                                                                                    </span>
                                                                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${isCounted ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                                                                                        {isCounted ? 'Counted' : 'Missing'}
                                                                                                    </span>
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                    {filteredActiveGroups.length === 0 && (
                                                        <tr>
                                                            <td colSpan="9" className="px-4 py-8 text-center text-sm text-zinc-500">
                                                                {activeSearchTerm ? "No item types match your search." : "No items counted yet."}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
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
                            <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h2 className="text-xl font-bold">Stock Take Report</h2>
                                        <span className="inline-flex items-center gap-1 font-semibold text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
                                            📍 Scope: {selectedHistoryReport.location || 'All Locations (Company-Wide)'}
                                        </span>
                                    </div>
                                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                                        Completed on {new Date(selectedHistoryReport.completed_at).toLocaleString()}
                                        {selectedProfile?.name && (
                                            <span className="ml-2 font-medium text-zinc-700 dark:text-zinc-300">
                                                &bull; Auditor: {selectedProfile.name}
                                            </span>
                                        )}
                                    </p>
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
                                            / {selectedHistoryItems.reduce((acc, curr) => acc + (curr.expected_quantity ?? 1), 0)}
                                        </span>
                                    </p>
                                </div>
                                <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Variance</p>
                                    <p className="text-xl font-bold">
                                        {(() => {
                                            const v = selectedHistoryItems.reduce((acc, item) => {
                                                return acc + ((item.counted_quantity || 0) - (item.expected_quantity ?? 1));
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
                                                const diff = (item.counted_quantity || 0) - (item.expected_quantity ?? 1);
                                                const price = parseFloat(item.stock_items?.purchase_price) || 0;
                                                return acc + (diff * price);
                                            }, 0);
                                            return <span className={v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : ''}>{v < 0 ? '-' : v > 0 ? '+' : ''}£{Math.abs(v).toFixed(2)}</span>;
                                        })()}
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Summary by Item Type</h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Grouped by product type &bull; Discrepancies highlighted &bull; Click any item to expand scans
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                    {historyAvailableCategories.length > 2 && (
                                        <select
                                            value={historyCategoryFilter}
                                            onChange={(e) => setHistoryCategoryFilter(e.target.value)}
                                            className={formInputStyle + " text-xs py-1.5 w-auto"}
                                        >
                                            {historyAvailableCategories.map(cat => (
                                                <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
                                            ))}
                                        </select>
                                    )}
                                    <div className="w-full sm:w-56">
                                        <input 
                                            type="text" 
                                            placeholder="Search items or barcodes..." 
                                            value={historySearchTerm}
                                            onChange={(e) => setHistorySearchTerm(e.target.value)}
                                            className={formInputStyle + " text-xs py-1.5"}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={toggleAllHistoryGroups}
                                        className="text-xs font-semibold px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded transition-colors whitespace-nowrap"
                                    >
                                        {filteredHistoryGroups.length > 0 && filteredHistoryGroups.every(g => expandedHistoryTypes[g.name]) ? 'Collapse All' : 'Expand All'}
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg">
                                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                    <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                                        <tr>
                                            <th className="w-8 px-3 py-3"></th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Item Type</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Barcode / Serials</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Price</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Expected</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Counted</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Variance</th>
                                            <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Value Var</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-700">
                                        {filteredHistoryGroups.sort((a, b) => {
                                            const vA = Math.abs(a.value_variance);
                                            const vB = Math.abs(b.value_variance);
                                            if (vB !== vA) return vB - vA;
                                            const uA = Math.abs(a.variance);
                                            const uB = Math.abs(b.variance);
                                            if (uB !== uA) return uB - uA;
                                            return a.name.localeCompare(b.name);
                                        }).map(item => {
                                            const hasDiscrepancy = item.variance !== 0;
                                            const isExpanded = !!expandedHistoryTypes[item.name];

                                            return (
                                                <React.Fragment key={item.key}>
                                                    <tr 
                                                        onClick={() => toggleHistoryGroup(item.name)} 
                                                        className={`cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700/40 ${hasDiscrepancy ? 'bg-amber-50/30 dark:bg-amber-900/10' : ''}`}
                                                    >
                                                        <td className="px-3 py-3 text-center text-zinc-400">
                                                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'transform rotate-180' : '-rotate-90'}`} />
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            <div className="flex items-center gap-2">
                                                                <span>{item.name}</span>
                                                                {item.category && item.category !== 'General' && (
                                                                    <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                                                        {item.category}
                                                                    </span>
                                                                )}
                                                                {item.is_unique && (
                                                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                        Unique
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-zinc-500">
                                                            {item.barcodeDisplay}
                                                        </td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">£{item.price.toFixed(2)}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-zinc-600 dark:text-zinc-400">{item.expected_quantity}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">{item.counted_quantity}</td>
                                                        <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (item.variance > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                            {item.variance > 0 ? `+${item.variance}` : item.variance}
                                                        </td>
                                                        <td className={`px-4 py-3 whitespace-nowrap text-sm font-bold ${hasDiscrepancy ? (item.value_variance > 0 ? 'text-green-600' : 'text-red-600') : 'text-zinc-500'}`}>
                                                            {item.value_variance > 0 ? '+' : ''}{item.value_variance < 0 ? '-' : ''}£{Math.abs(item.value_variance).toFixed(2)}
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="bg-zinc-50/70 dark:bg-zinc-900/40">
                                                            <td colSpan="8" className="px-6 py-3">
                                                                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-800/80 shadow-xs">
                                                                    <div className="px-3.5 py-2 bg-zinc-100/80 dark:bg-zinc-700/60 text-xs font-semibold text-zinc-600 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                                                        <span>Recorded Scans / Serial Numbers ({item.rawItems.length})</span>
                                                                        <span>Expected vs Counted</span>
                                                                    </div>
                                                                    <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700 text-xs">
                                                                        {item.rawItems.map((raw, idx) => {
                                                                            const isCounted = (raw.counted_quantity || 0) > 0;
                                                                            return (
                                                                                <div key={raw.id || idx} className="px-3.5 py-2 flex items-center justify-between font-mono">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-zinc-400 text-[11px] font-sans">#{idx + 1}</span>
                                                                                        <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                                                                                            {raw.stock_items?.barcode || 'No Barcode'}
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-3">
                                                                                        <span className="text-zinc-500 font-sans text-xs">
                                                                                            Counted: <strong>{raw.counted_quantity || 0}</strong> / Expected: {raw.expected_quantity ?? 1}
                                                                                        </span>
                                                                                        <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${isCounted ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                                                                            {isCounted ? 'Counted' : 'Missing'}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                        {filteredHistoryGroups.length === 0 && (
                                            <tr>
                                                <td colSpan="8" className="px-4 py-8 text-center text-sm text-zinc-500">
                                                    {historySearchTerm ? "No item types match your search." : "No items were recorded in this stock take."}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-zinc-200 dark:border-zinc-700">
                                <div>
                                    <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">Past Stock Take Audits</h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Review variance reports across company storehouses</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label htmlFor="history-loc-filter" className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Filter Location:</label>
                                    <select
                                        id="history-loc-filter"
                                        value={historyLocationFilter}
                                        onChange={(e) => setHistoryLocationFilter(e.target.value)}
                                        className={formInputStyle + " text-xs py-1.5"}
                                    >
                                        <option value="All">All Locations</option>
                                        {locationsList.map(loc => (
                                            <option key={loc} value={loc}>{loc}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {(() => {
                                const filteredHistory = historicalTakes.filter(take => {
                                    if (historyLocationFilter === 'All') return true;
                                    return take.location === historyLocationFilter;
                                });

                                if (filteredHistory.length === 0) {
                                    return (
                                        <div className="text-center py-16">
                                            <ClipboardCheckIcon className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
                                            <p className="text-zinc-500 font-medium">
                                                {historyLocationFilter === 'All' ? 'No historical stock takes found.' : `No completed stock takes found for ${historyLocationFilter}.`}
                                            </p>
                                            <p className="text-sm text-zinc-400 mt-1">Completed reports will appear here automatically.</p>
                                        </div>
                                    );
                                }

                                return (
                                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                        {filteredHistory.map(take => (
                                            <li key={take.id} className="py-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-700/30 px-4 -mx-4 rounded-lg transition-colors">
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{take.type} Stock Take</p>
                                                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                                            📍 {take.location || 'All Locations (Company-Wide)'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-zinc-500 mt-0.5">Completed: {new Date(take.completed_at).toLocaleString()}</p>
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
                                );
                            })()}
                        </div>
                    )}
                </div>
            )}

            <Modal isOpen={isInitiateModalOpen} onClose={() => setIsInitiateModalOpen(false)} title="Initiate Stock Take">
                <div className="space-y-4 py-4">
                    <div>
                        <label htmlFor="st-location-scope" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Storehouse / Location Scope
                        </label>
                        <select
                            id="st-location-scope"
                            value={stockTakeLocation}
                            onChange={(e) => setStockTakeLocation(e.target.value)}
                            className={formInputStyle + " py-2.5"}
                            required
                        >
                            {locationsList.map(loc => (
                                <option key={loc} value={loc}>{loc}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Audits only inventory physically stored in {stockTakeLocation || locationsList[0] || 'the selected storehouse'}.
                        </p>
                    </div>

                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        Stock Take Type
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

            <Modal isOpen={isFinaliseModalOpen} onClose={() => setIsFinaliseModalOpen(false)} title="Finalise Stock Take & Update Stock">
                <div className="space-y-4 py-4">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        Are you sure you want to finalise this stock take for <strong>{activeStockTake?.location || 'this location'}</strong>?
                    </p>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-xs text-blue-800 dark:text-blue-200">
                        <strong>Stock Count Reconciliation:</strong> Finalising will archive the permanent variance audit in History and automatically reconcile the live in-stock counts at <strong>{activeStockTake?.location}</strong> for all audited item types to match what was scanned.
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setIsFinaliseModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md font-medium text-sm">
                            Keep Counting
                        </button>
                        <button onClick={handleFinalise} className="px-4 py-2 bg-green-600 text-white rounded-md font-medium text-sm hover:bg-green-700">
                            Confirm & Update Stock
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
                            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-xs">
                                <div>
                                    <span className="text-zinc-500 dark:text-zinc-400">Expected: </span>
                                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                                        {stockTakeItems
                                            .filter(i => (i.stock_items?.barcode || '') === (quantityItem.stock_items?.barcode || ''))
                                            .reduce((acc, i) => acc + (i.expected_quantity ?? 1), 0)}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-zinc-500 dark:text-zinc-400">Current Total Count: </span>
                                    <span className="font-bold text-blue-600 dark:text-blue-400">
                                        {stockTakeItems
                                            .filter(i => (i.stock_items?.barcode || '') === (quantityItem.stock_items?.barcode || ''))
                                            .reduce((acc, i) => acc + (i.counted_quantity || 0), 0)}
                                    </span>
                                </div>
                            </div>
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

            {/* Serial Number Range Count Modal */}
            <Modal 
                isOpen={isRangeCountModalOpen} 
                onClose={() => { 
                    setIsRangeCountModalOpen(false); 
                    setRangeCountError(''); 
                }} 
                title="Count Serial Number Range"
            >
                <form onSubmit={handleRangeCountSubmit} className="space-y-4">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Quickly count an entire boxed set of serialized meters by entering the first and last serial number.
                    </p>

                    <div>
                        <label htmlFor="range-item-type" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Product Type
                        </label>
                        <select
                            id="range-item-type"
                            value={rangeCountDetails.selectedItemType}
                            onChange={(e) => setRangeCountDetails(prev => ({ ...prev, selectedItemType: e.target.value }))}
                            className={formInputStyle}
                        >
                            <option value="">-- Auto-detect from serial / Select product --</option>
                            {itemTypes.map(it => (
                                <option key={it.id || it.name} value={it.name}>
                                    {it.name} {it.category ? `(${it.category})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="range-first-serial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                First Serial Number
                            </label>
                            <input
                                type="text"
                                id="range-first-serial"
                                value={rangeCountDetails.firstSerial}
                                onChange={(e) => setRangeCountDetails(prev => ({ ...prev, firstSerial: e.target.value }))}
                                placeholder="e.g. MTR-2024-001"
                                className={`${formInputStyle} font-mono`}
                                required
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="range-last-serial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Last Serial Number
                            </label>
                            <input
                                type="text"
                                id="range-last-serial"
                                value={rangeCountDetails.lastSerial}
                                onChange={(e) => setRangeCountDetails(prev => ({ ...prev, lastSerial: e.target.value }))}
                                placeholder="e.g. MTR-2024-050"
                                className={`${formInputStyle} font-mono`}
                                required
                            />
                        </div>
                    </div>

                    {/* Preview or Error Box */}
                    {rangeCountError ? (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-md text-xs border border-red-200 dark:border-red-800">
                            {rangeCountError}
                        </div>
                    ) : rangeCountProcessingResult.error ? (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-md text-xs border border-red-200 dark:border-red-800">
                            {rangeCountProcessingResult.error}
                        </div>
                    ) : rangeCountProcessingResult.serials.length > 0 ? (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-xs text-blue-800 dark:text-blue-200">
                            <p className="font-semibold">
                                ✓ Valid Range: {rangeCountProcessingResult.serials.length} serial numbers will be counted
                            </p>
                            <p className="mt-1 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 truncate">
                                Range: {rangeCountProcessingResult.serials[0]} &rarr; {rangeCountProcessingResult.serials[rangeCountProcessingResult.serials.length - 1]}
                            </p>
                        </div>
                    ) : null}

                    <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                        <button
                            type="button"
                            onClick={() => {
                                setIsRangeCountModalOpen(false);
                                setRangeCountError('');
                            }}
                            className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={rangeCountSubmitting || !!rangeCountProcessingResult.error || rangeCountProcessingResult.serials.length === 0}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[140px]"
                        >
                            {rangeCountSubmitting ? <Spinner className="w-4 h-4 mr-2" /> : null}
                            {rangeCountSubmitting ? 'Counting...' : `Count ${rangeCountProcessingResult.serials.length || 0} Units`}
                        </button>
                    </div>
                </form>
            </Modal>
        </Page>
    );
};

export default StockTakePage;
