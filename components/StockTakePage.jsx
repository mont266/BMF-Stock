import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Page, Spinner, EmptyState, formInputStyle } from './StockManagerApp';
import Modal from './Modal';
import { PlusCircleIcon, ClipboardCheckIcon, ArchiveIcon, ChartBarIcon, TrashIcon, BuildingStoreIcon, ChevronDownIcon, TagIcon, BarcodeIcon, SearchIcon, CheckCircleIcon, BoxIcon, AlertTriangleIcon } from './Icons';
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

const calculateEndSerial = (start, count) => {
    if (!start) return '';
    const numCount = parseInt(count, 10);
    if (isNaN(numCount) || numCount < 1) return '';
    const parts = parseSerial(start.trim());
    if (!parts) return '';
    const startNum = parseInt(parts.numStr, 10);
    const endNum = startNum + numCount - 1;
    if (endNum < startNum) return '';
    const padLen = Math.max(parts.numStr.length, String(endNum).length);
    const paddedEndNum = String(endNum).padStart(parts.numStr.length, '0');
    return `${parts.prefix}${paddedEndNum}${parts.suffix}`;
};

const calculateRangeQuantity = (start, end) => {
    if (!start || !end) return '';
    const sParts = parseSerial(start.trim());
    const eParts = parseSerial(end.trim());
    if (!sParts || !eParts) return '';
    if (sParts.prefix !== eParts.prefix || sParts.suffix !== eParts.suffix) return '';
    const sNum = parseInt(sParts.numStr, 10);
    const eNum = parseInt(eParts.numStr, 10);
    if (isNaN(sNum) || isNaN(eNum) || eNum < sNum) return '';
    return String(eNum - sNum + 1);
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

    const [stockTakeLocation, setStockTakeLocation] = useState('');
    const [historyLocationFilter, setHistoryLocationFilter] = useState('All');
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('active');
    const [activeStockTake, setActiveStockTake] = useState(null);
    const [stockTakeItems, setStockTakeItems] = useState([]);
    
    // Grouping, search and filter states
    const [activeSearchTerm, setActiveSearchTerm] = useState('');
    const [activeCategoryFilter, setActiveCategoryFilter] = useState('All');
    const [expandedActiveTypes, setExpandedActiveTypes] = useState({});
    const [activeMobileViewMode, setActiveMobileViewMode] = useState('cards'); // 'cards' | 'table'

    const [historySearchTerm, setHistorySearchTerm] = useState('');
    const [historyCategoryFilter, setHistoryCategoryFilter] = useState('All');
    const [expandedHistoryTypes, setExpandedHistoryTypes] = useState({});
    const [historyMobileViewMode, setHistoryMobileViewMode] = useState('cards'); // 'cards' | 'table'
    
    const [isInitiateModalOpen, setIsInitiateModalOpen] = useState(false);
    const [stockTakeType, setStockTakeType] = useState('FULL');
    
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isFinaliseModalOpen, setIsFinaliseModalOpen] = useState(false);

    const [lastScanned, setLastScanned] = useState(null);
    
    const [scanMode, setScanMode] = useState('RAPID');
    const [isQuantityModalOpen, setIsQuantityModalOpen] = useState(false);
    const [quantityItem, setQuantityItem] = useState(null);
    const [quantityInput, setQuantityInput] = useState('1');

    // --- Enhanced Range Count State ---
    const [isRangeCountModalOpen, setIsRangeCountModalOpen] = useState(false);
    const [rangeCountDetails, setRangeCountDetails] = useState({ 
        firstSerial: '', 
        lastSerial: '', 
        quantityCount: '',
        selectedItemType: '',
        selectedPartNumber: ''
    });
    const [rangeInputMode, setRangeInputMode] = useState('endSerial'); // 'endSerial' | 'quantity'
    const [showRangeSerialsPreview, setShowRangeSerialsPreview] = useState(false);
    const [rangeCountSubmitting, setRangeCountSubmitting] = useState(false);
    const [rangeCountError, setRangeCountError] = useState('');
    const [rangeItemSearchQuery, setRangeItemSearchQuery] = useState('');
    const [rangeLiveDbStockMap, setRangeLiveDbStockMap] = useState(new Map());

    const playBeep = useCallback((type = 'success') => {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            const audioCtx = new AudioContextClass();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            gainNode.gain.value = 0.08;
            if (type === 'success') {
                oscillator.frequency.value = 880;
                oscillator.type = 'sine';
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.12);
            } else if (type === 'warn') {
                oscillator.frequency.value = 440;
                oscillator.type = 'triangle';
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.15);
            } else {
                oscillator.frequency.value = 220;
                oscillator.type = 'square';
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + 0.2);
            }
        } catch (_) {}
    }, []);
    
    const [historicalTakes, setHistoricalTakes] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedHistoryReport, setSelectedHistoryReport] = useState(null);
    const [selectedHistoryItems, setSelectedHistoryItems] = useState([]);
    
    const [isDeleteHistoryModalOpen, setIsDeleteHistoryModalOpen] = useState(false);
    const [historyToDelete, setHistoryToDelete] = useState(null);

    const stockTakeItemsRef = useRef(stockTakeItems);
    const activeStockTakeRef = useRef(activeStockTake);
    const scanModeRef = useRef(scanMode);
    const isRangeCountModalOpenRef = useRef(isRangeCountModalOpen);
    const isQuantityModalOpenRef = useRef(isQuantityModalOpen);
    const rangeCountDetailsRef = useRef(rangeCountDetails);
    const rangeInputModeRef = useRef(rangeInputMode);
    
    useEffect(() => {
        stockTakeItemsRef.current = stockTakeItems;
        activeStockTakeRef.current = activeStockTake;
        scanModeRef.current = scanMode;
        isRangeCountModalOpenRef.current = isRangeCountModalOpen;
        isQuantityModalOpenRef.current = isQuantityModalOpen;
        rangeCountDetailsRef.current = rangeCountDetails;
        rangeInputModeRef.current = rangeInputMode;
    }, [stockTakeItems, activeStockTake, scanMode, isRangeCountModalOpen, isQuantityModalOpen, rangeCountDetails, rangeInputMode]);

    const openInitiateStockTakeModal = useCallback(() => {
        setStockTakeLocation('');
        setIsInitiateModalOpen(true);
    }, []);

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

    const uniqueItemTypes = useMemo(() => {
        return itemTypes.filter(it => it.is_unique || (it.category && it.category.toLowerCase().includes('meter')) || (it.name && it.name.toLowerCase().includes('meter')));
    }, [itemTypes]);

    const resolveUniqueItemType = useCallback((query) => {
        if (!query || !query.trim()) return null;
        const q = query.trim().toLowerCase();

        // 1. Exact check in partNumberLookupMap
        const partMatch = partNumberLookupMap[q];
        if (partMatch) {
            const it = itemTypes.find(t =>
                (partMatch.itemTypeId != null && t.id === partMatch.itemTypeId) ||
                (partMatch.itemTypeName && t.name === partMatch.itemTypeName)
            );
            if (it) return it;
        }

        // 2. Exact match in supplierPartNumbers
        if (Array.isArray(supplierPartNumbers)) {
            const spExact = supplierPartNumbers.find(sp => 
                (sp.part_number && String(sp.part_number).trim().toLowerCase() === q) ||
                (sp.barcode && String(sp.barcode).trim().toLowerCase() === q)
            );
            if (spExact) {
                const it = itemTypes.find(t =>
                    (spExact.item_type_id != null && t.id === spExact.item_type_id) ||
                    (spExact.item_types?.name && t.name === spExact.item_types.name) ||
                    (spExact.item_name && t.name === spExact.item_name)
                );
                if (it) return it;
            }
        }

        // 3. Exact match in itemTypes by barcode or exact name (never substring includes)
        const typeMatch = itemTypes.find(it => 
            (it.barcode && String(it.barcode).trim().toLowerCase() === q) ||
            (it.name && it.name.trim().toLowerCase() === q)
        );
        if (typeMatch) return typeMatch;

        return null;
    }, [partNumberLookupMap, supplierPartNumbers, itemTypes]);

    const hasLongerRangeCandidate = useCallback((query) => {
        if (!query || !query.trim()) return false;
        const q = query.trim().toLowerCase();
        if (Array.isArray(supplierPartNumbers)) {
            const longerSp = supplierPartNumbers.some(sp => {
                const pn = sp.part_number ? String(sp.part_number).trim().toLowerCase() : '';
                const bc = sp.barcode ? String(sp.barcode).trim().toLowerCase() : '';
                return (pn.length > q.length && pn.startsWith(q)) || (bc.length > q.length && bc.startsWith(q));
            });
            if (longerSp) return true;
        }
        return itemTypes.some(it => {
            const bc = it.barcode ? String(it.barcode).trim().toLowerCase() : '';
            const nm = it.name ? it.name.trim().toLowerCase() : '';
            return (bc.length > q.length && bc.startsWith(q)) || (nm.length > q.length && nm.startsWith(q));
        });
    }, [supplierPartNumbers, itemTypes]);

    const selectResolvedRangeProduct = useCallback((resolvedItemType, rawQuery = '') => {
        if (!resolvedItemType) return;
        const q = String(rawQuery || '').trim().toLowerCase();
        const exactSp = q && Array.isArray(supplierPartNumbers)
            ? supplierPartNumbers.find(p =>
                ((resolvedItemType.id != null && p.item_type_id === resolvedItemType.id) || p.item_name === resolvedItemType.name || p.item_types?.name === resolvedItemType.name) &&
                ((p.part_number && String(p.part_number).trim().toLowerCase() === q) || (p.barcode && String(p.barcode).trim().toLowerCase() === q))
            )
            : null;
        const fallbackSp = !exactSp && Array.isArray(supplierPartNumbers)
            ? supplierPartNumbers.find(p => (resolvedItemType.id != null && p.item_type_id === resolvedItemType.id) || p.item_name === resolvedItemType.name || p.item_types?.name === resolvedItemType.name)
            : null;
        const matchedSp = exactSp || fallbackSp;
        setRangeCountDetails(prev => ({
            ...prev,
            selectedItemType: resolvedItemType.name,
            selectedPartNumber: matchedSp?.part_number || ''
        }));
    }, [supplierPartNumbers]);
    
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

    const isAssignedToTeam = useCallback((assignedTo) => {
        return !!(
            assignedTo &&
            assignedTo !== 'Unassigned' &&
            assignedTo !== Team.UNASSIGNED &&
            assignedTo !== 'Stock Take Discrepancy (Missing)'
        );
    }, []);

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
            const itemCategory = meta.category || item.category || item.stock_items?.category || 'General';
            const spPart = Array.isArray(supplierPartNumbers)
                ? supplierPartNumbers.find(sp => (meta.id && sp.item_type_id === meta.id) || sp.item_name === itemTypeName || sp.item_types?.name === itemTypeName)
                : null;
            const supplierPurchasePrice = parseFloat(spPart?.purchase_price) || 0;
            const price = supplierPurchasePrice > 0 
                ? supplierPurchasePrice 
                : (parseFloat(item.stock_items?.purchase_price ?? stockItemFallback?.purchase_price ?? 0) || 0);
            const defaultBarcode = item.stock_items?.barcode || stockItemFallback?.barcode || meta.barcode || '';
            const isItemUnique = !!(
                meta.is_unique ||
                item.stock_items?.is_unique ||
                stockItemFallback?.is_unique ||
                item.is_unique ||
                (itemCategory && itemCategory.toLowerCase().includes('meter')) ||
                (itemTypeName && itemTypeName.toLowerCase().includes('meter'))
            );

            if (!groups[itemTypeName]) {
                groups[itemTypeName] = {
                    key: itemTypeName,
                    name: itemTypeName,
                    category: itemCategory,
                    price: price,
                    is_unique: isItemUnique,
                    expected_quantity: 0,
                    counted_quantity: 0,
                    returnedCount: 0,
                    returnedTeams: [],
                    rawItems: [],
                    status: 'PENDING'
                };
            } else if (isItemUnique) {
                groups[itemTypeName].is_unique = true;
            }
            // If the physical item was created during/after the stock take started, it was not in the system at the start
            const takeCreatedAt = activeStockTake?.created_at ? new Date(activeStockTake.created_at).getTime() : 0;
            const itemCreatedAt = item.stock_items?.created_at ? new Date(item.stock_items.created_at).getTime() : 0;
            const wasCreatedDuringTake = itemCreatedAt > 0 && takeCreatedAt > 0 && itemCreatedAt >= (takeCreatedAt - 3000);

            const exp = wasCreatedDuringTake 
                ? 0 
                : (typeof item.expected_quantity === 'number' ? item.expected_quantity : 1);
            const cnt = typeof item.counted_quantity === 'number' ? item.counted_quantity : 0;
            const assignedTo = item.stock_items?.assigned_to ?? stockItemFallback?.assigned_to;
            const returnedFromTeam = (cnt > 0 && isAssignedToTeam(assignedTo)) ? assignedTo : null;

            groups[itemTypeName].expected_quantity += exp;
            groups[itemTypeName].counted_quantity += cnt;
            if (returnedFromTeam) {
                groups[itemTypeName].returnedCount += 1;
                if (!groups[itemTypeName].returnedTeams.includes(returnedFromTeam)) {
                    groups[itemTypeName].returnedTeams.push(returnedFromTeam);
                }
            }
            groups[itemTypeName].rawItems.push({
                ...item,
                returnedFromTeam,
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
            const bulkMap = new Map();
            for (const raw of g.rawItems) {
                const bc = String(raw.stock_items?.barcode || (fallbackBarcode !== '—' ? fallbackBarcode : '') || 'No Barcode').trim() || 'No Barcode';
                const bcKey = bc.toLowerCase();
                if (!bulkMap.has(bcKey)) {
                    bulkMap.set(bcKey, {
                        barcode: bc,
                        expected_quantity: 0,
                        counted_quantity: 0,
                        returnedCount: 0,
                        returnedTeams: []
                    });
                }
                const entry = bulkMap.get(bcKey);
                entry.expected_quantity += (typeof raw.expected_quantity === 'number' ? raw.expected_quantity : 1);
                entry.counted_quantity += (typeof raw.counted_quantity === 'number' ? raw.counted_quantity : 0);
                if (raw.returnedFromTeam) {
                    entry.returnedCount += 1;
                    if (!entry.returnedTeams.includes(raw.returnedFromTeam)) {
                        entry.returnedTeams.push(raw.returnedFromTeam);
                    }
                }
            }
            return {
                ...g,
                uniqueBarcodes,
                bulkSummaries: Array.from(bulkMap.values()),
                barcodeDisplay: uniqueBarcodes.length === 1 
                    ? uniqueBarcodes[0] 
                    : uniqueBarcodes.length > 1 
                        ? `${uniqueBarcodes.length} ${g.is_unique ? 'serials' : 'barcodes'}` 
                        : fallbackBarcode,
                variance: g.counted_quantity - g.expected_quantity,
                value_variance: (g.counted_quantity - g.expected_quantity) * g.price
            };
        });
    }, [itemTypesMap, itemTypes, stockMap, supplierPartNumbers, activeStockTake?.created_at, isAssignedToTeam]);

    const activeGroupedItems = useMemo(() => {
        return groupStockTakeByItemType(stockTakeItems);
    }, [stockTakeItems, groupStockTakeByItemType]);

    const returnedUniqueItems = useMemo(() => {
        const list = [];
        activeGroupedItems.forEach(g => {
            g.rawItems.forEach(raw => {
                if (raw.returnedFromTeam) {
                    list.push({
                        id: raw.item_id || raw.id,
                        name: g.name,
                        barcode: raw.stock_items?.barcode || 'N/A',
                        fromTeam: raw.returnedFromTeam
                    });
                }
            });
        });
        return list;
    }, [activeGroupedItems]);

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
                        purchase_price: (() => {
                            const sp = Array.isArray(supplierPartNumbers) ? supplierPartNumbers.find(p => (meta.id && p.item_type_id === meta.id) || p.item_name === rawName || p.item_types?.name === rawName) : null;
                            const spPrice = parseFloat(sp?.purchase_price) || 0;
                            return spPrice > 0 ? spPrice : (parseFloat(stockItemFallback?.purchase_price) || 0);
                        })(),
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
        const filtered = historyGroupedItems.filter(g => {
            const matchesCat = historyCategoryFilter === 'All' || g.category === historyCategoryFilter;
            if (!matchesCat) return false;
            if (!historySearchTerm.trim()) return true;
            const term = historySearchTerm.toLowerCase();
            const matchesName = (g.name || '').toLowerCase().includes(term);
            const matchesCatText = (g.category || '').toLowerCase().includes(term);
            const matchesBarcode = g.rawItems.some(i => (i.stock_items?.barcode || '').toLowerCase().includes(term));
            return matchesName || matchesCatText || matchesBarcode;
        });
        return filtered.sort((a, b) => {
            const vA = Math.abs(a.value_variance);
            const vB = Math.abs(b.value_variance);
            if (vB !== vA) return vB - vA;
            const uA = Math.abs(a.variance);
            const uB = Math.abs(b.variance);
            if (uB !== uA) return uB - uA;
            return a.name.localeCompare(b.name);
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
        if (!stockTakeLocation || stockTakeLocation === 'All') {
            setError("Please select a specific storehouse / location before starting a stock take.");
            return;
        }
        const targetLocation = stockTakeLocation;
        setIsInitiateModalOpen(false);
        setLoading(true);
        if (isTrainingMode) {
            try {
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
            let returnedCount = 0;

            // 4. Update live stock counts in stock_items at targetLocation for each audited item type
            for (const group of itemsToReconcile) {
                const targetCount = Math.max(0, group.counted_quantity || 0);
                const groupLoc = (activeStockTake.location && activeStockTake.location !== 'All') 
                    ? activeStockTake.location 
                    : (group.rawItems.find(r => r.stock_items?.location)?.stock_items?.location || targetLocation);

                const rawItemIds = group.rawItems.map(r => r.item_id).filter(Boolean);
                const countedItemIds = new Set(
                    group.rawItems
                        .filter(r => (r.counted_quantity || 0) > 0 && r.item_id)
                        .map(r => r.item_id)
                );

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

                // 4a. Return any counted items that are still assigned to a team back to storehouse stock
                const meta = itemTypesMap[group.name] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === group.name) : null) || {};
                const itemsToReturn = dbItemsById.filter(item => countedItemIds.has(item.id) && isAssignedToTeam(item.assigned_to));

                if (itemsToReturn.length > 0) {
                    const returnIds = itemsToReturn.map(i => i.id);
                    const { error: returnError } = await supabase
                        .from('stock_items')
                        .update({
                            assigned_to: Team.UNASSIGNED,
                            location: groupLoc,
                            assigned_at: null,
                            assigned_by: null
                        })
                        .in('id', returnIds);

                    if (returnError) {
                        console.error(`Failed to return counted items for ${group.name}:`, returnError);
                        throw returnError;
                    }

                    if (typeof setStock === 'function') {
                        setStock(prev => prev.map(item => {
                            if (returnIds.includes(item.id)) {
                                return {
                                    ...item,
                                    assigned_to: Team.UNASSIGNED,
                                    location: groupLoc,
                                    assigned_at: null,
                                    assigned_by: null
                                };
                            }
                            return item;
                        }));
                    }

                    const returnMovements = itemsToReturn.map(item => ({
                        item_id: item.id,
                        item_barcode: item.barcode || group.barcodeDisplay || 'N/A',
                        item_name: item.name || group.name,
                        movement_type: 'IN',
                        location_from: item.assigned_to,
                        location_to: groupLoc,
                        user_id: user?.id || null,
                        username: auditorName
                    }));
                    await supabase.from('stock_movements').insert(returnMovements);

                    const returnIdSet = new Set(returnIds);
                    dbItemsById = dbItemsById.map(item =>
                        returnIdSet.has(item.id)
                            ? { ...item, assigned_to: Team.UNASSIGNED, location: groupLoc, assigned_at: null, assigned_by: null }
                            : item
                    );
                    returnedCount += itemsToReturn.length;
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
                    const template = currentDbItems?.[0] || group.rawItems?.find(r => r.stock_items)?.stock_items || {};
                    const spPart = Array.isArray(supplierPartNumbers) ? supplierPartNumbers.find(p => (meta.id && p.item_type_id === meta.id) || p.item_name === group.name || p.item_types?.name === group.name) : null;
                    const spPrice = parseFloat(spPart?.purchase_price) || 0;
                    const purchasePrice = spPrice > 0 ? spPrice : (parseFloat(template.purchase_price ?? group.price ?? 0) || 0);
                    const desc = meta.description || template.description || null;
                    const baseBarcode = meta.barcode || template.barcode || '';

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
                message: `Stock take finalised! Inventory counts for ${reconciledCount} product types at ${targetLocation} have been updated to match what was scanned.${returnedCount > 0 ? ` ${returnedCount} returned unique item(s) signed back into stock.` : ''}`
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
            if (typeof refetchStock === 'function') {
                await refetchStock();
            }
            return;
        }
        try {
            // 1. Find all stock_take_items for this active stock take to detect items created during the uncompleted take
            const { data: takeItems } = await supabase
                .from('stock_take_items')
                .select('id, item_id, expected_quantity, stock_items(id, created_at)')
                .eq('stock_take_id', activeStockTake.id);

            const takeCreatedAt = activeStockTake.created_at ? new Date(activeStockTake.created_at).getTime() : 0;
            const itemsToDeleteFromStock = [];

            if (takeItems && takeItems.length > 0) {
                takeItems.forEach(ti => {
                    const itemCreated = ti.stock_items?.created_at ? new Date(ti.stock_items.created_at).getTime() : 0;
                    // Items added during this uncompleted take have expected_quantity = 0 or were created during the active stock take
                    if (ti.expected_quantity === 0 || (itemCreated > 0 && takeCreatedAt > 0 && itemCreated >= (takeCreatedAt - 3000))) {
                        if (ti.item_id) itemsToDeleteFromStock.push(ti.item_id);
                    }
                });
            }

            // 1b. Explicitly delete stock_take_items first to prevent foreign key errors
            await supabase
                .from('stock_take_items')
                .delete()
                .eq('stock_take_id', activeStockTake.id);

            // 2. Delete the active stock take
            const { error } = await supabase
                .from('stock_takes')
                .delete()
                .eq('id', activeStockTake.id);
                
            if (error) throw error;

            // 3. Delete any newly created stock_items that were created during this uncompleted take
            if (itemsToDeleteFromStock.length > 0) {
                await supabase
                    .from('stock_items')
                    .delete()
                    .in('id', itemsToDeleteFromStock);
            }

            // 4. Reset local state
            setActiveStockTake(null);
            setStockTakeItems([]);
            await fetchActiveStockTake();

            // 5. Refetch live inventory so counts immediately revert cleanly in dashboard and reports
            if (typeof refetchStock === 'function') {
                await refetchStock();
            }

            setLastScanned({
                success: true,
                message: "Stock take cancelled. All counts reverted and no changes were made to live stock."
            });
            setTimeout(() => setLastScanned(null), 4000);
        } catch(err) {
            console.error("Error cancelling stock take:", err);
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
                    const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan && isAssignedToTeam(s.assigned_to))
                        || stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan);
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

                const itemDisplayName = res.item.stock_items?.name || matchedItemType.name;
                const returnedTeam = isAssignedToTeam(res.item.stock_items?.assigned_to) ? res.item.stock_items.assigned_to : null;
                if (returnedTeam) {
                    setExpandedActiveTypes(prev => ({ ...prev, [itemDisplayName]: true }));
                }
                playBeep(returnedTeam ? 'warn' : 'success');
                setLastScanned({
                    success: true,
                    variant: returnedTeam ? 'warning' : 'success',
                    message: returnedTeam
                        ? `↩️ Due to Return to System: ${itemDisplayName} (${rawBarcode}) is signed out to ${returnedTeam} and is marked to be returned to ${currentTargetLocation} stock when you finalise.`
                        : `Counted 1x ${itemDisplayName} (Count: ${res.item.counted_quantity})`
                });
                setTimeout(() => setLastScanned(null), returnedTeam ? 8000 : 4000);
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
            let matchedPhysicalSerialItem = null;

            // 2. Check stock prop (preferring team-assigned rows if duplicates exist)
            if (!matchedItemName) {
                const stockMatch = stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan && isAssignedToTeam(s.assigned_to))
                    || stock.find(s => String(s.barcode).trim().toLowerCase() === lowerScan);
                if (stockMatch) {
                    matchedItemName = stockMatch.name;
                    baseBarcode = stockMatch.barcode;
                    matchedPhysicalSerialItem = stockMatch;
                }
            }

            // 2b. Always verify live DB stock_items when the scan wasn't a part number / item_type master barcode
            // so stale cached stock never hides that a serial has been signed out to a team
            if (!matchedItemType) {
                const { data: liveStockMatches } = await supabase
                    .from('stock_items')
                    .select('*')
                    .ilike('barcode', rawBarcode)
                    .limit(10);

                if (liveStockMatches && liveStockMatches.length > 0) {
                    const preferred = liveStockMatches.find(r => isAssignedToTeam(r.assigned_to))
                        || liveStockMatches.find(r => r.location === currentTargetLocation)
                        || liveStockMatches[0];
                    matchedPhysicalSerialItem = preferred;
                    matchedItemName = matchedItemName || preferred.name;
                    baseBarcode = preferred.barcode || baseBarcode;
                }
            }

            if (!matchedItemName) {
                // Query database for part number / item_type barcode
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
            const spPart = Array.isArray(supplierPartNumbers) ? supplierPartNumbers.find(p => (meta.id && p.item_type_id === meta.id) || p.item_name === matchedItemName || p.item_types?.name === matchedItemName) : null;
            const itemPrice = parseFloat(spPart?.purchase_price ?? 0) || 0;

            // If it's a unique item type (serialized item or meter) OR matched a specific physical serial row in stock_items
            const isUniqueType = !!(meta.is_unique || (meta.category && meta.category.toLowerCase().includes('meter')) || matchedItemName.toLowerCase().includes('meter'));
            const isPartOrMasterBarcode = !!(partLookup || (meta.barcode && String(meta.barcode).trim().toLowerCase() === lowerScan));
            const isSpecificPhysicalSerial = Boolean(matchedPhysicalSerialItem && (!isPartOrMasterBarcode || isAssignedToTeam(matchedPhysicalSerialItem.assigned_to)));

            if (isUniqueType || isSpecificPhysicalSerial) {
                // 1. Check if the scanned barcode matches an exact serial number already in the current stock take
                const serialLower = lowerScan;
                const matchedNameLower = matchedItemName.trim().toLowerCase();
                const specificSerialItem = stockTakeItemsRef.current.find(sti => {
                    if (matchedPhysicalSerialItem && sti.item_id === matchedPhysicalSerialItem.id) return true;
                    const name = (sti.stock_items?.name || stockMap.get(sti.item_id)?.name || '').trim().toLowerCase();
                    if (name !== matchedNameLower) return false;
                    return (sti.stock_items?.barcode || '').trim().toLowerCase() === serialLower;
                });

                if (specificSerialItem) {
                    const existingAssigned = matchedPhysicalSerialItem?.assigned_to ?? specificSerialItem.stock_items?.assigned_to ?? stockMap.get(specificSerialItem.item_id)?.assigned_to;
                    const returnedTeam = isAssignedToTeam(existingAssigned) ? existingAssigned : null;

                    if ((specificSerialItem.counted_quantity || 0) > 0) {
                        if (matchedPhysicalSerialItem) {
                            setStockTakeItems(prev => prev.map(i => i.id === specificSerialItem.id ? { ...i, stock_items: matchedPhysicalSerialItem } : i));
                        }
                        if (returnedTeam) {
                            setExpandedActiveTypes(prev => ({ ...prev, [matchedItemName]: true }));
                            setLastScanned({
                                success: true,
                                variant: 'warning',
                                message: `↩️ Due to Return to System: ${matchedItemName} (${rawBarcode}) is signed out to ${returnedTeam} and is already marked to be returned to ${currentTargetLocation} stock on finalise.`
                            });
                            playBeep('warn');
                            setTimeout(() => setLastScanned(null), 8000);
                            return;
                        }
                        setLastScanned({ success: false, message: `Serial "${rawBarcode}" for ${matchedItemName} is already counted.` });
                        playBeep('warn');
                        return;
                    }

                    const { error: updErr } = await supabase
                        .from('stock_take_items')
                        .update({ counted_quantity: 1, status: 'COUNTED' })
                        .eq('id', specificSerialItem.id);
                    if (updErr) throw updErr;

                    setStockTakeItems(prev => prev.map(i => i.id === specificSerialItem.id ? {
                        ...i,
                        counted_quantity: 1,
                        status: 'COUNTED',
                        stock_items: matchedPhysicalSerialItem || i.stock_items
                    } : i));

                    if (returnedTeam) {
                        setExpandedActiveTypes(prev => ({ ...prev, [matchedItemName]: true }));
                    }
                    setLastScanned({
                        success: true,
                        variant: returnedTeam ? 'warning' : 'success',
                        message: returnedTeam
                            ? `↩️ Due to Return to System: ${matchedItemName} (${rawBarcode}) is signed out to ${returnedTeam} and is marked to be returned to ${currentTargetLocation} stock when you finalise.`
                            : `Scanned ${matchedItemName} (Serial ${rawBarcode}) (+1 Counted)`
                    });
                    playBeep(returnedTeam ? 'warn' : 'success');
                    setTimeout(() => setLastScanned(null), returnedTeam ? 8000 : 4000);
                    return;
                }

                // 1b. If the scanned code matches a specific physical serial in stock_items (e.g. signed out to a team, or in a rolling stock take), record it directly!
                if (isSpecificPhysicalSerial) {
                    const wasInStockBefore = matchedPhysicalSerialItem.location === currentTargetLocation && !isAssignedToTeam(matchedPhysicalSerialItem.assigned_to);
                    const { data: insertedTakeItem, error: takeInsertError } = await supabase
                        .from('stock_take_items')
                        .insert([{
                            stock_take_id: activeStockTakeRef.current.id,
                            item_id: matchedPhysicalSerialItem.id,
                            expected_quantity: wasInStockBefore ? 1 : 0,
                            counted_quantity: 1,
                            status: 'COUNTED'
                        }])
                        .select('*, stock_items(id, name, barcode, purchase_price, description, location, assigned_to, created_at)')
                        .single();

                    if (takeInsertError) throw takeInsertError;
                    setStockTakeItems(prev => [...prev, { ...insertedTakeItem, stock_items: insertedTakeItem.stock_items || matchedPhysicalSerialItem }]);

                    const returnedTeam = isAssignedToTeam(matchedPhysicalSerialItem.assigned_to) ? matchedPhysicalSerialItem.assigned_to : null;
                    if (returnedTeam) {
                        setExpandedActiveTypes(prev => ({ ...prev, [matchedItemName]: true }));
                    }
                    setLastScanned({
                        success: true,
                        variant: returnedTeam ? 'warning' : 'success',
                        message: returnedTeam
                            ? `↩️ Due to Return to System: ${matchedItemName} (${rawBarcode}) is signed out to ${returnedTeam} and is marked to be returned to ${currentTargetLocation} stock when you finalise.`
                            : `Scanned ${matchedItemName} (Serial ${rawBarcode}) (+1 Counted)`
                    });
                    playBeep(returnedTeam ? 'warn' : 'success');
                    setTimeout(() => setLastScanned(null), returnedTeam ? 8000 : 4000);
                    return;
                }

                // 2. The scanned code was the PART NUMBER, model barcode, or a serialized product: Open Range Count!
                setRangeCountError('');
                setRangeCountDetails({
                    firstSerial: '',
                    lastSerial: '',
                    quantityCount: '',
                    selectedItemType: matchedItemName,
                    selectedPartNumber: partLookup?.partNumber || spPart?.part_number || ''
                });
                setRangeItemSearchQuery(matchedItemName);
                setIsRangeCountModalOpen(true);
                setLastScanned({
                    success: true,
                    message: `Part Number matched: ${matchedItemName}. Range Count opened.`
                });
                setTimeout(() => setLastScanned(null), 3000);
                return;
            }

            // 3. Find or inject stock_take_items for this non-unique item at target storehouse
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

            const isScannedItemUnique = !!(meta.is_unique || takeItemToUpdate?.stock_items?.is_unique);
            if (scanModeRef.current === 'QUANTITY' && !isScannedItemUnique) {
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

        const getTakeItemName = (sti) => sti?.stock_items?.name || stockMap.get(sti?.item_id)?.name || '';
        const itemName = getTakeItemName(quantityItem) || 'item';
        const productTakeItems = getTakeItemName(quantityItem)
            ? stockTakeItemsRef.current.filter(i => getTakeItemName(i) === itemName)
            : [quantityItem];

        // Distribute addedQty across uncounted rows first (1 each) so individual unit rows don't show 0/1 Missing,
        // and place any excess onto quantityItem.
        let remaining = addedQty;
        const updatesById = new Map();
        const uncountedRows = productTakeItems
            .filter(i => (i.counted_quantity || 0) === 0)
            .sort((a, b) => (a.id === quantityItem.id ? -1 : b.id === quantityItem.id ? 1 : 0));

        for (const row of uncountedRows) {
            if (remaining <= 0) break;
            updatesById.set(row.id, 1);
            remaining -= 1;
        }
        if (remaining > 0) {
            const baseQty = updatesById.has(quantityItem.id)
                ? updatesById.get(quantityItem.id)
                : (quantityItem.counted_quantity || 0);
            updatesById.set(quantityItem.id, baseQty + remaining);
        }

        setLoading(true);
        if (isTrainingMode) {
            const applyLocalUpdates = (list) => list.map(i =>
                updatesById.has(i.id)
                    ? { ...i, counted_quantity: updatesById.get(i.id), status: 'COUNTED' }
                    : i
            );
            setStockTakeItems(prev => applyLocalUpdates(prev));
            if (Array.isArray(trainingManager.stockTakeItems)) {
                trainingManager.stockTakeItems = applyLocalUpdates(trainingManager.stockTakeItems);
                trainingManager.notify();
            }
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
            const idsToSetOne = [];
            const customQtyUpdates = [];
            updatesById.forEach((qty, id) => {
                if (qty === 1) {
                    idsToSetOne.push(id);
                } else {
                    customQtyUpdates.push({ id, qty });
                }
            });

            const CHUNK_SIZE = 150;
            for (let idx = 0; idx < idsToSetOne.length; idx += CHUNK_SIZE) {
                const chunk = idsToSetOne.slice(idx, idx + CHUNK_SIZE);
                const { error: batchUpdateError } = await supabase
                    .from('stock_take_items')
                    .update({ counted_quantity: 1, status: 'COUNTED' })
                    .in('id', chunk);
                if (batchUpdateError) throw batchUpdateError;
            }

            for (const entry of customQtyUpdates) {
                const { error: updateError } = await supabase
                    .from('stock_take_items')
                    .update({ counted_quantity: entry.qty, status: 'COUNTED' })
                    .eq('id', entry.id);
                if (updateError) throw updateError;
            }

            // Update local state using functional updater
            setStockTakeItems(prev => prev.map(i =>
                updatesById.has(i.id)
                    ? { ...i, counted_quantity: updatesById.get(i.id), status: 'COUNTED' }
                    : i
            ));

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

    // Filtered item types for Range Count Modal based on part number, barcode, or name
    const filteredRangeItemTypes = useMemo(() => {
        if (!rangeItemSearchQuery.trim()) return itemTypes;
        const q = rangeItemSearchQuery.trim().toLowerCase();
        return itemTypes.filter(it => {
            if (it.name && it.name.toLowerCase().includes(q)) return true;
            if (it.category && it.category.toLowerCase().includes(q)) return true;
            if (it.barcode && String(it.barcode).toLowerCase().includes(q)) return true;
            if (Array.isArray(supplierPartNumbers)) {
                const matchPart = supplierPartNumbers.some(sp => 
                    ((it.id != null && sp.item_type_id === it.id) || sp.item_name === it.name || sp.item_types?.name === it.name) &&
                    ((sp.part_number && String(sp.part_number).toLowerCase().includes(q)) || 
                     (sp.barcode && String(sp.barcode).toLowerCase().includes(q)))
                );
                if (matchPart) return true;
            }
            return false;
        });
    }, [itemTypes, supplierPartNumbers, rangeItemSearchQuery]);

    // Meta for currently selected item type in Range Count Modal
    const selectedRangeProductMeta = useMemo(() => {
        if (!rangeCountDetails.selectedItemType) return null;
        const it = itemTypes.find(t => t.name === rangeCountDetails.selectedItemType || t.id === rangeCountDetails.selectedItemType);
        const spPart = Array.isArray(supplierPartNumbers)
            ? (
                (rangeCountDetails.selectedPartNumber && supplierPartNumbers.find(sp =>
                    ((it?.id != null && sp.item_type_id === it.id) || sp.item_name === rangeCountDetails.selectedItemType || sp.item_types?.name === rangeCountDetails.selectedItemType) &&
                    String(sp.part_number || '').trim().toLowerCase() === String(rangeCountDetails.selectedPartNumber).trim().toLowerCase()
                )) ||
                supplierPartNumbers.find(sp => (it?.id != null && sp.item_type_id === it.id) || sp.item_name === rangeCountDetails.selectedItemType || sp.item_types?.name === rangeCountDetails.selectedItemType)
            )
            : null;
        const partNumber = rangeCountDetails.selectedPartNumber || spPart?.part_number || null;
        const price = parseFloat(spPart?.purchase_price ?? it?.purchase_price ?? 0) || 0;
        
        // Expected items at active storehouse for this product
        const loc = activeStockTake?.location;
        const expectedItems = stockTakeItems.filter(sti => {
            const name = sti.stock_items?.name || stockMap.get(sti.item_id)?.name;
            return name === rangeCountDetails.selectedItemType;
        });
        const expectedCount = expectedItems.reduce((acc, curr) => acc + (curr.expected_quantity ?? 1), 0);
        const countedCount = expectedItems.reduce((acc, curr) => acc + (curr.counted_quantity || 0), 0);

        return {
            itemType: it || { name: rangeCountDetails.selectedItemType },
            supplierPart: spPart,
            partNumber: partNumber,
            supplierName: spPart?.suppliers?.name || null,
            barcode: it?.barcode || spPart?.barcode || null,
            price: price,
            category: it?.category || 'Meters',
            location: loc,
            expectedCount,
            countedCount
        };
    }, [rangeCountDetails.selectedItemType, rangeCountDetails.selectedPartNumber, itemTypes, supplierPartNumbers, activeStockTake, stockTakeItems, stockMap]);

    // Enhanced Range Count Calculation & Mindful Inventory Analysis
    const rangeCountProcessingResult = useMemo(() => {
        const { firstSerial, lastSerial } = rangeCountDetails;
        const start = firstSerial?.trim();
        const end = lastSerial?.trim();

        if (!start || !end) {
            return { 
                serials: [], 
                count: 0, 
                error: null, 
                inventoryStats: null,
                serialDetails: []
            };
        }

        const expansion = expandRange(start, end);
        if (expansion.error) {
            return { 
                serials: [], 
                count: 0, 
                error: expansion.error, 
                inventoryStats: null,
                serialDetails: []
            };
        }

        const expanded = expansion.result;
        if (expanded.length > 1000) {
            return { 
                serials: [], 
                count: 0, 
                error: `Range is too large. A maximum of 1000 items can be counted at once, but this range contains ${expanded.length}.`, 
                inventoryStats: null,
                serialDetails: []
            };
        }

        // Analyze serials against existing stock items, live DB lookups, and active stock take items
        const targetNameNorm = (rangeCountDetails.selectedItemType || '').trim().toLowerCase();
        const existingStockBarcodes = new Set();
        const assignedSerialMap = new Map();
        const takeItemsForTarget = stockTakeItems.filter(sti => {
            const name = (sti.stock_items?.name || stockMap.get(sti.item_id)?.name || '').trim().toLowerCase();
            return !targetNameNorm || name === targetNameNorm;
        });

        const alreadyCountedSet = new Set();
        takeItemsForTarget.forEach(ti => {
            const bc = (ti.stock_items?.barcode || '').trim().toLowerCase();
            if (bc) {
                const assignedTo = ti.stock_items?.assigned_to ?? stockMap.get(ti.item_id)?.assigned_to;
                if (isAssignedToTeam(assignedTo)) {
                    assignedSerialMap.set(bc, assignedTo);
                } else {
                    existingStockBarcodes.add(bc);
                }
                if ((ti.counted_quantity || 0) > 0) {
                    alreadyCountedSet.add(bc);
                }
            }
        });

        const absorbStockRow = (s, requireNameMatch = true) => {
            if (!s) return;
            const bc = (s.barcode || '').trim().toLowerCase();
            if (!bc) return;
            const sNameNorm = (s.name || '').trim().toLowerCase();
            if (requireNameMatch && targetNameNorm && sNameNorm !== targetNameNorm) return;

            if (isAssignedToTeam(s.assigned_to)) {
                assignedSerialMap.set(bc, s.assigned_to);
            } else if (!assignedSerialMap.has(bc)) {
                existingStockBarcodes.add(bc);
            }
        };

        if (Array.isArray(stock)) {
            stock.forEach(s => absorbStockRow(s, true));
            // Fallback pass: if a serial in stock is signed out to a team regardless of minor product name differences
            stock.forEach(s => {
                if (isAssignedToTeam(s.assigned_to)) absorbStockRow(s, false);
            });
        }

        if (rangeLiveDbStockMap && rangeLiveDbStockMap.size > 0) {
            rangeLiveDbStockMap.forEach(s => {
                if (isAssignedToTeam(s.assigned_to)) {
                    absorbStockRow(s, false);
                } else {
                    absorbStockRow(s, true);
                }
            });
        }

        let existingCount = 0;
        let returnedCount = 0;
        let newCount = 0;
        let alreadyCountedCount = 0;
        const returnedTeamsSet = new Set();

        const serialDetails = expanded.map(s => {
            const sLower = s.toLowerCase();
            const isAlreadyCounted = alreadyCountedSet.has(sLower);
            const assignedTo = assignedSerialMap.get(sLower) || null;
            const isReturned = Boolean(assignedTo);
            const isExisting = existingStockBarcodes.has(sLower);
            const isNew = !isExisting && !isReturned;

            if (isAlreadyCounted) alreadyCountedCount++;
            if (isReturned) {
                returnedCount++;
                returnedTeamsSet.add(assignedTo);
            } else if (isExisting) {
                existingCount++;
            }
            if (isNew) newCount++;

            return {
                serial: s,
                isExisting,
                isReturned,
                assignedTo,
                isNew,
                isAlreadyCounted
            };
        });

        return {
            serials: expanded,
            serialDetails,
            count: expanded.length,
            error: null,
            inventoryStats: {
                total: expanded.length,
                existingCount,
                returnedCount,
                returnedTeams: Array.from(returnedTeamsSet),
                newCount,
                alreadyCountedCount
            }
        };
    }, [rangeCountDetails.firstSerial, rangeCountDetails.lastSerial, rangeCountDetails.selectedItemType, stockTakeItems, stock, stockMap, rangeLiveDbStockMap, isAssignedToTeam]);

    // Live DB verification for Range Count serials so stale local stock never hides signed-out items
    useEffect(() => {
        if (!isRangeCountModalOpen || isTrainingMode) {
            setRangeLiveDbStockMap(new Map());
            return;
        }
        const start = rangeCountDetails.firstSerial?.trim();
        const end = rangeCountDetails.lastSerial?.trim();
        if (!start || !end) {
            setRangeLiveDbStockMap(new Map());
            return;
        }
        const expansion = expandRange(start, end);
        if (expansion.error || !expansion.result || expansion.result.length === 0 || expansion.result.length > 1000) {
            setRangeLiveDbStockMap(new Map());
            return;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const serialsList = expansion.result;
                // Include case-matched barcodes from local stock prop too
                const querySet = new Set(serialsList);
                const lowerSet = new Set(serialsList.map(s => s.trim().toLowerCase()));
                if (Array.isArray(stock)) {
                    stock.forEach(s => {
                        const bc = (s.barcode || '').trim();
                        if (bc && lowerSet.has(bc.toLowerCase())) {
                            querySet.add(bc);
                        }
                    });
                }
                const allQueryBarcodes = Array.from(querySet);
                const liveMap = new Map();
                const chunkSize = 150;
                for (let i = 0; i < allQueryBarcodes.length; i += chunkSize) {
                    if (cancelled) return;
                    const chunk = allQueryBarcodes.slice(i, i + chunkSize);
                    const { data, error } = await supabase
                        .from('stock_items')
                        .select('id, name, barcode, location, assigned_to')
                        .in('barcode', chunk);
                    if (!error && Array.isArray(data)) {
                        data.forEach(row => {
                            const key = String(row.barcode || '').trim().toLowerCase();
                            if (!key) return;
                            const prev = liveMap.get(key);
                            if (!prev || (isAssignedToTeam(row.assigned_to) && !isAssignedToTeam(prev.assigned_to))) {
                                liveMap.set(key, row);
                            }
                        });
                    }
                }
                if (!cancelled) {
                    setRangeLiveDbStockMap(liveMap);
                }
            } catch (err) {
                console.warn('Range live DB lookup warning:', err);
            }
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isRangeCountModalOpen, isTrainingMode, rangeCountDetails.firstSerial, rangeCountDetails.lastSerial, stock, isAssignedToTeam]);

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

                const returnedItems = res.returnedItems || [];
                const returnedTeams = Array.from(new Set(returnedItems.map(r => r.fromTeam)));
                if (returnedItems.length > 0) {
                    playBeep('warn');
                    setExpandedActiveTypes(prev => ({ ...prev, [targetTypeName]: true }));
                } else {
                    playBeep('success');
                }

                setLastScanned({
                    success: true,
                    variant: returnedItems.length > 0 ? 'warning' : 'success',
                    message: returnedItems.length > 0
                        ? `↩️ Signed Out Serials Scanned (${returnedItems.length} of ${res.count} ${targetTypeName}): Currently signed out to ${returnedTeams.join(', ')} — marked as pending return and will be returned to ${currentTargetLocation} stock when you finalise.`
                        : `Counted range of ${res.count} items (${serials[0]} - ${serials[serials.length - 1]}) for ${targetTypeName}`
                });
                setTimeout(() => setLastScanned(null), returnedItems.length > 0 ? 8000 : 4000);

                setIsRangeCountModalOpen(false);
                setRangeCountDetails({ firstSerial: '', lastSerial: '', quantityCount: '', selectedItemType: '', selectedPartNumber: '' });
                setShowRangeSerialsPreview(false);
                setRangeItemSearchQuery('');
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

            if (!targetTypeName) {
                setRangeCountError("Please select the product type for this serial number range.");
                setRangeCountSubmitting(false);
                return;
            }

            const meta = itemTypesMap[targetTypeName] || (Array.isArray(itemTypes) ? itemTypes.find(it => it.name === targetTypeName) : null) || {};
            const spPart = Array.isArray(supplierPartNumbers) ? supplierPartNumbers.find(p => (meta.id && p.item_type_id === meta.id) || p.item_name === targetTypeName || p.item_types?.name === targetTypeName) : null;
            const itemPrice = parseFloat(spPart?.purchase_price ?? 0) || 0;

            // Look up existing stock items in database matching these serials (chunked, including any case variants from stock prop)
            const queryBarcodeSet = new Set(serials);
            const serialLowerSet = new Set(serials.map(s => s.trim().toLowerCase()));
            if (Array.isArray(stock)) {
                stock.forEach(s => {
                    const bc = (s.barcode || '').trim();
                    if (bc && serialLowerSet.has(bc.toLowerCase())) {
                        queryBarcodeSet.add(bc);
                    }
                });
            }
            const queryBarcodes = Array.from(queryBarcodeSet);
            const dbMatchedStock = [];
            const queryChunkSize = 150;
            for (let i = 0; i < queryBarcodes.length; i += queryChunkSize) {
                const chunk = queryBarcodes.slice(i, i + queryChunkSize);
                const { data: chunkData, error: dbStockError } = await supabase
                    .from('stock_items')
                    .select('*')
                    .in('barcode', chunk);
                if (dbStockError) throw dbStockError;
                if (chunkData) dbMatchedStock.push(...chunkData);
            }

            const existingByBarcodeLower = new Map();
            dbMatchedStock.forEach(item => {
                if (item.barcode) {
                    const key = String(item.barcode).trim().toLowerCase();
                    const prev = existingByBarcodeLower.get(key);
                    if (!prev || (isAssignedToTeam(item.assigned_to) && !isAssignedToTeam(prev.assigned_to)) || (!isAssignedToTeam(prev.assigned_to) && item.location === currentTargetLocation && prev.location !== currentTargetLocation)) {
                        existingByBarcodeLower.set(key, item);
                    }
                }
            });

            // For each serial in the range, find or create the physical stock_item
            const resolvedStockItems = [];
            const newStockItemsToCreate = [];
            const newlyCreatedBarcodes = new Set();

            for (const serial of serials) {
                const existing = existingByBarcodeLower.get(serial.trim().toLowerCase());
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
                }
            }

            const resolvedByItemId = new Map();
            resolvedStockItems.forEach(s => {
                if (s && s.id) resolvedByItemId.set(s.id, s);
            });

            // Fetch or match stock_take_items for these stock item IDs
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
                insertedTakeItems = (inserted || []).map(row => ({
                    ...row,
                    stock_items: row.stock_items || resolvedByItemId.get(row.item_id)
                }));
            }

            // Update existing stock_take_items to counted_quantity = 1, status = 'COUNTED'
            if (takeItemIdsToUpdate.length > 0) {
                const { error: takeUpdateError } = await supabase
                    .from('stock_take_items')
                    .update({ counted_quantity: 1, status: 'COUNTED' })
                    .in('id', takeItemIdsToUpdate);

                if (takeUpdateError) throw takeUpdateError;
            }

            // Update local stockTakeItems state (including fresh stock_items metadata)
            const updatedIdsSet = new Set(takeItemIdsToUpdate);
            setStockTakeItems(prev => {
                const updatedList = prev.map(item => {
                    if (updatedIdsSet.has(item.id)) {
                        return {
                            ...item,
                            counted_quantity: 1,
                            status: 'COUNTED',
                            stock_items: resolvedByItemId.get(item.item_id) || item.stock_items
                        };
                    }
                    return item;
                });
                return [...updatedList, ...insertedTakeItems];
            });

            const returnedInRange = resolvedStockItems.filter(s => isAssignedToTeam(s.assigned_to));
            const returnedTeams = Array.from(new Set(returnedInRange.map(s => s.assigned_to)));
            if (returnedInRange.length > 0) {
                playBeep('warn');
                setExpandedActiveTypes(prev => ({ ...prev, [targetTypeName]: true }));
            } else {
                playBeep('success');
            }

            setLastScanned({
                success: true,
                variant: returnedInRange.length > 0 ? 'warning' : 'success',
                message: returnedInRange.length > 0
                    ? `↩️ Signed Out Serials Scanned (${returnedInRange.length} of ${serials.length} ${targetTypeName}): Currently signed out to ${returnedTeams.join(', ')} — marked as pending return and will be returned to ${currentTargetLocation} stock when you finalise.`
                    : `Successfully counted serial range (${serials.length} units of ${targetTypeName})`
            });
            setTimeout(() => setLastScanned(null), returnedInRange.length > 0 ? 8000 : 5000);

            setIsRangeCountModalOpen(false);
            setRangeCountDetails({ firstSerial: '', lastSerial: '', quantityCount: '', selectedItemType: '', selectedPartNumber: '' });
            setShowRangeSerialsPreview(false);
            setRangeItemSearchQuery('');

        } catch (err) {
            console.error("Error in handleRangeCountSubmit:", err);
            setRangeCountError(`Failed to process range count: ${err.message}`);
        } finally {
            setRangeCountSubmitting(false);
        }
    };

    const resolveUniqueItemTypeRef = useRef(resolveUniqueItemType);
    const selectResolvedRangeProductRef = useRef(selectResolvedRangeProduct);
    useEffect(() => {
        resolveUniqueItemTypeRef.current = resolveUniqueItemType;
        selectResolvedRangeProductRef.current = selectResolvedRangeProduct;
    }, [resolveUniqueItemType, selectResolvedRangeProduct]);

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
                    if (isQuantityModalOpenRef.current) {
                        barcodeBuffer = '';
                        return;
                    }
                    if (isRangeCountModalOpenRef.current) {
                        const scannedCode = barcodeBuffer.trim();
                        if (!rangeCountDetailsRef.current?.selectedItemType) {
                            setRangeItemSearchQuery(scannedCode);
                            const resolved = resolveUniqueItemTypeRef.current(scannedCode);
                            if (resolved) {
                                selectResolvedRangeProductRef.current(resolved, scannedCode);
                            }
                        } else if (!rangeCountDetailsRef.current?.firstSerial) {
                            setRangeCountDetails(prev => {
                                const updated = { ...prev, firstSerial: scannedCode };
                                if (rangeInputModeRef.current === 'quantity' && prev.quantityCount) {
                                    updated.lastSerial = calculateEndSerial(scannedCode, prev.quantityCount);
                                } else if (rangeInputModeRef.current === 'endSerial' && prev.lastSerial) {
                                    updated.quantityCount = calculateRangeQuantity(scannedCode, prev.lastSerial);
                                }
                                return updated;
                            });
                        } else if (rangeInputModeRef.current === 'endSerial' && !rangeCountDetailsRef.current?.lastSerial) {
                            setRangeCountDetails(prev => ({
                                ...prev,
                                lastSerial: scannedCode,
                                quantityCount: calculateRangeQuantity(prev.firstSerial, scannedCode)
                            }));
                        }
                        barcodeBuffer = '';
                        return;
                    }
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
                <button onClick={openInitiateStockTakeModal} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
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
                                <button onClick={openInitiateStockTakeModal} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium">
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

                            <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 sm:p-10 flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-800/50 relative overflow-hidden">
                                
                                {lastScanned && (
                                    <div className={`w-full mb-5 px-4 py-3 rounded-lg text-sm font-medium text-white shadow-sm flex items-center justify-between gap-3 z-20 ${
                                        !lastScanned.success
                                            ? 'bg-red-600'
                                            : lastScanned.variant === 'warning'
                                                ? 'bg-amber-600'
                                                : 'bg-green-600'
                                    }`}>
                                        <span className="text-left">{lastScanned.message}</span>
                                        <button
                                            type="button"
                                            onClick={() => setLastScanned(null)}
                                            className="shrink-0 text-white/80 hover:text-white font-bold text-base leading-none px-1"
                                            aria-label="Dismiss scan notification"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                )}
                                
                                <div className="self-end mb-4 sm:mb-2 flex bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 p-1 flex-wrap gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setScanMode('RAPID')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${scanMode === 'RAPID' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                                    >
                                        Rapid Scan
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setScanMode('QUANTITY')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${scanMode === 'QUANTITY' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                                    >
                                        Quantity Mode
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setRangeCountError('');
                                            setRangeCountDetails({ firstSerial: '', lastSerial: '', quantityCount: '', selectedItemType: '', selectedPartNumber: '' });
                                            setRangeItemSearchQuery('');
                                            setIsRangeCountModalOpen(true);
                                        }}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-md transition-colors text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/40 flex items-center gap-1.5 border-l border-zinc-200 dark:border-zinc-700 ml-0.5 pl-2"
                                        title="Count a continuous serial number range by part number (e.g. boxed meters)"
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
                                        {returnedUniqueItems.length > 0 && (
                                            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                                                ↩️ {returnedUniqueItems.length} due to return to system
                                            </p>
                                        )}
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

                                {returnedUniqueItems.length > 0 && (
                                    <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/80 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="flex items-start gap-2.5">
                                            <span className="text-lg leading-none mt-0.5">↩️</span>
                                            <div>
                                                <p className="font-bold text-sm text-amber-950 dark:text-amber-100">
                                                    Items Due to Return to System ({returnedUniqueItems.length} signed-out {returnedUniqueItems.length === 1 ? 'serial' : 'serials'})
                                                </p>
                                                <p className="mt-1 text-amber-800 dark:text-amber-300">
                                                    {returnedUniqueItems.length === 1 ? 'This scanned serial is' : 'These scanned serials are'} currently signed out to{' '}
                                                    <strong>{Array.from(new Set(returnedUniqueItems.map(r => r.fromTeam))).join(', ')}</strong>.{' '}
                                                    They are marked as due for return and will automatically be returned back into{' '}
                                                    <strong>{activeStockTake.location || 'storehouse'}</strong> system stock when you finalise the stock counts.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = { ...expandedActiveTypes };
                                                returnedUniqueItems.forEach(r => { next[r.name] = true; });
                                                setExpandedActiveTypes(next);
                                            }}
                                            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors self-start sm:self-center"
                                        >
                                            Show Due Returns
                                        </button>
                                    </div>
                                )}

                                {/* Live Count Breakdown Section */}
                                <div className="mt-8">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Live Count Breakdown</h3>
                                                {filteredActiveGroups.length > 0 && (
                                                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
                                                        {filteredActiveGroups.length} {filteredActiveGroups.length === 1 ? 'item' : 'items'}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                Grouped by product type &bull; Tap any item to inspect recorded scans
                                            </p>
                                        </div>

                                        {activeGroupedItems.length > 0 && (
                                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                                {/* Mobile View Toggle: Cards vs Table */}
                                                <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 sm:hidden self-start">
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveMobileViewMode('cards')}
                                                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                                            activeMobileViewMode === 'cards'
                                                                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-xs'
                                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800'
                                                        }`}
                                                    >
                                                        🗂️ Cards
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveMobileViewMode('table')}
                                                        className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                                            activeMobileViewMode === 'table'
                                                                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-xs'
                                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800'
                                                        }`}
                                                    >
                                                        📊 Table
                                                    </button>
                                                </div>

                                                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                                    {activeAvailableCategories.length > 2 && (
                                                        <select
                                                            value={activeCategoryFilter}
                                                            onChange={(e) => setActiveCategoryFilter(e.target.value)}
                                                            className={formInputStyle + " text-xs py-1.5 w-full sm:w-auto"}
                                                        >
                                                            {activeAvailableCategories.map(cat => (
                                                                <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                    <div className="relative w-full sm:w-56">
                                                        <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                                        <input 
                                                            type="text" 
                                                            placeholder="Search items or barcodes..." 
                                                            value={activeSearchTerm}
                                                            onChange={(e) => setActiveSearchTerm(e.target.value)}
                                                            className={formInputStyle + " text-xs py-1.5 pl-8 pr-7"}
                                                        />
                                                        {activeSearchTerm && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setActiveSearchTerm('')}
                                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs p-0.5"
                                                                title="Clear search"
                                                            >
                                                                &times;
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={toggleAllActiveGroups}
                                                        className="text-xs font-semibold px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto"
                                                    >
                                                        {filteredActiveGroups.length > 0 && filteredActiveGroups.every(g => expandedActiveTypes[g.name]) ? 'Collapse All' : 'Expand All'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {activeGroupedItems.length === 0 ? (
                                        <div className="text-center py-10 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
                                            <ClipboardCheckIcon className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                                            <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">No items counted yet.</p>
                                            <p className="text-xs text-zinc-400 mt-1">Scan any item's barcode to add and count it in this {activeStockTake.type.toLowerCase()} stock take.</p>
                                        </div>
                                    ) : filteredActiveGroups.length === 0 ? (
                                        <div className="text-center py-8 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
                                            <SearchIcon className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                                            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">No matching items found</p>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Try adjusting your search query or category filter.</p>
                                            <button
                                                type="button"
                                                onClick={() => { setActiveSearchTerm(''); setActiveCategoryFilter('All'); }}
                                                className="mt-3 px-3 py-1.5 text-xs font-semibold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                                            >
                                                Reset Filters
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {/* MOBILE VIEW: Item Blocks / Cards */}
                                            <div className={`${activeMobileViewMode === 'cards' ? 'block' : 'hidden'} sm:hidden space-y-3`}>
                                                {filteredActiveGroups.map(group => {
                                                    const hasDiscrepancy = group.variance !== 0;
                                                    const isExpanded = !!expandedActiveTypes[group.name];

                                                    return (
                                                        <div 
                                                            key={group.key}
                                                            className={`rounded-xl border transition-all shadow-xs overflow-hidden ${
                                                                hasDiscrepancy
                                                                    ? group.variance > 0
                                                                        ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/20 dark:bg-emerald-950/15'
                                                                        : 'border-amber-200 dark:border-amber-800/70 bg-amber-50/25 dark:bg-amber-950/20'
                                                                    : 'border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-800/95'
                                                            }`}
                                                        >
                                                            {/* Card Header & Main Info */}
                                                            <div className="p-3.5 pb-3">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 leading-snug">
                                                                                {group.name}
                                                                            </h4>
                                                                            {group.category && group.category !== 'General' && (
                                                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                                                                    {group.category}
                                                                                </span>
                                                                            )}
                                                                            {group.is_unique && (
                                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                                    ⚡ Unique
                                                                                </span>
                                                                            )}
                                                                            {group.returnedCount > 0 && (
                                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title={`Signed out to: ${group.returnedTeams.join(', ')}. Will return to stock on finalise.`}>
                                                                                    ↩️ {group.returnedCount} Due to Return ({group.returnedTeams.join(', ')})
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                                                                            <span className="truncate">{group.barcodeDisplay}</span>
                                                                            <span>&bull;</span>
                                                                            <span className="shrink-0">£{group.price.toFixed(2)} / ea</span>
                                                                        </div>
                                                                    </div>

                                                                    {/* Variance Pill Badge */}
                                                                    <div className="shrink-0 text-right">
                                                                        {hasDiscrepancy ? (
                                                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                                                                                group.variance > 0
                                                                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                                                            }`}>
                                                                                {group.variance > 0 ? `+${group.variance}` : group.variance} var
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                                                                ✓ Balanced
                                                                            </span>
                                                                        )}
                                                                        {hasDiscrepancy && (
                                                                            <span className={`block text-[10px] font-bold mt-0.5 ${group.value_variance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                                                {group.value_variance > 0 ? '+' : ''}{group.value_variance < 0 ? '-' : ''}£{Math.abs(group.value_variance).toFixed(2)}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* 3-Box Metrics Grid */}
                                                                <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-700/60">
                                                                    <div className="bg-zinc-50 dark:bg-zinc-900/60 p-2 rounded-lg text-center border border-zinc-150 dark:border-zinc-700/50">
                                                                        <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Expected</span>
                                                                        <span className="text-sm font-mono font-bold text-zinc-700 dark:text-zinc-300">{group.expected_quantity}</span>
                                                                    </div>
                                                                    {group.returnedCount > 0 && group.returnedCount === group.counted_quantity ? (
                                                                        <div className="bg-amber-50/80 dark:bg-amber-950/40 p-2 rounded-lg text-center border border-amber-200 dark:border-amber-800/60">
                                                                            <span className="block text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 tracking-wider">Due Return</span>
                                                                            <span className="text-sm font-mono font-bold text-amber-700 dark:text-amber-300">↩️ {group.returnedCount}</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="bg-blue-50/70 dark:bg-blue-950/40 p-2 rounded-lg text-center border border-blue-100 dark:border-blue-900/50">
                                                                            <span className="block text-[10px] uppercase font-bold text-blue-500 tracking-wider">Counted</span>
                                                                            <span className="text-sm font-mono font-bold text-blue-700 dark:text-blue-300">{group.counted_quantity}</span>
                                                                            {group.returnedCount > 0 && (
                                                                                <span className="block text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                                                                    ({group.returnedCount} due return)
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    <div className={`p-2 rounded-lg text-center border ${
                                                                        hasDiscrepancy
                                                                            ? group.variance > 0
                                                                                ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50'
                                                                                : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50'
                                                                            : 'bg-zinc-50 dark:bg-zinc-900/60 border-zinc-150 dark:border-zinc-700/50'
                                                                    }`}>
                                                                        <span className={`block text-[10px] uppercase font-bold tracking-wider ${
                                                                            hasDiscrepancy
                                                                                ? group.variance > 0 ? 'text-emerald-600' : 'text-amber-600'
                                                                                : 'text-zinc-400'
                                                                        }`}>Variance</span>
                                                                        <span className={`text-sm font-mono font-bold ${
                                                                            hasDiscrepancy
                                                                                ? group.variance > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                                                                                : 'text-zinc-600 dark:text-zinc-400'
                                                                        }`}>
                                                                            {group.variance > 0 ? `+${group.variance}` : group.variance}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                {/* Quick Action Buttons Row */}
                                                                <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-700/60">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleActiveGroup(group.name)}
                                                                        className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 flex items-center gap-1.5 py-1 px-1.5 rounded transition-colors touch-manipulation"
                                                                    >
                                                                        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : '-rotate-90'}`} />
                                                                        <span>
                                                                            {group.is_unique
                                                                                ? `${group.rawItems.length} Scans / Serials`
                                                                                : `Bulk Qty Summary (${group.counted_quantity}/${group.expected_quantity})`}
                                                                        </span>
                                                                    </button>

                                                                    <div className="flex items-center gap-1.5">
                                                                        {(group.is_unique || (group.category && group.category.toLowerCase().includes('meter')) || group.name.toLowerCase().includes('meter')) && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setRangeCountError('');
                                                                                    const sp = supplierPartNumbers?.find(p => p.item_name === group.name || p.item_types?.name === group.name);
                                                                                    const firstSerial = group.rawItems?.find(r => r.stock_items?.barcode)?.stock_items?.barcode || '';
                                                                                    setRangeCountDetails({
                                                                                        firstSerial: firstSerial,
                                                                                        lastSerial: '',
                                                                                        quantityCount: '',
                                                                                        selectedItemType: group.name,
                                                                                        selectedPartNumber: sp?.part_number || ''
                                                                                    });
                                                                                    setRangeItemSearchQuery(group.name);
                                                                                    setRangeInputMode('endSerial');
                                                                                    setShowRangeSerialsPreview(false);
                                                                                    setIsRangeCountModalOpen(true);
                                                                                }}
                                                                                className="text-xs font-semibold px-2.5 py-1.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors flex items-center gap-1 touch-manipulation"
                                                                                title="Count a serial number range for this product"
                                                                            >
                                                                                <BarcodeIcon className="w-3.5 h-3.5" />
                                                                                <span>Range</span>
                                                                            </button>
                                                                        )}
                                                                        {!group.is_unique && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setQuantityItem(group.rawItems[0]);
                                                                                    setQuantityInput('1');
                                                                                    setIsQuantityModalOpen(true);
                                                                                }}
                                                                                className="text-xs font-bold px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1 touch-manipulation"
                                                                            >
                                                                                <PlusCircleIcon className="w-3.5 h-3.5" />
                                                                                <span>Add Qty</span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Expanded Recorded Scans / Bulk Breakdown List */}
                                                            {isExpanded && (
                                                                <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/50 p-3">
                                                                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 flex justify-between">
                                                                        <span>{group.is_unique ? 'Recorded Scans / Serials' : 'Bulk Barcode Breakdown'}</span>
                                                                        <span>Status</span>
                                                                    </div>
                                                                    <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 divide-y divide-zinc-200/50 dark:divide-zinc-700/50">
                                                                        {group.is_unique ? (
                                                                            group.rawItems.map((raw, idx) => {
                                                                                const isCounted = (raw.counted_quantity || 0) > 0;
                                                                                return (
                                                                                    <div key={raw.id || idx} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs font-mono">
                                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                                            <span className="text-zinc-400 font-sans text-[10px]">#{idx + 1}</span>
                                                                                            <span className="text-zinc-800 dark:text-zinc-200 font-medium truncate">
                                                                                                {raw.stock_items?.barcode || 'No Barcode'}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                                            <span className="text-zinc-500 font-sans text-[11px]">
                                                                                                {raw.counted_quantity || 0} / {raw.expected_quantity ?? 1}
                                                                                            </span>
                                                                                            {raw.returnedFromTeam ? (
                                                                                                <span className="px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                                                                                    ↩️ Due to Return ({raw.returnedFromTeam})
                                                                                                </span>
                                                                                            ) : (
                                                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold ${
                                                                                                    isCounted
                                                                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                                                                                                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                                                                                }`}>
                                                                                                    {isCounted ? 'Counted' : 'Missing'}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        ) : (
                                                                            group.bulkSummaries.map((bulk, idx) => {
                                                                                const exp = bulk.expected_quantity;
                                                                                const cnt = bulk.counted_quantity;
                                                                                const badge = bulk.returnedCount > 0 && bulk.returnedCount === cnt
                                                                                    ? { text: `↩️ Due to Return (${bulk.returnedTeams.join(', ')})`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700' }
                                                                                    : cnt === 0 && exp > 0
                                                                                        ? { text: 'Missing', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' }
                                                                                        : cnt > 0 && cnt < exp
                                                                                            ? { text: `Partial (${exp - cnt} short)`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
                                                                                            : cnt > exp
                                                                                                ? { text: `Counted (+${cnt - exp} surplus)`, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' }
                                                                                                : { text: 'Counted', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' };
                                                                                return (
                                                                                    <div key={bulk.barcode || idx} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs font-mono">
                                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                                            <span className="text-zinc-800 dark:text-zinc-200 font-medium truncate">
                                                                                                {bulk.barcode}
                                                                                            </span>
                                                                                            <span className="font-sans text-[10px] text-zinc-400 shrink-0">(Bulk)</span>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                                            <span className="text-zinc-500 font-sans text-[11px]">
                                                                                                <strong>{cnt}</strong> / {exp}
                                                                                            </span>
                                                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-bold ${badge.cls}`}>
                                                                                                {badge.text}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* DESKTOP TABLE VIEW (or Mobile Table if toggled) */}
                                            <div className={`${activeMobileViewMode === 'table' ? 'block' : 'hidden'} sm:block overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg`}>
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
                                                                                {group.returnedCount > 0 && (
                                                                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title={`Signed out to: ${group.returnedTeams.join(', ')}. Will return to stock on finalise.`}>
                                                                                        ↩️ {group.returnedCount} Due to Return ({group.returnedTeams.join(', ')})
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-zinc-500">
                                                                            {group.barcodeDisplay}
                                                                        </td>
                                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-zinc-500">£{group.price.toFixed(2)}</td>
                                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-zinc-600 dark:text-zinc-400">{group.expected_quantity}</td>
                                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">
                                                                            {group.returnedCount > 0 && group.returnedCount === group.counted_quantity ? (
                                                                                <span className="text-amber-600 dark:text-amber-400">↩️ {group.returnedCount} Due Return</span>
                                                                            ) : (
                                                                                <>
                                                                                    <span>{group.counted_quantity}</span>
                                                                                    {group.returnedCount > 0 && (
                                                                                        <span className="block text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                                                                            ({group.returnedCount} due return)
                                                                                        </span>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                        </td>
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
                                                                                            const sp = supplierPartNumbers?.find(p => p.item_name === group.name || p.item_types?.name === group.name);
                                                                                            const firstSerial = group.rawItems?.find(r => r.stock_items?.barcode)?.stock_items?.barcode || '';
                                                                                            setRangeCountDetails({
                                                                                                firstSerial: firstSerial,
                                                                                                lastSerial: '',
                                                                                                quantityCount: '',
                                                                                                selectedItemType: group.name,
                                                                                                selectedPartNumber: sp?.part_number || ''
                                                                                            });
                                                                                            setRangeItemSearchQuery(group.name);
                                                                                            setRangeInputMode('endSerial');
                                                                                            setShowRangeSerialsPreview(false);
                                                                                            setIsRangeCountModalOpen(true);
                                                                                        }}
                                                                                        className="text-xs font-semibold px-2.5 py-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-100 dark:hover:bg-purple-800 transition-colors flex items-center gap-1"
                                                                                        title="Count a serial number range for this product"
                                                                                    >
                                                                                        <BarcodeIcon className="w-3 h-3" />
                                                                                        <span>Range</span>
                                                                                    </button>
                                                                                )}
                                                                                {!group.is_unique && (
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
                                                                                )}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                    {isExpanded && (
                                                                        <tr className="bg-zinc-50/70 dark:bg-zinc-900/40">
                                                                            <td colSpan="9" className="px-6 py-3">
                                                                                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-800/80 shadow-xs">
                                                                                    <div className="px-3.5 py-2 bg-zinc-100/80 dark:bg-zinc-700/60 text-xs font-semibold text-zinc-600 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                                                                        <span>
                                                                                            {group.is_unique
                                                                                                ? `Recorded Scans / Serial Numbers (${group.rawItems.length})`
                                                                                                : `Bulk Count Summary (${group.bulkSummaries.length} ${group.bulkSummaries.length === 1 ? 'Barcode' : 'Barcodes'})`}
                                                                                        </span>
                                                                                        <span>Expected vs Counted</span>
                                                                                    </div>
                                                                                    <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700 text-xs">
                                                                                        {group.is_unique ? (
                                                                                            group.rawItems.map((raw, idx) => {
                                                                                                const isCounted = (raw.counted_quantity || 0) > 0;
                                                                                                return (
                                                                                                    <div key={raw.id || idx} className="px-3.5 py-2 flex items-center justify-between font-mono">
                                                                                                        <div className="flex items-center gap-2">
                                                                                                            <span className="text-zinc-400 text-[11px] font-sans">#{idx + 1}</span>
                                                                                                            <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                                                                                                                {raw.stock_items?.barcode || 'No Barcode'}
                                                                                                            </span>
                                                                                                        </div>
                                                                                                        <div className="flex items-center gap-2.5">
                                                                                                            <span className="text-zinc-500 font-sans text-xs">
                                                                                                                {raw.returnedFromTeam ? (
                                                                                                                    <>Due Return: <strong>{raw.counted_quantity || 0}</strong> / Expected: {raw.expected_quantity ?? 1}</>
                                                                                                                ) : (
                                                                                                                    <>Counted: <strong>{raw.counted_quantity || 0}</strong> / Expected: {raw.expected_quantity ?? 1}</>
                                                                                                                )}
                                                                                                            </span>
                                                                                                            {raw.returnedFromTeam ? (
                                                                                                                <span className="px-2 py-0.5 rounded text-[11px] font-sans font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                                                                                                    ↩️ Due to Return to System (from {raw.returnedFromTeam})
                                                                                                                </span>
                                                                                                            ) : (
                                                                                                                <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${isCounted ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                                                                                                    {isCounted ? 'Counted' : 'Missing'}
                                                                                                                </span>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            })
                                                                                        ) : (
                                                                                            group.bulkSummaries.map((bulk, idx) => {
                                                                                                const exp = bulk.expected_quantity;
                                                                                                const cnt = bulk.counted_quantity;
                                                                                                const badge = bulk.returnedCount > 0 && bulk.returnedCount === cnt
                                                                                                    ? { text: `↩️ Due to Return to System (from ${bulk.returnedTeams.join(', ')})`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700' }
                                                                                                    : cnt === 0 && exp > 0
                                                                                                        ? { text: 'Missing', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
                                                                                                        : cnt > 0 && cnt < exp
                                                                                                            ? { text: `Partial (${exp - cnt} short)`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
                                                                                                            : cnt > exp
                                                                                                                ? { text: `Counted (+${cnt - exp} surplus)`, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' }
                                                                                                                : { text: 'Counted', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
                                                                                                return (
                                                                                                    <div key={bulk.barcode || idx} className="px-3.5 py-2 flex items-center justify-between font-mono">
                                                                                                        <div className="flex items-center gap-2">
                                                                                                            <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                                                                                                                {bulk.barcode}
                                                                                                            </span>
                                                                                                            <span className="font-sans text-[11px] text-zinc-400">(Non-Unique / Bulk)</span>
                                                                                                        </div>
                                                                                                        <div className="flex items-center gap-2.5">
                                                                                                            <span className="text-zinc-500 font-sans text-xs">
                                                                                                                Counted: <strong>{cnt}</strong> / Expected: {exp}
                                                                                                            </span>
                                                                                                            <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${badge.cls}`}>
                                                                                                                {badge.text}
                                                                                                            </span>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            })
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
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
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Summary by Item Type</h3>
                                        {filteredHistoryGroups.length > 0 && (
                                            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
                                                {filteredHistoryGroups.length} {filteredHistoryGroups.length === 1 ? 'item' : 'items'}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                        Grouped by product type &bull; Discrepancies highlighted &bull; Tap any item to inspect scans
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                    {/* Mobile View Toggle: Cards vs Table */}
                                    <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 sm:hidden self-start">
                                        <button
                                            type="button"
                                            onClick={() => setHistoryMobileViewMode('cards')}
                                            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                                historyMobileViewMode === 'cards'
                                                    ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-xs'
                                                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800'
                                            }`}
                                        >
                                            🗂️ Cards
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setHistoryMobileViewMode('table')}
                                            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                                historyMobileViewMode === 'table'
                                                    ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-xs'
                                                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800'
                                            }`}
                                        >
                                            📊 Table
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                        {historyAvailableCategories.length > 2 && (
                                            <select
                                                value={historyCategoryFilter}
                                                onChange={(e) => setHistoryCategoryFilter(e.target.value)}
                                                className={formInputStyle + " text-xs py-1.5 w-full sm:w-auto"}
                                            >
                                                {historyAvailableCategories.map(cat => (
                                                    <option key={cat} value={cat}>{cat === 'All' ? 'All Categories' : cat}</option>
                                                ))}
                                            </select>
                                        )}
                                        <div className="relative w-full sm:w-56">
                                            <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                            <input 
                                                type="text" 
                                                placeholder="Search items or barcodes..." 
                                                value={historySearchTerm}
                                                onChange={(e) => setHistorySearchTerm(e.target.value)}
                                                className={formInputStyle + " text-xs py-1.5 pl-8 pr-7"}
                                            />
                                            {historySearchTerm && (
                                                <button
                                                    type="button"
                                                    onClick={() => setHistorySearchTerm('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs p-0.5"
                                                    title="Clear search"
                                                >
                                                    &times;
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={toggleAllHistoryGroups}
                                            className="text-xs font-semibold px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors whitespace-nowrap"
                                        >
                                            {filteredHistoryGroups.length > 0 && filteredHistoryGroups.every(g => expandedHistoryTypes[g.name]) ? 'Collapse All' : 'Expand All'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {filteredHistoryGroups.length === 0 ? (
                                <div className="text-center py-8 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4">
                                    <SearchIcon className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">No matching items found</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Try adjusting your search query or category filter.</p>
                                    <button
                                        type="button"
                                        onClick={() => { setHistorySearchTerm(''); setHistoryCategoryFilter('All'); }}
                                        className="mt-3 px-3 py-1.5 text-xs font-semibold bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                                    >
                                        Reset Filters
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* MOBILE VIEW: Item Blocks / Cards */}
                                    <div className={`${historyMobileViewMode === 'cards' ? 'block' : 'hidden'} sm:hidden space-y-3`}>
                                        {filteredHistoryGroups.map(item => {
                                            const hasDiscrepancy = item.variance !== 0;
                                            const isExpanded = !!expandedHistoryTypes[item.name];

                                            return (
                                                <div 
                                                    key={item.key}
                                                    className={`rounded-xl border transition-all shadow-xs overflow-hidden ${
                                                        hasDiscrepancy
                                                            ? item.variance > 0
                                                                ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/20 dark:bg-emerald-950/15'
                                                                : 'border-amber-200 dark:border-amber-800/70 bg-amber-50/25 dark:bg-amber-950/20'
                                                            : 'border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-800/95'
                                                    }`}
                                                >
                                                    {/* Card Header & Main Info */}
                                                    <div className="p-3.5 pb-3">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                                    <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 leading-snug">
                                                                        {item.name}
                                                                    </h4>
                                                                    {item.category && item.category !== 'General' && (
                                                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                                                            {item.category}
                                                                        </span>
                                                                    )}
                                                                    {item.is_unique && (
                                                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                                                            ⚡ Unique
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                                                                    <span className="truncate">{item.barcodeDisplay}</span>
                                                                    <span>&bull;</span>
                                                                    <span className="shrink-0">£{item.price.toFixed(2)} / ea</span>
                                                                </div>
                                                            </div>

                                                            {/* Variance Pill Badge */}
                                                            <div className="shrink-0 text-right">
                                                                {hasDiscrepancy ? (
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${
                                                                        item.variance > 0
                                                                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                                                    }`}>
                                                                        {item.variance > 0 ? `+${item.variance}` : item.variance} var
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                                                        ✓ Balanced
                                                                    </span>
                                                                )}
                                                                {hasDiscrepancy && (
                                                                    <span className={`block text-[10px] font-bold mt-0.5 ${item.value_variance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                                                        {item.value_variance > 0 ? '+' : ''}{item.value_variance < 0 ? '-' : ''}£{Math.abs(item.value_variance).toFixed(2)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* 3-Box Metrics Grid */}
                                                        <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-700/60">
                                                            <div className="bg-zinc-50 dark:bg-zinc-900/60 p-2 rounded-lg text-center border border-zinc-150 dark:border-zinc-700/50">
                                                                <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Expected</span>
                                                                <span className="text-sm font-mono font-bold text-zinc-700 dark:text-zinc-300">{item.expected_quantity}</span>
                                                            </div>
                                                            <div className="bg-blue-50/70 dark:bg-blue-950/40 p-2 rounded-lg text-center border border-blue-100 dark:border-blue-900/50">
                                                                <span className="block text-[10px] uppercase font-bold text-blue-500 tracking-wider">Counted</span>
                                                                <span className="text-sm font-mono font-bold text-blue-700 dark:text-blue-300">{item.counted_quantity}</span>
                                                            </div>
                                                            <div className={`p-2 rounded-lg text-center border ${
                                                                hasDiscrepancy
                                                                    ? item.variance > 0
                                                                        ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50'
                                                                        : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50'
                                                                    : 'bg-zinc-50 dark:bg-zinc-900/60 border-zinc-150 dark:border-zinc-700/50'
                                                            }`}>
                                                                <span className={`block text-[10px] uppercase font-bold tracking-wider ${
                                                                    hasDiscrepancy
                                                                        ? item.variance > 0 ? 'text-emerald-600' : 'text-amber-600'
                                                                        : 'text-zinc-400'
                                                                }`}>Variance</span>
                                                                <span className={`text-sm font-mono font-bold ${
                                                                    hasDiscrepancy
                                                                        ? item.variance > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                                                                        : 'text-zinc-600 dark:text-zinc-400'
                                                                }`}>
                                                                    {item.variance > 0 ? `+${item.variance}` : item.variance}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Expand / Collapse Button for Scans */}
                                                        <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-zinc-100 dark:border-zinc-700/60">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleHistoryGroup(item.name)}
                                                                className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 flex items-center gap-1.5 py-1 px-1.5 rounded transition-colors touch-manipulation w-full justify-between"
                                                            >
                                                                <span className="flex items-center gap-1.5">
                                                                    <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : '-rotate-90'}`} />
                                                                    <span>
                                                                        {item.is_unique
                                                                            ? `${item.rawItems.length} Scans / Serials Recorded`
                                                                            : `Bulk Qty Summary (${item.counted_quantity}/${item.expected_quantity})`}
                                                                    </span>
                                                                </span>
                                                                <span className="text-[11px] text-zinc-400 font-normal">
                                                                    {isExpanded ? 'Hide' : 'View breakdown'}
                                                                </span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Expandable Scans / Bulk Summary List */}
                                                    {isExpanded && (
                                                        <div className="border-t border-zinc-200 dark:border-zinc-700/80 bg-zinc-50/80 dark:bg-zinc-900/60 p-3">
                                                            <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 flex justify-between">
                                                                <span>{item.is_unique ? 'Serial / Barcode' : 'Bulk Barcode'}</span>
                                                                <span>Status</span>
                                                            </div>
                                                            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                                                {item.is_unique ? (
                                                                    item.rawItems.map((raw, idx) => {
                                                                        const isCounted = (raw.counted_quantity || 0) > 0;
                                                                        return (
                                                                            <div key={raw.id || idx} className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between text-xs">
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <span className="text-zinc-400 text-[10px]">#{idx + 1}</span>
                                                                                    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                                                                        {raw.stock_items?.barcode || 'No Barcode'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2 shrink-0">
                                                                                    <span className="text-[11px] text-zinc-500 font-mono">
                                                                                        {raw.counted_quantity || 0}/{raw.expected_quantity ?? 1}
                                                                                    </span>
                                                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                                                        isCounted 
                                                                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' 
                                                                                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                                                                    }`}>
                                                                                        {isCounted ? 'Counted' : 'Missing'}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    item.bulkSummaries.map((bulk, idx) => {
                                                                        const exp = bulk.expected_quantity;
                                                                        const cnt = bulk.counted_quantity;
                                                                        const badge = cnt === 0 && exp > 0
                                                                            ? { text: 'Missing', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
                                                                            : cnt > 0 && cnt < exp
                                                                                ? { text: `Partial (${exp - cnt} short)`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
                                                                                : cnt > exp
                                                                                    ? { text: `Counted (+${cnt - exp} surplus)`, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' }
                                                                                    : { text: 'Counted', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
                                                                        return (
                                                                            <div key={bulk.barcode || idx} className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200/70 dark:border-zinc-700/60 flex items-center justify-between text-xs">
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                                                                        {bulk.barcode}
                                                                                    </span>
                                                                                    <span className="text-[10px] text-zinc-400 shrink-0">(Bulk)</span>
                                                                                </div>
                                                                                <div className="flex items-center gap-2 shrink-0">
                                                                                    <span className="text-[11px] text-zinc-500 font-mono">
                                                                                        {cnt}/{exp}
                                                                                    </span>
                                                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>
                                                                                        {badge.text}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* DESKTOP VIEW (or Mobile Table Mode) */}
                                    <div className={`${historyMobileViewMode === 'table' ? 'block' : 'hidden'} sm:block overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg`}>
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
                                                {filteredHistoryGroups.map(item => {
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
                                                                                <span>
                                                                                    {item.is_unique
                                                                                        ? `Recorded Scans / Serial Numbers (${item.rawItems.length})`
                                                                                        : `Bulk Count Summary (${item.bulkSummaries.length} ${item.bulkSummaries.length === 1 ? 'Barcode' : 'Barcodes'})`}
                                                                                </span>
                                                                                <span>Expected vs Counted</span>
                                                                            </div>
                                                                            <div className="max-h-56 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-700 text-xs">
                                                                                {item.is_unique ? (
                                                                                    item.rawItems.map((raw, idx) => {
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
                                                                                    })
                                                                                ) : (
                                                                                    item.bulkSummaries.map((bulk, idx) => {
                                                                                        const exp = bulk.expected_quantity;
                                                                                        const cnt = bulk.counted_quantity;
                                                                                        const badge = cnt === 0 && exp > 0
                                                                                            ? { text: 'Missing', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
                                                                                            : cnt > 0 && cnt < exp
                                                                                                ? { text: `Partial (${exp - cnt} short)`, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
                                                                                                : cnt > exp
                                                                                                    ? { text: `Counted (+${cnt - exp} surplus)`, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' }
                                                                                                    : { text: 'Counted', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
                                                                                        return (
                                                                                            <div key={bulk.barcode || idx} className="px-3.5 py-2 flex items-center justify-between font-mono">
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                                                                                                        {bulk.barcode}
                                                                                                    </span>
                                                                                                    <span className="font-sans text-[11px] text-zinc-400">(Non-Unique / Bulk)</span>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-3">
                                                                                                    <span className="text-zinc-500 font-sans text-xs">
                                                                                                        Counted: <strong>{cnt}</strong> / Expected: {exp}
                                                                                                    </span>
                                                                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${badge.cls}`}>
                                                                                                        {badge.text}
                                                                                                    </span>
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
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
                {(() => {
                    const isStockTakeLocationSelected = Boolean(stockTakeLocation && stockTakeLocation !== 'All');
                    return (
                        <div className="space-y-4 py-4">
                            <div>
                                <label htmlFor="st-location-scope" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    Storehouse / Location Scope <span className="text-red-500 font-bold">*</span>
                                </label>
                                <select
                                    id="st-location-scope"
                                    value={stockTakeLocation}
                                    onChange={(e) => setStockTakeLocation(e.target.value)}
                                    className={`py-2.5 w-full px-3 rounded-md shadow-xs text-sm focus:outline-none transition-all ${
                                        !isStockTakeLocationSelected
                                            ? 'border-2 border-amber-500 dark:border-amber-400 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100 font-semibold ring-2 ring-amber-400/30 focus:ring-amber-500 focus:border-amber-500'
                                            : `${formInputStyle} border-emerald-500/70 dark:border-emerald-600/70`
                                    }`}
                                    required
                                >
                                    <option value="" disabled>-- Please select storehouse / location --</option>
                                    {locationsList.map(loc => (
                                        <option key={loc} value={loc}>{loc}</option>
                                    ))}
                                </select>
                                {!isStockTakeLocationSelected ? (
                                    <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                                        <AlertTriangleIcon className="w-3.5 h-3.5 shrink-0" />
                                        <span>Required: Please choose which storehouse is being audited.</span>
                                    </div>
                                ) : (
                                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                        Audits only inventory physically stored in <strong>{stockTakeLocation}</strong>.
                                    </p>
                                )}
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
                            <button
                                type="button"
                                disabled={!isStockTakeLocationSelected}
                                title={!isStockTakeLocationSelected ? 'Select a storehouse / location first' : undefined}
                                onClick={handleInitiateStockTake}
                                className="w-full mt-4 flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed"
                            >
                                Start Count
                            </button>
                        </div>
                    );
                })()}
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
                    {returnedUniqueItems.length > 0 && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                            <p className="font-bold">
                                ↩️ Returned Unique Items ({returnedUniqueItems.length})
                            </p>
                            <p>
                                The following counted serials are currently signed out to teams and will be automatically <strong>returned back to {activeStockTake?.location || 'storehouse'} stock</strong>:
                            </p>
                            <div className="max-h-28 overflow-y-auto space-y-1 pt-1 font-mono text-[11px]">
                                {returnedUniqueItems.map((r, idx) => (
                                    <div key={r.id || idx} className="flex items-center justify-between gap-2 bg-white/70 dark:bg-zinc-900/50 px-2 py-1 rounded border border-amber-200/70 dark:border-amber-800/50">
                                        <span className="truncate font-semibold">{r.barcode} ({r.name})</span>
                                        <span className="font-sans text-[10px] shrink-0 text-amber-800 dark:text-amber-300">from {r.fromTeam}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
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
                                {(() => {
                                    const targetName = quantityItem.stock_items?.name || stockMap.get(quantityItem.item_id)?.name || '';
                                    const matchingRows = targetName
                                        ? stockTakeItems.filter(i => (i.stock_items?.name || stockMap.get(i.item_id)?.name || '') === targetName)
                                        : stockTakeItems.filter(i => (i.stock_items?.barcode || '') === (quantityItem.stock_items?.barcode || ''));
                                    const expTotal = matchingRows.reduce((acc, i) => acc + (i.expected_quantity ?? 1), 0);
                                    const cntTotal = matchingRows.reduce((acc, i) => acc + (i.counted_quantity || 0), 0);
                                    return (
                                        <>
                                            <div>
                                                <span className="text-zinc-500 dark:text-zinc-400">Expected: </span>
                                                <span className="font-semibold text-zinc-800 dark:text-zinc-200">{expTotal}</span>
                                            </div>
                                            <div>
                                                <span className="text-zinc-500 dark:text-zinc-400">Current Total Count: </span>
                                                <span className="font-bold text-blue-600 dark:text-blue-400">{cntTotal}</span>
                                            </div>
                                        </>
                                    );
                                })()}
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

            {/* Enhanced Serial Number Range Count Modal */}
            <Modal 
                isOpen={isRangeCountModalOpen} 
                onClose={() => { 
                    setIsRangeCountModalOpen(false); 
                    setRangeCountError(''); 
                    setShowRangeSerialsPreview(false);
                }} 
                title="Serial Number Range Count"
                maxWidth="max-w-2xl"
            >
                <form onSubmit={handleRangeCountSubmit} className="space-y-4">
                    {/* Header Storehouse & Scope Banner */}
                    <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-700/80 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                📍 Storehouse:
                            </span>
                            <span className="px-2 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300">
                                {activeStockTake?.location || 'Storehouse'}
                            </span>
                        </div>
                        <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">
                            {activeStockTake?.type === 'FULL' ? 'Full Store Audit' : 'Rolling Audit'}
                        </span>
                    </div>

                    {/* Section 1: Product & Part Number Identification */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Product & Part Number
                            </label>
                            {selectedRangeProductMeta && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRangeCountDetails(prev => ({ ...prev, selectedItemType: '', selectedPartNumber: '' }));
                                        setRangeItemSearchQuery('');
                                    }}
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    Change Product
                                </button>
                            )}
                        </div>

                        {selectedRangeProductMeta ? (
                            /* Selected Product Card Banner with Part Number Highlighted */
                            <div className="p-3.5 bg-gradient-to-r from-purple-50/60 to-blue-50/60 dark:from-purple-950/30 dark:to-blue-950/30 rounded-xl border border-purple-200/80 dark:border-purple-800/60">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="font-bold text-base text-zinc-900 dark:text-white">
                                                {selectedRangeProductMeta.itemType.name}
                                            </h4>
                                            {selectedRangeProductMeta.category && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 font-medium">
                                                    {selectedRangeProductMeta.category}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs font-mono">
                                            {selectedRangeProductMeta.partNumber ? (
                                                <span className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
                                                    <TagIcon className="w-3.5 h-3.5" />
                                                    Part #: {selectedRangeProductMeta.partNumber}
                                                </span>
                                            ) : (
                                                <span className="text-zinc-500 font-sans italic">
                                                    No supplier part # configured
                                                </span>
                                            )}
                                            {selectedRangeProductMeta.supplierName && (
                                                <span className="text-zinc-600 dark:text-zinc-300 font-sans">
                                                    Supplier: <strong>{selectedRangeProductMeta.supplierName}</strong>
                                                </span>
                                            )}
                                            {selectedRangeProductMeta.price > 0 && (
                                                <span className="text-zinc-600 dark:text-zinc-300 font-sans">
                                                    £{selectedRangeProductMeta.price.toFixed(2)}/ea
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className="block text-[10px] uppercase font-bold text-zinc-400">Current Stock Take</span>
                                        <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
                                            {selectedRangeProductMeta.countedCount} / {selectedRangeProductMeta.expectedCount} Counted
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* Product / Part Number Search & Dropdown */
                            <div className="space-y-2">
                                <div className="relative">
                                    <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={rangeItemSearchQuery}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setRangeItemSearchQuery(val);
                                            if (val.trim().length >= 2 && !hasLongerRangeCandidate(val)) {
                                                const resolved = resolveUniqueItemType(val);
                                                if (resolved) {
                                                    selectResolvedRangeProduct(resolved, val);
                                                }
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const resolved = resolveUniqueItemType(rangeItemSearchQuery);
                                                if (resolved) {
                                                    selectResolvedRangeProduct(resolved, rangeItemSearchQuery);
                                                } else if (filteredRangeItemTypes.length === 1) {
                                                    selectResolvedRangeProduct(filteredRangeItemTypes[0], rangeItemSearchQuery);
                                                }
                                            }
                                        }}
                                        placeholder="Scan or type Part Number (e.g. PN-EMLITE-01), Barcode, or Product Name..."
                                        className={`${formInputStyle} pl-9 text-sm font-mono`}
                                        autoFocus
                                    />
                                    {rangeItemSearchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setRangeItemSearchQuery('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-sm p-0.5"
                                        >
                                            &times;
                                        </button>
                                    )}
                                </div>

                                <select
                                    id="range-item-type"
                                    value={rangeCountDetails.selectedItemType}
                                    onChange={(e) => {
                                        const name = e.target.value;
                                        const selectedIt = itemTypes.find(t => t.name === name);
                                        const sp = supplierPartNumbers?.find(p => (selectedIt?.id != null && p.item_type_id === selectedIt.id) || p.item_name === name || p.item_types?.name === name);
                                        setRangeCountDetails(prev => ({ 
                                            ...prev, 
                                            selectedItemType: name,
                                            selectedPartNumber: sp?.part_number || ''
                                        }));
                                    }}
                                    className={formInputStyle}
                                >
                                    <option value="">-- Select Product / Part Number --</option>
                                    {filteredRangeItemTypes.map(it => {
                                        const partInfo = supplierPartNumbers?.find(sp => (it.id != null && sp.item_type_id === it.id) || sp.item_name === it.name || sp.item_types?.name === it.name);
                                        const partNum = partInfo?.part_number ? ` [Part #: ${partInfo.part_number}]` : '';
                                        const bc = it.barcode ? ` [BC: ${it.barcode}]` : '';
                                        return (
                                            <option key={it.id || it.name} value={it.name}>
                                                {it.name}{partNum}{bc} {it.category ? `(${it.category})` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                                {filteredRangeItemTypes.length === 0 && rangeItemSearchQuery && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400">
                                        No items or part numbers matched "{rangeItemSearchQuery}".
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Section 2: Range Input Controls (Dual Mode: By End Serial vs By Box Quantity) */}
                    <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                Serial Number Range
                            </span>
                            {/* Mode switcher tabs */}
                            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs">
                                <button
                                    type="button"
                                    onClick={() => setRangeInputMode('endSerial')}
                                    className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                                        rangeInputMode === 'endSerial'
                                            ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-2xs'
                                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                                    }`}
                                >
                                    By End Serial
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRangeInputMode('quantity')}
                                    className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                                        rangeInputMode === 'quantity'
                                            ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-2xs'
                                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                                    }`}
                                >
                                    By Box Quantity
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="range-first-serial" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                    First Serial Number
                                </label>
                                <input
                                    type="text"
                                    id="range-first-serial"
                                    value={rangeCountDetails.firstSerial}
                                    onChange={(e) => {
                                        const start = e.target.value;
                                        setRangeCountDetails(prev => {
                                            const updated = { ...prev, firstSerial: start };
                                            if (rangeInputMode === 'quantity' && prev.quantityCount) {
                                                updated.lastSerial = calculateEndSerial(start, prev.quantityCount);
                                            } else if (rangeInputMode === 'endSerial' && prev.lastSerial) {
                                                updated.quantityCount = calculateRangeQuantity(start, prev.lastSerial);
                                            }
                                            return updated;
                                        });
                                    }}
                                    placeholder="e.g. MTR-2024-001"
                                    className={`${formInputStyle} font-mono text-sm`}
                                    required
                                />
                            </div>

                            {rangeInputMode === 'endSerial' ? (
                                <div>
                                    <label htmlFor="range-last-serial" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                        Last Serial Number
                                    </label>
                                    <input
                                        type="text"
                                        id="range-last-serial"
                                        value={rangeCountDetails.lastSerial}
                                        onChange={(e) => {
                                            const end = e.target.value;
                                            setRangeCountDetails(prev => ({
                                                ...prev,
                                                lastSerial: end,
                                                quantityCount: calculateRangeQuantity(prev.firstSerial, end)
                                            }));
                                        }}
                                        placeholder="e.g. MTR-2024-050"
                                        className={`${formInputStyle} font-mono text-sm`}
                                        required
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label htmlFor="range-quantity" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                        Box Quantity (Units)
                                    </label>
                                    <input
                                        type="number"
                                        id="range-quantity"
                                        min="1"
                                        max="1000"
                                        value={rangeCountDetails.quantityCount}
                                        onChange={(e) => {
                                            const qty = e.target.value;
                                            setRangeCountDetails(prev => ({
                                                ...prev,
                                                quantityCount: qty,
                                                lastSerial: calculateEndSerial(prev.firstSerial, qty)
                                            }));
                                        }}
                                        placeholder="e.g. 50"
                                        className={`${formInputStyle} font-mono text-sm`}
                                        required
                                    />
                                </div>
                            )}
                        </div>

                        {/* Quick Box Quantity Shortcut Chips */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] text-zinc-400 font-medium">Quick Box Size:</span>
                            {[10, 20, 25, 50, 100].map(qty => (
                                <button
                                    key={qty}
                                    type="button"
                                    onClick={() => {
                                        setRangeCountDetails(prev => ({
                                            ...prev,
                                            quantityCount: String(qty),
                                            lastSerial: calculateEndSerial(prev.firstSerial, qty)
                                        }));
                                    }}
                                    className="px-2 py-0.5 text-xs font-semibold rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 transition-colors"
                                >
                                    +{qty}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Section 3: Error or Mindful Range Inventory Preview */}
                    {rangeCountError ? (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-xs border border-red-200 dark:border-red-800">
                            {rangeCountError}
                        </div>
                    ) : rangeCountProcessingResult.error ? (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-xs border border-red-200 dark:border-red-800">
                            {rangeCountProcessingResult.error}
                        </div>
                    ) : rangeCountProcessingResult.serials.length > 0 ? (
                        <div className="p-3.5 bg-zinc-50 dark:bg-zinc-900/70 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2.5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold">
                                        ✓
                                    </span>
                                    <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                                        Valid Range: {rangeCountProcessingResult.count} Units
                                    </span>
                                </div>
                                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                                    {rangeCountProcessingResult.serials[0]} &rarr; {rangeCountProcessingResult.serials[rangeCountProcessingResult.serials.length - 1]}
                                </span>
                            </div>

                            {/* Mindful Inventory Breakdown */}
                            {rangeCountProcessingResult.inventoryStats && (
                                <div className={`grid ${rangeCountProcessingResult.inventoryStats.returnedCount > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2 pt-1 text-center text-xs`}>
                                    <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <span className="block text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Existing In Stock</span>
                                        <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">
                                            {rangeCountProcessingResult.inventoryStats.existingCount} units
                                        </span>
                                    </div>
                                    {rangeCountProcessingResult.inventoryStats.returnedCount > 0 && (
                                        <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg border border-amber-200 dark:border-amber-800/60">
                                            <span className="block text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Pending Return</span>
                                            <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                                                ↩️ {rangeCountProcessingResult.inventoryStats.returnedCount} units
                                            </span>
                                        </div>
                                    )}
                                    <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg border border-purple-200 dark:border-purple-800/60">
                                        <span className="block text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400">New for Part #</span>
                                        <span className="font-mono font-bold text-purple-700 dark:text-purple-300">
                                            +{rangeCountProcessingResult.inventoryStats.newCount} new
                                        </span>
                                    </div>
                                    <div className="bg-white dark:bg-zinc-800 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
                                        <span className="block text-[10px] uppercase font-bold text-zinc-400">Already Counted</span>
                                        <span className="font-mono font-bold text-zinc-600 dark:text-zinc-400">
                                            {rangeCountProcessingResult.inventoryStats.alreadyCountedCount} units
                                        </span>
                                    </div>
                                </div>
                            )}

                            {rangeCountProcessingResult.inventoryStats?.returnedCount > 0 && (
                                <p className="text-[11px] text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-md border border-amber-300 dark:border-amber-700/70">
                                    ↩️ <strong>Signed Out Items Detected:</strong> {rangeCountProcessingResult.inventoryStats.returnedCount} serial(s) in this range are currently signed out to{' '}
                                    <strong>{rangeCountProcessingResult.inventoryStats.returnedTeams.join(', ')}</strong>. Scanning them marks them as pending return so they will be returned back to{' '}
                                    <strong>{activeStockTake?.location || 'this storehouse'}</strong> system stock when you finalise.
                                </p>
                            )}

                            {/* Mindful Context Callout */}
                            {rangeCountProcessingResult.inventoryStats?.newCount > 0 && selectedRangeProductMeta && (
                                <p className="text-[11px] text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 p-2 rounded-md border border-purple-200 dark:border-purple-800/40">
                                    ✨ <strong>Part Number Association:</strong> {rangeCountProcessingResult.inventoryStats.newCount} unrecognised serials will automatically be registered as new inventory under Part Number <strong>{selectedRangeProductMeta.partNumber || selectedRangeProductMeta.itemType.name}</strong> at {activeStockTake?.location || 'this storehouse'}.
                                </p>
                            )}

                            {/* Toggleable Serials Preview List */}
                            <div className="pt-1">
                                <button
                                    type="button"
                                    onClick={() => setShowRangeSerialsPreview(prev => !prev)}
                                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                    <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${showRangeSerialsPreview ? 'rotate-180' : '-rotate-90'}`} />
                                    <span>{showRangeSerialsPreview ? 'Hide Serial Numbers' : `Preview All ${rangeCountProcessingResult.count} Serials`}</span>
                                </button>

                                {showRangeSerialsPreview && (
                                    <div className="mt-2 max-h-48 overflow-y-auto space-y-1 pr-1 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-800">
                                        {rangeCountProcessingResult.serialDetails.map((s, idx) => (
                                            <div key={s.serial} className="flex items-center justify-between text-xs font-mono py-1 px-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700/50">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-zinc-400 font-sans w-5">#{idx + 1}</span>
                                                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{s.serial}</span>
                                                </div>
                                                <span className={`text-[10px] font-sans px-1.5 py-0.5 rounded font-bold ${
                                                    s.isReturned
                                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                                                        : s.isAlreadyCounted
                                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                                            : s.isNew
                                                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                }`}>
                                                    {s.isReturned
                                                        ? `↩️ Signed Out (${s.assignedTo}) — Will Return`
                                                        : s.isAlreadyCounted
                                                            ? 'Already Counted'
                                                            : s.isNew
                                                                ? '✨ New Serial'
                                                                : '✓ In Stock'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}

                    {/* Section 4: Modal Actions */}
                    <div className="flex justify-end space-x-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                        <button
                            type="button"
                            onClick={() => {
                                setIsRangeCountModalOpen(false);
                                setRangeCountError('');
                                setShowRangeSerialsPreview(false);
                            }}
                            className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={rangeCountSubmitting || !!rangeCountProcessingResult.error || rangeCountProcessingResult.serials.length === 0}
                            className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-900/40 disabled:cursor-not-allowed flex items-center justify-center min-w-[150px] shadow-xs"
                        >
                            {rangeCountSubmitting ? <Spinner className="w-4 h-4 mr-2" /> : null}
                            {rangeCountSubmitting 
                                ? 'Counting...' 
                                : `Count ${rangeCountProcessingResult.count || 0} Units${rangeCountProcessingResult.inventoryStats?.returnedCount > 0 ? ` (${rangeCountProcessingResult.inventoryStats.returnedCount} Return to Stock)` : ''}${selectedRangeProductMeta?.partNumber ? ` (PN: ${selectedRangeProductMeta.partNumber})` : ''}`}
                        </button>
                    </div>
                </form>
            </Modal>
        </Page>
    );
};

export default StockTakePage;
