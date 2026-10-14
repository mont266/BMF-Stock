import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Team, StockCategory } from '../types';
import Modal from './Modal';
import {
  ChartBarIcon,
  PlusCircleIcon,
  ArrowRightCircleIcon,
  DocumentArrowDownIcon,
  RefreshIcon,
  SearchIcon,
  BarcodeIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  UsersIcon,
  BoxIcon,
  TagIcon,
  ChevronDownIcon
} from './Icons';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { trainingManager } from '../lib/trainingEnvironment';

const formInputStyle = "mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-md shadow-sm placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 focus:border-transparent sm:text-sm";

const Spinner = ({ className = "w-5 h-5" }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const StatCard = ({ title, badge, value, icon, colorClass, subtitle }) => (
  <div className="h-full flex flex-col justify-between bg-white dark:bg-zinc-800/80 p-3 sm:p-4 md:p-5 rounded-xl shadow-xs sm:shadow-sm border border-zinc-200 dark:border-zinc-700/80 transition-all hover:border-zinc-300 dark:hover:border-zinc-600">
    <div className="flex items-start justify-between gap-1.5 mb-2">
      <div className="min-w-0 pr-1 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[11px] sm:text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
            {title}
          </p>
          {badge && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 uppercase tracking-normal shrink-0">
              {badge}
            </span>
          )}
        </div>
      </div>
      <div className={`rounded-lg p-1.5 sm:p-2 ${colorClass} text-white shrink-0 shadow-xs flex items-center justify-center`}>
        {icon}
      </div>
    </div>
    <div className="mt-auto">
      <p className="text-xl sm:text-2xl md:text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
        {value}
      </p>
      {subtitle && (
        <p className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate leading-tight">
          {subtitle}
        </p>
      )}
    </div>
  </div>
);

// Helper to detect if serial numbers form a consecutive sequence
const formatSerialRangeDisplay = (serials) => {
  if (!serials || serials.length === 0) return '';
  if (serials.length === 1) return serials[0];
  if (serials.length <= 3) return serials.join(', ');
  
  const first = serials[0];
  const last = serials[serials.length - 1];
  return `${first} ... ${last} (${serials.length} serials)`;
};

export const ReportingPage = ({
  teams = [],
  dbLocations = [],
  filters,
  setFilters,
  reportData,
  setReportData,
  loading,
  setLoading,
  itemTypes = [],
  stock = [],
  supplierPartNumbers: propSupplierPartNumbers = [],
  partNumberLookupMap = {},
  suppliers = [],
  userProfile,
  selectedProfile,
  profiles = [],
  setError,
  isTrainingMode = false
}) => {
  const [activeTab, setActiveTab] = useState('movements'); // 'movements', 'audit', 'assigned', 'thresholds'
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [mobileTabDropdownOpen, setMobileTabDropdownOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [csvModalData, setCsvModalData] = useState(null);

  const REPORT_TABS = useMemo(() => [
    { id: 'movements', label: 'Sign In / Sign Out History', icon: <ChartBarIcon className="w-4 h-4" /> },
    { id: 'audit', label: 'Meter & Serial Audit Trail', icon: <BarcodeIcon className="w-4 h-4" /> },
    { id: 'assigned', label: 'Assigned Stock by Team', icon: <UsersIcon className="w-4 h-4" /> },
    { id: 'thresholds', label: 'Stock Thresholds & Replenishment', icon: <AlertTriangleIcon className="w-4 h-4" /> },
  ], []);

  const currentTab = useMemo(() => {
    return REPORT_TABS.find(t => t.id === activeTab) || REPORT_TABS[0];
  }, [REPORT_TABS, activeTab]);

  // Helper to resolve email addresses or unknown users to the user's active profile name
  const formatUsername = useCallback((username) => {
    if (!username) return 'System';
    if (username.includes('@')) {
      if (userProfile?.email && username.toLowerCase() === userProfile.email.toLowerCase()) {
        return selectedProfile?.name || userProfile?.full_name || username.split('@')[0];
      }
      if (profiles && profiles.length > 0) {
        const match = profiles.find(p => p.email && p.email.toLowerCase() === username.toLowerCase());
        if (match) return match.name;
      }
      if (selectedProfile?.name) return selectedProfile.name;
      if (userProfile?.full_name) return userProfile.full_name;
      return username.split('@')[0];
    }
    return username;
  }, [userProfile, selectedProfile, profiles]);
  
  // Extra filter states
  const [movementTypeFilter, setMovementTypeFilter] = useState('ALL'); // 'ALL', 'OUT', 'IN'
  const [uniqueOnlyFilter, setUniqueOnlyFilter] = useState('ALL'); // 'ALL', 'UNIQUE_ONLY', 'BULK_ONLY'
  const [textSearch, setTextSearch] = useState('');
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(true); // Collapsed by default

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (movementTypeFilter !== 'ALL') count++;
    if (uniqueOnlyFilter !== 'ALL') count++;
    if (filters.team && filters.team !== 'All') count++;
    if (filters.location && filters.location !== 'All') count++;
    if (filters.partNumber && filters.partNumber.trim()) count++;
    if (filters.itemName && filters.itemName !== 'All') count++;
    if (textSearch && textSearch.trim()) count++;
    return count;
  }, [movementTypeFilter, uniqueOnlyFilter, filters.team, filters.location, filters.partNumber, filters.itemName, textSearch]);

  // Selected batch for viewing all serial numbers modal
  const [viewSerialsModalData, setViewSerialsModalData] = useState(null);
  const [serialSearchTerm, setSerialSearchTerm] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(null);

  // Meter & Serial Audit Trail state
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [activeAuditSerial, setActiveAuditSerial] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditTrailMovements, setAuditTrailMovements] = useState([]);
  const [auditActiveStockItem, setAuditActiveStockItem] = useState(null);
  const [auditPartNumberFilter, setAuditPartNumberFilter] = useState('All');

  // Assigned stock search & filter
  const [assignedTeamFilter, setAssignedTeamFilter] = useState('All');
  const [assignedSearchTerm, setAssignedSearchTerm] = useState('');
  const [assignedPartFilter, setAssignedPartFilter] = useState('All');
  const [expandedTeamItemKey, setExpandedTeamItemKey] = useState(null);

  // Part Number modal details state
  const [viewAssociatedBarcodesModal, setViewAssociatedBarcodesModal] = useState(null);
  const [barcodeSearchModalTerm, setBarcodeSearchModalTerm] = useState('');

  // Fallback state for supplier part numbers if not passed from parent
  const [localSupplierPartNumbers, setLocalSupplierPartNumbers] = useState([]);

  useEffect(() => {
    if (!propSupplierPartNumbers || propSupplierPartNumbers.length === 0) {
      const fetchParts = async () => {
        try {
          const { data, error } = await supabase
            .from('item_supplier_part_numbers')
            .select('*, suppliers(id, name), item_types(id, name, category, barcode)')
            .order('id', { ascending: false });
          if (!error && data) {
            setLocalSupplierPartNumbers(data);
          }
        } catch (e) {
          console.warn("Could not fetch supplier part numbers in ReportingPage:", e.message);
        }
      };
      fetchParts();
    }
  }, [propSupplierPartNumbers]);

  const effectiveSupplierPartNumbers = useMemo(() => {
    return propSupplierPartNumbers && propSupplierPartNumbers.length > 0
      ? propSupplierPartNumbers
      : localSupplierPartNumbers;
  }, [propSupplierPartNumbers, localSupplierPartNumbers]);

  // Unique list of supplier part numbers for filter dropdowns
  const availableSupplierPartNumbers = useMemo(() => {
    const list = [];
    const seen = new Set();
    (effectiveSupplierPartNumbers || []).forEach(sp => {
      const pn = (sp.part_number || '').trim();
      if (pn && !seen.has(pn.toLowerCase())) {
        seen.add(pn.toLowerCase());
        const supName = sp.suppliers?.name || sp.supplier_name || 'Supplier';
        const itemName = sp.item_types?.name || 'Item';
        list.push({
          partNumber: pn,
          supplierName: supName,
          itemName,
          barcode: sp.barcode || '',
          itemTypeId: sp.item_type_id
        });
      }
    });
    return list.sort((a, b) => a.partNumber.localeCompare(b.partNumber));
  }, [effectiveSupplierPartNumbers]);

  // Map item names to unique status / meter category
  const itemTypeMap = useMemo(() => {
    const map = new Map();
    itemTypes.forEach(t => {
      const isMeter = (t.category || '').toLowerCase() === 'meters' || t.category === StockCategory.METERS;
      const isUnique = Boolean(t.is_unique || isMeter);
      map.set(t.name, { ...t, isMeter, isUnique });
    });
    return map;
  }, [itemTypes]);

  const isUniqueItem = useCallback((name) => {
    const info = itemTypeMap.get(name);
    return Boolean(info?.isUnique || info?.isMeter);
  }, [itemTypeMap]);

  // Unique item names for dropdown
  const uniqueItemNames = useMemo(() => {
    const names = new Set(stock.map(item => item.name));
    itemTypes.forEach(t => names.add(t.name));
    return ['All', ...Array.from(names).sort()];
  }, [stock, itemTypes]);

  // --- PART NUMBER IDENTIFICATION & BARCODE MAPPING ENGINE ---
  // Identifies every barcode (supplier barcodes, item barcodes, unique meter serial barcodes) linked to a part number
  const getPartNumberAssociations = useCallback((partQuery) => {
    if (!partQuery || !partQuery.trim()) {
      return null;
    }
    const cleanQuery = partQuery.trim().toLowerCase();

    // 1. Find all matching records in supplier part numbers
    const matchingParts = (effectiveSupplierPartNumbers || []).filter(sp => {
      const pn = String(sp.part_number || '').trim().toLowerCase();
      return pn === cleanQuery || pn.includes(cleanQuery);
    });

    const supplierNames = new Set();
    const explicitSupplierBarcodes = new Set();
    const itemTypeIds = new Set();
    const itemNames = new Set();
    const matchedPartNumbers = new Set();

    matchingParts.forEach(sp => {
      if (sp.part_number) matchedPartNumbers.add(sp.part_number);
      const sName = sp.suppliers?.name || sp.supplier_name;
      if (sName) supplierNames.add(sName);
      if (sp.barcode && String(sp.barcode).trim()) {
        explicitSupplierBarcodes.add(String(sp.barcode).trim());
      }
      if (sp.item_type_id) itemTypeIds.add(sp.item_type_id);
      if (sp.item_types?.name) itemNames.add(sp.item_types.name);
    });

    // 2. Cross-reference itemTypes
    const itemTypeBarcodes = new Set();
    itemTypes.forEach(it => {
      if (itemTypeIds.has(it.id) || itemNames.has(it.name)) {
        itemNames.add(it.name);
        itemTypeIds.add(it.id);
        if (it.barcode && String(it.barcode).trim()) {
          itemTypeBarcodes.add(String(it.barcode).trim());
        }
      }
    });

    // 3. Find all barcodes & unique serial numbers from stock_items
    const stockBarcodes = new Set();
    const uniqueMeterSerials = new Set();
    let meterCount = 0;

    stock.forEach(item => {
      const matchById = item.item_type_id && itemTypeIds.has(item.item_type_id);
      const matchByName = item.name && itemNames.has(item.name);
      if (matchById || matchByName) {
        if (item.barcode && String(item.barcode).trim()) {
          const bc = String(item.barcode).trim();
          stockBarcodes.add(bc);
          if (isUniqueItem(item.name)) {
            uniqueMeterSerials.add(bc);
            meterCount++;
          }
        }
        if (item.serial_number && String(item.serial_number).trim()) {
          const sn = String(item.serial_number).trim();
          stockBarcodes.add(sn);
          uniqueMeterSerials.add(sn);
        }
      }
    });

    // 4. Combine all candidate barcodes into one unified set
    const allBarcodes = new Set([
      ...explicitSupplierBarcodes,
      ...itemTypeBarcodes,
      ...stockBarcodes,
      partQuery.trim()
    ]);

    return {
      query: partQuery.trim(),
      matchedPartNumbers: Array.from(matchedPartNumbers),
      suppliers: Array.from(supplierNames),
      itemNames: Array.from(itemNames),
      explicitSupplierBarcodes: Array.from(explicitSupplierBarcodes),
      itemTypeBarcodes: Array.from(itemTypeBarcodes),
      uniqueMeterSerials: Array.from(uniqueMeterSerials),
      stockBarcodes: Array.from(stockBarcodes),
      allBarcodes: Array.from(allBarcodes),
      meterCount,
      totalBarcodesCount: allBarcodes.size,
      hasMatches: matchingParts.length > 0 || allBarcodes.size > 1
    };
  }, [effectiveSupplierPartNumbers, itemTypes, stock, isUniqueItem]);

  // Active associations for current filter
  const activePartAssociations = useMemo(() => {
    if (!filters.partNumber || !filters.partNumber.trim()) return null;
    return getPartNumberAssociations(filters.partNumber);
  }, [filters.partNumber, getPartNumberAssociations]);

  // Helper to resolve Part Number & Supplier for ANY individual movement record
  const getMovementPartInfo = useCallback((move) => {
    if (!move) return null;
    const barcode = (move.item_barcode || '').trim().toLowerCase();
    const itemName = (move.item_name || '').trim().toLowerCase();

    // 1. Direct lookup map by barcode
    if (barcode && partNumberLookupMap[barcode]) {
      const found = partNumberLookupMap[barcode];
      return {
        partNumber: found.partNumber,
        supplierName: found.supplierName || 'Supplier',
        matchType: 'barcode'
      };
    }

    // 2. Check effectiveSupplierPartNumbers
    if (effectiveSupplierPartNumbers && effectiveSupplierPartNumbers.length > 0) {
      // Direct barcode match
      const matchByBarcode = effectiveSupplierPartNumbers.find(sp =>
        sp.barcode && String(sp.barcode).trim().toLowerCase() === barcode
      );
      if (matchByBarcode) {
        return {
          partNumber: matchByBarcode.part_number,
          supplierName: matchByBarcode.suppliers?.name || matchByBarcode.supplier_name || 'Supplier',
          matchType: 'supplier_barcode'
        };
      }

      // If activePartAssociations is set and matches this movement
      if (activePartAssociations && activePartAssociations.hasMatches) {
        const matchesName = activePartAssociations.itemNames.some(n => n.toLowerCase() === itemName);
        const matchesBarcode = activePartAssociations.allBarcodes.some(b => b.toLowerCase() === barcode);
        if (matchesName || matchesBarcode) {
          return {
            partNumber: activePartAssociations.matchedPartNumbers[0] || activePartAssociations.query,
            supplierName: activePartAssociations.suppliers[0] || 'Supplier',
            matchType: 'associated_part'
          };
        }
      }

      // Item type name match
      const matchByName = effectiveSupplierPartNumbers.find(sp =>
        sp.item_types?.name && sp.item_types.name.trim().toLowerCase() === itemName
      );
      if (matchByName) {
        return {
          partNumber: matchByName.part_number,
          supplierName: matchByName.suppliers?.name || matchByName.supplier_name || 'Supplier',
          matchType: 'catalog_item'
        };
      }
    }

    return null;
  }, [partNumberLookupMap, effectiveSupplierPartNumbers, activePartAssociations]);

  // --- Fetch Movements (with pagination and part number identification to never miss records) ---
  const handleGenerateReport = useCallback(async () => {
    setLoading(true);
    if (typeof setError === 'function') setError(null);
    if (isTrainingMode) {
      try {
        const movs = trainingManager.getMovements(filters);
        setReportData(movs);
        setLastRefreshedAt(new Date());
      } catch (err) {
        if (typeof setError === 'function') setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');

      // Pre-calculate part number associations so we fetch the right records
      const partAssociations = filters.partNumber && filters.partNumber.trim() !== ''
        ? getPartNumberAssociations(filters.partNumber)
        : null;

      // Fetch all movements in batches to avoid PostgREST 1000 limit
      const pageSize = 1000;
      let from = 0;
      let allMovements = [];
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('stock_movements')
          .select('*')
          .gte('created_at', new Date(filters.startDate).toISOString())
          .lte('created_at', new Date(`${filters.endDate}T23:59:59.999Z`).toISOString())
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);

        if (filters.itemName && filters.itemName !== 'All') {
          query = query.eq('item_name', filters.itemName);
        }
        if (filters.team && filters.team !== 'All') {
          query = query.or(`location_from.eq."${filters.team}",location_to.eq."${filters.team}"`);
        }
        if (filters.location && filters.location !== 'All') {
          query = query.or(`location_from.eq."${filters.location}",location_to.eq."${filters.location}"`);
        }

        // Part number handling in query:
        // If we identified associated item names or explicit barcodes, query by them!
        if (partAssociations) {
          if (partAssociations.itemNames.length > 0 && partAssociations.itemNames.length <= 10) {
            // PostgREST: item_name in (names) OR item_barcode in (explicitBarcodes)
            const nameConditions = partAssociations.itemNames.map(n => `item_name.eq."${n}"`).join(',');
            const barcodeConditions = partAssociations.explicitSupplierBarcodes.slice(0, 5).map(b => `item_barcode.eq."${b}"`).join(',');
            const combinedOr = [nameConditions, barcodeConditions].filter(Boolean).join(',');
            if (combinedOr) {
              query = query.or(combinedOr);
            }
          } else if (partAssociations.allBarcodes.length > 0 && partAssociations.allBarcodes.length <= 15) {
            const barcodeList = partAssociations.allBarcodes.map(b => `"${b}"`).join(',');
            query = query.or(`item_barcode.in.(${barcodeList})`);
          } else {
            // Direct text match fallback
            const cleanPart = filters.partNumber.trim();
            query = query.ilike('item_barcode', `%${cleanPart}%`);
          }
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data && data.length > 0) {
          allMovements.push(...data);
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            from += pageSize;
          }
        } else {
          hasMore = false;
        }
      }

      setReportData(allMovements);
      setLastRefreshedAt(new Date());
    } catch (err) {
      if (typeof setError === 'function') {
        setError(`Failed to generate report: ${err.message}`);
      }
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, setLoading, setError, setReportData, getPartNumberAssociations]);

  // Fetch report data whenever filters or report criteria change
  useEffect(() => {
    handleGenerateReport();
  }, [handleGenerateReport]);

  // --- Real-time Subscription to stock_movements for live updates ---
  useEffect(() => {
    if (isTrainingMode) {
      setIsLiveConnected(true);
      const unsubscribe = trainingManager.subscribe(() => {
        const movs = trainingManager.getMovements(filters);
        setReportData(movs);
        setLastRefreshedAt(new Date());
      });
      return unsubscribe;
    }
    let channel = null;
    try {
      channel = supabase
        .channel('realtime_stock_movements_report')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'stock_movements' },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const newMovement = payload.new;
              setReportData(prevData => {
                if (!prevData) return [newMovement];
                if (prevData.some(m => m.id === newMovement.id)) return prevData;
                return [newMovement, ...prevData];
              });
              setLastRefreshedAt(new Date());
            } else if (payload.eventType === 'UPDATE') {
              const updatedMovement = payload.new;
              setReportData(prevData => {
                if (!prevData) return prevData;
                return prevData.map(m => m.id === updatedMovement.id ? updatedMovement : m);
              });
              setLastRefreshedAt(new Date());
            }
          }
        )
        .subscribe((status) => {
          setIsLiveConnected(status === 'SUBSCRIBED');
        });
    } catch (e) {
      console.warn("Realtime subscription setup failed:", e);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [setReportData]);

  // Quick date presets
  const applyDatePreset = (preset) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let startStr = todayStr;
    let endStr = todayStr;

    if (preset === 'today') {
      startStr = todayStr;
      endStr = todayStr;
    } else if (preset === 'yesterday') {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      startStr = y.toISOString().split('T')[0];
      endStr = startStr;
    } else if (preset === '7days') {
      const d = new Date(today);
      d.setDate(today.getDate() - 7);
      startStr = d.toISOString().split('T')[0];
      endStr = todayStr;
    } else if (preset === '30days') {
      const d = new Date(today);
      d.setDate(today.getDate() - 30);
      startStr = d.toISOString().split('T')[0];
      endStr = todayStr;
    } else if (preset === 'thismonth') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      startStr = d.toISOString().split('T')[0];
      endStr = todayStr;
    } else if (preset === 'all') {
      startStr = '2023-01-01';
      endStr = todayStr;
    }

    setFilters(prev => ({
      ...prev,
      startDate: startStr,
      endDate: endStr
    }));
  };

  const activePreset = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const yesterdayStr = y.toISOString().split('T')[0];
    const d7 = new Date(today);
    d7.setDate(today.getDate() - 7);
    const d7Str = d7.toISOString().split('T')[0];
    const d30 = new Date(today);
    d30.setDate(today.getDate() - 30);
    const d30Str = d30.toISOString().split('T')[0];
    const tm = new Date(today.getFullYear(), today.getMonth(), 1);
    const tmStr = tm.toISOString().split('T')[0];

    const s = filters?.startDate;
    const e = filters?.endDate;

    if (s === todayStr && e === todayStr) return 'today';
    if (s === yesterdayStr && e === yesterdayStr) return 'yesterday';
    if (s === d7Str && e === todayStr) return '7days';
    if (s === d30Str && e === todayStr) return '30days';
    if (s === tmStr && e === todayStr) return 'thismonth';
    if (s === '2023-01-01' && e === todayStr) return 'all';
    return null;
  }, [filters?.startDate, filters?.endDate]);

  const getPresetBtnClass = (presetId) => {
    const isActive = activePreset === presetId;
    if (isActive) {
      return "w-full sm:w-auto px-2.5 py-1.5 sm:py-1 rounded bg-blue-600 dark:bg-blue-600 text-white font-semibold text-xs text-center transition-colors shadow-xs";
    }
    return "w-full sm:w-auto px-2.5 py-1.5 sm:py-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-xs text-center transition-colors";
  };

  // --- Filtered Movements Data (with comprehensive part code & barcode linkage) ---
  const filteredReportData = useMemo(() => {
    if (!reportData) return null;
    return reportData.filter(move => {
      // Movement type filter
      if (movementTypeFilter !== 'ALL' && move.movement_type !== movementTypeFilter) {
        return false;
      }

      // Unique / Meter filter
      if (uniqueOnlyFilter === 'UNIQUE_ONLY' && !isUniqueItem(move.item_name)) {
        return false;
      }
      if (uniqueOnlyFilter === 'BULK_ONLY' && isUniqueItem(move.item_name)) {
        return false;
      }

      // Part number association filter
      if (activePartAssociations) {
        const moveBarcode = (move.item_barcode || '').trim().toLowerCase();
        const moveName = (move.item_name || '').trim().toLowerCase();
        const cleanQuery = activePartAssociations.query.toLowerCase();

        const barcodeMatches = activePartAssociations.allBarcodes.some(b => b.toLowerCase() === moveBarcode);
        const nameMatches = activePartAssociations.itemNames.some(n => n.toLowerCase() === moveName);
        const directContains = moveBarcode.includes(cleanQuery) || moveName.includes(cleanQuery);

        if (!barcodeMatches && !nameMatches && !directContains) {
          return false;
        }
      }

      // Text search (search in barcode/serial, item_name, location_from, location_to, username, part number)
      if (textSearch.trim()) {
        const query = textSearch.trim().toLowerCase();
        const barcodeMatch = (move.item_barcode || '').toLowerCase().includes(query);
        const nameMatch = (move.item_name || '').toLowerCase().includes(query);
        const fromMatch = (move.location_from || '').toLowerCase().includes(query);
        const toMatch = (move.location_to || '').toLowerCase().includes(query);
        const userMatch = (move.username || '').toLowerCase().includes(query);

        // Also check if movement's part number matches text search
        const partInfo = getMovementPartInfo(move);
        const partMatch = partInfo && (
          (partInfo.partNumber && partInfo.partNumber.toLowerCase().includes(query)) ||
          (partInfo.supplierName && partInfo.supplierName.toLowerCase().includes(query))
        );

        if (!barcodeMatch && !nameMatch && !fromMatch && !toMatch && !userMatch && !partMatch) {
          return false;
        }
      }

      return true;
    });
  }, [reportData, movementTypeFilter, uniqueOnlyFilter, activePartAssociations, textSearch, isUniqueItem, getMovementPartInfo]);

  // --- Summary Calculations ---
  const reportSummary = useMemo(() => {
    if (!filteredReportData) return { totalIn: 0, totalOut: 0, netChange: 0, uniqueCount: 0, uniqueMetersCount: 0 };
    const summary = filteredReportData.reduce((acc, move) => {
      if (move.movement_type === 'IN') acc.totalIn += 1;
      if (move.movement_type === 'OUT') acc.totalOut += 1;
      if (isUniqueItem(move.item_name)) acc.uniqueCount += 1;
      return acc;
    }, { totalIn: 0, totalOut: 0, uniqueCount: 0 });
    summary.netChange = summary.totalIn - summary.totalOut;
    return summary;
  }, [filteredReportData, isUniqueItem]);

  // --- Grouped Movements (By Minute, Item, Type, Locations, User) ---
  const groupedReportData = useMemo(() => {
    if (!filteredReportData) return null;

    const groups = {};

    filteredReportData.forEach(move => {
      const timeKey = new Date(move.created_at).toISOString().slice(0, 16);
      const isUnique = isUniqueItem(move.item_name);
      const key = `${move.item_name}|${move.movement_type}|${move.location_from}|${move.location_to}|${move.username}|${timeKey}`;

      if (!groups[key]) {
        const partInfo = getMovementPartInfo(move);
        groups[key] = {
          id: move.id,
          created_at: move.created_at,
          item_name: move.item_name,
          movement_type: move.movement_type,
          location_from: move.location_from,
          location_to: move.location_to,
          username: move.username,
          isUnique,
          quantity: 0,
          barcodes: [],
          partNumber: partInfo?.partNumber || null,
          supplierName: partInfo?.supplierName || null
        };
      }

      groups[key].quantity += 1;
      if (move.item_barcode) {
        groups[key].barcodes.push(move.item_barcode);
      }
    });

    return Object.values(groups).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [filteredReportData, isUniqueItem, getMovementPartInfo]);

  // --- Assigned Stock by Team Data ---
  const assignedStockData = useMemo(() => {
    const assigned = stock.filter(item => item.assigned_to && item.assigned_to !== Team.UNASSIGNED);
    const groups = {};
    assigned.forEach(item => {
      const team = item.assigned_to;
      if (!groups[team]) groups[team] = {};
      if (!groups[team][item.name]) {
        // Find part info for item
        let itemPartNumber = null;
        let itemSupplierName = null;
        if (effectiveSupplierPartNumbers) {
          const match = effectiveSupplierPartNumbers.find(sp =>
            (item.item_type_id && sp.item_type_id === item.item_type_id) ||
            (sp.item_types?.name === item.name) ||
            (sp.barcode && sp.barcode === item.barcode)
          );
          if (match) {
            itemPartNumber = match.part_number;
            itemSupplierName = match.suppliers?.name || match.supplier_name;
          }
        }

        groups[team][item.name] = {
          count: 0,
          barcodes: [],
          isUnique: isUniqueItem(item.name),
          partNumber: itemPartNumber,
          supplierName: itemSupplierName
        };
      }
      groups[team][item.name].count++;
      if (item.barcode) {
        groups[team][item.name].barcodes.push(item.barcode);
      }
    });
    return groups;
  }, [stock, isUniqueItem, effectiveSupplierPartNumbers]);

  // --- Stock Thresholds Data ---
  const thresholdData = useMemo(() => {
    const stockCounts = {};
    stock.forEach(item => {
      if (!item.assigned_to || item.assigned_to === Team.UNASSIGNED) {
        if (!stockCounts[item.name]) stockCounts[item.name] = 0;
        stockCounts[item.name]++;
      }
    });

    const report = [];
    itemTypes.forEach(type => {
      const currentStock = stockCounts[type.name] || 0;
      const threshold = parseInt(type.stock_threshold, 10) || 0;

      let status = 'OK';
      if (currentStock <= threshold) {
        status = 'CRITICAL';
      } else if (threshold > 0 && currentStock <= threshold * 1.5) {
        status = 'WARNING';
      }

      if (status !== 'OK') {
        const suggestedOrder = Math.max(0, threshold - currentStock);
        // Find supplier part number
        let pNum = null;
        let sName = null;
        const partMatch = (effectiveSupplierPartNumbers || []).find(sp => sp.item_type_id === type.id);
        if (partMatch) {
          pNum = partMatch.part_number;
          sName = partMatch.suppliers?.name || partMatch.supplier_name;
        }

        report.push({
          name: type.name,
          currentStock,
          threshold,
          suggestedOrder,
          status,
          isUnique: isUniqueItem(type.name),
          partNumber: pNum,
          supplierName: sName
        });
      }
    });

    return report.sort((a, b) => {
      if (a.status === b.status) return a.currentStock - b.currentStock;
      return a.status === 'CRITICAL' ? -1 : 1;
    });
  }, [stock, itemTypes, isUniqueItem, effectiveSupplierPartNumbers]);

  // --- Meter & Serial Audit Trail Handler ---
  const handlePerformSerialAudit = useCallback(async (serialToLookup) => {
    const serial = (serialToLookup || auditSearchQuery).trim();
    if (!serial) return;

    setActiveAuditSerial(serial);
    setAuditLoading(true);
    if (typeof setError === 'function') setError(null);

    if (isTrainingMode) {
      try {
        const clean = serial.toLowerCase();
        const allMovements = trainingManager.getMovements();
        const matched = allMovements.filter(m => (m.item_barcode || '').toLowerCase().includes(clean));
        setAuditTrailMovements(matched);

        const currentStockList = trainingManager.getStock();
        const found = currentStockList.find(s => (s.barcode || '').toLowerCase() === clean) ||
                      currentStockList.find(s => (s.barcode || '').toLowerCase().includes(clean));
        setAuditActiveStockItem(found || null);
      } catch (err) {
        if (typeof setError === 'function') setError(`Failed to perform serial audit: ${err.message}`);
      } finally {
        setAuditLoading(false);
      }
      return;
    }

    try {
      // 1. Find all historical movements for this exact serial
      const { data: movements, error: moveErr } = await supabase
        .from('stock_movements')
        .select('*')
        .ilike('item_barcode', `%${serial}%`)
        .order('created_at', { ascending: false });

      if (moveErr) throw moveErr;
      setAuditTrailMovements(movements || []);

      // 2. Find current status in stock items
      const { data: currentItems, error: stockErr } = await supabase
        .from('stock_items')
        .select('*')
        .eq('barcode', serial);

      if (!stockErr && currentItems && currentItems.length > 0) {
        setAuditActiveStockItem(currentItems[0]);
      } else {
        // Fallback search in memory
        const found = stock.find(s => s.barcode === serial);
        setAuditActiveStockItem(found || null);
      }
    } catch (err) {
      if (typeof setError === 'function') {
        setError(`Failed to perform serial audit: ${err.message}`);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [auditSearchQuery, setError, stock]);

  // --- CSV Export (detailed every single serial/item row with Part Number & Supplier) ---
  const handleExportCsv = async () => {
    if (!filteredReportData || filteredReportData.length === 0) return;
    setIsExportingCsv(true);
    try {
      const headers = [
        "Date & Time",
        "Item Name",
        "Supplier Part Number",
        "Supplier",
        "Is Meter / Unique",
        "Serial Number / Barcode",
        "Movement Type",
        "From Location",
        "To Location",
        "User"
      ];
      const rows = filteredReportData.map(move => {
        const isMeter = isUniqueItem(move.item_name) ? "Yes" : "No";
        const partInfo = getMovementPartInfo(move);
        return [
          `"${new Date(move.created_at).toLocaleString()}"`,
          `"${(move.item_name || '').replace(/"/g, '""')}"`,
          `"${(partInfo?.partNumber || '').replace(/"/g, '""')}"`,
          `"${(partInfo?.supplierName || '').replace(/"/g, '""')}"`,
          `"${isMeter}"`,
          `"${(move.item_barcode || '').replace(/"/g, '""')}"`,
          `"${move.movement_type}"`,
          `"${(move.location_from || '').replace(/"/g, '""')}"`,
          `"${(move.location_to || '').replace(/"/g, '""')}"`,
          `"${(formatUsername(move.username) || '').replace(/"/g, '""')}"`
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const partTag = filters.partNumber ? `_part_${filters.partNumber.trim()}` : '';
      const fileName = `inventory_movements${partTag}_${filters.startDate}_to_${filters.endDate}.csv`;

      // 1. Try Native Filesystem + Share if available
      if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem')) {
        try {
          const base64Data = btoa(unescape(encodeURIComponent(csvContent)));
          const savedFile = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache,
            recursive: true
          });

          if (Capacitor.isPluginAvailable('Share')) {
            try {
              await Share.share({
                title: 'Inventory Movements CSV',
                url: savedFile.uri,
                dialogTitle: 'Share or Save CSV'
              });
              return;
            } catch (shareErr) {
              console.warn("Native share dismissed or cancelled:", shareErr);
            }
          }
        } catch (nativeErr) {
          console.warn("Native Filesystem save failed, falling back to Web Share / Download:", nativeErr);
        }
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], fileName, { type: 'text/csv' });

      // 2. Try Web Share API (native Android system share dialog)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Inventory Movements CSV',
            files: [file]
          });
          return;
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') {
            return;
          }
          console.warn("Web file share cancelled or unsupported:", shareErr);
        }
      }

      // 3. Fallback: Trigger standard download link
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (dlErr) {
        console.warn("Direct download link trigger failed:", dlErr);
      }

      // 4. On native platform or mobile, always open the CSV Export Modal so user has direct access
      if (Capacitor.isNativePlatform() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        setCsvModalData({
          fileName,
          content: csvContent,
          rowCount: rows.length,
          url,
          file
        });
      }
    } catch (err) {
      console.error("CSV Export failed:", err);
      if (typeof setError === 'function') setError("CSV export failed: " + err.message);
    } finally {
      setIsExportingCsv(false);
    }
  };

  // --- PDF Export (with complete serial numbers and part number tracking) ---
  const handlePrint = async () => {
    if (!groupedReportData || groupedReportData.length === 0) return;
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF('landscape');

      doc.setFontSize(18);
      doc.text(`Inventory Movements & Audit Report`, 14, 18);
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);

      let headerText = `Period: ${new Date(filters.startDate).toLocaleDateString()} to ${new Date(filters.endDate).toLocaleDateString()}`;
      if (filters.partNumber && filters.partNumber.trim()) {
        headerText += ` | Part Code: ${filters.partNumber.trim()}`;
        if (activePartAssociations?.suppliers.length > 0) {
          headerText += ` (Supplier: ${activePartAssociations.suppliers.join(', ')})`;
        }
      }
      if (filters.team && filters.team !== 'All') headerText += ` | Team: ${filters.team}`;
      if (filters.location && filters.location !== 'All') headerText += ` | Location: ${filters.location}`;
      if (filters.itemName && filters.itemName !== 'All') headerText += ` | Item: ${filters.itemName}`;
      if (movementTypeFilter !== 'ALL') headerText += ` | Type: ${movementTypeFilter}`;
      if (uniqueOnlyFilter !== 'ALL') headerText += ` | Category: ${uniqueOnlyFilter === 'UNIQUE_ONLY' ? 'Meters/Unique Only' : 'Bulk Only'}`;

      doc.text(headerText, 14, 25);
      doc.text(`Generated: ${new Date().toLocaleString()} | Total Sign Ins: ${reportSummary.totalIn} | Total Sign Outs: ${reportSummary.totalOut} | Net Change: ${reportSummary.netChange > 0 ? '+' : ''}${reportSummary.netChange} | Unique Meter Events: ${reportSummary.uniqueCount}`, 14, 30);

      const tableColumn = ["Date & Time", "Item Name", "Supplier Part #", "Qty", "Type", "Serial Numbers / Barcodes", "From", "To", "User"];
      const tableRows = [];

      groupedReportData.forEach(move => {
        let serialsDisplay = 'N/A';
        if (move.barcodes.length === 1) {
          serialsDisplay = move.barcodes[0];
        } else if (move.barcodes.length > 1) {
          if (move.isUnique) {
            serialsDisplay = move.barcodes.slice(0, 4).join(', ') + (move.barcodes.length > 4 ? ` (+${move.barcodes.length - 4} more)` : '');
          } else {
            serialsDisplay = `${move.barcodes[0]} (${move.barcodes.length} scans)`;
          }
        }

        const partCodeText = move.partNumber
          ? `${move.partNumber}${move.supplierName ? ` (${move.supplierName})` : ''}`
          : '—';

        const rowData = [
          new Date(move.created_at).toLocaleString(),
          move.isUnique ? `${move.item_name} [Meter]` : move.item_name,
          partCodeText,
          move.quantity.toString(),
          move.movement_type,
          serialsDisplay,
          move.location_from,
          move.location_to,
          formatUsername(move.username)
        ];
        tableRows.push(rowData);
      });

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 35,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [40, 50, 70], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });

      const fileName = `inventory_movements_${new Date().getTime()}.pdf`;

      // 1. Try Native Filesystem + Share if available
      if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem')) {
        try {
          const pdfBase64 = doc.output('datauristring').split(',')[1];
          const savedFile = await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Cache,
            recursive: true
          });

          if (Capacitor.isPluginAvailable('Share')) {
            try {
              await Share.share({
                title: 'Inventory Report',
                url: savedFile.uri,
                dialogTitle: 'Save or Share PDF'
              });
              return;
            } catch (shareErr) {
              console.warn("Native share cancelled or dismissed", shareErr);
            }
          }
        } catch (nativeErr) {
          console.warn("Native PDF save failed, falling back to Web Share / Download:", nativeErr);
        }
      }

      const blob = doc.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Inventory Report',
            files: [file]
          });
          return;
        } catch (shareErr) {
          console.warn("Web share cancelled", shareErr);
        }
      }

      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
    } catch (err) {
      console.error("PDF generation error:", err);
      if (typeof setError === 'function') setError("Failed to generate PDF: " + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(label || 'Copied!');
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header and Live Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Inventory & Movement Reports</h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Real-time tracking of all sign-ins, sign-outs, supplier part numbers, and unique serialized meters.
          </p>
          {lastRefreshedAt && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800/90 text-xs text-zinc-600 dark:text-zinc-300 font-medium border border-zinc-200 dark:border-zinc-700/80 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Last updated: <strong className="text-zinc-900 dark:text-white font-semibold">{lastRefreshedAt.toLocaleTimeString()}</strong></span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {groupedReportData && groupedReportData.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportDropdownOpen(prev => !prev)}
                disabled={isExportingCsv || isGeneratingPdf}
                className="inline-flex items-center px-3 py-2 border border-transparent rounded-lg shadow-sm text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                title="Export report options"
                aria-expanded={exportDropdownOpen}
              >
                {isExportingCsv || isGeneratingPdf ? (
                  <Spinner className="w-4 h-4 mr-1.5" />
                ) : (
                  <DocumentArrowDownIcon className="w-4 h-4 mr-1.5" />
                )}
                <span>
                  {isExportingCsv ? 'Exporting...' : isGeneratingPdf ? 'Generating...' : 'Export'}
                </span>
                <ChevronDownIcon className={`w-3.5 h-3.5 ml-1.5 transition-transform duration-200 ${exportDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {exportDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setExportDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-1.5 z-30 w-56 max-w-[calc(100vw-2rem)] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden py-1 divide-y divide-zinc-100 dark:divide-zinc-700/60">
                    <button
                      type="button"
                      onClick={() => {
                        setExportDropdownOpen(false);
                        handleExportCsv();
                      }}
                      disabled={isExportingCsv}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
                    >
                      <DocumentArrowDownIcon className="w-4 h-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-white">Export CSV</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          Download spreadsheet with all serials & parts
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setExportDropdownOpen(false);
                        handlePrint();
                      }}
                      disabled={isGeneratingPdf}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700/60 transition-colors disabled:opacity-50"
                    >
                      <DocumentArrowDownIcon className="w-4 h-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-white">Save PDF</div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          Generate printable PDF report document
                        </div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={loading}
            className="inline-flex items-center justify-center p-2 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-sm text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
            title={loading ? 'Refreshing report...' : 'Refresh report'}
            aria-label="Refresh report"
          >
            <RefreshIcon className={`w-4 h-4 text-zinc-600 dark:text-zinc-300 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile Tab Selector (No awkward horizontal scrollbar) */}
      <div className="sm:hidden no-print">
        <label className="block text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">
          Report View
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMobileTabDropdownOpen(prev => !prev)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xs text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-750 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            aria-expanded={mobileTabDropdownOpen}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-1 rounded-md bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 shrink-0">
                {currentTab.icon}
              </span>
              <span className="truncate">{currentTab.label}</span>
            </div>
            <ChevronDownIcon className={`w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0 transition-transform duration-200 ${mobileTabDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {mobileTabDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setMobileTabDropdownOpen(false)}
              />
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden py-1 divide-y divide-zinc-100 dark:divide-zinc-700/60">
                {REPORT_TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id);
                        setMobileTabDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-3 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold'
                          : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/60 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                          {tab.icon}
                        </span>
                        <span className="truncate">{tab.label}</span>
                      </div>
                      {isActive && (
                        <CheckCircleIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 ml-2" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Desktop Tabs Navigation */}
      <div className="hidden sm:block border-b border-zinc-200 dark:border-zinc-700 no-print">
        <nav className="-mb-px flex space-x-6">
          {REPORT_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ================= TAB 1: MOVEMENT HISTORY ================= */}
      {activeTab === 'movements' && (
        <div className="space-y-6">
          {/* Quick Date Presets & Filter Panel */}
          <div className="bg-white dark:bg-zinc-800/60 p-4 sm:p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 space-y-4 no-print">
            {/* Timestamps & Quick Dates (Always Visible) */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Quick Dates
                </label>
                {/* Mobile: 2 rows of 3 columns grid. Desktop: Flex row */}
                <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
                  <button
                    type="button"
                    onClick={() => applyDatePreset('today')}
                    className={getPresetBtnClass('today')}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('yesterday')}
                    className={getPresetBtnClass('yesterday')}
                  >
                    Yesterday
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('7days')}
                    className={getPresetBtnClass('7days')}
                  >
                    Past 7 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('30days')}
                    className={getPresetBtnClass('30days')}
                  >
                    Past 30 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('thismonth')}
                    className={getPresetBtnClass('thismonth')}
                  >
                    This Month
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('all')}
                    className={getPresetBtnClass('all')}
                  >
                    All Time
                  </button>
                </div>
              </div>

              {/* Date Range Inputs */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label htmlFor="rep-start-date" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Start Date</label>
                  <input
                    type="date"
                    id="rep-start-date"
                    value={filters.startDate}
                    onChange={e => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    className={formInputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="rep-end-date" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">End Date</label>
                  <input
                    type="date"
                    id="rep-end-date"
                    value={filters.endDate}
                    onChange={e => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    className={formInputStyle}
                  />
                </div>
              </div>
            </div>

            {/* Collapsible Filter Bar Trigger */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-700/60">
              <button
                type="button"
                onClick={() => setIsFilterCollapsed(prev => !prev)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
              >
                <SearchIcon className="w-3.5 h-3.5 text-zinc-500" />
                <span>{isFilterCollapsed ? 'Show Additional Filters' : 'Hide Additional Filters'}</span>
                {activeFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                    {activeFiltersCount}
                  </span>
                )}
                <ChevronDownIcon className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${!isFilterCollapsed ? 'rotate-180' : ''}`} />
              </button>

              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMovementTypeFilter('ALL');
                    setUniqueOnlyFilter('ALL');
                    setFilters(prev => ({ ...prev, team: 'All', location: 'All', partNumber: '', itemName: 'All' }));
                    setTextSearch('');
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline"
                >
                  Clear Filters ({activeFiltersCount})
                </button>
              )}
            </div>

            {/* Collapsible Additional Filters Section */}
            {!isFilterCollapsed && (
              <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-700/50 animate-fadeIn">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label htmlFor="rep-movement-type" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Movement Type</label>
                    <select
                      id="rep-movement-type"
                      value={movementTypeFilter}
                      onChange={e => setMovementTypeFilter(e.target.value)}
                      className={formInputStyle}
                    >
                      <option value="ALL">All Movements</option>
                      <option value="OUT">Sign Outs (OUT)</option>
                      <option value="IN">Sign Ins / Returns (IN)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rep-unique-filter" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Item Classification</label>
                    <select
                      id="rep-unique-filter"
                      value={uniqueOnlyFilter}
                      onChange={e => setUniqueOnlyFilter(e.target.value)}
                      className={formInputStyle}
                    >
                      <option value="ALL">All Item Types</option>
                      <option value="UNIQUE_ONLY">⚡ Meters & Unique Serials Only</option>
                      <option value="BULK_ONLY">📦 Bulk & Standard Items Only</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rep-team-filter" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Team / Surveyor</label>
                    <select
                      id="rep-team-filter"
                      value={filters.team || 'All'}
                      onChange={e => setFilters(prev => ({ ...prev, team: e.target.value }))}
                      className={formInputStyle}
                    >
                      <option value="All">All Teams</option>
                      {teams && teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rep-location-filter" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Stock Location</label>
                    <select
                      id="rep-location-filter"
                      value={filters.location || 'All'}
                      onChange={e => setFilters(prev => ({ ...prev, location: e.target.value }))}
                      className={formInputStyle}
                    >
                      <option value="All">All Locations</option>
                      {dbLocations && dbLocations.map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-700/50">
                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="rep-part-number" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                        <TagIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        Supplier Part Number / Code
                      </label>
                      {filters.partNumber && (
                        <button
                          type="button"
                          onClick={() => setFilters(prev => ({ ...prev, partNumber: '' }))}
                          className="text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    
                    <div className="mt-1 space-y-1">
                      <select
                        id="rep-part-number-select"
                        value={availableSupplierPartNumbers.some(p => p.partNumber.toLowerCase() === (filters.partNumber || '').trim().toLowerCase()) ? filters.partNumber.trim() : (filters.partNumber ? 'custom' : '')}
                        onChange={e => {
                          if (e.target.value === 'custom') return;
                          setFilters(prev => ({ ...prev, partNumber: e.target.value }));
                        }}
                        className={formInputStyle}
                      >
                        <option value="">All Part Numbers (No filter)</option>
                        {availableSupplierPartNumbers.map(p => (
                          <option key={p.partNumber} value={p.partNumber}>
                            {p.partNumber} — {p.supplierName} ({p.itemName})
                          </option>
                        ))}
                        {filters.partNumber && !availableSupplierPartNumbers.some(p => p.partNumber.toLowerCase() === filters.partNumber.trim().toLowerCase()) && (
                          <option value="custom">Custom Part Code: {filters.partNumber}</option>
                        )}
                      </select>

                      <input
                        type="text"
                        id="rep-part-number"
                        placeholder="Or type part code (e.g. MK10, PN-9901)..."
                        value={filters.partNumber || ''}
                        onChange={e => setFilters(prev => ({ ...prev, partNumber: e.target.value }))}
                        className="block w-full px-2.5 py-1 text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-md placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="rep-item-name" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Item Name</label>
                    <select
                      id="rep-item-name"
                      value={filters.itemName || 'All'}
                      onChange={e => setFilters(prev => ({ ...prev, itemName: e.target.value }))}
                      className={formInputStyle}
                    >
                      {uniqueItemNames.map(name => (
                        <option key={name} value={name}>
                          {name === 'All' ? 'All Items' : `${name}${isUniqueItem(name) ? ' [Meter/Unique]' : ''}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rep-text-search" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Search Serial, Barcode, User, or Location
                    </label>
                    <div className="relative mt-1">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                        <SearchIcon className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        id="rep-text-search"
                        placeholder="e.g. SN-04829, MET-, Flamstead..."
                        value={textSearch}
                        onChange={e => setTextSearch(e.target.value)}
                        className={`${formInputStyle} pl-9`}
                      />
                      {textSearch && (
                        <button
                          type="button"
                          onClick={() => setTextSearch('')}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-zinc-400 hover:text-zinc-600"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* PART NUMBER IDENTIFIED BARCODES BANNER */}
                {activePartAssociations && (
                  <div className="mt-3 p-3.5 bg-blue-50 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                          <TagIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          Reporting on Part Number:
                        </span>
                        <span className="font-mono font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200">
                          {activePartAssociations.query}
                        </span>
                        {activePartAssociations.suppliers.length > 0 && (
                          <span className="text-zinc-600 dark:text-zinc-400">
                            (Supplier: <strong className="text-zinc-800 dark:text-zinc-200">{activePartAssociations.suppliers.join(', ')}</strong>)
                          </span>
                        )}
                        {activePartAssociations.itemNames.length > 0 && (
                          <span className="text-zinc-600 dark:text-zinc-400">
                            Linked Item: <strong className="text-zinc-800 dark:text-zinc-200">{activePartAssociations.itemNames.join(', ')}</strong>
                          </span>
                        )}
                      </div>

                      <p className="text-zinc-600 dark:text-zinc-400">
                        Identified <strong className="text-blue-700 dark:text-blue-300">{activePartAssociations.totalBarcodesCount}</strong> associated barcode{activePartAssociations.totalBarcodesCount === 1 ? '' : 's'} across supplier shipments
                        {activePartAssociations.meterCount > 0 && (
                          <span>, including <strong className="text-purple-700 dark:text-purple-300">{activePartAssociations.meterCount} unique serialized meters</strong></span>
                        )}.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setViewAssociatedBarcodesModal(activePartAssociations);
                          setBarcodeSearchModalTerm('');
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md shadow-sm transition-colors flex items-center gap-1.5"
                      >
                        <BarcodeIcon className="w-3.5 h-3.5" />
                        View {activePartAssociations.totalBarcodesCount} Barcodes
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, partNumber: '' }))}
                        className="px-2.5 py-1.5 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors"
                      >
                        Clear Filter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Key Metric Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              title="Total Sign-Ins"
              badge="IN"
              value={reportSummary.totalIn}
              icon={<ArrowRightCircleIcon className="w-4 h-4 sm:w-5 sm:h-5 transform rotate-180" />}
              colorClass="bg-emerald-600"
              subtitle="Received / returned stock"
            />
            <StatCard
              title="Total Sign-Outs"
              badge="OUT"
              value={reportSummary.totalOut}
              icon={<ArrowRightCircleIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
              colorClass="bg-amber-600"
              subtitle="Dispatched to teams"
            />
            <StatCard
              title="Net Stock Impact"
              value={`${reportSummary.netChange > 0 ? '+' : ''}${reportSummary.netChange}`}
              icon={<ChartBarIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
              colorClass={reportSummary.netChange >= 0 ? "bg-blue-600" : "bg-purple-600"}
              subtitle={reportSummary.netChange >= 0 ? "Stock increased" : "Stock consumed/issued"}
            />
            <StatCard
              title="Meter Events"
              badge="Unique"
              value={reportSummary.uniqueCount}
              icon={<BarcodeIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
              colorClass="bg-indigo-600"
              subtitle="Serialized tracking events"
            />
          </div>

          {/* Movements List / Table */}
          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  Sign In / Out Activity Log
                  {activePartAssociations && (
                    <span className="text-xs font-normal text-blue-600 dark:text-blue-400 font-mono">
                      (Part #{activePartAssociations.query})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Showing {groupedReportData ? groupedReportData.length : 0} grouped movement events ({filteredReportData ? filteredReportData.length : 0} individual items/serials)
                </p>
              </div>

              {copyFeedback && (
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircleIcon className="w-4 h-4" />
                  {copyFeedback}
                </div>
              )}
            </div>

            {loading ? (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400 flex flex-col items-center justify-center space-y-3">
                <Spinner className="w-8 h-8 text-blue-600" />
                <p className="text-sm font-medium">Loading and verifying sign in/out movements...</p>
              </div>
            ) : !groupedReportData || groupedReportData.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
                <BoxIcon className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="font-semibold text-zinc-700 dark:text-zinc-300">No sign-in or sign-out logs found</p>
                <p className="text-xs mt-1 text-zinc-400 max-w-md mx-auto">
                  {activePartAssociations
                    ? `No movements found for Part Number "${activePartAssociations.query}" across its ${activePartAssociations.totalBarcodesCount} associated barcodes in this date range. Try widening the date filter.`
                    : 'Try selecting a different date range, team, or item name.'}
                </p>
                <button
                  type="button"
                  onClick={() => applyDatePreset('all')}
                  className="mt-4 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-md hover:bg-blue-100 transition-colors"
                >
                  View All Time History
                </button>
              </div>
            ) : (
              <>
                {/* Mobile View: Cards */}
                <div className="md:hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                  {groupedReportData.map(move => (
                    <div key={move.id} className="p-4 space-y-2">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{move.item_name}</p>
                            {move.isUnique && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                                ⚡ Meter / Unique
                              </span>
                            )}
                            {move.partNumber && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200">
                                Part: {move.partNumber}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {new Date(move.created_at).toLocaleString()}
                          </p>
                        </div>

                        <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0 inline-flex items-center ${
                          move.movement_type === 'IN'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
                        }`}>
                          {move.movement_type === 'IN' ? 'Sign In' : 'Sign Out'}
                        </span>
                      </div>

                      <div className="text-xs text-zinc-600 dark:text-zinc-300 grid grid-cols-2 gap-1 pt-1">
                        <p><span className="text-zinc-400">From:</span> {move.location_from}</p>
                        <p><span className="text-zinc-400">To:</span> {move.location_to}</p>
                        <p><span className="text-zinc-400">User:</span> {formatUsername(move.username)}</p>
                        <p><span className="text-zinc-400">Quantity:</span> {move.quantity}</p>
                      </div>

                      {/* Barcodes / Serials display */}
                      {move.barcodes.length > 0 && (
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700/60 flex items-center justify-between">
                          <div className="text-xs font-mono text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">
                            {move.barcodes.length === 1 ? (
                              <span>SN: {move.barcodes[0]}</span>
                            ) : (
                              <span>{formatSerialRangeDisplay(move.barcodes)}</span>
                            )}
                          </div>
                          {move.barcodes.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setViewSerialsModalData(move);
                                setSerialSearchTerm('');
                              }}
                              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              View All Serials ({move.barcodes.length})
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('audit');
                                setAuditSearchQuery(move.barcodes[0]);
                                handlePerformSerialAudit(move.barcodes[0]);
                              }}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Audit Serial
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop View: Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                    <thead className="bg-zinc-50 dark:bg-zinc-800">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Date & Time</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item Name</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Supplier Part #</th>
                        <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Type</th>
                        <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Qty</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Serial Numbers / Barcodes</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">From</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">To</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">User</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-zinc-800/40 divide-y divide-zinc-200 dark:border-zinc-700">
                      {groupedReportData.map(move => (
                        <tr key={move.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors">
                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                            {new Date(move.created_at).toLocaleString()}
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{move.item_name}</span>
                              {move.isUnique && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                                  Meter
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                            {move.partNumber ? (
                              <div className="flex flex-col">
                                <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">
                                  {move.partNumber}
                                </span>
                                {move.supplierName && (
                                  <span className="text-[10px] text-zinc-400">
                                    {move.supplierName}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-zinc-400 italic">None</span>
                            )}
                          </td>

                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <span className={`px-2.5 py-0.5 inline-flex items-center text-xs leading-5 font-semibold rounded-full whitespace-nowrap shrink-0 ${
                              move.movement_type === 'IN'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                            }`}>
                              {move.movement_type === 'IN' ? 'Sign In' : 'Sign Out'}
                            </span>
                          </td>

                          <td className="px-3 py-3.5 whitespace-nowrap text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {move.quantity}
                          </td>

                          <td className="px-4 py-3.5">
                            {move.barcodes.length === 0 ? (
                              <span className="text-xs text-zinc-400">None</span>
                            ) : move.barcodes.length === 1 ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300">{move.barcodes[0]}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveTab('audit');
                                    setAuditSearchQuery(move.barcodes[0]);
                                    handlePerformSerialAudit(move.barcodes[0]);
                                  }}
                                  className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 underline"
                                  title="View lifecycle audit trail for this serial"
                                >
                                  Audit
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                                  {formatSerialRangeDisplay(move.barcodes)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setViewSerialsModalData(move);
                                    setSerialSearchTerm('');
                                  }}
                                  className="px-2 py-0.5 text-xs font-medium rounded bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 transition-colors"
                                >
                                  View All ({move.barcodes.length})
                                </button>
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300 font-medium">
                            {move.location_from}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300 font-medium">
                            {move.location_to}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                            {formatUsername(move.username)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: METER & SERIAL AUDIT TRAIL ================= */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-800/60 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                <BarcodeIcon className="w-5 h-5 text-blue-600" />
                Meter & Serial Number Full Lifecycle Audit Trail
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Every meter item has its own unique serial number. Track complete movement history from delivery, through storehouses and teams, to surveyor assignments.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Part Number Filter for Meters */}
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Filter Meters by Supplier Part Number
                </label>
                <select
                  value={auditPartNumberFilter}
                  onChange={e => setAuditPartNumberFilter(e.target.value)}
                  className={formInputStyle}
                >
                  <option value="All">All Part Numbers</option>
                  {availableSupplierPartNumbers.map(p => (
                    <option key={p.partNumber} value={p.partNumber}>
                      {p.partNumber} ({p.supplierName} — {p.itemName})
                    </option>
                  ))}
                </select>
              </div>

              {/* Direct Serial Search */}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Search Exact Serial Number / Barcode
                </label>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handlePerformSerialAudit();
                  }}
                  className="flex gap-2 mt-1"
                >
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="e.g. SN-04829, MET-99201, 501234..."
                      value={auditSearchQuery}
                      onChange={e => setAuditSearchQuery(e.target.value)}
                      className={formInputStyle}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={auditLoading || !auditSearchQuery.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {auditLoading ? <Spinner className="w-4 h-4" /> : <SearchIcon className="w-4 h-4" />}
                    Audit Serial
                  </button>
                </form>
              </div>
            </div>

            {/* Quick Suggestions from unique stock items */}
            {stock && stock.some(s => isUniqueItem(s.name)) && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700/60">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mr-2">
                  {auditPartNumberFilter !== 'All' ? `Unique Meters for Part #${auditPartNumberFilter}:` : 'Recent Unique Meters in Stock:'}
                </span>
                <div className="inline-flex flex-wrap gap-1.5 mt-1">
                  {stock
                    .filter(s => {
                      if (!isUniqueItem(s.name) || !s.barcode) return false;
                      if (auditPartNumberFilter !== 'All') {
                        const assocs = getPartNumberAssociations(auditPartNumberFilter);
                        return assocs && assocs.allBarcodes.some(b => b.toLowerCase() === s.barcode.toLowerCase());
                      }
                      return true;
                    })
                    .slice(0, 8)
                    .map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setAuditSearchQuery(item.barcode);
                          handlePerformSerialAudit(item.barcode);
                        }}
                        className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-100 hover:bg-blue-50 hover:text-blue-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 transition-colors"
                      >
                        {item.barcode} ({item.name})
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Audit Results */}
          {activeAuditSerial && (
            <div className="space-y-6">
              {/* Current Status Banner */}
              <div className="bg-white dark:bg-zinc-800/60 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs uppercase font-semibold text-zinc-400 tracking-wider">Serial Number</span>
                      <h3 className="text-xl font-bold font-mono text-zinc-900 dark:text-white">{activeAuditSerial}</h3>
                      {auditActiveStockItem && isUniqueItem(auditActiveStockItem.name) && (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                          ⚡ Meter
                        </span>
                      )}
                    </div>
                    {auditActiveStockItem && (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                          Item: {auditActiveStockItem.name}
                        </p>
                        {/* Show associated supplier part number */}
                        {(() => {
                          const partInfo = getMovementPartInfo({ item_name: auditActiveStockItem.name, item_barcode: auditActiveStockItem.barcode });
                          if (partInfo) {
                            return (
                              <p className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                                Supplier Part #: {partInfo.partNumber} ({partInfo.supplierName})
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Current Status Pill */}
                  <div className="flex flex-col sm:items-end">
                    {auditActiveStockItem ? (
                      auditActiveStockItem.assigned_to && auditActiveStockItem.assigned_to !== Team.UNASSIGNED ? (
                        <div className="space-y-1 sm:text-right">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                            SIGNED OUT to {auditActiveStockItem.assigned_to}
                          </span>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Assigned on: {auditActiveStockItem.assigned_at ? new Date(auditActiveStockItem.assigned_at).toLocaleDateString() : 'Recently'}
                            {auditActiveStockItem.assigned_by ? ` by ${formatUsername(auditActiveStockItem.assigned_by)}` : ''}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1 sm:text-right">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            IN STOCK at {auditActiveStockItem.location || 'Leading Stores'}
                          </span>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">Available for assignment</p>
                        </div>
                      )
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                        Historical Record (Not currently in active stock)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Timeline of Movements */}
              <div className="bg-white dark:bg-zinc-800/60 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700">
                <h4 className="text-sm font-bold text-zinc-800 dark:text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                  <ChartBarIcon className="w-4 h-4 text-blue-600" />
                  Chronological Lifecycle Timeline ({auditTrailMovements.length} logged event{auditTrailMovements.length === 1 ? '' : 's'})
                </h4>

                {auditTrailMovements.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
                    No movement events recorded for this serial number yet.
                  </div>
                ) : (
                  <div className="relative border-l-2 border-zinc-200 dark:border-zinc-700 ml-4 space-y-6">
                    {auditTrailMovements.map((move, index) => {
                      const isSignOut = move.movement_type === 'OUT';
                      return (
                        <div key={move.id || index} className="relative pl-6">
                          {/* Dot indicator */}
                          <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white dark:border-zinc-800 flex items-center justify-center ${
                            isSignOut ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                          </div>

                          <div className="bg-zinc-50 dark:bg-zinc-900/60 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                                isSignOut
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                              }`}>
                                {isSignOut ? 'SIGNED OUT / TRANSFERRED' : 'SIGNED IN / RECEIVED'}
                              </span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                {new Date(move.created_at).toLocaleString()}
                              </span>
                            </div>

                            <div className="text-xs text-zinc-700 dark:text-zinc-300 grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                              <div>
                                <span className="text-zinc-400 block text-[11px]">From Location:</span>
                                <span className="font-semibold">{move.location_from || 'Unknown'}</span>
                              </div>
                              <div>
                                <span className="text-zinc-400 block text-[11px]">To Location / Team:</span>
                                <span className="font-semibold text-blue-600 dark:text-blue-400">{move.location_to || 'Unknown'}</span>
                              </div>
                              <div>
                                <span className="text-zinc-400 block text-[11px]">Logged By User:</span>
                                <span className="font-medium">{formatUsername(move.username)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: ASSIGNED STOCK BY TEAM ================= */}
      {activeTab === 'assigned' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-800/60 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                  <UsersIcon className="w-5 h-5 text-blue-600" />
                  Currently Assigned Stock & Meters by Team
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Complete breakdown of all items and serialized meters currently signed out to each team or surveyor.
                </p>
              </div>

              {copyFeedback && (
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircleIcon className="w-4 h-4" />
                  {copyFeedback}
                </div>
              )}
            </div>

            {/* Filters for Assigned Stock */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-700/60">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Filter Team</label>
                <select
                  value={assignedTeamFilter}
                  onChange={e => setAssignedTeamFilter(e.target.value)}
                  className={formInputStyle}
                >
                  <option value="All">All Teams</option>
                  {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Filter by Supplier Part #</label>
                <select
                  value={assignedPartFilter}
                  onChange={e => setAssignedPartFilter(e.target.value)}
                  className={formInputStyle}
                >
                  <option value="All">All Part Numbers</option>
                  {availableSupplierPartNumbers.map(p => (
                    <option key={p.partNumber} value={p.partNumber}>
                      {p.partNumber} ({p.itemName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Search Item or Serial</label>
                <input
                  type="text"
                  placeholder="e.g. MK10, SN-04829..."
                  value={assignedSearchTerm}
                  onChange={e => setAssignedSearchTerm(e.target.value)}
                  className={formInputStyle}
                />
              </div>
            </div>
          </div>

          {/* Teams breakdown */}
          {Object.keys(assignedStockData).length === 0 ? (
            <div className="bg-white dark:bg-zinc-800/60 p-12 rounded-xl text-center text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
              <BoxIcon className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
              <p className="font-semibold text-zinc-700 dark:text-zinc-300">No stock is currently assigned to teams</p>
              <p className="text-xs mt-1 text-zinc-400">All inventory items are currently in storehouse locations.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(assignedStockData)
                .filter(([teamName]) => assignedTeamFilter === 'All' || teamName === assignedTeamFilter)
                .map(([teamName, itemsMap]) => {
                  const filteredItems = Object.entries(itemsMap).filter(([itemName, details]) => {
                    if (assignedSearchTerm) {
                      const q = assignedSearchTerm.toLowerCase();
                      const nameMatches = itemName.toLowerCase().includes(q);
                      const serialMatches = details.barcodes.some(b => b.toLowerCase().includes(q));
                      const partMatches = details.partNumber && details.partNumber.toLowerCase().includes(q);
                      if (!nameMatches && !serialMatches && !partMatches) return false;
                    }
                    if (assignedPartFilter !== 'All') {
                      if (details.partNumber !== assignedPartFilter) {
                        const assocs = getPartNumberAssociations(assignedPartFilter);
                        const barcodeMatches = assocs && assocs.allBarcodes.some(b => details.barcodes.includes(b));
                        if (!barcodeMatches) return false;
                      }
                    }
                    return true;
                  });

                  if (filteredItems.length === 0) return null;

                  const totalItems = filteredItems.reduce((sum, [, d]) => sum + d.count, 0);
                  const totalUniqueMeters = filteredItems.reduce((sum, [, d]) => sum + (d.isUnique ? d.count : 0), 0);

                  return (
                    <div key={teamName} className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                      <div className="bg-zinc-50 dark:bg-zinc-900/60 px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <UsersIcon className="w-5 h-5 text-blue-600" />
                          <h3 className="text-base font-bold text-zinc-900 dark:text-white">{teamName}</h3>
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                            {totalItems} item{totalItems === 1 ? '' : 's'} assigned
                          </span>
                          {totalUniqueMeters > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
                              ⚡ {totalUniqueMeters} serialized meter{totalUniqueMeters === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                        {filteredItems.map(([itemName, details]) => {
                          const itemKey = `${teamName}_${itemName}`;
                          const isExpanded = expandedTeamItemKey === itemKey;

                          return (
                            <div key={itemName} className="p-4 space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{itemName}</span>
                                    {details.isUnique && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                                        ⚡ Meter
                                      </span>
                                    )}
                                    {details.partNumber && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                                        Part #: {details.partNumber}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    Total Assigned: <strong className="text-zinc-900 dark:text-white">{details.count}</strong> units
                                  </p>
                                </div>

                                {details.barcodes.length > 0 && (
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(details.barcodes.join('\n'), `Copied ${details.barcodes.length} serials for ${itemName}`)}
                                      className="px-2.5 py-1 text-xs font-medium rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                                    >
                                      Copy {details.barcodes.length} Serials
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedTeamItemKey(isExpanded ? null : itemKey)}
                                      className="px-3 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 transition-colors"
                                    >
                                      {isExpanded ? 'Hide Serial Numbers' : `View ${details.barcodes.length} Serial Numbers`}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Expandable list of serial numbers */}
                              {isExpanded && details.barcodes.length > 0 && (
                                <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-2">
                                  <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    <span>Individual Meter Serial Numbers ({details.barcodes.length}):</span>
                                    <span>Click serial to audit</span>
                                  </div>

                                  <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1 font-mono text-xs">
                                    {details.barcodes.map((sn, idx) => (
                                      <button
                                        key={idx}
                                        type="button"
                                        onClick={() => {
                                          setActiveTab('audit');
                                          setAuditSearchQuery(sn);
                                          handlePerformSerialAudit(sn);
                                        }}
                                        className="px-2 py-1 bg-white dark:bg-zinc-800 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                        title="Click to view lifecycle audit trail"
                                      >
                                        {sn}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 4: STOCK THRESHOLDS ================= */}
      {activeTab === 'thresholds' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-800/60 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <AlertTriangleIcon className="w-5 h-5 text-amber-500" />
              Stock Thresholds & Replenishment Monitor
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Real-time stock alerts for items and meters dropping below minimum thresholds, with supplier part numbers for replenishment.
            </p>
          </div>

          <div className="bg-white dark:bg-zinc-800/60 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {thresholdData.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
                <CheckCircleIcon className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
                <p className="font-semibold text-zinc-700 dark:text-zinc-300">All stock levels healthy!</p>
                <p className="text-xs mt-1 text-zinc-400">No items or meters are currently below their minimum threshold.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                <thead className="bg-zinc-50 dark:bg-zinc-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Supplier Part #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Current Stock</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Order to Replenish</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-zinc-800/40 divide-y divide-zinc-200 dark:border-zinc-700">
                  {thresholdData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-700/30">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {item.status === 'CRITICAL' ? (
                          <span className="px-2.5 py-0.5 inline-flex text-xs leading-5 font-bold rounded-full bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300">
                            Needs Order
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 inline-flex text-xs leading-5 font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                            Warning
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-medium text-sm text-zinc-900 dark:text-zinc-100">{item.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        {item.partNumber ? (
                          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                            {item.partNumber}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        {item.isUnique ? (
                          <span className="text-blue-600 dark:text-blue-400 font-semibold">⚡ Meter / Unique</span>
                        ) : (
                          <span className="text-zinc-500">Standard Bulk</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100 font-medium">{item.currentStock}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">{item.suggestedOrder || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL: VIEW ALL SERIAL NUMBERS IN BATCH ================= */}
      <Modal
        isOpen={Boolean(viewSerialsModalData)}
        onClose={() => setViewSerialsModalData(null)}
        title={viewSerialsModalData ? `Serial Numbers: ${viewSerialsModalData.item_name}` : 'Serial Numbers'}
        maxWidth="max-w-xl"
      >
        {viewSerialsModalData && (
          <div className="space-y-4 py-2">
            <div className="flex justify-between items-center text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div>
                <p><span className="font-semibold text-zinc-700 dark:text-zinc-200">Date:</span> {new Date(viewSerialsModalData.created_at).toLocaleString()}</p>
                <p><span className="font-semibold text-zinc-700 dark:text-zinc-200">Type:</span> {viewSerialsModalData.movement_type === 'IN' ? 'Sign In' : 'Sign Out'}</p>
                {viewSerialsModalData.partNumber && (
                  <p><span className="font-semibold text-zinc-700 dark:text-zinc-200">Part #:</span> {viewSerialsModalData.partNumber}</p>
                )}
              </div>
              <div className="text-right">
                <p><span className="font-semibold text-zinc-700 dark:text-zinc-200">From:</span> {viewSerialsModalData.location_from}</p>
                <p><span className="font-semibold text-zinc-700 dark:text-zinc-200">To:</span> {viewSerialsModalData.location_to}</p>
              </div>
            </div>

            {/* Search inside modal */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search serial..."
                value={serialSearchTerm}
                onChange={e => setSerialSearchTerm(e.target.value)}
                className={formInputStyle}
              />
              <button
                type="button"
                onClick={() => copyToClipboard(viewSerialsModalData.barcodes.join('\n'), `Copied ${viewSerialsModalData.barcodes.length} serials`)}
                className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded whitespace-nowrap"
              >
                Copy All ({viewSerialsModalData.barcodes.length})
              </button>
            </div>

            {/* List of serials */}
            <div className="max-h-64 overflow-y-auto space-y-1 p-2 bg-zinc-50 dark:bg-zinc-900/60 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-xs">
              {viewSerialsModalData.barcodes
                .filter(s => !serialSearchTerm || s.toLowerCase().includes(serialSearchTerm.toLowerCase()))
                .map((sn, idx) => (
                  <div key={idx} className="flex justify-between items-center py-1 px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                    <span className="text-zinc-800 dark:text-zinc-200">{sn}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setViewSerialsModalData(null);
                        setActiveTab('audit');
                        setAuditSearchQuery(sn);
                        handlePerformSerialAudit(sn);
                      }}
                      className="text-xs text-blue-600 hover:underline font-sans"
                    >
                      Audit Trail
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewSerialsModalData(null)}
                className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL: VIEW ALL ASSOCIATED BARCODES FOR PART NUMBER ================= */}
      <Modal
        isOpen={Boolean(viewAssociatedBarcodesModal)}
        onClose={() => setViewAssociatedBarcodesModal(null)}
        title={viewAssociatedBarcodesModal ? `Associated Barcodes: Part #${viewAssociatedBarcodesModal.query}` : 'Associated Barcodes'}
        maxWidth="max-w-xl"
      >
        {viewAssociatedBarcodesModal && (
          <div className="space-y-4 py-2">
            <div className="bg-zinc-50 dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">Part Number:</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{viewAssociatedBarcodesModal.query}</span>
              </div>
              {viewAssociatedBarcodesModal.suppliers.length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Supplier:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{viewAssociatedBarcodesModal.suppliers.join(', ')}</span>
                </div>
              )}
              {viewAssociatedBarcodesModal.itemNames.length > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Linked Item Type:</span>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{viewAssociatedBarcodesModal.itemNames.join(', ')}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1 border-t border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-500">Total Barcodes Identified:</span>
                <span className="font-bold text-blue-700 dark:text-blue-300">{viewAssociatedBarcodesModal.totalBarcodesCount} (across supplier codes, item barcodes, & serialized meters)</span>
              </div>
            </div>

            {/* Search filter for barcodes */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Filter barcode or serial..."
                value={barcodeSearchModalTerm}
                onChange={e => setBarcodeSearchModalTerm(e.target.value)}
                className={formInputStyle}
              />
              <button
                type="button"
                onClick={() => copyToClipboard(viewAssociatedBarcodesModal.allBarcodes.join('\n'), `Copied all ${viewAssociatedBarcodesModal.allBarcodes.length} barcodes`)}
                className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded whitespace-nowrap"
              >
                Copy All ({viewAssociatedBarcodesModal.allBarcodes.length})
              </button>
            </div>

            {/* List of barcodes */}
            <div className="max-h-64 overflow-y-auto space-y-1.5 p-2 bg-zinc-50 dark:bg-zinc-900/60 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-xs">
              {viewAssociatedBarcodesModal.allBarcodes
                .filter(b => !barcodeSearchModalTerm || b.toLowerCase().includes(barcodeSearchModalTerm.toLowerCase()))
                .map((barcode, idx) => {
                  const isSupplierBarcode = viewAssociatedBarcodesModal.explicitSupplierBarcodes.includes(barcode);
                  const isItemTypeBarcode = viewAssociatedBarcodesModal.itemTypeBarcodes.includes(barcode);
                  const isUniqueSerial = viewAssociatedBarcodesModal.uniqueMeterSerials.includes(barcode);

                  return (
                    <div key={idx} className="flex justify-between items-center py-1 px-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-900 dark:text-zinc-100">{barcode}</span>
                        {isSupplierBarcode && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 font-sans">
                            Supplier Code
                          </span>
                        )}
                        {isItemTypeBarcode && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300 font-sans">
                            Catalog Barcode
                          </span>
                        )}
                        {isUniqueSerial && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 font-sans">
                            Meter Serial
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setViewAssociatedBarcodesModal(null);
                          setActiveTab('audit');
                          setAuditSearchQuery(barcode);
                          handlePerformSerialAudit(barcode);
                        }}
                        className="text-xs text-blue-600 hover:underline font-sans"
                      >
                        Audit
                      </button>
                    </div>
                  );
                })}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewAssociatedBarcodesModal(null)}
                className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ================= MODAL: PDF READY ================= */}
      <Modal
        isOpen={Boolean(pdfPreviewUrl)}
        onClose={() => setPdfPreviewUrl(null)}
        title={pdfPreviewUrl === 'native-saved' ? 'Saved to Documents' : 'PDF Report Ready'}
      >
        <div className="flex flex-col items-center text-center space-y-4 py-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center">
            <DocumentArrowDownIcon className="w-12 h-12" />
          </div>
          {pdfPreviewUrl === 'native-saved' ? (
            <>
              <p className="text-zinc-600 dark:text-zinc-300 font-medium">
                Your PDF has been saved to your Documents folder.
              </p>
              <button
                onClick={() => setPdfPreviewUrl(null)}
                className="w-full mt-4 flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <p className="text-zinc-600 dark:text-zinc-300 font-medium text-sm">
                Your PDF report has been generated with all serial numbers and supplier part numbers.
              </p>
              <div className="flex flex-col w-full gap-2.5 mt-4">
                <a
                  href={pdfPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Open & Print PDF
                </a>
                <a
                  href={pdfPreviewUrl}
                  download="inventory_movements_report.pdf"
                  className="w-full flex items-center justify-center px-4 py-2.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                >
                  Download PDF File
                </a>
                <button
                  onClick={() => setPdfPreviewUrl(null)}
                  className="w-full flex items-center justify-center px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-md font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ================= MODAL: CSV READY ================= */}
      <Modal
        isOpen={Boolean(csvModalData)}
        onClose={() => setCsvModalData(null)}
        title="CSV Export Ready"
      >
        <div className="flex flex-col items-center text-center space-y-4 py-4">
          <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center">
            <DocumentArrowDownIcon className="w-12 h-12" />
          </div>
          <p className="text-zinc-600 dark:text-zinc-300 font-medium text-sm">
            Your CSV export with {csvModalData?.rowCount || 0} movement records is ready.
          </p>
          <div className="flex flex-col w-full gap-2.5 mt-2">
            {csvModalData?.url && (
              <a
                href={csvModalData.url}
                download={csvModalData.fileName}
                className="w-full flex items-center justify-center px-4 py-3 bg-emerald-600 text-white rounded-md font-medium hover:bg-emerald-700 transition-colors shadow-sm"
              >
                Download CSV File
              </a>
            )}
            {typeof navigator !== 'undefined' && navigator.canShare && csvModalData?.file && navigator.canShare({ files: [csvModalData.file] }) && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: 'Inventory Movements CSV',
                      files: [csvModalData.file]
                    });
                  } catch (e) {
                    console.warn(e);
                  }
                }}
                className="w-full flex items-center justify-center px-4 py-2.5 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors shadow-sm"
              >
                Share via System Apps
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (csvModalData?.content) {
                  navigator.clipboard.writeText(csvModalData.content);
                  setCopyFeedback(`Copied ${csvModalData.rowCount} records to clipboard!`);
                  setTimeout(() => setCopyFeedback(null), 3000);
                }
              }}
              className="w-full flex items-center justify-center px-4 py-2.5 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-800 rounded-md font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              Copy Full CSV to Clipboard
            </button>
            {copyFeedback && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ {copyFeedback}
              </p>
            )}
            <button
              type="button"
              onClick={() => setCsvModalData(null)}
              className="w-full mt-2 flex items-center justify-center px-4 py-2 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ReportingPage;
