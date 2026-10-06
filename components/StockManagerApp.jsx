import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useStock } from '../hooks/useStock';
import { View, Location, Team, TeamType, StockCategory, POStatus } from '../types';
import { LOCATIONS, STOCK_CATEGORIES } from '../constants';
import { useDarkMode } from '../hooks/useDarkMode';
import Scanner from './Scanner';
import Modal from './Modal';
import PurchasingPage from './PurchasingPage';
import StockTakePage from './StockTakePage';
import { BrandIcon, ScanIcon, InformationCircleIcon, AddIcon, ListIcon, ChevronDownIcon, LogoutIcon, AdminIcon, BoxIcon, TagIcon, UsersIcon, BuildingStoreIcon, SunIcon, MoonIcon, EditIcon, TrashIcon, CurrencyPoundIcon, ArchiveIcon, PlusCircleIcon, ArrowRightCircleIcon, CheckCircleIcon, XCircleIcon, SettingsIcon, XIcon, ChartBarIcon, PurchasingIcon, SwitchUserIcon, CalculatorIcon, DocumentArrowDownIcon, UploadIcon, RefreshIcon, ClipboardCheckIcon, BellIcon, SearchIcon, BarcodeIcon, AlertTriangleIcon } from './Icons';
import { supabase } from '../lib/supabaseClient';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { App as CapacitorApp } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- Helper functions for serial number range expansion ---

/**
 * Parses a serial number into its constituent parts: prefix, number, and suffix.
 * It identifies the *last* block of digits in the string as the number part.
 * e.g., "ITEM-01-A99" -> { prefix: "ITEM-01-A", numStr: "99", suffix: "" }
 */
const parseSerial = (serial) => {
    let lastDigitIndex = -1;
    for (let i = serial.length - 1; i >= 0; i--) {
        if (!isNaN(parseInt(serial[i], 10))) {
            lastDigitIndex = i;
            break;
        }
    }

    if (lastDigitIndex === -1) return null; // No number found

    let firstDigitIndex = lastDigitIndex;
    while (firstDigitIndex > 0 && !isNaN(parseInt(serial[firstDigitIndex - 1], 10))) {
        firstDigitIndex--;
    }

    const prefix = serial.substring(0, firstDigitIndex);
    const numStr = serial.substring(firstDigitIndex, lastDigitIndex + 1);
    const suffix = serial.substring(lastDigitIndex + 1);
    
    return { prefix, numStr, suffix };
};


/**
 * Expands a serial number range into a full array of serial numbers.
 * This function robustly handles complex alphanumeric serials by identifying the
 * last numeric part of the strings to iterate over.
 * Returns an object { result: string[] } on success, or { error: string } on failure.
 */
const expandRange = (start, end) => {
    const startParts = parseSerial(start);
    const endParts = parseSerial(end);

    if (!startParts || !endParts) {
        return { error: "Invalid format. Serials must contain a number part for range expansion." };
    }
    
    const { prefix: startPrefix, numStr: startNumStr, suffix: startSuffix } = startParts;
    const { prefix: endPrefix, numStr: endNumStr, suffix: endSuffix } = endParts;


    // For a valid range, the non-numeric parts must be identical.
    if (startPrefix !== endPrefix || startSuffix !== endSuffix) {
        return { error: "The text parts (prefix/suffix) of the serial numbers do not match." };
    }
    
    const startNum = parseInt(startNumStr, 10);
    const endNum = parseInt(endNumStr, 10);

    // The start of the range cannot be greater than the end.
    if (startNum > endNum) {
        return { error: "The start number cannot be greater than the end number." };
    }

    const results = [];
    // The padding of the numbers should be consistent with the longest number string.
    const padLength = Math.max(startNumStr.length, endNumStr.length);

    for (let i = startNum; i <= endNum; i++) {
        // Pad the number and reconstruct the serial string.
        const paddedNum = String(i).padStart(padLength, '0');
        results.push(`${startPrefix}${paddedNum}${startSuffix}`);
    }

    return { result: results };
};

const expandRangeByQuantity = (start, quantity) => {
    const startParts = parseSerial(start);
    if (!startParts) {
        return { error: "Invalid format. Serial must contain a number part." };
    }
    
    const { prefix, numStr, suffix } = startParts;
    const startNum = parseInt(numStr, 10);
    const padLength = numStr.length;
    
    const results = [];
    for (let i = 0; i < quantity; i++) {
        const paddedNum = String(startNum + i).padStart(padLength, '0');
        results.push(`${prefix}${paddedNum}${suffix}`);
    }
    
    return { result: results };
};

const ReportingPage = ({ teams, dbLocations, filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen }) => {
  
  const [activeTab, setActiveTab] = useState('movements');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);

  const assignedStockData = useMemo(() => {
    const assigned = stock.filter(item => item.assigned_to && item.assigned_to !== 'Unassigned');
    const groups = {};
    assigned.forEach(item => {
      const team = item.assigned_to;
      if (!groups[team]) groups[team] = {};
      if (!groups[team][item.name]) groups[team][item.name] = { count: 0, barcodes: [] };
      groups[team][item.name].count++;
      groups[team][item.name].barcodes.push(item.barcode);
    });
    return groups;
  }, [stock]);

      const thresholdData = useMemo(() => {
    const stockCounts = {};
    stock.forEach(item => {
        if (!item.assigned_to || item.assigned_to === 'Unassigned') {
            if (!stockCounts[item.name]) stockCounts[item.name] = 0;
            stockCounts[item.name]++;
        }
    });

    const report = [];
    itemTypes.forEach(type => {
        const currentStock = stockCounts[type.name] || 0;
        // The stock_threshold on the item type is already the 6-week calculated buffer
        const threshold = parseInt(type.stock_threshold) || 0;
        
        let status = 'OK';
        if (currentStock <= threshold) {
            status = 'CRITICAL';
        } else if (threshold > 0 && currentStock <= threshold * 1.5) {
            status = 'WARNING';
        }

        if (status !== 'OK') {
            // Replenish stock back up to the 6-week threshold
            const suggestedOrder = Math.max(0, threshold - currentStock);
            
            report.push({
                name: type.name,
                currentStock,
                threshold,
                suggestedOrder,
                status
            });
        }
    });
    
    return report.sort((a, b) => {
        if (a.status === b.status) return a.currentStock - b.currentStock;
        return a.status === 'CRITICAL' ? -1 : 1;
    });
  }, [stock, itemTypes]);

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const uniqueItemNames = useMemo(() => {
    const names = new Set(stock.map(item => item.name));
    return ['All', ...Array.from(names).sort()];
  }, [stock]);

  const handleGenerateReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');
      
      let query = supabase
        .from('stock_movements')
        .select('*')
        
        .gte('created_at', new Date(filters.startDate).toISOString())
        .lte('created_at', new Date(`${filters.endDate}T23:59:59.999Z`).toISOString())
        .order('created_at', { ascending: false });

            if (filters.itemName !== 'All') {
        query = query.eq('item_name', filters.itemName);
      }
      if (filters.team && filters.team !== 'All') {
        query = query.or(`location_from.eq."${filters.team}",location_to.eq."${filters.team}"`);
      }
      if (filters.location && filters.location !== 'All') {
        query = query.or(`location_from.eq."${filters.location}",location_to.eq."${filters.location}"`);
      }
      if (filters.partNumber && filters.partNumber.trim() !== '') {
        query = query.eq('item_barcode', filters.partNumber.trim());
      }

      const { data, error } = await query;
      if (error) throw error;
      
      setReportData(data);
    } catch (err) {
      setError(`Failed to generate report: ${err.message}`);
      setReportData(null);
    } finally {
      setLoading(false);
    }
  }, [filters, setLoading, setError, setReportData]);

  const reportSummary = useMemo(() => {
    if (!reportData) return { totalIn: 0, totalOut: 0, netChange: 0 };
    const summary = reportData.reduce((acc, move) => {
        if (move.movement_type === 'IN') acc.totalIn += 1;
        if (move.movement_type === 'OUT') acc.totalOut += 1;
        return acc;
    }, { totalIn: 0, totalOut: 0 });
    summary.netChange = summary.totalIn - summary.totalOut;
    return summary;
  }, [reportData]);
  
  const groupedReportData = useMemo(() => {
    if (!reportData) return null;
    
    const groups = {};
    
    reportData.forEach(move => {
      // Group by minute to catch bulk inserts and rapid scans
      const timeKey = new Date(move.created_at).toISOString().slice(0, 16); 
      const key = `${move.item_name}|${move.movement_type}|${move.location_from}|${move.location_to}|${move.username}|${timeKey}`;
      
      if (!groups[key]) {
        groups[key] = {
          id: move.id, // use first id as key
          created_at: move.created_at,
          item_name: move.item_name,
          movement_type: move.movement_type,
          location_from: move.location_from,
          location_to: move.location_to,
          username: move.username,
          quantity: 0,
          barcodes: []
        };
      }
      
      groups[key].quantity += 1;
      if (move.item_barcode) {
        groups[key].barcodes.push(move.item_barcode);
      }
    });
    
    // Convert back to array and sort by created_at descending
    return Object.values(groups).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [reportData]);
  
  const handlePrint = async () => {
    setIsGeneratingPdf(true);
    try {
        const doc = new jsPDF();
        
                doc.setFontSize(20);
        doc.text(`Inventory Report`, 14, 22);
        doc.setFontSize(12);
        let headerText = `Period: ${new Date(filters.startDate).toLocaleDateString()} to ${new Date(filters.endDate).toLocaleDateString()}`;
        if (filters.team && filters.team !== 'All') {
            headerText += ` | Team: ${filters.team}`;
        }
        if (filters.location && filters.location !== 'All') {
            headerText += ` | Location: ${filters.location}`;
        }
        if (filters.itemName && filters.itemName !== 'All') {
            headerText += ` | Item: ${filters.itemName}`;
        }
        doc.text(headerText, 14, 32);
        
        doc.text(`Total Items In: ${reportSummary.totalIn}`, 14, 42);
        doc.text(`Total Items Out: ${reportSummary.totalOut}`, 80, 42);
        doc.text(`Net Change: ${reportSummary.netChange > 0 ? '+' : ''}${reportSummary.netChange}`, 140, 42);

        const tableColumn = ["Date", "Item", "Qty", "Type", "From", "To", "User"];
        const tableRows = [];

        groupedReportData.forEach(move => {
            const itemDetails = move.quantity === 1 && move.barcodes.length > 0 
                ? `${move.item_name}\n(${move.barcodes[0]})` 
                : `${move.item_name}`;

            const itemData = [
                new Date(move.created_at).toLocaleString(),
                itemDetails,
                move.quantity.toString(),
                move.movement_type,
                move.location_from,
                move.location_to,
                move.username
            ];
            tableRows.push(itemData);
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 50,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [71, 85, 105] }
        });

        const fileName = `inventory_report_${new Date().getTime()}.pdf`;

        if (Capacitor.isNativePlatform()) {
            try {
                const pdfBase64 = doc.output('datauristring').split(',')[1];
                const savedFile = await Filesystem.writeFile({
                    path: fileName,
                    data: pdfBase64,
                    directory: Directory.Documents
                });
                
                try {
                    await Share.share({
                        title: 'Inventory Report',
                        url: savedFile.uri,
                    });
                } catch (shareErr) {
                    console.warn("Native PDF share failed, but file is saved", shareErr);
                    setPdfPreviewUrl('native-saved');
                }
                return;
            } catch (nativeErr) {
                console.error("Native file save failed", nativeErr);
                setError("Failed to save PDF on device: " + nativeErr.message);
                return;
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
                console.warn("Web share failed or was cancelled", shareErr);
            }
        }

        const url = URL.createObjectURL(blob);
        setPdfPreviewUrl(url);
    } catch (err) {
        console.error("Failed to generate PDF:", err);
        setError("Failed to generate PDF report: " + err.message);
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  return (
    <Page title="Inventory Reports">
      
      <div className="border-b border-zinc-200 dark:border-zinc-700 mb-6 no-print">
          <nav className="-mb-px flex space-x-6 overflow-x-auto">
              <button onClick={() => setActiveTab('movements')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'movements' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'}`}>Movement History</button>
              <button onClick={() => setActiveTab('assigned')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'assigned' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'}`}>Assigned Stock</button>
              <button onClick={() => setActiveTab('thresholds')} className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'thresholds' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'}`}>Stock Thresholds</button>
          </nav>
      </div>

      {activeTab === 'movements' && (
        <div className="space-y-6">

        <div className="bg-white dark:bg-zinc-800/50 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 no-print">
          <h2 className="text-xl font-bold text-zinc-800 dark:text-white mb-4">Report Filters</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4 items-end">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Start Date</label>
              <input type="date" id="start-date" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">End Date</label>
              <input type="date" id="end-date" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
              <label htmlFor="team-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team</label>
              <select id="team-filter" value={filters.team || 'All'} onChange={e => setFilters(prev => ({...prev, team: e.target.value}))} className={formInputStyle}>
                <option value="All">All Teams</option>
                {teams && teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="location-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location</label>
              <select id="location-filter" value={filters.location || 'All'} onChange={e => setFilters(prev => ({...prev, location: e.target.value}))} className={formInputStyle}>
                <option value="All">All Locations</option>
                {dbLocations && dbLocations.map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="item-name-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Name</label>
              <select id="item-name-filter" value={filters.itemName} onChange={e => setFilters(prev => ({...prev, itemName: e.target.value}))} className={formInputStyle}>
                {uniqueItemNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="part-number-filter" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Part Number</label>
              <input 
                type="text" 
                id="part-number-filter"
                placeholder="Enter barcode..."
                value={filters.partNumber} 
                onChange={e => setFilters(prev => ({...prev, partNumber: e.target.value}))} 
                className={formInputStyle} 
              />
            </div>
            <button onClick={handleGenerateReport} disabled={loading} className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center h-10">
              {loading && <Spinner className="w-5 h-5 mr-2" />}
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>

        {reportData ? (
          <div id="report-content" className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
             <div className="p-6 border-b border-zinc-200 dark:border-zinc-700">
                <div className="flex justify-between items-center">
                    <div>
                                                <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Report Results</h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            For period {new Date(filters.startDate).toLocaleDateString()} to {new Date(filters.endDate).toLocaleDateString()}
                            {filters.team && filters.team !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Team: {filters.team}</span>}
                            {filters.location && filters.location !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Location: {filters.location}</span>}
                            {filters.itemName && filters.itemName !== 'All' && <span className="ml-2 font-medium text-blue-600 dark:text-blue-400">&bull; Item: {filters.itemName}</span>}
                        </p>
                    </div>
                    <button onClick={handlePrint} disabled={isGeneratingPdf} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center no-print disabled:bg-blue-400">
                      {isGeneratingPdf && <Spinner className="w-4 h-4 mr-2" />}
                      {isGeneratingPdf ? 'Generating...' : 'Save PDF'}
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                    <StatCard title="Total Items In" value={reportSummary.totalIn} icon={<PlusCircleIcon className="w-6 h-6 text-white"/>} colorClass="bg-green-500" />
                    <StatCard title="Total Items Out" value={reportSummary.totalOut} icon={<ArrowRightCircleIcon className="w-6 h-6 text-white"/>} colorClass="bg-red-500" />
                    <StatCard title="Net Change" value={reportSummary.netChange > 0 ? `+${reportSummary.netChange}` : reportSummary.netChange} icon={<ChartBarIcon className="w-6 h-6 text-white"/>} colorClass="bg-indigo-500" />
                </div>
            </div>
            <div>
              {/* --- Mobile View: Cards --- */}
              <div className="md:hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                {groupedReportData.map(move => (
                  <div key={move.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{move.item_name}</p>
                        {move.quantity > 1 ? (
                          <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
                            {move.quantity} items
                          </p>
                        ) : (
                          <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">{move.barcodes[0]}</p>
                        )}
                      </div>
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${move.movement_type === 'IN' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                          {move.movement_type}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
                        <p><span className="font-medium text-zinc-500 dark:text-zinc-400">Date:</span> {new Date(move.created_at).toLocaleString()}</p>
                        <p><span className="font-medium text-zinc-500 dark:text-zinc-400">From:</span> {move.location_from}</p>
                        <p><span className="font-medium text-zinc-500 dark:text-zinc-400">To:</span> {move.location_to}</p>
                        <p><span className="font-medium text-zinc-500 dark:text-zinc-400">User:</span> {move.username}</p>
                        {move.quantity > 1 && (
                          <p className="text-xs text-zinc-400 mt-2">Barcodes: {move.barcodes.slice(0, 5).join(', ')}{move.barcodes.length > 5 ? '...' : ''}</p>
                        )}
                    </div>
                  </div>
                ))}
              </div>

              {/* --- Desktop View: Table --- */}
              <div className="hidden md:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                          <tr>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Date</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Qty</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Type</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">From</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">To</th>
                              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">User</th>
                          </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                          {groupedReportData.map(move => (
                              <tr key={move.id}>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{new Date(move.created_at).toLocaleString()}</td>
                                  <td className="px-6 py-4">
                                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{move.item_name}</div>
                                      <div className="text-sm text-zinc-500 dark:text-zinc-400 font-mono" title={move.barcodes.join(', ')}>
                                        {move.quantity === 1 ? move.barcodes[0] : `${move.barcodes.slice(0, 3).join(', ')}${move.barcodes.length > 3 ? '...' : ''}`}
                                      </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100 font-medium">
                                      {move.quantity}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${move.movement_type === 'IN' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                                          {move.movement_type}
                                      </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{move.location_from}</td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{move.location_to}</td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{move.username}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 px-6 bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Generate a report</h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Select your filters above and click "Generate Report" to see stock movement history.</p>
          </div>
        )}
      
        </div>
      )}

      {activeTab === 'assigned' && (
          <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-700">
                  <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Assigned Stock by Team</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Currently signed out inventory.</p>
              </div>
              <div className="p-0">
                  {Object.keys(assignedStockData).length === 0 ? (
                      <div className="p-6 text-center text-zinc-500 dark:text-zinc-400">No items are currently signed out to teams.</div>
                  ) : (
                      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                          {Object.entries(assignedStockData).map(([team, items]) => (
                              <div key={team} className="p-6">
                                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">{team}</h3>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {Object.entries(items).map(([itemName, data]) => (
                                          <div key={itemName} className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded p-4">
                                              <p className="font-medium text-zinc-900 dark:text-zinc-100">{itemName}</p>
                                              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{data.count}</p>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      )}

      {activeTab === 'thresholds' && (
          <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="p-6 border-b border-zinc-200 dark:border-zinc-700">
                  <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Stock Threshold Alerts</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Items falling below their 6-week stock threshold, along with the order quantity required to replenish them.</p>
              </div>
              <div className="overflow-x-auto">
                  {thresholdData.length === 0 ? (
                      <div className="p-6 text-center text-zinc-500 dark:text-zinc-400">All stock levels are healthy!</div>
                  ) : (
                      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                          <thead className="bg-zinc-50 dark:bg-zinc-800">
                              <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Current Stock</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold (6-Weeks)</th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Order to Replenish</th>
                              </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                              {thresholdData.map((item, idx) => (
                                  <tr key={idx}>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                          {item.status === 'CRITICAL' ? (
                                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">Needs Order</span>
                                          ) : (
                                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">Warning</span>
                                          )}
                                      </td>
                                      <td className="px-6 py-4 font-medium text-zinc-900 dark:text-zinc-100">{item.name}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-900 dark:text-zinc-100">{item.currentStock}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{item.threshold}</td>
                                      <td className="px-6 py-4 whitespace-nowrap font-bold text-blue-600 dark:text-blue-400">{item.suggestedOrder || 0}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  )}
              </div>
          </div>
      )}

      <Modal isOpen={!!pdfPreviewUrl} onClose={() => setPdfPreviewUrl(null)} title={pdfPreviewUrl === 'native-saved' ? 'Saved to Documents' : 'PDF Report Ready'}>
         <div className="flex flex-col items-center text-center space-y-4 py-4">
            <div className="p-4 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center">
               <DocumentArrowDownIcon className="w-12 h-12" />
            </div>
            {pdfPreviewUrl === 'native-saved' ? (
                <>
                    <p className="text-zinc-600 dark:text-zinc-300 font-medium">
                       Your PDF has been saved to your Documents folder.
                    </p>
                    <p className="text-xs text-zinc-500 mt-2">
                       You can find it in your phone's File Manager under Documents. From there, you can open it and print it.
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
                    <p className="text-zinc-600 dark:text-zinc-300 font-medium">
                       Your PDF has been generated successfully.
                    </p>
                    <div className="flex flex-col w-full gap-3 mt-4">
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
                         download={`inventory_report_${new Date().getTime()}.pdf`}
                         className="w-full flex items-center justify-center px-4 py-3 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md font-medium hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors shadow-sm"
                       >
                         Download PDF
                       </a>
                    </div>
                    <p className="text-xs text-zinc-500 mt-4 leading-relaxed">
                       Note: If downloading does not work, please use "Open & Print PDF".
                    </p>
                </>
            )}
         </div>
      </Modal>

    </Page>
  );
};


export const formInputStyle = "mt-1 block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-md shadow-sm placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 focus:border-transparent sm:text-sm";

export const SearchableSelect = ({ options, value, onChange, placeholder, loading }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef(null);

  useEffect(() => {
      // Keep search term in sync with external value if component is closed
      if (!isOpen && value) {
          setSearchTerm(value);
      }
  }, [value, isOpen]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        // If user clicks away without selecting, reset input to the actual current value
        setSearchTerm(value || '');
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef, value]);
  
  const filteredOptions = useMemo(() => {
    if (!searchTerm || searchTerm === value) return options;
    const lowercasedFilter = searchTerm.toLowerCase().trim();
    
    const filtered = {};
    Object.keys(options).forEach(category => {
      const subcategories = options[category];
      const filteredSubcategories = {};
      Object.keys(subcategories).forEach(subcategory => {
        const items = subcategories[subcategory];
        const filteredItems = items.filter(item => {
          const nameMatch = item.name.toLowerCase().includes(lowercasedFilter);
          const barcodeMatch = item.barcode && String(item.barcode).toLowerCase().includes(lowercasedFilter);
          const partsMatch = (item.supplierPartNumbers || []).some(sp => 
            (sp.part_number && String(sp.part_number).toLowerCase().includes(lowercasedFilter)) ||
            (sp.supplier_name && String(sp.supplier_name).toLowerCase().includes(lowercasedFilter)) ||
            (sp.suppliers?.name && String(sp.suppliers.name).toLowerCase().includes(lowercasedFilter)) ||
            (sp.barcode && String(sp.barcode).toLowerCase().includes(lowercasedFilter))
          );
          return nameMatch || barcodeMatch || partsMatch;
        });
        if (filteredItems.length > 0) {
          filteredSubcategories[subcategory] = filteredItems;
        }
      });
      if (Object.keys(filteredSubcategories).length > 0) {
        filtered[category] = filteredSubcategories;
      }
    });
    return filtered;
  }, [searchTerm, options, value]);

  const handleSelect = (optionName) => {
    onChange({ target: { name: 'name', value: optionName } });
    setSearchTerm(optionName);
    setIsOpen(false);
  };
  
  const hasResults = Object.keys(filteredOptions).length > 0;

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        className={formInputStyle}
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          if(!isOpen) setIsOpen(true);
          // if user clears input, clear selection
          if(e.target.value === '') {
            onChange({ target: { name: 'name', value: '' } });
          }
        }}
        onFocus={() => {
            setIsOpen(true);
            // When focusing, if the current search term is the selected value, clear it to allow easy re-searching
            if (value && searchTerm === value) {
                setSearchTerm('');
            }
        }}
        onClick={() => setIsOpen(true)}
        disabled={loading}
      />
      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-2 text-zinc-500">Loading...</div>
          ) : hasResults ? (
            Object.keys(filteredOptions).sort().map(category => (
              <div key={category}>
                {Object.keys(filteredOptions[category]).sort().map(subCategory => (
                    <div key={`${category}-${subCategory}`}>
                        <span className="block px-4 py-2 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase bg-zinc-50 dark:bg-zinc-700/50 sticky top-0">{category} / {subCategory}</span>
                        {filteredOptions[category][subCategory].map(type => (
                            <button
                                type="button"
                                key={type.id}
                                className={`w-full text-left px-4 py-2 text-sm transition-colors border-b border-zinc-100 dark:border-zinc-700/50 last:border-0 ${type.name === value ? 'bg-blue-600 text-white' : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}
                                onClick={() => handleSelect(type.name)}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{type.name}</span>
                                    {type.barcode && <span className={`text-[11px] font-mono ${type.name === value ? 'text-blue-100' : 'text-zinc-400 dark:text-zinc-500'}`}>{type.barcode}</span>}
                                </div>
                                {type.supplierPartNumbers && type.supplierPartNumbers.length > 0 && (
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        {type.supplierPartNumbers.map((sp, idx) => (
                                            <span key={idx} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${type.name === value ? 'bg-blue-700 text-blue-100 border-blue-500' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'}`}>
                                                <span className="font-semibold">{sp.suppliers?.name || sp.supplier_name || 'Part'}:</span> {sp.part_number}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                ))}
              </div>
            ))
          ) : (
            <div className="px-4 py-2 text-zinc-500">No results found for "{searchTerm}".</div>
          )}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, icon, colorClass, subtitle }) => (
    <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 flex items-center">
        <div className={`rounded-full p-3 ${colorClass} flex-shrink-0`}>
            {icon}
        </div>
        <div className="ml-4 min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 truncate">{title}</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
            {subtitle && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
    </div>
);

export const Page = ({ title, actions, children }) => (
  <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white">{title}</h1>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
  </div>
);

const SidebarNavItem = ({ icon, label, isActive, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>
      {React.cloneElement(icon, { className: 'w-5 h-5' })}
      <span className="ml-3">{label}</span>
  </button>
);

const MobileNavItem = ({ icon, label, isActive, onClick }) => (
  <button onClick={onClick} className={`flex-1 flex flex-col items-center justify-center p-3 rounded-lg transition-colors ${isActive ? 'text-blue-600' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
      {React.cloneElement(icon, { className: 'w-6 h-6' })}
      <span className="text-xs font-medium mt-1.5">{label}</span>
  </button>
);

// --- UI ENHANCEMENT COMPONENTS ---

export const Spinner = ({ className }) => (
    <svg className={className || "animate-spin h-5 w-5 text-white"} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export const EmptyState = ({ icon, title, message, action }) => (
    <div className="text-center py-16 px-6">
        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800">
            {React.cloneElement(icon, { className: "w-6 h-6 text-zinc-500 dark:text-zinc-400" })}
        </div>
        <h3 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
        {action && (
            <div className="mt-6">
                {action}
            </div>
        )}
    </div>
);

const StatCardSkeleton = () => (
    <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 flex items-center animate-pulse">
        <div className="rounded-full bg-zinc-200 dark:bg-zinc-700 h-12 w-12"></div>
        <div className="ml-4 flex-1">
            <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full w-24 mb-2"></div>
            <div className="h-4 bg-zinc-300 dark:bg-zinc-600 rounded-full w-12"></div>
        </div>
    </div>
);

const StockItemGroupSkeleton = ({ count = 3 }) => (
    <div className="space-y-2 p-2 md:p-4">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden p-4 animate-pulse">
                <div className="flex justify-between items-center">
                    <div className="flex-1">
                        <div className="h-4 bg-zinc-300 dark:bg-zinc-600 rounded-full w-1/3 mb-2"></div>
                        <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/4"></div>
                    </div>
                    <div className="h-5 w-5 bg-zinc-200 dark:bg-zinc-700 rounded-full"></div>
                </div>
            </div>
        ))}
    </div>
);

export const ListItemSkeleton = ({ count = 5 }) => (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="px-4 py-3 animate-pulse">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 space-y-2">
                        <div className="h-3 bg-zinc-300 dark:bg-zinc-600 rounded-full w-3/4"></div>
                        <div className="h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/2"></div>
                    </div>
                    <div className="w-20 h-4 bg-zinc-200 dark:bg-zinc-700 rounded-full"></div>
                </div>
            </div>
        ))}
    </div>
);

const ExternalScannerPage = ({ onScanSuccess, onCancel, persistent = false }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        const focusInput = () => {
            // Avoid focusing if activeElement is an interactive button or control
            if (document.activeElement && (document.activeElement.tagName === 'BUTTON' || document.activeElement.closest?.('button'))) {
                return;
            }
            inputRef.current?.focus({ preventScroll: true });
        };
        const timeoutId = setTimeout(focusInput, 100); 
        return () => clearTimeout(timeoutId);
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        const scannedValue = inputRef.current?.value.trim();
        if (scannedValue) {
            onScanSuccess(scannedValue);
            if (inputRef.current) {
                inputRef.current.value = '';
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col justify-center items-center p-8 bg-zinc-50 dark:bg-zinc-900 text-center" aria-modal="true" role="dialog">
            <form onSubmit={handleSubmit}>
                <ScanIcon className="w-16 h-16 text-blue-500 mx-auto animate-pulse" />
                <h2 className="mt-4 text-2xl font-bold text-zinc-800 dark:text-zinc-100">Ready to Scan</h2>
                <p className="mt-2 text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">Use your external handheld scanner to scan a barcode. The captured value will appear here.</p>
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="none"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    tabIndex={-1}
                    className="absolute top-[-9999px] left-[-9999px] opacity-0 pointer-events-none"
                    aria-label="External scanner input"
                    onBlur={(e) => {
                        // Do not forcefully refocus if focus moved to a button or interactive control
                        if (e.relatedTarget && (e.relatedTarget.tagName === 'BUTTON' || e.relatedTarget.closest?.('button'))) {
                            return;
                        }
                    }} 
                />
                {!persistent && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="mt-8 px-8 py-3 bg-white/80 dark:bg-zinc-800/80 text-zinc-800 dark:text-zinc-100 rounded-lg backdrop-blur-md text-lg font-semibold border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                        Cancel
                    </button>
                )}
            </form>
        </div>
    );
};


const ITEMS_PER_PAGE = 25;

const AdminActionCard = ({ icon, title, description, onClick, buttonText, disabled = false, infoAction = null }) => (
    <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center">
                {React.cloneElement(icon, { className: "w-5 h-5 mr-3 text-zinc-500" })}
                <span>{title}</span>
            </h2>
            {infoAction && (
                <button onClick={infoAction} className="text-zinc-400 hover:text-blue-500 transition-colors" title="How is this calculated?">
                    <InformationCircleIcon className="w-5 h-5" />
                </button>
            )}
        </div>
        <div className="p-6 flex-grow">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {description}
            </p>
        </div>
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-700 text-right">
            <button
                onClick={onClick}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[150px]"
                disabled={disabled}
            >
                {disabled && <Spinner className="w-5 h-5 mr-2" />}
                {buttonText}
            </button>
        </div>
    </div>
);

const RapidScanSummary = ({ summary, className = '' }) => {
    const summaryItems = Object.entries(summary);
    if (summaryItems.length === 0) return null;

    return (
        <div className={`w-full max-w-sm mx-auto pointer-events-auto ${className}`}>
            <div className="bg-zinc-900/95 backdrop-blur-md shadow-xl rounded-xl p-3 text-white border border-zinc-700/50">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2 border-b border-zinc-700/50 pb-1.5">Session Summary</h3>
                <ul className="space-y-1.5 max-h-[25vh] overflow-y-auto pr-1">
                    {summaryItems.map(([name, count]) => (
                        <li key={name} className="flex justify-between items-center text-sm">
                            <span className="font-medium text-zinc-200 truncate pr-3">{name}</span>
                            <span className="font-mono bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{count}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const StockManagerApp = ({ userProfile, selectedProfile, onSwitchProfile, onLogout }) => {
  const { stock, setStock, loading: stockLoading, addStockItem, bulkAddStockItems, updateStockItemAssignment, bulkUpdateAssignments, deleteStockItem, bulkDeleteStockItems, getStockItemsByBarcode, getExistingBarcodes, refetchStock, syncQueue, clearSyncQueue } = useStock();
  const [currentView, setCurrentView] = useState(View.LIST);

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showOnlineRestored, setShowOnlineRestored] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
        setIsOffline(true);
        setShowOnlineRestored(false);
    };
    const handleOnline = () => {
        setIsOffline(false);
        setShowOnlineRestored(true);
        setTimeout(() => setShowOnlineRestored(false), 3000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
    };
  }, []);

  const [scannedItem, setScannedItem] = useState(null);
  const [assignment, setAssignment] = useState({ location: Location.UNASSIGNED, team: Team.UNASSIGNED });
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [newItem, setNewItem] = useState({ name: '', description: '', barcodes: '', firstSerial: '', lastSerial: '', barcode: '', quantity: '' });
  const [addMode, setAddMode] = useState('range'); // 'range' or 'list'
  const [addItemsError, setAddItemsError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSerialsExpanded, setIsSerialsExpanded] = useState(true);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [dbLocations, setDbLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [isAddLocationModalOpen, setIsAddLocationModalOpen] = useState(false);
  const [newLocationInfo, setNewLocationInfo] = useState({ name: '' });
  const [editingLocation, setEditingLocation] = useState(null);
  
  const displayLocations = dbLocations.length > 0 ? dbLocations.map(l => l.name) : LOCATIONS;
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [newUserInfo, setNewUserInfo] = useState({ email: '', password: '', username: '', role: 'User' });
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const [isDarkMode, toggleDarkMode] = useDarkMode();
  const [activeLocation, setActiveLocation] = useState(() => {
    try {
      return localStorage.getItem('bregan_active_location') || 'All';
    } catch {
      return 'All';
    }
  });
  const [dashboardFilters, setDashboardFilters] = useState({ location: activeLocation });

  const handleSelectActiveLocation = useCallback((loc) => {
    setActiveLocation(loc);
    setDashboardFilters(prev => ({ ...prev, location: loc }));
    try {
      localStorage.setItem('bregan_active_location', loc);
    } catch (e) {
      console.warn("Could not save location preference", e);
    }
  }, []);
  const [assignmentFilters, setAssignmentFilters] = useState({ team: 'All', itemType: 'All', location: 'All', assignedByMe: false });

  const [itemTypes, setItemTypes] = useState([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(true);
  const [editingItemType, setEditingItemType] = useState(null); // e.g., { id, name, price, category, stock_threshold, is_unique, subcategory_id, supplier_id }
  const [newItemTypeInfo, setNewItemTypeInfo] = useState({ name: '', barcode: '', price: '', category: '', subcategory_id: '', stock_threshold: '', is_unique: false, supplier_id: '' });
  const [isAddItemTypeModalOpen, setIsAddItemTypeModalOpen] = useState(false);
  const [expandedItemTypeGroups, setExpandedItemTypeGroups] = useState({});
  const [expandedSubCategory, setExpandedSubCategory] = useState({});

  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [editingTeam, setEditingTeam] = useState(null);
  const [newTeamInfo, setNewTeamInfo] = useState({ name: '', type: TeamType.TEAM, barcode: '' });
  const [expandedTeamGroups, setExpandedTeamGroups] = useState({});
  const [isAddTeamModalOpen, setIsAddTeamModalOpen] = useState(false);
  
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [newSupplierInfo, setNewSupplierInfo] = useState({ name: '', contact_person: '', phone: '', email: '', lead_time_days: 7 });
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
  const [adminItemTypeSearchTerm, setAdminItemTypeSearchTerm] = useState('');
  const [adminSupplierSearchTerm, setAdminSupplierSearchTerm] = useState('');

  // --- Supplier Part Numbers State ---
  const [supplierPartNumbers, setSupplierPartNumbers] = useState([]);
  const [supplierPartNumbersLoading, setSupplierPartNumbersLoading] = useState(true);
  const [selectedItemTypeForParts, setSelectedItemTypeForParts] = useState(null);
  const [isManagePartNumbersModalOpen, setIsManagePartNumbersModalOpen] = useState(false);
  const [newPartNumberInfo, setNewPartNumberInfo] = useState({ supplier_id: '', supplier_name: '', part_number: '', barcode: '', purchase_price: '', notes: '' });
  const [editingPartNumber, setEditingPartNumber] = useState(null);
  const [stockSearchTerm, setStockSearchTerm] = useState('');
  const [expandedSupplierCatalog, setExpandedSupplierCatalog] = useState({});

  // --- Profile Management State ---
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const [newProfileInfo, setNewProfileInfo] = useState({ name: '', pin: '', role: 'User' });
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null); // Holds profile object for editing

  // --- State for Add Item Barcode flow ---
  const [newItemBarcodeSelection, setNewItemBarcodeSelection] = useState('');


  // --- State for Confirmation Modal ---
  const [returnModalData, setReturnModalData] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [isReturningStock, setIsReturningStock] = useState(false);
  
  // --- Batch Return State ---
  const [isBatchReturnModalOpen, setIsBatchReturnModalOpen] = useState(false);
  const [batchReturnTeam, setBatchReturnTeam] = useState('');
  const [batchReturnQuantities, setBatchReturnQuantities] = useState({});
  const [isBatchReturning, setIsBatchReturning] = useState(false);

  const [confirmationModal, setConfirmationModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    actionType: null,
    item: null
  });
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);

  // --- State for Categories & Subcategories ---
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [subcategories, setSubcategories] = useState([]);
  const [isManageCategoriesModalOpen, setIsManageCategoriesModalOpen] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null); // { id, name }
  const [editCategoryName, setEditCategoryName] = useState('');
  const [isAddSubcategoryModalOpen, setIsAddSubcategoryModalOpen] = useState(false);
  const [selectedParentCategoryId, setSelectedParentCategoryId] = useState(null);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [editingSubcategory, setEditingSubcategory] = useState(null); // { id, category_id, name }
  const [editSubcategoryName, setEditSubcategoryName] = useState('');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState({});
  const [returnTeamBarcodeInput, setReturnTeamBarcodeInput] = useState('');

  // --- State for Scan In ---
  const [isScanModeModalOpen, setIsScanModeModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState(null); // 'in', 'out-quantity', 'out-rapid'
  const [isAddScannedItemModalOpen, setIsAddScannedItemModalOpen] = useState(false);
  const [newScannedItemDetails, setNewScannedItemDetails] = useState({ barcode: '', name: '', description: '', quantity: '', firstSerial: '', lastSerial: '' });
  const [isAddQuantityModalOpen, setIsAddQuantityModalOpen] = useState(false);
  const [itemForQuantityAdd, setItemForQuantityAdd] = useState(null);
  const [quantityToAdd, setQuantityToAdd] = useState('');
  const [quantityAddLocation, setQuantityAddLocation] = useState('');

  // --- State for new Scan Out flow ---
  const [isAssignmentSetupModalOpen, setIsAssignmentSetupModalOpen] = useState(false);
  const [assignmentContext, setAssignmentContext] = useState({ location: Location.LEADING_STORES, team: '' });
  const [isScanOutModeSelectionOpen, setIsScanOutModeSelectionOpen] = useState(false);
  const [isAssignQuantityModalOpen, setIsAssignQuantityModalOpen] = useState(false);
  const [itemForQuantityAssign, setItemForQuantityAssign] = useState(null);
  const [quantityToAssign, setQuantityToAssign] = useState('');
  const [scanFlash, setScanFlash] = useState({ active: false, type: '' });
  const [toasts, setToasts] = useState([]);
  const isProcessingScanRef = useRef(false);
  const [rapidScanSummary, setRapidScanSummary] = useState({});
  const [stagedBatchItems, setStagedBatchItems] = useState([]);
  const [isBatchConfirmModalOpen, setIsBatchConfirmModalOpen] = useState(false);
  const [isSubmittingBatchSignOut, setIsSubmittingBatchSignOut] = useState(false);
  const [teamBarcodeInput, setTeamBarcodeInput] = useState('');
  const [isPrintTeamBadgesModalOpen, setIsPrintTeamBadgesModalOpen] = useState(false);
  const [teamBadgesFilter, setTeamBadgesFilter] = useState('');

  const [isAssignRangeModalOpen, setIsAssignRangeModalOpen] = useState(false);
  const [isReturnSetupModalOpen, setIsReturnSetupModalOpen] = useState(false);
  const [isScanReturnModeSelectionOpen, setIsScanReturnModeSelectionOpen] = useState(false);
  const [returnContext, setReturnContext] = useState(() => ({ 
    team: '', 
    location: (activeLocation && activeLocation !== 'All') ? activeLocation : Location.LEADING_STORES 
  }));
  const [stagedReturnItems, setStagedReturnItems] = useState([]);
  const [isReturnBatchConfirmModalOpen, setIsReturnBatchConfirmModalOpen] = useState(false);

  useEffect(() => {
    if (activeLocation && activeLocation !== 'All') {
      setAssignmentContext(prev => ({ ...prev, location: activeLocation }));
      setReturnContext(prev => ({ ...prev, location: activeLocation }));
    }
  }, [activeLocation]);
  const [isSubmittingBatchReturn, setIsSubmittingBatchReturn] = useState(false);
  const [isReturnQuantityModalOpen, setIsReturnQuantityModalOpen] = useState(false);
  const [itemForQuantityReturn, setItemForQuantityReturn] = useState(null);
  const [quantityToReturn, setQuantityToReturn] = useState('');
  const [rangeAssignDetails, setRangeAssignDetails] = useState({ firstSerial: '', lastSerial: '' });

  // --- App Settings State ---
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const [isDevMode, setIsDevMode] = useState(false);
  const [isDevLoginModalOpen, setIsDevLoginModalOpen] = useState(false);
  const [devPasswordInput, setDevPasswordInput] = useState('');
  const [devLoginError, setDevLoginError] = useState('');
  const [isDevPurgeModalOpen, setIsDevPurgeModalOpen] = useState(false);
  const [devPurgeBarcode, setDevPurgeBarcode] = useState('');
  const [devPurgeResults, setDevPurgeResults] = useState(null);
  const [devPurgeLoading, setDevPurgeLoading] = useState(false);

  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [unrecognizedScans, setUnrecognizedScans] = useState([]);
  const [isUnrecognizedModalOpen, setIsUnrecognizedModalOpen] = useState(false);
  const [excessSignOutConfirmation, setExcessSignOutConfirmation] = useState(null);
  const [isBeepEnabled, setIsBeepEnabled] = useState(() => {
    const saved = localStorage.getItem('scannerBeepEnabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [scannerPreference, setScannerPreferenceState] = useState(() => localStorage.getItem('scannerPreference') || 'external');
  const audioCtxRef = useRef(null);

  // --- Pagination State ---
  const [currentPageByGroup, setCurrentPageByGroup] = useState({});

  // --- Reporting State ---
  const [reportFilters, setReportFilters] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    itemName: 'All',
    partNumber: '',
    team: 'All',
    location: 'All',
  });
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [isPrintInfoModalOpen, setIsPrintInfoModalOpen] = useState(false);

  // --- PIN Change State ---
  const [isChangePinModalOpen, setIsChangePinModalOpen] = useState(false);
  const [pinChangeData, setPinChangeData] = useState({ currentPin: '', newPin: '', confirmNewPin: '' });
  const [pinChangeError, setPinChangeError] = useState('');
  
  // --- Automated Threshold Calculation State ---
  const [isCalculatingThresholds, setIsCalculatingThresholds] = useState(false);
  const [thresholdSummary, setThresholdSummary] = useState(null);
  const [isThresholdSummaryModalOpen, setIsThresholdSummaryModalOpen] = useState(false);
  const [isThresholdInfoModalOpen, setIsThresholdInfoModalOpen] = useState(false);

  const isAdminProfile = selectedProfile?.role === 'Admin';

  const setScannerPreference = useCallback((preference) => {
    localStorage.setItem('scannerPreference', preference);
    setScannerPreferenceState(preference);
  }, []);
  
  const navigateTo = useCallback((view) => {
    setError(null);
    setCurrentView(view);
  }, []);

  const handleSetView = useCallback((view) => {
    setCurrentView(view);
  }, []);
  
  const handleCancelScan = useCallback(() => {
    handleSetView(View.LIST);
    setScanMode(null);
    setToasts([]);
    setRapidScanSummary({});
    setStagedBatchItems([]);
    setStagedReturnItems([]);
    setIsBatchConfirmModalOpen(false);
    setIsReturnBatchConfirmModalOpen(false);
  }, [handleSetView]);

  // --- Native App Back Button/Gesture Handling ---
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const listener = CapacitorApp.addListener('backButton', () => {
        // Priority 1: Close any open modal
        if (scannedItem) { setScannedItem(null); return; }
        if (isBatchConfirmModalOpen) { setIsBatchConfirmModalOpen(false); return; }
        if (isReturnBatchConfirmModalOpen) { setIsReturnBatchConfirmModalOpen(false); return; }
        if (isAssignmentSetupModalOpen) { setIsAssignmentSetupModalOpen(false); return; }
        if (isScanModeModalOpen) { setIsScanModeModalOpen(false); return; }
        if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return; }
        if (isDevLoginModalOpen) { setIsDevLoginModalOpen(false); return; }
        if (isDevPurgeModalOpen) { setIsDevPurgeModalOpen(false); return; }
        if (isChangePinModalOpen) { setIsChangePinModalOpen(false); return; }
        if (isCreateUserModalOpen) { setIsCreateUserModalOpen(false); return; }
        if (isManageCategoriesModalOpen) { setIsManageCategoriesModalOpen(false); return; }
        if (isAddCategoryModalOpen) { setIsAddCategoryModalOpen(false); return; }
        if (editingCategory) { setEditingCategory(null); return; }
        if (isAddSubcategoryModalOpen) { setIsAddSubcategoryModalOpen(false); return; }
        if (editingSubcategory) { setEditingSubcategory(null); return; }
        if (editingItemType) { setEditingItemType(null); return; }
        if (isAddItemTypeModalOpen) { setIsAddItemTypeModalOpen(false); return; }
        if (editingTeam) { setEditingTeam(null); return; }
        if (isAddTeamModalOpen) { setIsAddTeamModalOpen(false); return; }
        if (isPrintTeamBadgesModalOpen) { setIsPrintTeamBadgesModalOpen(false); return; }
        if (editingSupplier) { setEditingSupplier(null); return; }
        if (isAddSupplierModalOpen) { setIsAddSupplierModalOpen(false); return; }
        if (isScanOutModeSelectionOpen) { setIsScanOutModeSelectionOpen(false); return; }
        if (isScanReturnModeSelectionOpen) { setIsScanReturnModeSelectionOpen(false); return; }
        if (isAssignQuantityModalOpen) { setIsAssignQuantityModalOpen(false); return; }
        if (isAssignRangeModalOpen) { setIsAssignRangeModalOpen(false); setRangeAssignDetails({ firstSerial: '', lastSerial: '' }); return; }
        if (isAddScannedItemModalOpen) { setIsAddScannedItemModalOpen(false); return; }
        if (isAddQuantityModalOpen) { setIsAddQuantityModalOpen(false); return; }
        if (isReturnSetupModalOpen) { setIsReturnSetupModalOpen(false); return; }
        if (isReturnQuantityModalOpen) { setIsReturnQuantityModalOpen(false); return; }
        if (confirmationModal.isOpen) { setConfirmationModal(prev => ({ ...prev, isOpen: false })); return; }
        if (isPrintInfoModalOpen) { setIsPrintInfoModalOpen(false); return; }
        if (isProfilesModalOpen) { setIsProfilesModalOpen(false); return; }
        if (editingProfile) { setEditingProfile(null); return; }
        if (isThresholdSummaryModalOpen) { setIsThresholdSummaryModalOpen(false); return; }
        
        // Priority 2: Cancel the scanner if it's active
        if (currentView === View.SCAN) {
          handleCancelScan();
          return;
        }

        // Priority 3: Navigate back to the dashboard from any other view
        if (currentView !== View.LIST) {
          navigateTo(View.LIST);
          return;
        }
        
        // If we are on the dashboard with no modals open, exit the app
        CapacitorApp.exitApp();
      });

      return () => {
        listener.remove();
      };
    }
  }, [
    currentView,
    scannedItem,
    isSettingsModalOpen,
    isDevLoginModalOpen,
    isDevPurgeModalOpen,
    isChangePinModalOpen,
    isCreateUserModalOpen,
    isAddItemTypeModalOpen,
    editingItemType,
    isAddTeamModalOpen,
    isPrintTeamBadgesModalOpen,
    editingTeam,
    isAddSupplierModalOpen,
    editingSupplier,
    isScanModeModalOpen,
    isAssignmentSetupModalOpen,
    isBatchConfirmModalOpen,
    isScanOutModeSelectionOpen,
    isScanReturnModeSelectionOpen,
    isAssignQuantityModalOpen,
    isAssignRangeModalOpen,
    isAddScannedItemModalOpen,
    isAddQuantityModalOpen,
    isReturnSetupModalOpen,
    isReturnQuantityModalOpen,
    confirmationModal.isOpen,
    isPrintInfoModalOpen,
    isProfilesModalOpen,
    editingProfile,
    isThresholdSummaryModalOpen,
    navigateTo,
    handleCancelScan
  ]);


  useEffect(() => {
    localStorage.setItem('scannerBeepEnabled', JSON.stringify(isBeepEnabled));
  }, [isBeepEnabled]);

  const playBeep = useCallback((type = 'success') => {
    if (!isBeepEnabled) return;
    try {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        gainNode.gain.value = 0.1;

        if (type === 'success') {
            oscillator.frequency.value = 960; // Higher pitch
            oscillator.type = 'sine';
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.1);
        } else { // 'error'
            oscillator.frequency.value = 220; // Lower pitch
            oscillator.type = 'square'; // Harsher sound
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.2);
        }
    } catch (e) {
        console.error("Could not play beep sound:", e);
    }
  }, [isBeepEnabled]);

  const triggerScanFeedback = useCallback((type) => {
    playBeep(type);
    
    if (Capacitor.isNativePlatform()) {
      if (type === 'success') {
        Haptics.impact({ style: ImpactStyle.Light });
      } else {
        Haptics.vibrate(); 
      }
    }

    setScanFlash({ active: true, type });
    setTimeout(() => {
      setScanFlash({ active: false, type: '' });
    }, 400);
  }, [playBeep]);

  const addToast = useCallback((message, type = 'success', barcode = '') => {
    const id = Date.now() + Math.random();
    // A toast object now includes a status for lifecycle management.
    const newToast = { id, message, type, barcode, status: 'entering' };
    
    setToasts(prev => {
        const TOAST_LIMIT = 3;
        // Add the new toast to the front of the array.
        const updatedToasts = [newToast, ...prev];
        
        let visibleCount = 0;
        // Mark the oldest toasts for removal ('exiting') if we are over the limit.
        const finalToasts = updatedToasts.map(toast => {
            // Keep the toast if it's already exiting or if we're under the limit.
            if (toast.status !== 'exiting' && visibleCount < TOAST_LIMIT) {
                visibleCount++;
                return toast;
            } else if (toast.status !== 'exiting') {
                // This toast is over the limit, so mark it for exit.
                return { ...toast, status: 'exiting' };
            }
            return toast; // Return already exiting toasts as they are.
        });
        
        return finalToasts;
    });

    // Set a timer to automatically mark this specific toast for removal after a duration.
    setTimeout(() => {
        setToasts(prev => 
            prev.map(toast => 
                toast.id === id ? { ...toast, status: 'exiting' } : toast
            )
        );
    }, 3500);

  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => 
        prev.map(toast => 
            toast.id === id ? { ...toast, status: 'exiting' } : toast
        )
    );
  }, []);
  
  const fetchItemTypes = useCallback(async () => {
    setItemTypesLoading(true);
    try {
        const { data, error } = await supabase
            .from('item_types')
            .select('*, item_subcategory(name), suppliers(*)')
            .order('category')
            .order('name');
        if (error) throw error;
        setItemTypes(data || []);
    } catch (err) {
        setError(`Failed to fetch item types: ${err.message}`);
    } finally {
        setItemTypesLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
        const { data, error } = await supabase.from('item_category').select('*').order('name');
        if (error) throw error;
        const fetchedCategories = data || [];
        setCategories(fetchedCategories);
        
        const { data: subData, error: subError } = await supabase.from('item_subcategory').select('*').order('name');
        if(subError) throw subError;
        setSubcategories(subData || []);

        if (fetchedCategories.length > 0) {
             setNewItemTypeInfo(prev => ({...prev, category: prev.category || fetchedCategories[0].name}));
        }
    } catch (err) {
        console.error('Error fetching categories:', err);
        const fallbackCategories = STOCK_CATEGORIES.map(name => ({ name }));
        setCategories(fallbackCategories);
        if (fallbackCategories.length > 0) {
            setNewItemTypeInfo(prev => ({...prev, category: prev.category || fallbackCategories[0].name}));
        }
    } finally {
        setCategoriesLoading(false);
    }
  }, []);
  
  const saveTeamBarcodeToCache = useCallback((teamName, barcode) => {
    try {
      const cache = JSON.parse(localStorage.getItem('team_barcodes_cache') || '{}');
      if (barcode) {
        cache[teamName] = barcode;
      } else {
        delete cache[teamName];
      }
      localStorage.setItem('team_barcodes_cache', JSON.stringify(cache));
    } catch (e) {
      console.warn("Could not save team barcode to local cache", e);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    setTeamsLoading(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) throw new Error('User not authenticated');

        const { count, error: countError } = await supabase.from('teams').select('*', { count: 'exact', head: true });
        if (countError) throw countError;

        if (count === 0) {
            const teamsToSeed = [];
            for (let i = 1; i <= 15; i++) {
                teamsToSeed.push({ name: `Team ${i.toString().padStart(3, '0')}`, user_id: user.id, type: TeamType.TEAM });
            }
            for (let i = 1; i <= 25; i++) {
                teamsToSeed.push({ name: `Surveyor ${i.toString().padStart(3, '0')}`, user_id: user.id, type: TeamType.SURVEYOR });
            }
            const { error: insertError } = await supabase.from('teams').insert(teamsToSeed);
            if (insertError) throw insertError;
        }

        const { data, error } = await supabase.from('teams').select('*').order('type').order('name');
        if (error) throw error;
        
        let cachedTeamBarcodes = {};
        try {
            cachedTeamBarcodes = JSON.parse(localStorage.getItem('team_barcodes_cache') || '{}');
        } catch (e) {}

        const enrichedTeams = (data || []).map(t => ({
            ...t,
            barcode: t.barcode || cachedTeamBarcodes[t.name] || ''
        }));

        setTeams(enrichedTeams);
        setAssignmentContext(prev => ({ ...prev, team: prev.team || enrichedTeams[0]?.name || '' }));
    } catch (err) {
        setError(`Failed to fetch or seed teams: ${err.message}`);
    } finally {
        setTeamsLoading(false);
    }
  }, []);

  const fetchLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) throw new Error('User not authenticated');
        const { data, error } = await supabase.from('locations').select('*').order('name');
        if (error) throw error;
        setDbLocations(data || []);
    } catch (err) {
        console.warn("Could not fetch locations (table might not exist). Falling back to LOCATIONS.", err);
        setDbLocations([]);
    } finally {
        setLocationsLoading(false);
    }
  }, []);

  const fetchSuppliers = useCallback(async () => {
    setSuppliersLoading(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
        if (!user) throw new Error('User not authenticated');
        const { data, error } = await supabase.from('suppliers').select('*').order('name');
        if (error) throw error;
        setSuppliers(data || []);
    } catch (err) {
        setError(`Failed to fetch suppliers: ${err.message}`);
    } finally {
        setSuppliersLoading(false);
    }
  }, []);

  const fetchUnrecognizedScans = useCallback(async () => {
    try {
        const { data, error } = await supabase.from('unrecognized_scans').select('*').order('scanned_at', { ascending: false });
        if (!error && data) {
            setUnrecognizedScans(data);
        }
    } catch (err) {
        console.error("Failed to fetch unrecognized scans", err);
    }
  }, []);

  const logUnrecognizedBarcode = useCallback(async (barcode) => {
      try {
          const { data: { session } } = await supabase.auth.getSession();
          const user = session?.user;
          const { error } = await supabase.from('unrecognized_scans').insert({
              barcode: barcode,
              scanned_by: user?.id,
              profile_name: selectedProfile?.name || 'Unknown'
          });
          if (!error) {
              fetchUnrecognizedScans();
          }
      } catch (err) {
          console.error("Failed to log unrecognized barcode", err);
      }
  }, [fetchUnrecognizedScans, selectedProfile]);

  const fetchSupplierPartNumbers = useCallback(async () => {
    setSupplierPartNumbersLoading(true);
    try {
        const { data, error } = await supabase
            .from('item_supplier_part_numbers')
            .select('*, suppliers(id, name), item_types(id, name, category, barcode)')
            .order('id', { ascending: false });
        if (error) {
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                console.warn("item_supplier_part_numbers table not yet created in database.");
                setSupplierPartNumbers([]);
            } else {
                throw error;
            }
        } else {
            setSupplierPartNumbers(data || []);
        }
    } catch (err) {
        console.warn("Failed to fetch supplier part numbers:", err.message);
        setSupplierPartNumbers([]);
    } finally {
        setSupplierPartNumbersLoading(false);
    }
  }, []);

  const deleteUnrecognizedScan = async (id) => {
      try {
          const { error } = await supabase.from('unrecognized_scans').delete().eq('id', id);
          if (!error) {
              setUnrecognizedScans(prev => prev.filter(scan => scan.id !== id));
          }
      } catch (err) {
          console.error("Failed to delete unrecognized scan", err);
      }
  };

  useEffect(() => {
    fetchItemTypes();
    fetchTeams();
    fetchCategories();
    fetchSuppliers();
    fetchLocations();
    fetchUnrecognizedScans();
    fetchSupplierPartNumbers();
  }, [fetchItemTypes, fetchTeams, fetchCategories, fetchSuppliers, fetchLocations, fetchUnrecognizedScans, fetchSupplierPartNumbers]);

  const itemTypeBarcodesMap = useMemo(() => {
    const map = {};
    if (!itemTypes) return map;

    const stockBarcodesByName = {};
    if (stock && stock.length > 0) {
      for (const item of stock) {
        if (item.name && item.barcode) {
          const bc = String(item.barcode).trim();
          if (bc) {
            if (!stockBarcodesByName[item.name]) {
              stockBarcodesByName[item.name] = new Set();
            }
            stockBarcodesByName[item.name].add(bc);
          }
        }
      }
    }

    for (const type of itemTypes) {
      const set = new Set();
      if (type.barcode && String(type.barcode).trim()) {
        set.add(String(type.barcode).trim());
      }
      if (stockBarcodesByName[type.name]) {
        for (const bc of stockBarcodesByName[type.name]) {
          set.add(bc);
        }
      }
      const sorted = Array.from(set).sort();
      map[type.name] = sorted;
      if (type.id) {
        map[type.id] = sorted;
      }
    }
    return map;
  }, [stock, itemTypes]);

  // Maps item_type_id -> array of SupplierPartNumber records
  const supplierPartNumbersByItemTypeId = useMemo(() => {
    const map = {};
    if (!supplierPartNumbers) return map;
    for (const p of supplierPartNumbers) {
      if (p.item_type_id) {
        if (!map[p.item_type_id]) map[p.item_type_id] = [];
        map[p.item_type_id].push(p);
      }
    }
    return map;
  }, [supplierPartNumbers]);

  // Maps item_name -> array of SupplierPartNumber records
  const supplierPartNumbersByItemTypeName = useMemo(() => {
    const map = {};
    if (!supplierPartNumbers || !itemTypes) return map;
    const typeIdToName = {};
    for (const it of itemTypes) {
      typeIdToName[it.id] = it.name;
    }
    for (const p of supplierPartNumbers) {
      const name = p.item_types?.name || typeIdToName[p.item_type_id];
      if (name) {
        if (!map[name]) map[name] = [];
        map[name].push(p);
      }
    }
    return map;
  }, [supplierPartNumbers, itemTypes]);

  // Maps supplier_id -> array of SupplierPartNumber records
  const supplierPartNumbersBySupplierId = useMemo(() => {
    const map = {};
    if (!supplierPartNumbers) return map;
    for (const p of supplierPartNumbers) {
      if (p.supplier_id) {
        if (!map[p.supplier_id]) map[p.supplier_id] = [];
        map[p.supplier_id].push(p);
      }
    }
    return map;
  }, [supplierPartNumbers]);

  // High-speed lookup map: maps normalized part_number OR barcode -> item type & supplier details
  const partNumberLookupMap = useMemo(() => {
    const map = {};
    if (!itemTypes) return map;
    const typeIdMap = {};
    for (const it of itemTypes) {
      typeIdMap[it.id] = it;
    }
    if (supplierPartNumbers && supplierPartNumbers.length > 0) {
      for (const p of supplierPartNumbers) {
        const it = typeIdMap[p.item_type_id] || p.item_types;
        const entry = {
          id: p.id,
          itemTypeId: p.item_type_id,
          itemTypeName: it?.name || p.item_types?.name,
          supplierId: p.supplier_id,
          supplierName: p.suppliers?.name || p.supplier_name || 'Supplier',
          partNumber: p.part_number,
          purchasePrice: p.purchase_price,
          barcode: p.barcode,
          notes: p.notes
        };
        if (p.part_number) {
          map[String(p.part_number).trim().toLowerCase()] = entry;
        }
        if (p.barcode) {
          map[String(p.barcode).trim().toLowerCase()] = entry;
        }
      }
    }
    return map;
  }, [supplierPartNumbers, itemTypes]);

  const teamBarcodeLookup = useMemo(() => {
    const map = {};
    if (!teams) return map;
    for (const t of teams) {
      if (t.barcode && String(t.barcode).trim()) {
        map[String(t.barcode).trim().toLowerCase()] = t;
      }
      const rawName = String(t.name).trim().toLowerCase();
      map[rawName] = t;
      map[rawName.replace(/\s+/g, '')] = t;
    }
    return map;
  }, [teams]);

  const stagedTotalCount = useMemo(() => {
    return stagedBatchItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }, [stagedBatchItems]);

  const handleUpdateStagedQuantity = useCallback((id, delta) => {
    // Blur any active element so mobile virtual keyboard immediately collapses
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setStagedBatchItems(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  }, []);

  const handleRemoveStagedItem = useCallback((id) => {
    setStagedBatchItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const stagedReturnTotalCount = useMemo(() => {
    return stagedReturnItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  }, [stagedReturnItems]);

  const handleUpdateStagedReturnQuantity = useCallback((id, delta) => {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    setStagedReturnItems(prev => prev.map(item => {
      if (item.id === id) {
        const maxLimit = typeof item.availableCount === 'number' && item.availableCount > 0 ? item.availableCount : Infinity;
        const newQty = Math.min(maxLimit, Math.max(1, item.quantity + delta));
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  }, []);

  const handleRemoveStagedReturnItem = useCallback((id) => {
    setStagedReturnItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const handleScanSuccess = useCallback(async (decodedText) => {
    setError(null);
    try {
        const trimmedScan = String(decodedText).trim();
        const lowerScan = trimmedScan.toLowerCase();
        const partLookup = partNumberLookupMap[lowerScan];

        // 1. Check if scanned barcode is a Team barcode or team code!
        const matchedTeamByBarcode = teamBarcodeLookup[lowerScan];
        if (matchedTeamByBarcode) {
            playBeep('success');
            triggerScanFeedback('success');

            if (scanMode === 'team-scan-return') {
                const targetLoc = (returnContext.location && returnContext.location !== 'All') 
                    ? returnContext.location 
                    : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES));
                setReturnContext(prev => ({ 
                    ...prev, 
                    team: matchedTeamByBarcode.name,
                    location: targetLoc
                }));
                setScanMode('return-batch');
                setStagedReturnItems([]);
                setRapidScanSummary({});
                addToast(`Returning team: ${matchedTeamByBarcode.name}. Now scan items to return.`, 'success', decodedText);
                return;
            }

            setAssignmentContext(prev => ({ ...prev, team: matchedTeamByBarcode.name }));
            
            if (scanMode === 'team-scan') {
                handleSetView(View.LIST);
                setIsAssignmentSetupModalOpen(false);
                setIsScanOutModeSelectionOpen(true);
                addToast(`Team set to: ${matchedTeamByBarcode.name}`, 'success', decodedText);
            } else if (scanMode === 'out-batch') {
                addToast(`Team switched to: ${matchedTeamByBarcode.name}`, 'success', decodedText);
            } else if (!scanMode) {
                // If scanned in general scanner, auto-start batch sign out for this team!
                setScanMode('out-batch');
                setStagedBatchItems([]);
                addToast(`Team: ${matchedTeamByBarcode.name}. Now scan items to sign out.`, 'success', decodedText);
            } else {
                addToast(`Team set to: ${matchedTeamByBarcode.name}`, 'success', decodedText);
            }
            return;
        }

        if (scanMode === 'team-scan' || scanMode === 'team-scan-return') {
            triggerScanFeedback('error');
            addToast(`Unrecognised team barcode: ${decodedText}`, 'error', decodedText);
            return;
        }

        // Resolve matched item type (from supplier part lookup, internal master barcode, or associated stock barcodes)
        const matchedItemType = partLookup
            ? itemTypes.find(it => it.id === partLookup.itemTypeId || it.name === partLookup.itemTypeName)
            : itemTypes.find(it => {
                if (it.barcode && String(it.barcode).trim().toLowerCase() === lowerScan) return true;
                const associated = itemTypeBarcodesMap[it.name] || [];
                return associated.some(bc => String(bc).trim().toLowerCase() === lowerScan);
            });

        if (scanMode === 'out-batch') {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
            (async () => {
                try {
                    const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
                    const itemTypeDetails = items.length > 0 ? itemTypes.find(it => it.name === items[0].name) : (matchedItemType || null);
                    const isUnique = !!itemTypeDetails?.is_unique;

                    if (items.length === 0) {
                        if (matchedItemType && !isUnique) {
                            const itemName = matchedItemType.name;
                            setStagedBatchItems(prev => {
                                const existingIdx = prev.findIndex(entry => entry.name === itemName && !entry.isUnique);
                                if (existingIdx >= 0) {
                                    const updated = [...prev];
                                    const currentEntry = updated[existingIdx];
                                    const newQty = currentEntry.quantity + 1;
                                    updated[existingIdx] = { ...currentEntry, quantity: newQty, availableCount: 0 };
                                    addToast(`+1 ${itemName} staged (0 recorded in stock at ${assignmentContext.location})`, 'warning', decodedText);
                                    triggerScanFeedback('warning');
                                    return updated;
                                }
                                addToast(`+1 ${itemName} staged (0 recorded in stock at ${assignmentContext.location})`, 'warning', decodedText);
                                triggerScanFeedback('warning');
                                return [
                                    ...prev,
                                    {
                                        id: `bulk-${itemName}-${Date.now()}`,
                                        name: itemName,
                                        barcode: decodedText,
                                        isUnique: false,
                                        quantity: 1,
                                        location: assignmentContext.location,
                                        availableCount: 0,
                                        partNumber: partLookup?.partNumber || ''
                                    }
                                ];
                            });
                            return;
                        }

                        if (matchedItemType) {
                            addToast(`"${matchedItemType.name}" is out of stock`, 'warning', decodedText);
                            triggerScanFeedback('warning');
                        } else {
                            logUnrecognizedBarcode(decodedText);
                            addToast(`Unrecognised barcode: ${decodedText}`, 'error', decodedText);
                            triggerScanFeedback('error');
                        }
                        return;
                    }

                    const targetLoc = assignmentContext.location;
                    const availableItems = items.filter(i => 
                        i.assigned_to === Team.UNASSIGNED && (targetLoc === 'All' || i.location === targetLoc)
                    );

                    if (availableItems.length === 0) {
                        const itemName = items[0].name;
                        if (!isUnique) {
                            setStagedBatchItems(prev => {
                                const existingIdx = prev.findIndex(entry => entry.name === itemName && !entry.isUnique);
                                if (existingIdx >= 0) {
                                    const updated = [...prev];
                                    const currentEntry = updated[existingIdx];
                                    const newQty = currentEntry.quantity + 1;
                                    updated[existingIdx] = { ...currentEntry, quantity: newQty, availableCount: 0 };
                                    addToast(`+1 ${itemName} staged (0 at ${targetLoc})`, 'warning', decodedText);
                                    triggerScanFeedback('warning');
                                    return updated;
                                }
                                addToast(`+1 ${itemName} staged (0 at ${targetLoc})`, 'warning', decodedText);
                                triggerScanFeedback('warning');
                                return [
                                    ...prev,
                                    {
                                        id: `bulk-${itemName}-${Date.now()}`,
                                        name: itemName,
                                        barcode: decodedText,
                                        isUnique: false,
                                        quantity: 1,
                                        location: targetLoc,
                                        availableCount: 0,
                                        partNumber: partLookup?.partNumber || ''
                                    }
                                ];
                            });
                            return;
                        }

                        const otherLocs = [...new Set(items.filter(i => i.assigned_to === Team.UNASSIGNED).map(i => i.location || 'another storehouse'))].join(', ');
                        if (otherLocs) {
                            addToast(`No stock at ${targetLoc} (available at ${otherLocs})`, 'warning', decodedText);
                        } else {
                            addToast(`"${items[0].name}" is currently out of stock`, 'warning', decodedText);
                        }
                        triggerScanFeedback('warning');
                        return;
                    }

                    const itemName = items[0].name;

                    setStagedBatchItems(prev => {
                        if (isUnique) {
                            const alreadyStaged = prev.some(entry => entry.barcode === decodedText || entry.serial === decodedText);
                            if (alreadyStaged) {
                                addToast(`Serial ${decodedText} is already scanned in this batch`, 'warning', decodedText);
                                triggerScanFeedback('warning');
                                return prev;
                            }
                            addToast(`+1 ${itemName} staged`, 'success', decodedText);
                            triggerScanFeedback('success');
                            return [
                                ...prev,
                                {
                                    id: `unique-${decodedText}-${Date.now()}`,
                                    name: itemName,
                                    barcode: decodedText,
                                    serial: decodedText,
                                    isUnique: true,
                                    quantity: 1,
                                    location: availableItems[0].location || targetLoc,
                                    availableCount: availableItems.length,
                                    partNumber: partLookup?.partNumber || ''
                                }
                            ];
                        } else {
                            const existingIdx = prev.findIndex(entry => entry.name === itemName && !entry.isUnique);
                            if (existingIdx >= 0) {
                                const updated = [...prev];
                                const currentEntry = updated[existingIdx];
                                const newQty = currentEntry.quantity + 1;
                                updated[existingIdx] = {
                                    ...currentEntry,
                                    quantity: newQty,
                                    availableCount: availableItems.length
                                };
                                if (newQty > availableItems.length) {
                                    addToast(`+1 ${itemName} staged (${newQty} exceeds stock of ${availableItems.length})`, 'warning', decodedText);
                                    triggerScanFeedback('warning');
                                } else {
                                    addToast(`+1 ${itemName} staged (${newQty} total)`, 'success', decodedText);
                                    triggerScanFeedback('success');
                                }
                                return updated;
                            } else {
                                addToast(`+1 ${itemName} staged (1 total)`, 'success', decodedText);
                                triggerScanFeedback('success');
                                return [
                                    ...prev,
                                    {
                                        id: `bulk-${itemName}-${Date.now()}`,
                                        name: itemName,
                                        barcode: decodedText,
                                        isUnique: false,
                                        quantity: 1,
                                        location: availableItems[0].location || targetLoc,
                                        availableCount: availableItems.length,
                                        partNumber: partLookup?.partNumber || ''
                                    }
                                ];
                            }
                        }
                    });

                } catch (err) {
                    addToast(`Scan error: ${err.message}`, 'error', decodedText);
                    triggerScanFeedback('error');
                } finally {
                    isProcessingScanRef.current = false;
                }
            })();
            return;
        }

        if (scanMode === 'in') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner for 'in' mode
            const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
            const itemTypeDetails = items.length > 0 ? itemTypes.find(it => it.name === items[0].name) : (matchedItemType || null);
            
            if (items.length === 0) {
                const defaultItemType = matchedItemType?.name || '';
                setNewScannedItemDetails({ 
                    barcode: partLookup ? (matchedItemType?.barcode || decodedText) : decodedText, 
                    name: defaultItemType, 
                    description: partLookup ? `Supplier Part #${partLookup.partNumber} (${partLookup.supplierName})` : '', 
                    quantity: '',
                    firstSerial: decodedText,
                    lastSerial: decodedText,
                    supplier_id: partLookup?.supplierId || matchedItemType?.supplier_id || '',
                    purchase_price: partLookup?.purchasePrice || matchedItemType?.price || '',
                    location: activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES),
                });
                setIsAddScannedItemModalOpen(true);
            } else {
                if (itemTypeDetails?.is_unique && !partLookup) {
                    setError(`An item with serial number "${decodedText}" already exists. Unique items cannot be duplicated.`);
                } else {
                    setItemForQuantityAdd(items[0]);
                    setQuantityToAdd('');
                    setQuantityAddLocation(activeLocation !== 'All' ? activeLocation : (items[0].location || displayLocations[0] || Location.LEADING_STORES));
                    setIsAddQuantityModalOpen(true);
                }
            }
        } else if (scanMode === 'out-rapid') {
            if (isProcessingScanRef.current) {
                return; // Ignore scan if one is already being processed
            }
            isProcessingScanRef.current = true;
            
            // Use a self-invoking async function to handle the promise chain without making the parent useCallback async.
            (async () => {
                try {
                    const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
                    
                    if (items.length === 0) {
                        if (matchedItemType) {
                            addToast(`"${matchedItemType.name}" is out of stock`, 'warning', decodedText);
                            triggerScanFeedback('warning');
                        } else {
                            logUnrecognizedBarcode(decodedText);
                            addToast(`Unrecognised barcode: ${decodedText}`, 'error', decodedText);
                            triggerScanFeedback('error');
                        }
                        return;
                    }

                    // FIFO: Prioritize older items with the lowest purchase price
                    items.sort((a, b) => {
                        const priceA = parseFloat(a.purchase_price) || 0;
                        const priceB = parseFloat(b.purchase_price) || 0;
                        if (priceA !== priceB) return priceA - priceB;
                        
                        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                        return dateA - dateB;
                    });

                    const unassignedItems = items.filter(i => i.assigned_to === Team.UNASSIGNED);
                    let itemToAssign = null;
                    if (assignmentContext.location && assignmentContext.location !== 'All') {
                        itemToAssign = unassignedItems.find(i => i.location === assignmentContext.location);
                        if (!itemToAssign) {
                            if (unassignedItems.length > 0) {
                                const otherLocs = [...new Set(unassignedItems.map(i => i.location || 'another storehouse'))].join(', ');
                                addToast(`No stock at ${assignmentContext.location} (stored at ${otherLocs})`, 'warning', decodedText);
                                triggerScanFeedback('warning');
                            } else {
                                addToast(`Item not in stock`, 'error', decodedText);
                                triggerScanFeedback('error');
                            }
                            return;
                        }
                    } else {
                        itemToAssign = unassignedItems[0];
                        if (!itemToAssign) {
                            addToast(`Item not in stock`, 'error', decodedText);
                            triggerScanFeedback('error');
                            return;
                        }
                    }
                    
                    // This now returns the updated item without refetching the whole list
                    const updatedItem = await updateStockItemAssignment(itemToAssign.id, assignmentContext.location, assignmentContext.team, selectedProfile.name);
                    
                    // Optimistically update the local state for a super-fast UI response
                    setStock(prevStock => prevStock.map(item => item.id === updatedItem.id ? updatedItem : item));
                    
                    const partLabel = partLookup ? ` (Part #${partLookup.partNumber})` : '';
                    addToast(`${updatedItem.name}${partLabel} assigned`, 'success', decodedText);
                    triggerScanFeedback('success');

                    setRapidScanSummary(prevSummary => {
                        const currentCount = prevSummary[updatedItem.name] || 0;
                        return {
                            ...prevSummary,
                            [updatedItem.name]: currentCount + 1
                        };
                    });
                    
                } catch (e) {
                    addToast(`Scan Error: ${e.message}`, 'error', decodedText);
                    triggerScanFeedback('error');
                } finally {
                    // Release the lock immediately to allow the next scan.
                    isProcessingScanRef.current = false;
                }
            })();

        } else if (scanMode === 'return-batch') {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
            (async () => {
                try {
                    const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
                    const itemTypeDetails = items.length > 0 ? itemTypes.find(it => it.name === items[0].name) : (matchedItemType || null);
                    const isUnique = !!itemTypeDetails?.is_unique;
                    const returningTeam = returnContext.team;
                    const targetLoc = (returnContext.location && returnContext.location !== 'All') 
                        ? returnContext.location 
                        : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES));

                    if (items.length === 0) {
                        logUnrecognizedBarcode(decodedText);
                        addToast(`Unrecognised barcode: ${decodedText}`, 'error', decodedText);
                        triggerScanFeedback('error');
                        return;
                    }

                    // Check items assigned to this returning team
                    const teamAssignedItems = items.filter(i => i.assigned_to === returningTeam);
                    const itemName = items[0].name;

                    if (teamAssignedItems.length === 0) {
                        const currentHolder = items[0].assigned_to;
                        if (currentHolder === Team.UNASSIGNED) {
                            addToast(`"${itemName}" is already in stock (unassigned)`, 'warning', decodedText);
                        } else {
                            addToast(`"${itemName}" is currently assigned to "${currentHolder}" (not ${returningTeam})`, 'warning', decodedText);
                        }
                        triggerScanFeedback('warning');
                        return;
                    }

                    setStagedReturnItems(prev => {
                        if (isUnique) {
                            const alreadyStaged = prev.some(entry => entry.barcode === decodedText || entry.serial === decodedText);
                            if (alreadyStaged) {
                                addToast(`Serial ${decodedText} is already staged for return`, 'warning', decodedText);
                                triggerScanFeedback('warning');
                                return prev;
                            }
                            addToast(`+1 ${itemName} staged for return`, 'success', decodedText);
                            triggerScanFeedback('success');
                            return [
                                ...prev,
                                {
                                    id: `return-unique-${decodedText}-${Date.now()}`,
                                    name: itemName,
                                    barcode: decodedText,
                                    serial: decodedText,
                                    isUnique: true,
                                    quantity: 1,
                                    location: targetLoc,
                                    availableCount: teamAssignedItems.length,
                                    partNumber: partLookup?.partNumber || ''
                                }
                            ];
                        } else {
                            const existingIdx = prev.findIndex(entry => entry.name === itemName && !entry.isUnique);
                            if (existingIdx >= 0) {
                                const currentEntry = prev[existingIdx];
                                const maxAvailable = teamAssignedItems.length;
                                
                                if (currentEntry.quantity >= maxAvailable) {
                                    addToast(`Cannot add more "${itemName}": all ${maxAvailable} assigned items are already staged for return`, 'warning', decodedText);
                                    triggerScanFeedback('warning');
                                    return prev;
                                }

                                const updated = [...prev];
                                const newQty = currentEntry.quantity + 1;
                                updated[existingIdx] = {
                                    ...currentEntry,
                                    quantity: newQty,
                                    availableCount: maxAvailable
                                };
                                addToast(`+1 ${itemName} staged (${newQty}/${maxAvailable} to return)`, 'success', decodedText);
                                triggerScanFeedback('success');
                                return updated;
                            } else {
                                const maxAvailable = teamAssignedItems.length;
                                if (maxAvailable <= 0) {
                                    addToast(`"${itemName}" is not assigned to ${returningTeam}`, 'warning', decodedText);
                                    triggerScanFeedback('warning');
                                    return prev;
                                }
                                addToast(`+1 ${itemName} staged for return (1/${maxAvailable})`, 'success', decodedText);
                                triggerScanFeedback('success');
                                return [
                                    ...prev,
                                    {
                                        id: `return-bulk-${itemName}-${Date.now()}`,
                                        name: itemName,
                                        barcode: decodedText,
                                        isUnique: false,
                                        quantity: 1,
                                        location: targetLoc,
                                        availableCount: maxAvailable,
                                        partNumber: partLookup?.partNumber || ''
                                    }
                                ];
                            }
                        }
                    });
                } catch (err) {
                    addToast(`Return scan error: ${err.message}`, 'error', decodedText);
                    triggerScanFeedback('error');
                } finally {
                    isProcessingScanRef.current = false;
                }
            })();

        } else if (scanMode === 'return-rapid') {
            if (isProcessingScanRef.current) return;
            isProcessingScanRef.current = true;
            (async () => {
                try {
                    const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
                    if (items.length === 0) {
                        logUnrecognizedBarcode(decodedText);
                        triggerScanFeedback('error');
                        addToast(`Unrecognised: ${decodedText}`, 'error', decodedText);
                        return;
                    }
                    
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const itemToReturn = items.find(i => i.assigned_to === returnContext.team && i.assigned_at && new Date(i.assigned_at) >= twentyFourHoursAgo);
                    
                    if (!itemToReturn) {
                        triggerScanFeedback('warning');
                        addToast(`Not assigned to ${returnContext.team} recently`, 'warning', decodedText);
                        return;
                    }
                    const rapidReturnLoc = (returnContext.location && returnContext.location !== 'All') 
                        ? returnContext.location 
                        : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES));
                    await updateStockItemAssignment(itemToReturn.id, rapidReturnLoc, Team.UNASSIGNED, selectedProfile.name);
                    triggerScanFeedback('success');
                    addToast(`Returned ${itemToReturn.name}`, 'success', decodedText);
                    setRapidScanSummary(prev => {
                        const newSummary = { ...prev };
                        if (!newSummary[itemToReturn.name]) newSummary[itemToReturn.name] = 0;
                        newSummary[itemToReturn.name]++;
                        return newSummary;
                    });
                } catch (err) {
                    triggerScanFeedback('error');
                    addToast(`Failed: ${err.message}`, 'error', decodedText);
                } finally {
                    isProcessingScanRef.current = false;
                }
            })();
        } else if (scanMode === 'return-quantity') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner
            
            const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
            if (items.length === 0) {
                logUnrecognizedBarcode(decodedText);
                addToast(`Unrecognised barcode: ${decodedText}`, 'error');
                return;
            }
            
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const teamItems = items.filter(i => i.assigned_to === returnContext.team && i.assigned_at && new Date(i.assigned_at) >= twentyFourHoursAgo);
            
            if (teamItems.length === 0) {
                addToast(`No items of this type assigned to ${returnContext.team} in last 24h`, 'warning');
                return;
            }
            
            setItemForQuantityReturn(teamItems);
            setQuantityToReturn('');
            setIsReturnQuantityModalOpen(true);
        } else if (scanMode === 'out-quantity') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner for quantity mode
            const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
            
            if (items.length === 0) {
                if (matchedItemType) {
                    setError(`"${matchedItemType.name}" has no units available in stock.`);
                } else {
                    logUnrecognizedBarcode(decodedText);
                    setError(`No available stock found for barcode/part number "${decodedText}".`);
                }
                return;
            }

            // FIFO: Prioritize older items with the lowest purchase price
            items.sort((a, b) => {
                const priceA = parseFloat(a.purchase_price) || 0;
                const priceB = parseFloat(b.purchase_price) || 0;
                if (priceA !== priceB) return priceA - priceB;
                
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateA - dateB;
            });

            let availableItems = items.filter(i => i.assigned_to === Team.UNASSIGNED);
            if (assignmentContext.location && assignmentContext.location !== 'All') {
                const locationMatching = availableItems.filter(i => i.location === assignmentContext.location);
                if (locationMatching.length === 0) {
                    if (availableItems.length > 0) {
                        const otherLocs = [...new Set(availableItems.map(i => i.location || 'another storehouse'))].join(', ');
                        setError(`No units available at ${assignmentContext.location} for "${decodedText}" (found at ${otherLocs}).`);
                    } else {
                        setError(`No available stock found for "${decodedText}".`);
                    }
                    return;
                }
                availableItems = locationMatching;
            }
            if (availableItems.length === 0) {
                setError(`No available stock found for "${decodedText}".`);
                return;
            }
            setItemForQuantityAssign(availableItems);
            setQuantityToAssign('');
            setIsAssignQuantityModalOpen(true);
        } else if (scanMode === 'out-range-start') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner
            setRangeAssignDetails({ firstSerial: decodedText, lastSerial: decodedText });
            setIsAssignRangeModalOpen(true);
        } else {
            // Default scanner mode (opened directly without pre-choosing an action)
            playBeep('success');
            handleSetView(View.LIST);
            const items = await getStockItemsByBarcode(decodedText, matchedItemType?.name);
            if (items.length > 0) {
                setScannedItem(items[0]);
                setAssignment({ location: items[0].location, team: items[0].assigned_to });
            } else {
                const defaultItemType = matchedItemType?.name || '';
                setNewScannedItemDetails({ 
                    barcode: partLookup ? (matchedItemType?.barcode || decodedText) : decodedText, 
                    name: defaultItemType, 
                    description: partLookup ? `Supplier Part #${partLookup.partNumber} (${partLookup.supplierName})` : '', 
                    quantity: '',
                    firstSerial: decodedText,
                    lastSerial: decodedText,
                    supplier_id: partLookup?.supplierId || matchedItemType?.supplier_id || '',
                    purchase_price: partLookup?.purchasePrice || matchedItemType?.price || '',
                    location: activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES),
                });
                setIsAddScannedItemModalOpen(true);
            }
        }
    } catch (e) {
        playBeep('error');
        setError(`Failed to process scan: ${e.message}`);
        handleSetView(View.LIST);
    }
  }, [getStockItemsByBarcode, handleSetView, scanMode, itemTypes, itemTypeBarcodesMap, partNumberLookupMap, teamBarcodeLookup, assignmentContext, returnContext, selectedProfile, playBeep, triggerScanFeedback, addToast, setStock, updateStockItemAssignment, logUnrecognizedBarcode, activeLocation, displayLocations]);
  
  const handleScanError = useCallback((err) => {
    handleSetView(View.LIST);
    setError(err);
    setScanMode(null);
  }, [handleSetView]);

  const handleAssignmentSubmit = async () => {
    if (scannedItem && selectedProfile) {
      try {
        await updateStockItemAssignment(scannedItem.id, assignment.location, assignment.team, selectedProfile.name);
        setScannedItem(null);
        await refetchStock();
      } catch (e) {
        setError(`Failed to update assignment: ${e.message}`);
      }
    }
  };

  const selectedItemType = useMemo(() => {
    if (!newItem.name || !itemTypes) return null;
    return itemTypes.find(it => it.name === newItem.name);
  }, [newItem.name, itemTypes]);
  
  const handleNewItemChange = (e) => {
    const { name, value } = e.target;

    if (name === 'barcodeSelection') {
        setNewItemBarcodeSelection(value);
        const newBarcode = value === 'new' ? '' : value;
        setNewItem(prev => ({ ...prev, barcode: newBarcode }));
        return;
    }

    setNewItem(prev => {
        const updated = { ...prev, [name]: value };
        
        if (name === 'name') {
            updated.barcode = '';
            updated.quantity = '';
            updated.firstSerial = '';
            updated.lastSerial = '';
            updated.barcodes = '';

            const newSelectedItemType = itemTypes.find(it => it.name === value);
            if (newSelectedItemType && !newSelectedItemType.is_unique) {
                const barcodesForNewType = [...new Set([
                    ...(newSelectedItemType.barcode ? [newSelectedItemType.barcode] : []),
                    ...stock.filter(item => item.name === value && item.barcode).map(item => item.barcode)
                ])].sort();
                if (barcodesForNewType.length > 0) {
                    setNewItemBarcodeSelection(barcodesForNewType[0]);
                    updated.barcode = barcodesForNewType[0];
                } else {
                    setNewItemBarcodeSelection('new');
                    updated.barcode = '';
                }
            } else {
                setNewItemBarcodeSelection('');
            }
        }
        return updated;
    });
  };

  const handleCancelAddItem = () => {
    navigateTo(View.LIST);
    setNewItem({ name: '', description: '', barcodes: '', firstSerial: '', lastSerial: '', barcode: '', quantity: '' });
    setAddMode('range');
    setAddItemsError(null);
    setNewItemBarcodeSelection('');
  };
  
  const serialsProcessingResult = useMemo(() => {
    if (addMode === 'range') {
        const { firstSerial, lastSerial } = newItem;
        const start = firstSerial.trim();
        const end = lastSerial.trim();
        
        if (!start || !end) return { serials: [], error: null };
        
        const expansion = expandRange(start, end);

        if (expansion.error) {
            return { serials: [], error: expansion.error };
        }

        const expanded = expansion.result;
        
        if (expanded.length > 1000) {
            return { serials: [], error: `Range is too large. A maximum of 1000 items can be added at once, but this range contains ${expanded.length}.` };
        }

        return { serials: expanded, error: null };
    } else if (addMode === 'quantity_range') {
        const { firstSerial, quantity } = newItem;
        const start = firstSerial.trim();
        const qty = parseInt(quantity, 10);
        
        if (!start || isNaN(qty) || qty < 1) return { serials: [], error: null };
        
        const expansion = expandRangeByQuantity(start, qty);

        if (expansion.error) {
            return { serials: [], error: expansion.error };
        }

        const expanded = expansion.result;
        
        if (expanded.length > 1000) {
            return { serials: [], error: `Range is too large. A maximum of 1000 items can be added at once, but this range contains ${expanded.length}.` };
        }

        return { serials: expanded, error: null };
    } else { // 'list' mode
        const text = newItem.barcodes;
        if (!text.trim()) return { serials: [], error: null };

        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        
        if (lines.length > 1000) {
            return { serials: [], error: `List is too long. A maximum of 1000 items can be added at once, but you have provided ${lines.length}.` };
        }
        
        const uniqueLines = new Set(lines);
        if (uniqueLines.size !== lines.length) {
            return { serials: [], error: "The list contains duplicate serial numbers. Please ensure each is unique." };
        }
        
        return { serials: lines, error: null };
    }
  }, [addMode, newItem.barcodes, newItem.firstSerial, newItem.lastSerial, newItem.quantity]);

  const processedSerials = serialsProcessingResult.serials;

  useEffect(() => {
    setAddItemsError(serialsProcessingResult.error);
  }, [serialsProcessingResult.error]);

  const existingBarcodesForItemType = useMemo(() => {
    if (!selectedItemType || selectedItemType.is_unique) return [];
    const barcodes = stock
        .filter(item => item.name === selectedItemType.name && item.barcode)
        .map(item => item.barcode);
    if (selectedItemType.barcode) {
        barcodes.push(selectedItemType.barcode);
    }
    return [...new Set(barcodes)].sort();
  }, [stock, selectedItemType]);
  
  const handleAddItem = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    
    try {
        const { name, description } = newItem;
        
        if (!selectedItemType) {
            throw new Error("Please select an item type from the dropdown.");
        }

        let itemsToAdd = [];

        if (selectedItemType.is_unique) {
            const barcodes = serialsProcessingResult.serials; 
            const currentProcessingError = serialsProcessingResult.error;

            if (barcodes.length === 0) {
                throw new Error("Please provide at least one serial number for this unique item type.");
            }
            if (currentProcessingError) {
                throw new Error(currentProcessingError);
            }
            
            const existingBarcodes = await getExistingBarcodes(barcodes);
            if (existingBarcodes.size > 0) {
                const duplicates = Array.from(existingBarcodes);
                throw new Error(`The following serial numbers already exist: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}. No items were added.`);
            }

            const itemLocation = newItem.location || (dashboardFilters.location !== 'All' ? dashboardFilters.location : (displayLocations[0] || Location.LEADING_STORES));
            itemsToAdd = barcodes.map(barcode => ({
                name,
                description,
                barcode,
                location: itemLocation,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));

        } else { // Not a unique item type
            const { barcode, quantity: quantityStr } = newItem;
            const quantity = parseInt(quantityStr, 10);

            if (!barcode.trim()) {
                throw new Error("Please provide a serial number / barcode.");
            }
            if (isNaN(quantity) || quantity < 1) {
                throw new Error("Please enter a valid quantity.");
            }

            const itemLocation = newItem.location || (dashboardFilters.location !== 'All' ? dashboardFilters.location : (displayLocations[0] || Location.LEADING_STORES));
            itemsToAdd = Array.from({ length: quantity }, () => ({
                name,
                description,
                barcode: barcode.trim(),
                location: itemLocation,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));
        }
        
        if (itemsToAdd.length > 0) {
            await bulkAddStockItems(itemsToAdd, selectedProfile.name);
        }
        handleCancelAddItem();
      
    } catch (err) {
        setError(err.message || "An unknown error occurred while adding items.");
    } finally {
        setIsSubmitting(false);
    }
  };

  const scannedSerialsProcessingResult = useMemo(() => {
    const selectedItemType = itemTypes.find(it => it.name === newScannedItemDetails.name);
    if (selectedItemType?.category !== StockCategory.METERS) {
        return { serials: [], error: null };
    }
    
    const { firstSerial, lastSerial } = newScannedItemDetails;
    const start = firstSerial?.trim();
    const end = lastSerial?.trim();
    
    if (!start || !end) return { serials: [], error: null };
    
    const expansion = expandRange(start, end);

    if (expansion.error) {
        return { serials: [], error: expansion.error };
    }

    const expanded = expansion.result;
    
    if (expanded.length > 1000) {
        return { serials: [], error: `Range is too large. A maximum of 1000 items can be added at once, but this range contains ${expanded.length}.` };
    }

    return { serials: expanded, error: null };
  }, [itemTypes, newScannedItemDetails.name, newScannedItemDetails.firstSerial, newScannedItemDetails.lastSerial]);
  
  const handleAddScannedItem = async (e) => {
    e.preventDefault();
    if (!newScannedItemDetails.name) {
        setError("Please select an item type.");
        return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
        const selectedItemType = itemTypes.find(it => it.name === newScannedItemDetails.name);
        const isMeterType = selectedItemType?.category === StockCategory.METERS;
        
        let itemsToAdd = [];
        let successCount = 0;

        if (isMeterType) {
            const { serials, error: processingError } = scannedSerialsProcessingResult;
            if (processingError) throw new Error(processingError);
            if (serials.length === 0) throw new Error("Please provide a valid serial number range.");
            
            if (selectedItemType?.is_unique) {
                const existingBarcodes = await getExistingBarcodes(serials);
                if (existingBarcodes.size > 0) {
                    const duplicates = Array.from(existingBarcodes);
                    throw new Error(`The following serial numbers already exist: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? '...' : ''}. No items were added.`);
                }
            }

            const targetLocation = newScannedItemDetails.location || (dashboardFilters.location !== 'All' ? dashboardFilters.location : (displayLocations[0] || Location.LEADING_STORES));
            itemsToAdd = serials.map(barcode => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode,
                location: targetLocation,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));
            successCount = itemsToAdd.length;

        } else {
            const quantity = parseInt(newScannedItemDetails.quantity, 10);
            if (isNaN(quantity) || quantity < 1) {
                throw new Error("Please enter a valid quantity.");
            }
            if (selectedItemType?.is_unique) {
                if (quantity > 1) {
                    throw new Error("Cannot add multiple unique items with the same serial number.");
                }
                const existing = await getStockItemsByBarcode(newScannedItemDetails.barcode);
                if (existing.length > 0) {
                    throw new Error(`An item with serial number "${newScannedItemDetails.barcode}" already exists.`);
                }
            }
            const targetLocation = newScannedItemDetails.location || (dashboardFilters.location !== 'All' ? dashboardFilters.location : (displayLocations[0] || Location.LEADING_STORES));
            itemsToAdd = Array.from({ length: quantity }, () => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode: newScannedItemDetails.barcode,
                location: targetLocation,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));
            successCount = itemsToAdd.length;
        }
        
        if (itemsToAdd.length > 0) {
            await bulkAddStockItems(itemsToAdd, selectedProfile.name);
            setSuccessMessage(`${successCount} x ${newScannedItemDetails.name} added to stock.`);
        }
        
        setTimeout(() => setSuccessMessage(null), 3000);
        setIsAddScannedItemModalOpen(false);
    } catch (err) {
        setError(`Failed to add scanned item: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleConfirmAddQuantity = async (e) => {
    e.preventDefault();
    if (!itemForQuantityAdd) return;
    setError(null);
    setIsSubmitting(true);
    try {
        const quantity = parseInt(quantityToAdd, 10);
        if (isNaN(quantity) || quantity < 1) {
            throw new Error("Please enter a valid quantity.");
        }
        
        const itemTypeDetails = itemTypes.find(it => it.name === itemForQuantityAdd.name);
        const targetLocation = quantityAddLocation || itemForQuantityAdd.location || (dashboardFilters.location !== 'All' ? dashboardFilters.location : (displayLocations[0] || Location.LEADING_STORES));
        const itemsToAdd = Array.from({ length: quantity }, () => ({
            name: itemForQuantityAdd.name,
            description: itemForQuantityAdd.description,
            barcode: itemForQuantityAdd.barcode,
            location: targetLocation,
            purchase_price: parseFloat(itemTypeDetails?.price) || 0,
        }));

        await bulkAddStockItems(itemsToAdd, selectedProfile.name);
        setSuccessMessage(`+${quantity} Added to ${itemForQuantityAdd.name}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        setIsAddQuantityModalOpen(false);
        setItemForQuantityAdd(null);
        setQuantityToAdd('');
    } catch (err) {
        setError(`Failed to add quantity: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleAssignQuantitySubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const numToAssign = parseInt(quantityToAssign, 10);
    if (isNaN(numToAssign) || numToAssign <= 0) {
      setError("Please enter a valid quantity.");
      return;
    }
    
    // If requested quantity exceeds current available stock, prompt user to confirm
    if (numToAssign > itemForQuantityAssign.length) {
      setExcessSignOutConfirmation({
        numToAssign,
        availableCount: itemForQuantityAssign.length,
        itemGroup: itemForQuantityAssign,
        excessQty: numToAssign - itemForQuantityAssign.length,
        itemName: itemForQuantityAssign[0]?.name || 'Item',
        location: assignmentContext.location,
        team: assignmentContext.team
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const itemsToUpdate = itemForQuantityAssign.slice(0, numToAssign);
      const itemIdsToUpdate = itemsToUpdate.map(item => item.id);

      await bulkUpdateAssignments(itemIdsToUpdate, assignmentContext.location, assignmentContext.team, selectedProfile.name);
      
      setSuccessMessage(`${numToAssign} x ${itemsToUpdate[0].name} assigned to ${assignmentContext.team}.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      setIsAssignQuantityModalOpen(false);
      setItemForQuantityAssign(null);
      setQuantityToAssign('');
      await refetchStock();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmExcessSignOut = async () => {
    if (!excessSignOutConfirmation) return;
    const { numToAssign, availableCount, itemGroup, excessQty, itemName, location, team } = excessSignOutConfirmation;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      // 1. Assign all available items in stock if any
      if (availableCount > 0) {
        const itemIdsToUpdate = itemGroup.map(item => item.id);
        await bulkUpdateAssignments(itemIdsToUpdate, location, team, selectedProfile.name);
      }

      // 2. Insert alert record into unrecognised scans / discrepancies table
      const discrepancyMessage = `Stock Discrepancy: ${numToAssign}x "${itemName}" signed out to ${team} (${availableCount} available at ${location}, excess: ${excessQty}). Recommended Action: Conduct Stock Take.`;
      const { error: logError } = await supabase.from('unrecognized_scans').insert({
        barcode: discrepancyMessage,
        scanned_by: user?.id || null,
        profile_name: selectedProfile?.name || 'Unknown'
      });
      if (logError) {
        console.error("Failed to log discrepancy into unrecognized_scans:", logError);
      }

      await refetchStock();
      await fetchUnrecognizedScans();

      setSuccessMessage(`Signed out ${numToAssign}x ${itemName} to ${team} (${availableCount} in stock updated). Discrepancy alert logged to Unrecognised Scans.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      setExcessSignOutConfirmation(null);
      setIsAssignQuantityModalOpen(false);
      setItemForQuantityAssign(null);
      setQuantityToAssign('');
    } catch (err) {
      setError(`Failed to process sign out: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBatchSignOut = async () => {
    if (stagedBatchItems.length === 0) return;
    setIsSubmittingBatchSignOut(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const loc = assignmentContext.location;
      const team = assignmentContext.team;
      const profileName = selectedProfile?.name || 'Unknown';

      const allItemIdsToAssign = [];
      let totalAssignedCount = 0;
      const discrepancies = [];

      for (const entry of stagedBatchItems) {
        if (entry.isUnique) {
          const found = stock.find(i => 
            i.barcode === entry.barcode && 
            i.assigned_to === Team.UNASSIGNED &&
            (loc === 'All' || i.location === loc)
          );
          if (found) {
            allItemIdsToAssign.push(found.id);
            totalAssignedCount += 1;
          } else {
            discrepancies.push(`Stock Discrepancy: Unique item "${entry.name}" (${entry.barcode}) was staged but could not be located in stock at ${loc}.`);
          }
        } else {
          // Bulk item
          const availableForType = stock.filter(i => 
            i.name === entry.name && 
            i.assigned_to === Team.UNASSIGNED &&
            (loc === 'All' || i.location === loc)
          );
          const countNeeded = entry.quantity;
          const itemsToTake = availableForType.slice(0, countNeeded);
          allItemIdsToAssign.push(...itemsToTake.map(i => i.id));
          totalAssignedCount += itemsToTake.length;

          if (countNeeded > availableForType.length) {
            const excess = countNeeded - availableForType.length;
            discrepancies.push(`Stock Discrepancy: ${countNeeded}x "${entry.name}" signed out to ${team} (${availableForType.length} available at ${loc}, excess: ${excess}). Recommended Action: Conduct Stock Take.`);
          }
        }
      }

      if (allItemIdsToAssign.length > 0) {
        await bulkUpdateAssignments(allItemIdsToAssign, loc, team, profileName);
      }

      for (const msg of discrepancies) {
        await supabase.from('unrecognized_scans').insert({
          barcode: msg,
          scanned_by: user?.id || null,
          profile_name: profileName
        });
      }

      await refetchStock();
      if (discrepancies.length > 0) {
        await fetchUnrecognizedScans();
      }

      setSuccessMessage(`Successfully signed out ${totalAssignedCount} item(s) to ${team}.${discrepancies.length > 0 ? ' (Discrepancy logged for excess units)' : ''}`);
      setTimeout(() => setSuccessMessage(null), 4000);

      setStagedBatchItems([]);
      setIsBatchConfirmModalOpen(false);
      handleCancelScan();
    } catch (err) {
      setError(`Failed to sign out items: ${err.message}`);
    } finally {
      setIsSubmittingBatchSignOut(false);
    }
  };

  const handleConfirmBatchReturn = async () => {
    if (stagedReturnItems.length === 0) return;
    setIsSubmittingBatchReturn(true);
    setError(null);
    try {
      const loc = (returnContext.location && returnContext.location !== 'All') 
        ? returnContext.location 
        : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES));
      const team = returnContext.team;
      const profileName = selectedProfile?.name || 'Unknown';

      const allItemIdsToReturn = [];
      let totalReturnedCount = 0;

      for (const entry of stagedReturnItems) {
        if (entry.isUnique) {
          const found = stock.find(i => 
            i.barcode === entry.barcode && 
            i.assigned_to === team
          );
          if (found) {
            allItemIdsToReturn.push(found.id);
            totalReturnedCount += 1;
          }
        } else {
          // Bulk item
          const teamItems = stock.filter(i => 
            i.name === entry.name && 
            i.assigned_to === team
          );
          const countNeeded = Math.min(entry.quantity, teamItems.length);
          const itemsToTake = teamItems.slice(0, countNeeded);
          allItemIdsToReturn.push(...itemsToTake.map(i => i.id));
          totalReturnedCount += itemsToTake.length;
        }
      }

      if (allItemIdsToReturn.length > 0) {
        await bulkUpdateAssignments(allItemIdsToReturn, loc, Team.UNASSIGNED, profileName);
      }

      await refetchStock();
      setSuccessMessage(`Successfully returned ${totalReturnedCount} item(s) from ${team} into ${loc}.`);
      setTimeout(() => setSuccessMessage(null), 4000);

      setStagedReturnItems([]);
      setIsReturnBatchConfirmModalOpen(false);
      handleCancelScan();
    } catch (err) {
      setError(`Failed to return items: ${err.message}`);
    } finally {
      setIsSubmittingBatchReturn(false);
    }
  };

  const rangeAssignProcessingResult = useMemo(() => {
    const { firstSerial, lastSerial } = rangeAssignDetails;
    const start = firstSerial?.trim();
    const end = lastSerial?.trim();
    
    if (!start || !end) return { serials: [], error: null };
    
    const expansion = expandRange(start, end);

    if (expansion.error) {
        return { serials: [], error: expansion.error };
    }

    const expanded = expansion.result;
    
    if (expanded.length > 1000) {
        return { serials: [], error: `Range is too large. A maximum of 1000 items can be assigned at once, but this range contains ${expanded.length}.` };
    }

    return { serials: expanded, error: null };
  }, [rangeAssignDetails.firstSerial, rangeAssignDetails.lastSerial]);

  const handleAssignRangeSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
        const { serials, error: processingError } = rangeAssignProcessingResult;
        if (processingError) throw new Error(processingError);
        if (serials.length === 0) throw new Error("Please provide a valid serial number range.");
        
        // Find all items in stock with these serials that are UNASSIGNED
        let itemsToAssign = stock.filter(item => 
            serials.includes(item.barcode) && item.assigned_to === Team.UNASSIGNED
        );

        if (assignmentContext.location && assignmentContext.location !== 'All') {
            const wrongLocationItems = itemsToAssign.filter(item => item.location !== assignmentContext.location);
            if (wrongLocationItems.length > 0) {
                const wrongList = wrongLocationItems.slice(0, 3).map(i => `${i.barcode} (stored at ${i.location || 'another storehouse'})`).join(', ');
                throw new Error(`Some items in this range are stored at another location (${wrongList}). Range sign out must only include items located at ${assignmentContext.location}.`);
            }
            itemsToAssign = itemsToAssign.filter(item => item.location === assignmentContext.location);
        }

        if (itemsToAssign.length === 0) {
            throw new Error(`No available items found in stock${assignmentContext.location && assignmentContext.location !== 'All' ? ` at ${assignmentContext.location}` : ''} for the given serial range.`);
        }

        // Check if all serials in the range are available
        const foundSerials = new Set(itemsToAssign.map(item => item.barcode));
        const missingSerials = serials.filter(s => !foundSerials.has(s));

        if (missingSerials.length > 0) {
            const missingList = missingSerials.slice(0, 5).join(', ') + (missingSerials.length > 5 ? '...' : '');
            throw new Error(`The following serial numbers are either not in stock or already assigned: ${missingList}. No items were assigned.`);
        }

        const itemIdsToUpdate = itemsToAssign.map(item => item.id);
        await bulkUpdateAssignments(itemIdsToUpdate, assignmentContext.location, assignmentContext.team, selectedProfile.name);
        
        setSuccessMessage(`${itemIdsToUpdate.length} items assigned to ${assignmentContext.team}.`);
        setTimeout(() => setSuccessMessage(null), 3000);
        setIsAssignRangeModalOpen(false);
        setRangeAssignDetails({ firstSerial: '', lastSerial: '' });
        await refetchStock();
    } catch (err) {
        setError(err.message);
    } finally {
        setIsSubmitting(false);
    }
  };

  const fetchUsers = useCallback(async () => {
    if (!isAdminProfile) return;
    setUsersLoading(true);
    try {
        const { data, error } = await supabase.from('users').select('*').order('email');
        if (error) throw error;
        setUsers(data || []);
    } catch (err) {
        setError(`Failed to fetch users: ${err.message}`);
    } finally {
        setUsersLoading(false);
    }
  }, [isAdminProfile]);

  const updateUserRole = async (userId, newRole) => {
    try {
        const { error } = await supabase
            .from('users')
            .update({ role: newRole })
            .eq('id', userId);
        if (error) throw error;
        setUsers(prevUsers => prevUsers.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
        setError(`Failed to update role: ${err.message}`);
    }
  };

  const handleAdminClick = useCallback(() => {
    navigateTo(View.ADMIN);
    fetchUsers();
  }, [fetchUsers, navigateTo]);

  const handleNewUserFormChange = (e) => {
    const { name, value } = e.target;
    setNewUserInfo(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError(null);
    setCreateUserLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
          body: newUserInfo,
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      setIsCreateUserModalOpen(false);
      setNewUserInfo({ email: '', password: '', username: '', role: 'User' });
      await fetchUsers();
    } catch (err) {
      setError(`Failed to create user: ${err.message}`);
    } finally {
      setCreateUserLoading(false);
    }
  };
  
  // --- Profile Management Functions ---
  const fetchProfiles = useCallback(async () => {
    if (!userProfile) return;
    setProfilesLoading(true);
    try {
        const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
        if (!user) throw new Error('User not authenticated');
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            
            .order('name');
        if (error) throw error;
        setProfiles(data || []);
    } catch (err) {
        setError(`Failed to fetch profiles: ${err.message}`);
    } finally {
        setProfilesLoading(false);
    }
  }, [userProfile]);

  const handleOpenProfilesModal = () => {
    fetchProfiles();
    setIsProfilesModalOpen(true);
  };

  const handleAddProfile = async (e) => {
    e.preventDefault();
    const name = newProfileInfo.name.trim();
    const pin = newProfileInfo.pin.trim();

    if (!name || pin.length !== 4) {
        setError("Profile name and a 4-digit PIN are required.");
        return;
    };

    setIsAddingProfile(true);
    setError(null);
    try {
        const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
        if (!user) throw new Error('User not authenticated');

        const profileData = { name, pin, user_id: user.id, role: newProfileInfo.role };

        const { error } = await supabase.from('profiles').insert(profileData);
        if (error) {
            if (error.message.includes('duplicate key')) {
                throw new Error(`A profile with the name "${name}" already exists.`);
            }
            throw error;
        }
        setNewProfileInfo({ name: '', pin: '', role: 'User' });
        await fetchProfiles();
    } catch (err) {
        setError(`Failed to add profile: ${err.message}`);
    } finally {
        setIsAddingProfile(false);
    }
  };
  
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!editingProfile) return;

    setIsSubmitting(true);
    setError(null);
    try {
        const { id, name, pin, role } = editingProfile;
        const trimmedName = name.trim();
        if (!trimmedName) throw new Error("Profile name cannot be empty.");
        if (!pin || pin.length !== 4) throw new Error("PIN must be 4 digits.");
        
        const updateData = { name: trimmedName, pin, role };

        const { error } = await supabase.from('profiles').update(updateData).eq('id', id);
        if (error) {
           if (error.message.includes('duplicate key')) {
                throw new Error(`A profile with the name "${trimmedName}" already exists.`);
            }
            throw error;
        }

        setEditingProfile(null);
        await fetchProfiles();

    } catch(err) {
        setError(`Failed to update profile: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!confirm('Are you sure you want to delete this profile? All movement history will remain, but the profile will be removed.')) return;
    setError(null);
    try {
        const { error } = await supabase.from('profiles').delete().eq('id', profileId);
        if (error) throw error;
        await fetchProfiles();
    } catch (err) {
        setError(`Failed to delete profile: ${err.message}`);
    }
  };

  const handleChangePinSubmit = async (e) => {
    e.preventDefault();
    setPinChangeError('');
    if (pinChangeData.newPin.length !== 4) {
        setPinChangeError('Your new PIN must be 4 digits long.');
        return;
    }
    if (pinChangeData.newPin !== pinChangeData.confirmNewPin) {
        setPinChangeError('The new PINs do not match.');
        return;
    }
    if (selectedProfile.pin && pinChangeData.currentPin !== selectedProfile.pin) {
        setPinChangeError('Your current PIN is incorrect.');
        return;
    }

    setIsSubmitting(true);
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ pin: pinChangeData.newPin })
            .eq('id', selectedProfile.id);

        if (error) throw error;

        setSuccessMessage('PIN updated successfully. Please select your profile again to continue.');
        setIsChangePinModalOpen(false);
        setTimeout(() => {
            onSwitchProfile();
            setSuccessMessage('');
        }, 1500);

    } catch (err) {
        setPinChangeError(`Failed to update PIN: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  };

  // --- Category & Sub-Category CRUD Handlers ---
  const handleAddCategory = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.from('item_category').insert([{ name }]).select();
      if (error) throw error;
      await fetchCategories();
      setNewCategoryName('');
      setIsAddCategoryModalOpen(false);
      addToast(`Category "${name}" created successfully`, 'success');
      setNewItemTypeInfo(prev => ({ ...prev, category: name, subcategory_id: '' }));
      if (editingItemType) {
        setEditingItemType(prev => ({ ...prev, category: name, subcategory_id: '' }));
      }
    } catch (err) {
      setError(`Failed to create category: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCategory = async (e) => {
    e.preventDefault();
    if (!editingCategory) return;
    const trimmed = editCategoryName.trim();
    if (!trimmed) return;
    const oldName = editingCategory.name;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('item_category').update({ name: trimmed }).eq('id', editingCategory.id);
      if (error) throw error;

      try {
        await supabase.from('item_types').update({ category: trimmed }).eq('category', oldName);
      } catch (err) {
        console.warn('Could not cascade category rename to item_types', err);
      }

      await Promise.all([fetchCategories(), fetchItemTypes()]);
      setEditingCategory(null);
      setEditCategoryName('');
      addToast(`Category renamed to "${trimmed}"`, 'success');
    } catch (err) {
      setError(`Failed to update category: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (cat) => {
    const inUseCount = itemTypes.filter(it => it.category === cat.name).length;
    const subCount = subcategories.filter(sc => sc.category_id === cat.id).length;
    let msg = `Are you sure you want to delete category "${cat.name}"?`;
    if (subCount > 0 || inUseCount > 0) {
      msg += `\n\nThis will also remove ${subCount} sub-category(s) and affect ${inUseCount} item type(s).`;
    }
    if (!window.confirm(msg)) return;

    try {
      await supabase.from('item_subcategory').delete().eq('category_id', cat.id);
      const { error } = await supabase.from('item_category').delete().eq('id', cat.id);
      if (error) throw error;
      await Promise.all([fetchCategories(), fetchItemTypes()]);
      addToast(`Category "${cat.name}" deleted`, 'success');
    } catch (err) {
      setError(`Failed to delete category: ${err.message}`);
    }
  };

  const handleAddSubcategory = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const name = newSubcategoryName.trim();
    if (!name || !selectedParentCategoryId) return;
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.from('item_subcategory').insert([{ name, category_id: selectedParentCategoryId }]).select();
      if (error) throw error;
      await fetchCategories();
      const createdSub = data?.[0];
      setNewSubcategoryName('');
      setIsAddSubcategoryModalOpen(false);
      addToast(`Sub-category "${name}" created successfully`, 'success');

      if (createdSub) {
        setNewItemTypeInfo(prev => ({ ...prev, subcategory_id: createdSub.id }));
        if (editingItemType) {
          setEditingItemType(prev => ({ ...prev, subcategory_id: createdSub.id }));
        }
      }
    } catch (err) {
      setError(`Failed to create sub-category: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateSubcategory = async (e) => {
    e.preventDefault();
    if (!editingSubcategory) return;
    const trimmed = editSubcategoryName.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('item_subcategory').update({ name: trimmed }).eq('id', editingSubcategory.id);
      if (error) throw error;
      await fetchCategories();
      setEditingSubcategory(null);
      setEditSubcategoryName('');
      addToast(`Sub-category updated to "${trimmed}"`, 'success');
    } catch (err) {
      setError(`Failed to update sub-category: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSubcategory = async (sub) => {
    const inUseCount = itemTypes.filter(it => it.subcategory_id === sub.id).length;
    let msg = `Are you sure you want to delete sub-category "${sub.name}"?`;
    if (inUseCount > 0) {
      msg += `\n\n${inUseCount} item type(s) currently use this sub-category and will have it unlinked.`;
    }
    if (!window.confirm(msg)) return;

    try {
      await supabase.from('item_types').update({ subcategory_id: null }).eq('subcategory_id', sub.id);
      const { error } = await supabase.from('item_subcategory').delete().eq('id', sub.id);
      if (error) throw error;
      await Promise.all([fetchCategories(), fetchItemTypes()]);
      addToast(`Sub-category "${sub.name}" deleted`, 'success');
    } catch (err) {
      setError(`Failed to delete sub-category: ${err.message}`);
    }
  };

  const handleAddItemType = async (e) => {
    e.preventDefault();
    if (!newItemTypeInfo.name.trim()) return;
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');
      
      const subId = newItemTypeInfo.subcategory_id ? parseInt(newItemTypeInfo.subcategory_id) : null;
      const supId = newItemTypeInfo.supplier_id ? parseInt(newItemTypeInfo.supplier_id) : null;
      const barcodeVal = newItemTypeInfo.barcode?.trim() || null;

      const payload = { 
        name: newItemTypeInfo.name.trim(), 
        price: parseFloat(newItemTypeInfo.price) || 0,
        category: newItemTypeInfo.category,
        subcategory_id: subId,
        supplier_id: supId,
        stock_threshold: parseInt(newItemTypeInfo.stock_threshold, 10) || 0,
        is_unique: newItemTypeInfo.is_unique,
        user_id: user.id 
      };

      if (barcodeVal) {
        payload.barcode = barcodeVal;
      }

      let { error: insertError } = await supabase.from('item_types').insert([payload]);
      if (insertError && (insertError.code === '42703' || insertError.message?.includes('barcode'))) {
        delete payload.barcode;
        const retry = await supabase.from('item_types').insert([payload]);
        insertError = retry.error;
      }
      if (insertError) throw insertError;
      setNewItemTypeInfo({ name: '', barcode: '', price: '', category: '', subcategory_id: '', stock_threshold: '', is_unique: false, supplier_id: '' });
      await fetchItemTypes();
      await fetchCategories();
      setIsAddItemTypeModalOpen(false);
    } catch (err) {
      setError(`Failed to add item type: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReturn = async (e) => {
    e.preventDefault();
    if (!returnModalData) return;
    
    setIsReturningStock(true);
    setError(null);
    try {
        const qtyToReturn = parseInt(returnQuantity, 10) || 1;
        const actualItemsToReturn = (returnModalData.items || [returnModalData]).slice(0, qtyToReturn);
        const returnLoc = (activeLocation && activeLocation !== 'All') ? activeLocation : (displayLocations[0] || Location.LEADING_STORES);
        
        if (actualItemsToReturn.length > 0) {
            const itemIds = actualItemsToReturn.map(i => i.id);
            if (itemIds.length === 1) {
                await updateStockItemAssignment(itemIds[0], returnLoc, Team.UNASSIGNED, selectedProfile.name);
            } else {
                await bulkUpdateAssignments(itemIds, returnLoc, Team.UNASSIGNED, selectedProfile.name);
            }
            await refetchStock();
            setSuccessMessage(`Successfully returned ${itemIds.length} item(s) to ${returnLoc}.`);
            setTimeout(() => setSuccessMessage(null), 3000);
        }
        setReturnModalData(null);
    } catch (err) {
        setError(`Failed to return to stock: ${err.message}`);
    } finally {
        setIsReturningStock(false);
    }
  };

  const handleBatchReturn = async (e) => {
    e.preventDefault();
    if (!batchReturnTeam) return;
    
    setIsBatchReturning(true);
    setError(null);
    try {
        const itemsToUpdate = [];
        const returnLoc = (activeLocation && activeLocation !== 'All') ? activeLocation : (displayLocations[0] || Location.LEADING_STORES);
        
        // Find all stock assigned to this team in the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam && s.assigned_at && new Date(s.assigned_at) >= twentyFourHoursAgo);
        
        // Group them by item name
        const groupedStock = {};
        teamStock.forEach(item => {
            if (!groupedStock[item.name]) groupedStock[item.name] = [];
            groupedStock[item.name].push(item);
        });

        // Collect items to return based on quantities provided
        Object.entries(batchReturnQuantities).forEach(([itemName, qtyToReturn]) => {
            const qty = parseInt(qtyToReturn, 10) || 0;
            if (qty > 0 && groupedStock[itemName]) {
                const itemsToReturn = groupedStock[itemName].slice(0, qty);
                itemsToUpdate.push(...itemsToReturn.map(i => i.id));
            }
        });
        
        if (itemsToUpdate.length > 0) {
            await bulkUpdateAssignments(itemsToUpdate, returnLoc, Team.UNASSIGNED, selectedProfile.name);
            await refetchStock();
            setSuccessMessage(`Successfully returned ${itemsToUpdate.length} item(s) from ${batchReturnTeam} into ${returnLoc}.`);
            setTimeout(() => setSuccessMessage(null), 3000);
            setIsBatchReturnModalOpen(false);
            setBatchReturnQuantities({});
        } else {
            setError("No quantities specified to return.");
        }
    } catch (err) {
        setError(`Failed to process batch return: ${err.message}`);
    } finally {
        setIsBatchReturning(false);
    }
  };

  const handleOpenBatchReturn = () => {
      setBatchReturnTeam(assignmentFilters.team !== 'All' ? assignmentFilters.team : '');
      setBatchReturnQuantities({});
      setIsBatchReturnModalOpen(true);
  };

  const executeConfirmationAction = async () => {
    if (confirmationModal.onConfirm) {
        setIsConfirmingAction(true);
        setError(null);
        try {
            await confirmationModal.onConfirm();
            setConfirmationModal({ isOpen: false });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsConfirmingAction(false);
        }
        return;
    }
    const { actionType, item } = confirmationModal;
    if (!actionType) return;
    
    setIsConfirmingAction(true);
    setError(null);

    try {
        if (actionType === 'DELETE_ITEM_TYPE') {
             const { error } = await supabase.from('item_types').delete().eq('id', item.id);
             if (error) throw error;
             await fetchItemTypes();
        } else if (actionType === 'DELETE_TEAM') {
             const { error } = await supabase.from('teams').delete().eq('id', item.id);
             if (error) throw error;
             await fetchTeams();
        } else if (actionType === 'DELETE_SUPPLIER') {
             const { error } = await supabase.from('suppliers').delete().eq('id', item.id);
             if (error) throw error;
             await fetchSuppliers();
        } else if (actionType === 'DELETE_LOCATION') {
             const { error } = await supabase.from('locations').delete().eq('id', item.id);
             if (error) throw error;
             await fetchLocations();
        } else if (actionType === 'DELETE_STOCK_ITEM') {
             if (item.items && item.items.length > 1) {
                 const itemIds = item.items.map(i => i.id);
                 await bulkDeleteStockItems(itemIds, selectedProfile.name);
             } else {
                 const itemId = item.items ? item.items[0].id : item.id;
                 await deleteStockItem(itemId, selectedProfile.name);
             }
             setSuccessMessage(`Item(s) deleted.`);
             setTimeout(() => setSuccessMessage(null), 3000);
        }
        setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    } catch (err) {
        setError(`Failed to perform action: ${err.message}`);
        setConfirmationModal(prev => ({ ...prev, isOpen: false }));
    } finally {
        setIsConfirmingAction(false);
    }
  };

  
  const handleDevLogin = (e) => {
      e.preventDefault();
      if (devPasswordInput === '153501') {
          setIsDevMode(true);
          setIsDevLoginModalOpen(false);
          setDevPasswordInput('');
          setDevLoginError('');
      } else {
          setDevLoginError('Incorrect password');
      }
  };

  const handleDevPurgeSearch = async (e) => {
      e.preventDefault();
      if (!devPurgeBarcode.trim()) return;
      setDevPurgeLoading(true);
      setDevPurgeResults(null);
      setError(null);
      try {
          const items = await getStockItemsByBarcode(devPurgeBarcode);
          const { data: itemType } = await supabase.from('item_types').select('*').eq('barcode', devPurgeBarcode).maybeSingle();
          
          setDevPurgeResults({
              stockItems: items || [],
              itemType: itemType || null
          });
      } catch (err) {
          setError(`Search failed: ${err.message}`);
      } finally {
          setDevPurgeLoading(false);
      }
  };

  const handleDevPurgeConfirm = async () => {
      if (!devPurgeResults) return;
      
      const itemIds = devPurgeResults.stockItems.map(i => i.id);
      
      try {
          if (itemIds.length > 0) {
              await bulkDeleteStockItems(itemIds, selectedProfile.name);
          }
          if (devPurgeResults.itemType) {
              await supabase.from('item_types').delete().eq('id', devPurgeResults.itemType.id);
              await fetchItemTypes();
          }
          
          setSuccessMessage(`Successfully purged ${itemIds.length} items${devPurgeResults.itemType ? ' and associated type data' : ''}.`);
          setIsDevPurgeModalOpen(false);
          setDevPurgeResults(null);
          setDevPurgeBarcode('');
      } catch (err) {
          setError(`Purge failed: ${err.message}`);
      }
  };

  const handleDeleteItemType = async (type) => {
    const hasStock = stock.some(item => item.name === type.name);
    
    if (hasStock) {
        setError(`Cannot delete item type "${type.name}" because there are items of this type currently in stock (or assigned). Please remove or reassign them first to ensure data integrity.`);
        return;
    }

    setConfirmationModal({
        isOpen: true,
        title: 'Delete Item Type',
        message: `Are you sure you want to delete the item type "${type.name}"? This action cannot be undone.`,
        actionType: 'DELETE_ITEM_TYPE',
        item: type
    });
  };

  const handleUpdateItemType = async (e) => {
    e.preventDefault();
    if (!editingItemType || !editingItemType.name.trim()) return;
    setIsSubmitting(true);
    try {
        const subId = editingItemType.subcategory_id ? parseInt(editingItemType.subcategory_id) : null;
        const supId = editingItemType.supplier_id ? parseInt(editingItemType.supplier_id) : null;
        const barcodeVal = editingItemType.barcode !== undefined ? (editingItemType.barcode ? editingItemType.barcode.trim() : null) : undefined;

        const updatePayload = { 
            name: editingItemType.name.trim(),
            price: parseFloat(editingItemType.price) || 0,
            category: editingItemType.category,
            subcategory_id: subId,
            supplier_id: supId,
            stock_threshold: parseInt(editingItemType.stock_threshold, 10) || 0,
            is_unique: editingItemType.is_unique,
        };
        if (barcodeVal !== undefined) {
            updatePayload.barcode = barcodeVal;
        }

        let { error } = await supabase
            .from('item_types')
            .update(updatePayload)
            .eq('id', editingItemType.id);

        if (error && (error.code === '42703' || error.message?.includes('barcode'))) {
            delete updatePayload.barcode;
            const retry = await supabase
                .from('item_types')
                .update(updatePayload)
                .eq('id', editingItemType.id);
            error = retry.error;
        }

        if (error) throw error;
        setEditingItemType(null);
        await fetchItemTypes();
    } catch (err) {
      setError(`Failed to update item type: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleAddTeam = async (e) => {
    e.preventDefault();
    const trimmedName = newTeamInfo.name.trim();
    if (!trimmedName) return;

    const isDuplicate = teams.some(team => team.name.toLowerCase() === trimmedName.toLowerCase());
    if (isDuplicate) {
        setError(`A team with the name "${trimmedName}" already exists.`);
        return;
    }
    
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');

      const trimmedBarcode = newTeamInfo.barcode?.trim() || null;
      const payload = { name: trimmedName, type: newTeamInfo.type, user_id: user.id };
      if (trimmedBarcode) {
        payload.barcode = trimmedBarcode;
      }

      let { error: insertError } = await supabase.from('teams').insert([payload]);
      if (insertError && (insertError.code === '42703' || insertError.message?.includes('barcode'))) {
        delete payload.barcode;
        const retry = await supabase.from('teams').insert([payload]);
        insertError = retry.error;
        if (!insertError && trimmedBarcode) {
          saveTeamBarcodeToCache(trimmedName, trimmedBarcode);
        }
      } else if (!insertError && trimmedBarcode) {
        saveTeamBarcodeToCache(trimmedName, trimmedBarcode);
      }

      if (insertError) throw insertError;
      setNewTeamInfo({ name: '', type: TeamType.TEAM, barcode: '' });
      await fetchTeams();
      setIsAddTeamModalOpen(false);
    } catch (err) {
      setError(`Failed to add team: ${err.message}`);
    }
  };

  const handleUpdateTeam = async (e) => {
    e.preventDefault();
    if (!editingTeam) return;
    const trimmedName = editingTeam.name.trim();
    if (!trimmedName) return;

    const isDuplicate = teams.some(
        team => team.name.toLowerCase() === trimmedName.toLowerCase() && team.id !== editingTeam.id
    );

    if (isDuplicate) {
        setError(`Another team with the name "${trimmedName}" already exists.`);
        return;
    }

    setError(null);

    try {
        const trimmedBarcode = editingTeam.barcode !== undefined ? (editingTeam.barcode?.trim() || null) : undefined;
        const updatePayload = { name: trimmedName, type: editingTeam.type };
        if (trimmedBarcode !== undefined) {
          updatePayload.barcode = trimmedBarcode;
        }

        let { error: updateError } = await supabase
            .from('teams')
            .update(updatePayload)
            .eq('id', editingTeam.id);

        if (updateError && (updateError.code === '42703' || updateError.message?.includes('barcode'))) {
          delete updatePayload.barcode;
          const retry = await supabase.from('teams').update(updatePayload).eq('id', editingTeam.id);
          updateError = retry.error;
          if (!updateError && trimmedBarcode !== undefined) {
            saveTeamBarcodeToCache(trimmedName, trimmedBarcode);
          }
        } else if (!updateError && trimmedBarcode !== undefined) {
          saveTeamBarcodeToCache(trimmedName, trimmedBarcode);
        }

        if (updateError) throw updateError;
        setEditingTeam(null);
        await fetchTeams();
    } catch (err) {
      setError(`Failed to update team: ${err.message}`);
    }
  };
  
  const handleDeleteTeam = (team) => {
    setConfirmationModal({
        isOpen: true,
        title: 'Delete Team',
        message: `Are you sure you want to delete "${team.name}"? This action cannot be undone.`,
        actionType: 'DELETE_TEAM',
        item: team
    });
  };
  
  const handleAddLocation = async (e) => {
    e.preventDefault();
    if (!newLocationInfo.name.trim()) return;
    try {
      const { error } = await supabase.from('locations').insert([{ name: newLocationInfo.name.trim() }]);
      if (error) throw error;
      setNewLocationInfo({ name: '' });
      await fetchLocations();
      setIsAddLocationModalOpen(false);
    } catch (err) {
      setError(`Failed to add location (Did you create the table?): ${err.message}`);
    }
  };

  const handleUpdateLocation = async (e) => {
    e.preventDefault();
    if (!editingLocation.name.trim()) return;
    try {
        const { error } = await supabase
            .from('locations')
            .update({ name: editingLocation.name.trim() })
            .eq('id', editingLocation.id);
        if (error) throw error;
        setEditingLocation(null);
        await fetchLocations();
    } catch (err) {
      setError(`Failed to update location: ${err.message}`);
    }
  };

  const handleDeleteLocation = async (location) => {
      setConfirmDialog({
          isOpen: true,
          title: 'Delete Location',
          message: `Are you sure you want to delete the location "${location.name}"? This will not affect existing historical stock movements but will remove it as a selectable option.`,
          actionType: 'DELETE_LOCATION',
          item: location
      });
  };

  const handleAddSupplier = async (e) => {
    e.preventDefault();
    const trimmedName = newSupplierInfo.name.trim();
    if (!trimmedName) return;

    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');
      
      const supplierData = { ...newSupplierInfo, name: trimmedName, user_id: user.id };
      supplierData.lead_time_days = parseInt(supplierData.lead_time_days, 10) || 7;

      const { error } = await supabase.from('suppliers').insert([supplierData]);
      if (error) {
        if (error.message.includes('duplicate key value')) {
          throw new Error(`A supplier with the name "${trimmedName}" already exists.`);
        }
        throw error;
      }
      setNewSupplierInfo({ name: '', contact_person: '', phone: '', email: '', lead_time_days: 7 });
      await fetchSuppliers();
      setIsAddSupplierModalOpen(false);
    } catch (err) {
      setError(`Failed to add supplier: ${err.message}`);
    }
  };

  const handleUpdateSupplier = async (e) => {
    e.preventDefault();
    if (!editingSupplier) return;
    const trimmedName = editingSupplier.name.trim();
    if (!trimmedName) return;
    
    setError(null);
    try {
        const updateData = { 
            name: trimmedName, 
            contact_person: editingSupplier.contact_person,
            phone: editingSupplier.phone,
            email: editingSupplier.email,
            lead_time_days: parseInt(editingSupplier.lead_time_days, 10) || 7,
        };

        const { error } = await supabase
            .from('suppliers')
            .update(updateData)
            .eq('id', editingSupplier.id);

        if (error) {
           if (error.message.includes('duplicate key value')) {
             throw new Error(`Another supplier with the name "${trimmedName}" already exists.`);
           }
           throw error;
        }
        setEditingSupplier(null);
        await fetchSuppliers();
    } catch (err) {
      setError(`Failed to update supplier: ${err.message}`);
    }
  };
  
  const handleDeleteSupplier = (supplier) => {
    const isSupplierInUse = itemTypes.some(it => it.supplier_id === supplier.id);
    if(isSupplierInUse) {
      setError(`Cannot delete supplier "${supplier.name}" as it is currently associated with one or more item types. Please reassign those item types first.`);
      return;
    }

    setConfirmationModal({
        isOpen: true,
        title: 'Delete Supplier',
        message: `Are you sure you want to delete "${supplier.name}"? This action cannot be undone.`,
        actionType: 'DELETE_SUPPLIER',
        item: supplier
    });
  };

  const handleReturnToStock = (groupOrItem) => {
    setReturnQuantity(groupOrItem.quantity || 1);
    setReturnModalData(groupOrItem);
  };

  const handleDeleteStockItem = (groupOrItem) => {
    const isGroup = groupOrItem.items && groupOrItem.items.length > 1;
    const message = isGroup
        ? `Are you sure you want to permanently delete ${groupOrItem.quantity}x ${groupOrItem.name}? This cannot be undone.`
        : `Are you sure you want to permanently delete item ${groupOrItem.barcode || groupOrItem.barcodes[0]}? This cannot be undone.`;

    setConfirmationModal({
        isOpen: true,
        title: 'Delete Item',
        message: message,
        actionType: 'DELETE_STOCK_ITEM',
        item: groupOrItem
    });
  };
  
  const handleCalculateThresholds = async () => {
    if (!confirm('Are you sure you want to recalculate all stock thresholds? This will overwrite any manually set values based on the usage over the last 4 weeks.')) {
        return;
    }
    setIsCalculatingThresholds(true);
    setError(null);
    try {
        const { data, error } = await supabase.functions.invoke('calculate-stock-thresholds');
        if (error) throw error;
        if (data.error) throw new Error(data.error);

        setThresholdSummary(data);
        setIsThresholdSummaryModalOpen(true);
        
        setSuccessMessage(`${data.updatedCount} stock thresholds have been updated.`);
        setTimeout(() => setSuccessMessage(null), 4000);

        await fetchItemTypes(); // Refresh item types to get new thresholds
    } catch (err) {
        setError(`Failed to calculate thresholds: ${err.message}`);
    } finally {
        setIsCalculatingThresholds(false);
    }
  };

  const handlePageChange = (groupName, newPage) => {
    setCurrentPageByGroup(prev => ({
      ...prev,
      [groupName]: newPage
    }));
  };

  const { currentStock, assignedStock } = useMemo(() => {
    const current = [];
    const assigned = [];
    if (stock) {
        for (const item of stock) {
            if (item.assigned_to === Team.UNASSIGNED) {
                current.push(item);
            } else {
                assigned.push(item);
            }
        }
    }
    assigned.sort((a, b) => new Date(b.assigned_at) - new Date(a.assigned_at));
    return { currentStock: current, assignedStock: assigned };
  }, [stock]);

  const filteredStock = useMemo(() => {
    if (!currentStock) return [];
    const search = (stockSearchTerm || '').trim().toLowerCase();
    return currentStock.filter(item => {
        const locationMatch = dashboardFilters.location === 'All' || item.location === dashboardFilters.location;
        if (!locationMatch) return false;
        if (!search) return true;

        const nameMatch = item.name && item.name.toLowerCase().includes(search);
        const barcodeMatch = item.barcode && String(item.barcode).toLowerCase().includes(search);
        const locationTextMatch = item.location && item.location.toLowerCase().includes(search);
        const descMatch = item.description && item.description.toLowerCase().includes(search);

        // Check if item matches any supplier part number
        const parts = supplierPartNumbersByItemTypeName[item.name] || [];
        const partMatch = parts.some(sp => 
            (sp.part_number && String(sp.part_number).toLowerCase().includes(search)) ||
            (sp.supplier_name && String(sp.supplier_name).toLowerCase().includes(search)) ||
            (sp.suppliers?.name && String(sp.suppliers.name).toLowerCase().includes(search)) ||
            (sp.barcode && String(sp.barcode).toLowerCase().includes(search))
        );

        return nameMatch || barcodeMatch || locationTextMatch || descMatch || partMatch;
    });
  }, [currentStock, dashboardFilters.location, stockSearchTerm, supplierPartNumbersByItemTypeName]);
  
  const filteredAssignedStock = useMemo(() => {
    if (!assignedStock) return [];
    return assignedStock.filter(item => {
        const teamMatch = assignmentFilters.team === 'All' || item.assigned_to === assignmentFilters.team;
        const itemTypeMatch = assignmentFilters.itemType === 'All' || item.name === assignmentFilters.itemType;
        const locationMatch = assignmentFilters.location === 'All' || item.location === assignmentFilters.location;
        const assignedByMeMatch = !assignmentFilters.assignedByMe || item.assigned_by === selectedProfile.name;
        return teamMatch && itemTypeMatch && locationMatch && assignedByMeMatch;
    });
  }, [assignedStock, assignmentFilters, selectedProfile]);

  const groupedAssignedStock = useMemo(() => {
    if (!filteredAssignedStock) return [];
    
    const groups = {};
    
    filteredAssignedStock.forEach(item => {
      // Group by minute, item name, assigned_to, assigned_by
      const timeKey = item.assigned_at ? new Date(item.assigned_at).toISOString().slice(0, 16) : 'unknown';
      const key = `${item.name}|${item.assigned_to}|${item.assigned_by}|${timeKey}`;
      
      if (!groups[key]) {
        groups[key] = {
          id: item.id, // use first id as key
          name: item.name,
          assigned_to: item.assigned_to,
          assigned_by: item.assigned_by,
          assigned_at: item.assigned_at,
          quantity: 0,
          barcodes: [],
          items: [] // Keep track of the actual items
        };
      }
      
      groups[key].quantity += 1;
      if (item.barcode) {
        groups[key].barcodes.push(item.barcode);
      }
      groups[key].items.push(item);
    });
    
    // Convert back to array and sort by assigned_at descending
    return Object.values(groups).sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0));
  }, [filteredAssignedStock]);

  const groupedStock = useMemo(() => {
    if (!filteredStock) return {};
    return filteredStock.reduce((acc, item) => {
        acc[item.name] = acc[item.name] || [];
        acc[item.name].push(item);
        return acc;
    }, {});
  }, [filteredStock]);

  const groupedTeams = useMemo(() => {
    if (!teams) return {};
    return teams.reduce((acc, team) => {
      const type = team.type || TeamType.TEAM;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(team);
      return acc;
    }, {});
  }, [teams]);

  const stockSummary = useMemo(() => {
    const relevantStock = dashboardFilters.location === 'All'
        ? currentStock
        : currentStock.filter(item => item.location === dashboardFilters.location);
    const relevantAssigned = dashboardFilters.location === 'All'
        ? assignedStock
        : assignedStock.filter(item => item.location === dashboardFilters.location);

    const totalItems = relevantStock.length;
    const itemTypesCount = new Set(relevantStock.map(i => i.name)).size;
    const itemsAssigned = relevantAssigned.length;
    const itemsInStore = relevantStock.length;

    // Company-wide stats for comprehensive visibility
    const companyTotalItems = currentStock.length;
    const companyItemTypesCount = new Set(currentStock.map(i => i.name)).size;
    const companyItemsAssigned = assignedStock.length;

    return { 
      totalItems, 
      itemTypesCount, 
      itemsAssigned, 
      itemsInStore,
      companyTotalItems,
      companyItemTypesCount,
      companyItemsAssigned
    };
  }, [currentStock, assignedStock, dashboardFilters.location]);

  // Map to get company-wide total count for each item type
  const companyStockByName = useMemo(() => {
    if (!currentStock) return {};
    return currentStock.reduce((acc, item) => {
      acc[item.name] = (acc[item.name] || 0) + 1;
      return acc;
    }, {});
  }, [currentStock]);

  // Map to get breakdown per location for each item type across the entire company
  const companyStockByLocationAndName = useMemo(() => {
    if (!currentStock) return {};
    return currentStock.reduce((acc, item) => {
      if (!acc[item.name]) acc[item.name] = {};
      const loc = item.location || 'Unassigned';
      acc[item.name][loc] = (acc[item.name][loc] || 0) + 1;
      return acc;
    }, {});
  }, [currentStock]);
    
  const itemTypeDetailsMap = useMemo(() => {
    if (!itemTypes) return {};
    return itemTypes.reduce((acc, type) => {
        acc[type.name] = {
            id: type.id,
            category: type.category,
            price: type.price || 0,
            threshold: type.stock_threshold || 0,
            is_unique: type.is_unique || false,
            barcode: stock.find(s => s.name === type.name)?.barcode,
        };
        return acc;
    }, {});
  }, [itemTypes, stock]);

  const { totalInventoryValue, companyInventoryValue } = useMemo(() => {
    if (!currentStock || !isAdminProfile) return { totalInventoryValue: 0, companyInventoryValue: 0 };
    let locationVal = 0;
    let companyVal = 0;
    for (const item of currentStock) {
        const details = itemTypeDetailsMap[item.name];
        const price = item.purchase_price != null ? item.purchase_price : (details ? details.price : 0);
        const p = parseFloat(price) || 0;
        companyVal += p;
        if (dashboardFilters.location === 'All' || item.location === dashboardFilters.location) {
            locationVal += p;
        }
    }
    return { totalInventoryValue: locationVal, companyInventoryValue: companyVal };
  }, [currentStock, itemTypeDetailsMap, isAdminProfile, dashboardFilters.location]);

  const stockGroupValues = useMemo(() => {
    if (!isAdminProfile || !groupedStock || !itemTypeDetailsMap) return {};
    return Object.entries(groupedStock).reduce((acc, [name, items]) => {
        const details = itemTypeDetailsMap[name];
        // For groups, since items might have different historical prices, we need to sum them individually
        const groupTotal = items.reduce((sum, item) => {
             const p = item.purchase_price != null ? item.purchase_price : (details ? details.price : 0);
             return sum + parseFloat(p);
        }, 0);
        acc[name] = groupTotal;
        return acc;
    }, {});
  }, [groupedStock, itemTypeDetailsMap, isAdminProfile]);

  const getStockLevelIndicator = useCallback((itemCount, threshold) => {
      if (!threshold || threshold <= 0) {
        return { color: 'bg-zinc-400', label: 'Stock threshold not set' };
      }
      if (itemCount <= threshold) {
        return { color: 'bg-red-500', label: 'Low Stock - Re-order' };
      }
      if (itemCount <= threshold * 1.25) {
        return { color: 'bg-yellow-400', label: 'Nearing Threshold' };
      }
      return { color: 'bg-green-500', label: 'Stock Level Healthy' };
  }, []);



  const filteredAdminItemTypes = useMemo(() => {
    if (!itemTypes) return [];
    if (!adminItemTypeSearchTerm.trim()) return itemTypes;
    const lowerSearch = adminItemTypeSearchTerm.toLowerCase().trim();
    return itemTypes.filter(type => {
      const associated = itemTypeBarcodesMap[type.name] || [];
      const barcodeMatch = associated.some(bc => bc.toLowerCase().includes(lowerSearch));
      const parts = supplierPartNumbersByItemTypeId[type.id] || [];
      const partMatch = parts.some(sp => 
        (sp.part_number && String(sp.part_number).toLowerCase().includes(lowerSearch)) ||
        (sp.supplier_name && String(sp.supplier_name).toLowerCase().includes(lowerSearch)) ||
        (sp.suppliers?.name && String(sp.suppliers.name).toLowerCase().includes(lowerSearch)) ||
        (sp.barcode && String(sp.barcode).toLowerCase().includes(lowerSearch))
      );
      return (
        type.name.toLowerCase().includes(lowerSearch) || 
        (type.category || '').toLowerCase().includes(lowerSearch) ||
        (type.item_subcategory?.name || '').toLowerCase().includes(lowerSearch) ||
        (type.barcode && String(type.barcode).toLowerCase().includes(lowerSearch)) ||
        barcodeMatch ||
        partMatch
      );
    });
  }, [itemTypes, adminItemTypeSearchTerm, itemTypeBarcodesMap, supplierPartNumbersByItemTypeId]);

  const groupedItemTypes = useMemo(() => {
    if (!filteredAdminItemTypes) return {};
    return filteredAdminItemTypes.reduce((acc, type) => {
        const category = type.category || 'Uncategorised';
        const subCategory = type.item_subcategory?.name || 'General';

        if (!acc[category]) {
            acc[category] = {};
        }
        if (!acc[category][subCategory]) {
            acc[category][subCategory] = [];
        }
        const enrichedType = {
          ...type,
          supplierPartNumbers: supplierPartNumbersByItemTypeId[type.id] || []
        };
        acc[category][subCategory].push(enrichedType);
        return acc;
    }, {});
  }, [filteredAdminItemTypes, supplierPartNumbersByItemTypeId]);

  const filteredAdminSuppliers = useMemo(() => {
    if (!suppliers) return [];
    if (!adminSupplierSearchTerm) return suppliers;
    const lowerSearch = adminSupplierSearchTerm.toLowerCase().trim();
    return suppliers.filter(supplier => {
      const parts = supplierPartNumbersBySupplierId[supplier.id] || [];
      const partMatch = parts.some(sp => 
        (sp.part_number && String(sp.part_number).toLowerCase().includes(lowerSearch)) ||
        (sp.item_types?.name && String(sp.item_types.name).toLowerCase().includes(lowerSearch))
      );
      return (
        supplier.name.toLowerCase().includes(lowerSearch) || 
        (supplier.contact_person || '').toLowerCase().includes(lowerSearch) ||
        (supplier.email || '').toLowerCase().includes(lowerSearch) ||
        (supplier.phone || '').toLowerCase().includes(lowerSearch) ||
        partMatch
      );
    });
  }, [suppliers, adminSupplierSearchTerm, supplierPartNumbersBySupplierId]);

  // --- Supplier Part Numbers CRUD Methods ---
  const handleAddSupplierPartNumber = async (itemTypeId, partData) => {
    if (!partData.part_number || !partData.part_number.trim()) {
      setError("Please provide a supplier part number.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const supId = partData.supplier_id ? parseInt(partData.supplier_id, 10) : null;
      const supplierObj = suppliers.find(s => s.id === supId);

      const payload = {
        item_type_id: itemTypeId,
        supplier_id: supId,
        supplier_name: supplierObj?.name || partData.supplier_name?.trim() || null,
        part_number: partData.part_number.trim(),
        barcode: partData.barcode?.trim() || null,
        purchase_price: parseFloat(partData.purchase_price) || 0,
        notes: partData.notes?.trim() || null,
        user_id: user?.id || null
      };

      const { data, error } = await supabase
        .from('item_supplier_part_numbers')
        .insert([payload])
        .select('*, suppliers(id, name), item_types(id, name, category)');

      if (error) throw error;

      await fetchSupplierPartNumbers();
      setNewPartNumberInfo({ supplier_id: '', supplier_name: '', part_number: '', barcode: '', purchase_price: '', notes: '' });
      setSuccessMessage(`Supplier part number "${payload.part_number}" saved successfully.`);
      setTimeout(() => setSuccessMessage(null), 3500);
      return data?.[0];
    } catch (err) {
      console.error("Error adding supplier part number:", err);
      setError(`Failed to save supplier part number: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateSupplierPartNumber = async (partId, partData) => {
    if (!partData.part_number || !partData.part_number.trim()) {
      setError("Please provide a supplier part number.");
      return;
    }
    setIsSubmitting(true);
    try {
      const supId = partData.supplier_id ? parseInt(partData.supplier_id, 10) : null;
      const supplierObj = suppliers.find(s => s.id === supId);

      const payload = {
        supplier_id: supId,
        supplier_name: supplierObj?.name || partData.supplier_name?.trim() || null,
        part_number: partData.part_number.trim(),
        barcode: partData.barcode?.trim() || null,
        purchase_price: parseFloat(partData.purchase_price) || 0,
        notes: partData.notes?.trim() || null,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('item_supplier_part_numbers')
        .update(payload)
        .eq('id', partId);

      if (error) throw error;

      await fetchSupplierPartNumbers();
      setEditingPartNumber(null);
      setSuccessMessage(`Supplier part number "${payload.part_number}" updated.`);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      console.error("Error updating supplier part number:", err);
      setError(`Failed to update supplier part number: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSupplierPartNumber = async (partId) => {
    try {
      const { error } = await supabase
        .from('item_supplier_part_numbers')
        .delete()
        .eq('id', partId);

      if (error) throw error;

      await fetchSupplierPartNumbers();
      setSuccessMessage("Supplier part number removed.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error("Error deleting supplier part number:", err);
      setError(`Failed to delete supplier part number: ${err.message}`);
    }
  };

  const supplierItemCount = useMemo(() => {
    if (!itemTypes) return {};
    return itemTypes.reduce((acc, item) => {
        if (item.supplier_id) {
            acc[item.supplier_id] = (acc[item.supplier_id] || 0) + 1;
        }
        return acc;
    }, {});
  }, [itemTypes]);
  
  const viewConfig = useMemo(() => ({
      [View.LIST]: { title: `Hi, ${selectedProfile?.name}` },
      [View.ADD_ITEM]: { title: 'Add New Stock' },
      [View.SCAN]: { title: 'Scan Serial Number' },
      [View.ADMIN]: { title: 'Admin' },
      [View.ASSIGNMENTS]: { title: 'Log' },
      [View.REPORTING]: { title: 'Inventory Reports' },
      [View.PURCHASING]: { title: 'Purchase Orders' },
  }), [selectedProfile]);

  const AddItemsPreview = () => (
    <div className="mt-6 p-4 rounded-md bg-zinc-50 dark:bg-zinc-700/30 border border-zinc-200 dark:border-zinc-700 min-h-[88px] flex flex-col justify-center">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Preview</h4>
      {addItemsError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{addItemsError}</p>
      ) : processedSerials.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            {processedSerials.length} item{processedSerials.length !== 1 ? 's' : ''} to be added.
          </p>
          {processedSerials.length > 1 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate mt-1">
              e.g., {processedSerials[0]} ... {processedSerials[processedSerials.length - 1]}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">A summary of items will appear here.</p>
      )}
    </div>
  );

  const selectedScannedItemType = useMemo(() => itemTypes.find(it => it.name === newScannedItemDetails.name), [newScannedItemDetails.name, itemTypes]);
  const isMeterType = selectedScannedItemType?.category === StockCategory.METERS;

  // Filter Subcategories based on selected category in forms
  const getFilteredSubcategories = (categoryName) => {
      if (!categoryName) return [];
      const parentCategory = categories.find(c => c.name === categoryName);
      if (!parentCategory) return [];
      return subcategories.filter(sc => sc.category_id === parentCategory.id);
  };

  const { isAddFormInvalid, addFormButtonText } = useMemo(() => {
    if (!selectedItemType) {
        return { isAddFormInvalid: true, addFormButtonText: 'Add Item(s)' };
    }
    if (selectedItemType.is_unique) {
        const invalid = !!addItemsError || processedSerials.length === 0;
        const text = processedSerials.length > 0 ? `Add ${processedSerials.length} Item(s)` : 'Add Item(s)';
        return { isAddFormInvalid: invalid, addFormButtonText: text };
    } else {
        const quantity = parseInt(newItem.quantity, 10);
        const invalid = !newItem.barcode.trim() || isNaN(quantity) || quantity < 1;
        const text = !isNaN(quantity) && quantity > 0 ? `Add ${quantity} Item(s)` : 'Add Item(s)';
        return { isAddFormInvalid: invalid, addFormButtonText: text };
    }
  }, [selectedItemType, addItemsError, processedSerials, newItem.barcode, newItem.quantity]);

  const headerTitle = currentView === View.LIST ? `Hi, ${selectedProfile?.name}` : (viewConfig[currentView]?.title || 'Bregan MainsFlow Stock');

  return (
    <>
      
      

      <div className="flex h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
        <aside className="hidden md:flex w-64 flex-col bg-white dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700">
          <div className="h-16 flex items-center px-4 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
              <BrandIcon className="w-8 h-8 text-blue-600" />
              <span className="ml-3 font-semibold text-lg text-zinc-900 dark:text-white">Bregan MainsFlow</span>
          </div>

          {/* Dedicated Storehouse Location Switcher */}
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-800/60">
            <label htmlFor="sidebar-location-select" className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5 flex items-center gap-1.5">
              <BuildingStoreIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Current Storehouse</span>
            </label>
            <select
              id="sidebar-location-select"
              value={activeLocation}
              onChange={(e) => handleSelectActiveLocation(e.target.value)}
              className="w-full text-xs font-semibold bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded-md py-1.5 px-2 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer shadow-sm"
              title="Select storehouse location to filter stock view and actions"
            >
              <option value="All">All Locations (Company-Wide)</option>
              {displayLocations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
            {activeLocation !== 'All' && (
              <p className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 font-medium truncate">
                Scoped to: {activeLocation}
              </p>
            )}
          </div>

          <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
              <SidebarNavItem icon={<ListIcon />} label="Dashboard" isActive={currentView === View.LIST} onClick={() => navigateTo(View.LIST)} />
              {isAdminProfile && (
                <SidebarNavItem icon={<ArchiveIcon />} label="Log" isActive={currentView === View.ASSIGNMENTS} onClick={() => navigateTo(View.ASSIGNMENTS)} />
              )}
              <SidebarNavItem icon={<ScanIcon />} label="Scan / Action" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />
              {isAdminProfile && (
                <>
                  <SidebarNavItem icon={<PurchasingIcon />} label="Purchasing" isActive={currentView === View.PURCHASING} onClick={() => navigateTo(View.PURCHASING)} />
                  <SidebarNavItem icon={<ChartBarIcon />} label="Reporting" isActive={currentView === View.REPORTING} onClick={() => navigateTo(View.REPORTING)} />
                  <SidebarNavItem icon={<ClipboardCheckIcon />} label="Stock Take" isActive={currentView === View.STOCK_TAKE} onClick={() => navigateTo(View.STOCK_TAKE)} />
                  <SidebarNavItem icon={<AdminIcon />} label="Admin Panel" isActive={currentView === View.ADMIN} onClick={handleAdminClick} />
                </>
              )}
          </nav>
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center">
                  <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-zinc-900 dark:text-zinc-100">{selectedProfile?.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{userProfile?.email}</p>
                  </div>
                  <button onClick={onSwitchProfile} className="p-2 ml-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Switch Profile" title="Switch Profile">
                    <SwitchUserIcon className="w-5 h-5"/>
                  </button>
                  {syncQueue && syncQueue.length > 0 && (
      <button onClick={() => setIsQueueModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors relative" aria-label="Upload Queue" title="Upload Queue">
        <UploadIcon className="w-5 h-5 text-amber-500" />
        <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">{syncQueue.length}</span>
      </button>
  )}
                  {isAdminProfile && (
                      <button onClick={() => setIsUnrecognizedModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors relative" aria-label="Notifications" title="Notifications">
                          <BellIcon className="w-5 h-5 text-zinc-500" />
                          {unrecognizedScans.length > 0 && (
                              <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">{unrecognizedScans.length}</span>
                          )}
                      </button>
                  )}
  <button onClick={() => setIsSettingsModalOpen(true)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Settings" title="Settings">
                    <SettingsIcon className="w-5 h-5"/>
                  </button>
                  <button onClick={toggleDarkMode} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Toggle Dark Mode" title="Toggle Dark Mode">
                    {isDarkMode ? <SunIcon className="w-5 h-5"/> : <MoonIcon className="w-5 h-5"/>}
                  </button>
                  <button onClick={onLogout} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Logout" title="Logout">
                      <LogoutIcon className="w-5 h-5"/>
                  </button>
              </div>
              <div className="mt-2 text-center">
                  <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 tracking-wider">0.10</span>
              </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* --- HEADER (Mobile) --- */}
          <header 
            className="bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-white p-4 flex items-center justify-between md:hidden border-b border-zinc-200 dark:border-zinc-700"
            style={{ paddingTop: Capacitor.isNativePlatform() ? 'calc(1rem + env(safe-area-inset-top, 0px))' : '1rem' }}
          >
              <div className="flex items-center space-x-3">
                  {currentView === View.LIST || currentView === View.ASSIGNMENTS ? (
                    <BrandIcon className="w-8 h-8 text-blue-600" />
                  ) : (
                    <div className="w-8 h-8" /> // Placeholder for alignment
                  )}
                  <h1 className="text-xl font-bold tracking-tight">{headerTitle}</h1>
              </div>
              <div className="flex items-center">
                 {isAdminProfile && (
                     <button onClick={() => setIsUnrecognizedModalOpen(true)} className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors relative mr-1" aria-label="Notifications" title="Notifications">
                        <BellIcon className="w-6 h-6" />
                        {unrecognizedScans.length > 0 && (
                            <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">{unrecognizedScans.length}</span>
                        )}
                     </button>
                 )}
                 <button onClick={onSwitchProfile} className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Switch Profile" title="Switch Profile">
                    <SwitchUserIcon className="w-6 h-6" />
                 </button>
                 <button onClick={onLogout} className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors" aria-label="Logout" title="Logout">
                    <LogoutIcon className="w-6 h-6" />
                 </button>
              </div>
          </header>

          {/* Mobile Storehouse Location Bar */}
          <div className="md:hidden bg-zinc-50 dark:bg-zinc-800/90 border-b border-zinc-200 dark:border-zinc-700 px-3 py-1.5 flex items-center justify-between gap-2 shadow-xs flex-shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 min-w-0">
              <BuildingStoreIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="truncate">Storehouse:</span>
            </div>
            <select
              aria-label="Select Storehouse"
              value={activeLocation}
              onChange={(e) => handleSelectActiveLocation(e.target.value)}
              className="text-xs font-semibold bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[210px] truncate"
            >
              <option value="All">All Locations (Company-Wide)</option>
              {displayLocations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>

          {/* --- Toast Notifications Container --- */}
          <div aria-live="assertive" className="fixed inset-0 flex items-start px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-[10001] toast-notifications-container">
            <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
              {toasts.map((toast) => {
                  const isExiting = toast.status === 'exiting';
                  return (
                      <div
                          key={toast.id}
                          id={`toast-${toast.id}`}
                          onAnimationEnd={() => {
                              if (isExiting) {
                                  setToasts(prev => prev.filter(t => t.id !== toast.id));
                              }
                          }}
                          className={`max-w-sm w-full bg-white dark:bg-zinc-800 shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden ${isExiting ? 'animate-toast-out' : 'animate-toast-in-right'}`}
                      >
                          <div className="p-4">
                              <div className="flex items-start">
                                  <div className="flex-shrink-0">
                                      {toast.type === 'success' ? (
                                          <CheckCircleIcon className="h-6 w-6 text-green-400" aria-hidden="true" />
                                      ) : (
                                          <XCircleIcon className="h-6 w-6 text-red-400" aria-hidden="true" />
                                      )}
                                  </div>
                                  <div className="ml-3 w-0 flex-1 pt-0.5">
                                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{toast.message}</p>
                                      {toast.barcode && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 font-mono">{toast.barcode}</p>}
                                  </div>
                                  <div className="ml-4 flex-shrink-0 flex">
                                    <button
                                        type="button"
                                        className="bg-white dark:bg-zinc-800 rounded-md inline-flex text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800"
                                        onClick={() => dismissToast(toast.id)}
                                    >
                                        <span className="sr-only">Close</span>
                                        <XIcon className="h-5 w-5" aria-hidden="true" />
                                    </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  );
              })}
            </div>
          </div>

          
          {isOffline && (
              <div className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-semibold flex items-center justify-center gap-2 flex-shrink-0 shadow-sm z-40 relative w-full">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  Offline Mode: Changes will be saved locally and synced when connection is restored.
              </div>
          )}
          {showOnlineRestored && !isOffline && (
              <div className="bg-emerald-500 text-white text-center py-2 px-4 text-sm font-semibold flex items-center justify-center gap-2 flex-shrink-0 shadow-sm transition-all duration-500 z-40 relative w-full">
                  <CheckCircleIcon className="w-4 h-4" />
                  Connection Restored: Syncing changes...
              </div>
          )}

          {/* --- MAIN CONTENT --- */}
          <main className="flex-1 overflow-y-auto pb-32 md:pb-0 relative">
               {error && (
                 <div className="m-4 sm:m-6 lg:m-8 p-4 bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-500/50 text-red-700 dark:text-red-300 rounded-md relative" role="alert">
                   <strong className="font-bold">Error:</strong>
                   <span className="block sm:inline ml-2">{error}</span>
                   <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3" aria-label="Close">
                     <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                   </button>
                 </div>
               )}
               
               {successMessage && (
                  <div className="m-4 sm:m-6 lg:m-8 p-4 bg-green-100 dark:bg-green-900/20 border border-green-400 dark:border-green-500/50 text-green-700 dark:text-green-300 rounded-md" role="status">
                      {successMessage}
                  </div>
               )}

              {currentView === View.SCAN && (
                  <>
                      <div 
                        className={`fixed inset-0 z-[9998] transition-opacity duration-200 ease-in-out pointer-events-none ${scanFlash.active ? 'opacity-100' : 'opacity-0'} ${scanFlash.type === 'success' ? 'bg-green-500/30' : 'bg-red-500/30'}`} 
                      />
                      {scannerPreference === 'camera' ? (
                          <Scanner
                              onScanSuccess={handleScanSuccess}
                              onScanError={handleScanError}
                              onCancel={handleCancelScan}
                              persistent={scanMode === 'out-rapid' || scanMode === 'return-rapid' || scanMode === 'return-quantity' || scanMode === 'out-batch' || scanMode === 'return-batch'}
                          />
                      ) : (
                          <ExternalScannerPage
                              onScanSuccess={handleScanSuccess}
                              onCancel={handleCancelScan}
                              persistent={scanMode === 'out-rapid' || scanMode === 'return-rapid' || scanMode === 'return-quantity' || scanMode === 'out-batch' || scanMode === 'return-batch'}
                          />
                      )}
                      
                      {scanMode && scanMode.startsWith('return-') && (
                        <div className="fixed inset-x-0 top-0 z-[10000] p-4 sm:p-6 pointer-events-none flex justify-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.5rem)' }}>
                            <div className="pointer-events-auto bg-zinc-900/95 backdrop-blur-xl shadow-xl rounded-full p-1 flex border border-zinc-700/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)]">
                                <button
                                    onClick={() => setScanMode('return-batch')}
                                    className={`px-4 sm:px-5 py-2 rounded-full text-xs font-bold transition-all ${scanMode === 'return-batch' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                                >
                                    Scan & Confirm
                                </button>
                                <button
                                    onClick={() => { setScanMode('return-rapid'); setRapidScanSummary({}); }}
                                    className={`px-4 sm:px-5 py-2 rounded-full text-xs font-bold transition-all ${scanMode === 'return-rapid' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                                >
                                    Rapid
                                </button>
                                <button
                                    onClick={() => setScanMode('return-quantity')}
                                    className={`px-4 sm:px-5 py-2 rounded-full text-xs font-bold transition-all ${scanMode === 'return-quantity' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                                >
                                    Quantity
                                </button>
                            </div>
                        </div>
                      )}
                      
                      {(scanMode === 'out-rapid' || scanMode === 'return-rapid' || scanMode === 'return-quantity') && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 sm:p-6 pb-safe-bottom pointer-events-none flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
                          
                          {(scanMode === 'out-rapid' || scanMode === 'return-rapid') && (
                              <RapidScanSummary summary={rapidScanSummary} className="mb-1" />
                          )}

                          <div className="w-full max-w-sm mx-auto p-2.5 bg-zinc-900/95 backdrop-blur-xl pointer-events-auto shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl flex justify-between items-center border border-zinc-700/50">
                            <div className="flex flex-col px-2 overflow-hidden">
                              <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold leading-tight mb-0.5">{scanMode && scanMode.startsWith('return') ? 'Returning from' : 'Assigning to'}</p>
                              <p className="font-bold text-white text-sm leading-tight truncate">{scanMode && scanMode.startsWith('return') ? returnContext.team : assignmentContext.team}</p>
                            </div>
                            <button 
                              onClick={handleCancelScan}
                              className="shrink-0 ml-3 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center gap-1.5"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                              Finish
                            </button>
                          </div>
                        </div>
                      )}

                      {scanMode === 'return-batch' && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-3 sm:p-4 pb-safe-bottom pointer-events-none flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
                          <div className="w-full max-w-lg mx-auto bg-zinc-900/95 backdrop-blur-xl pointer-events-auto shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-4 border border-zinc-700/60 text-white flex flex-col gap-3">
                            
                            {/* Header row */}
                            <div className="flex justify-between items-center border-b border-zinc-700/50 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Returning From:</span>
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-600 text-white">{returnContext.team}</span>
                                </div>
                                <span className="text-[11px] text-zinc-400">Into: {(returnContext.location && returnContext.location !== 'All') ? returnContext.location : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))} &bull; 💡 Scan team code anytime to switch</span>
                              </div>
                              <span className="text-xs font-mono font-bold px-2.5 py-1 bg-zinc-800 rounded-full border border-zinc-700 text-purple-400">
                                {stagedReturnTotalCount} unit{stagedReturnTotalCount !== 1 ? 's' : ''} ({stagedReturnItems.length} types)
                              </span>
                            </div>

                            {/* Staged items preview list */}
                            {stagedReturnItems.length === 0 ? (
                              <div className="py-4 text-center text-xs text-zinc-400">
                                <span>No items scanned yet. Scan barcodes to stage returns from <strong>{returnContext.team}</strong>.</span>
                              </div>
                            ) : (
                              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 divide-y divide-zinc-800">
                                {stagedReturnItems.map((item) => (
                                  <div key={item.id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2 text-xs">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-semibold text-zinc-100 truncate">{item.name}</p>
                                      <p className="text-[10px] text-zinc-400 font-mono truncate">{item.barcode}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {!item.isUnique ? (
                                        <div className="flex items-center gap-1 bg-zinc-800 px-1 py-0.5 rounded-lg border border-zinc-700">
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleUpdateStagedReturnQuantity(item.id, -1);
                                            }}
                                            disabled={item.quantity <= 1}
                                            className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-300 hover:text-white rounded bg-zinc-700/60 hover:bg-zinc-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-sm font-bold touch-manipulation select-none"
                                            title="Decrease quantity"
                                          >
                                            -
                                          </button>
                                          <span className="font-mono font-bold px-1.5 text-zinc-100 min-w-[20px] text-center select-none">
                                            {item.quantity}{item.availableCount ? `/${item.availableCount}` : ''}
                                          </span>
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleUpdateStagedReturnQuantity(item.id, 1);
                                            }}
                                            disabled={typeof item.availableCount === 'number' && item.quantity >= item.availableCount}
                                            className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-300 hover:text-white rounded bg-zinc-700/60 hover:bg-zinc-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-sm font-bold touch-manipulation select-none"
                                            title={typeof item.availableCount === 'number' && item.quantity >= item.availableCount ? `Max quantity (${item.availableCount}) reached` : 'Increase quantity'}
                                          >
                                            +
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                                          Unique
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        tabIndex={-1}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleRemoveStagedReturnItem(item.id);
                                        }}
                                        className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors touch-manipulation"
                                        title="Remove item"
                                      >
                                        <TrashIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={handleCancelScan}
                                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={stagedReturnTotalCount === 0}
                                onClick={() => setIsReturnBatchConfirmModalOpen(true)}
                                className="flex-1 px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-1.5"
                              >
                                <CheckCircleIcon className="w-4 h-4" />
                                <span>Review & Confirm Return ({stagedReturnTotalCount})</span>
                              </button>
                            </div>

                          </div>
                        </div>
                      )}

                      {scanMode === 'out-batch' && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-3 sm:p-4 pb-safe-bottom pointer-events-none flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
                          <div className="w-full max-w-lg mx-auto bg-zinc-900/95 backdrop-blur-xl pointer-events-auto shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-4 border border-zinc-700/60 text-white flex flex-col gap-3">
                            
                            {/* Header row */}
                            <div className="flex justify-between items-center border-b border-zinc-700/50 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Signing Out To:</span>
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-600 text-white">{assignmentContext.team}</span>
                                </div>
                                <span className="text-[11px] text-zinc-400">From: {assignmentContext.location} &bull; 💡 Scan team code anytime to switch</span>
                              </div>
                              <span className="text-xs font-mono font-bold px-2.5 py-1 bg-zinc-800 rounded-full border border-zinc-700 text-blue-400">
                                {stagedTotalCount} unit{stagedTotalCount !== 1 ? 's' : ''} ({stagedBatchItems.length} types)
                              </span>
                            </div>

                            {/* Staged items preview list */}
                            {stagedBatchItems.length === 0 ? (
                              <div className="py-4 text-center text-xs text-zinc-400">
                                <span>No items scanned yet. Scan barcodes to stage them for <strong>{assignmentContext.team}</strong>.</span>
                              </div>
                            ) : (
                              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 divide-y divide-zinc-800">
                                {stagedBatchItems.map((item) => (
                                  <div key={item.id} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2 text-xs">
                                    <div className="min-w-0 flex-1">
                                      <p className="font-semibold text-zinc-100 truncate">{item.name}</p>
                                      <p className="text-[10px] text-zinc-400 font-mono truncate">{item.barcode}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {!item.isUnique ? (
                                        <div className="flex items-center gap-1 bg-zinc-800 px-1 py-0.5 rounded-lg border border-zinc-700">
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleUpdateStagedQuantity(item.id, -1);
                                            }}
                                            className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-300 hover:text-white rounded bg-zinc-700/60 hover:bg-zinc-700 active:scale-95 transition-all text-sm font-bold touch-manipulation select-none"
                                            title="Decrease quantity"
                                          >
                                            -
                                          </button>
                                          <span className="font-mono font-bold px-1.5 text-zinc-100 min-w-[20px] text-center select-none">{item.quantity}</span>
                                          <button
                                            type="button"
                                            tabIndex={-1}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleUpdateStagedQuantity(item.id, 1);
                                            }}
                                            className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-300 hover:text-white rounded bg-zinc-700/60 hover:bg-zinc-700 active:scale-95 transition-all text-sm font-bold touch-manipulation select-none"
                                            title="Increase quantity"
                                          >
                                            +
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                                          Unique
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        tabIndex={-1}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleRemoveStagedItem(item.id);
                                        }}
                                        className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors touch-manipulation"
                                        title="Remove item"
                                      >
                                        <TrashIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={handleCancelScan}
                                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={stagedTotalCount === 0}
                                onClick={() => setIsBatchConfirmModalOpen(true)}
                                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-1.5"
                              >
                                <CheckCircleIcon className="w-4 h-4" />
                                <span>Review & Confirm Sign Out ({stagedTotalCount})</span>
                              </button>
                            </div>

                          </div>
                        </div>
                      )}
                  </>
              )}

               {currentView !== View.SCAN && (
                  <div key={currentView} className="container mx-auto animate-fade-in">
                    {currentView === View.LIST && (
                      <Page 
                        title={viewConfig[currentView].title}
                        actions={
                          <button 
                              onClick={refetchStock} 
                              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-md shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-sm font-medium text-zinc-700 dark:text-zinc-300"
                              title="Refresh Dashboard"
                          >
                              <RefreshIcon className={`w-4 h-4 ${stockLoading ? 'animate-spin text-blue-500' : ''}`} />
                              <span className="hidden sm:inline">Refresh</span>
                          </button>
                        }
                      >
                        {stockLoading ? (
                           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                              <StatCardSkeleton />
                              <StatCardSkeleton />
                              <StatCardSkeleton />
                              <StatCardSkeleton />
                           </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                              <StatCard 
                                  title="Total Items In Stock" 
                                  value={stockSummary.totalItems} 
                                  subtitle={activeLocation !== 'All' ? `${stockSummary.companyTotalItems} Entire Company` : null}
                                  icon={<BoxIcon className="w-6 h-6 text-white"/>} 
                                  colorClass="bg-blue-500" 
                              />
                              <StatCard 
                                  title="Item Types In Stock" 
                                  value={stockSummary.itemTypesCount} 
                                  subtitle={activeLocation !== 'All' ? `${stockSummary.companyItemTypesCount} Entire Company` : null}
                                  icon={<TagIcon className="w-6 h-6 text-white"/>} 
                                  colorClass="bg-green-500" 
                              />
                              <StatCard 
                                  title="Items Assigned Out" 
                                  value={stockSummary.itemsAssigned} 
                                  subtitle={activeLocation !== 'All' ? `${stockSummary.companyItemsAssigned} Entire Company` : null}
                                  icon={<UsersIcon className="w-6 h-6 text-white"/>} 
                                  colorClass="bg-yellow-500" 
                              />
                              {isAdminProfile && (
                                <StatCard 
                                    title="In-Stock Value" 
                                    value={new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(totalInventoryValue)} 
                                    subtitle={activeLocation !== 'All' ? `${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(companyInventoryValue)} Entire Company` : null}
                                    icon={<CurrencyPoundIcon className="w-6 h-6 text-white"/>} 
                                    colorClass="bg-indigo-500" 
                                />
                              )}
                          </div>
                        )}
                        
                        {activeLocation !== 'All' && (
                          <div className="mb-4 p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-2 text-sm text-blue-900 dark:text-blue-200 shadow-xs">
                            <BuildingStoreIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            <span>Showing stock stored at <strong>{activeLocation}</strong> ({filteredStock.length} items here &bull; <strong>{stockSummary.companyTotalItems}</strong> held company-wide)</span>
                          </div>
                        )}
                        <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                            <div className="p-4 md:p-6 border-b border-zinc-200 dark:border-zinc-700">
                                <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
                                  <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Current Stock</h2>
                                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    {activeLocation === 'All' ? "All Storehouses (Entire Company)" : `Storehouse: ${activeLocation}`}
                                  </span>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                                    <div className="md:col-span-8">
                                        <label htmlFor="stock-search" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Search Inventory & Part Numbers</label>
                                        <div className="relative mt-1">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                                                <SearchIcon className="h-4 w-4" />
                                            </div>
                                            <input 
                                                id="stock-search"
                                                type="text"
                                                placeholder="Search by item name, barcode, serial, supplier, or supplier part number..."
                                                value={stockSearchTerm}
                                                onChange={(e) => setStockSearchTerm(e.target.value)}
                                                className={`${formInputStyle} !mt-0 pl-9 pr-9 text-sm py-2`}
                                            />
                                            {stockSearchTerm && (
                                                <button
                                                    type="button"
                                                    onClick={() => setStockSearchTerm('')}
                                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                                    title="Clear search"
                                                >
                                                    <XIcon className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="md:col-span-4">
                                        <label htmlFor="filter-location" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Filter Location</label>
                                        <select 
                                            id="filter-location" 
                                            name="location" 
                                            value={dashboardFilters.location} 
                                            onChange={(e) => handleSelectActiveLocation(e.target.value)}
                                            className={`${formInputStyle} mt-1 text-sm py-2`}
                                        >
                                            <option value="All">All Locations (Entire Company)</option>
                                            {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            {stockLoading ? (
                                <StockItemGroupSkeleton />
                            ) : (
                                <div className="space-y-2 p-2 md:p-4">
                                    {Object.keys(groupedStock).length > 0 ? Object.entries(groupedStock).map(([name, items]) => {
                                        const groupValue = stockGroupValues[name] || 0;
                                        const details = itemTypeDetailsMap[name];
                                        const threshold = details ? details.threshold : 0;
                                        const indicator = getStockLevelIndicator(items.length, threshold);

                                        const isPaginated = items.length > ITEMS_PER_PAGE;
                                        const currentPage = currentPageByGroup[name] || 1;
                                        const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
                                        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                                        const paginatedItems = isPaginated ? items.slice(startIndex, startIndex + ITEMS_PER_PAGE) : items;

                                        const totalCompanyCount = companyStockByName[name] || items.length;
                                        const locationBreakdown = companyStockByLocationAndName[name] || {};
                                        const itemTypeObj = itemTypes.find(it => it.name === name);
                                        const typeSupplierParts = supplierPartNumbersByItemTypeName[name] || (itemTypeObj ? (supplierPartNumbersByItemTypeId[itemTypeObj.id] || []) : []);

                                        return (
                                        <div key={name} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                            <button onClick={() => setExpandedGroup(expandedGroup === name ? null : name)} className="w-full flex justify-between items-center p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                                <div className="flex items-center min-w-0 flex-1 mr-3">
                                                    {indicator && (
                                                      <span 
                                                          className={`flex-shrink-0 w-3 h-3 rounded-full mr-3 ${indicator.color}`} 
                                                          title={indicator.label}
                                                          aria-label={indicator.label}
                                                      ></span>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <h3 className="font-semibold text-zinc-800 dark:text-zinc-100 truncate">{name}</h3>
                                                        <div className="flex items-center flex-wrap gap-x-2 text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                            <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                                              {items.length} {activeLocation === 'All' ? 'in stock (Company-Wide Total)' : `at ${activeLocation}`}
                                                            </span>
                                                            {activeLocation !== 'All' && (
                                                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-600">
                                                                {totalCompanyCount} Total Company-Wide
                                                              </span>
                                                            )}
                                                            <span className="text-zinc-300 dark:text-zinc-600 hidden sm:inline">&bull;</span>
                                                            <span className="hidden sm:inline">Threshold: {threshold}</span>
                                                            {isAdminProfile && groupValue > 0 && (
                                                                <>
                                                                    <span className="text-zinc-300 dark:text-zinc-600">&bull;</span>
                                                                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                                                                        {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(groupValue)}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>

                                                        {/* Supplier Part Numbers Badges */}
                                                        {typeSupplierParts.length > 0 && (
                                                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 flex items-center gap-1">
                                                              <TagIcon className="w-3 h-3" />
                                                              Supplier Part Nos:
                                                            </span>
                                                            {typeSupplierParts.map(sp => {
                                                              const searchLower = (stockSearchTerm || '').trim().toLowerCase();
                                                              const isMatch = searchLower && (
                                                                (sp.part_number && sp.part_number.toLowerCase().includes(searchLower)) ||
                                                                (sp.supplier_name && sp.supplier_name.toLowerCase().includes(searchLower)) ||
                                                                (sp.suppliers?.name && sp.suppliers.name.toLowerCase().includes(searchLower))
                                                              );
                                                              return (
                                                                <span
                                                                  key={sp.id}
                                                                  className={`text-[11px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 transition-all ${
                                                                    isMatch
                                                                      ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 border-amber-400 dark:border-amber-600 font-bold ring-1 ring-amber-400'
                                                                      : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                                  }`}
                                                                  title={`Supplier: ${sp.suppliers?.name || sp.supplier_name || 'Standard'}`}
                                                                >
                                                                  <span className="font-sans font-semibold text-[10px] text-zinc-500 dark:text-zinc-400">{sp.suppliers?.name || sp.supplier_name || 'Part'}:</span>
                                                                  <span>{sp.part_number}</span>
                                                                </span>
                                                              );
                                                            })}
                                                          </div>
                                                        )}

                                                        {/* Location breakdown badges */}
                                                        {Object.keys(locationBreakdown).length > 0 && (
                                                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                            {Object.entries(locationBreakdown).map(([loc, count]) => {
                                                              const isCurrentScope = activeLocation !== 'All' && loc === activeLocation;
                                                              return (
                                                                <span 
                                                                  key={loc} 
                                                                  className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                                                                    isCurrentScope 
                                                                      ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700 font-bold' 
                                                                      : 'bg-zinc-100 dark:bg-zinc-700/60 text-zinc-600 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-700'
                                                                  }`}
                                                                >
                                                                  <span>{loc}:</span>
                                                                  <strong className={isCurrentScope ? 'text-blue-700 dark:text-blue-300' : ''}>{count}</strong>
                                                                </span>
                                                              );
                                                            })}
                                                          </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform flex-shrink-0 ${expandedGroup === name ? 'rotate-180' : ''}`} />
                                            </button>
                                            {expandedGroup === name && (
                                                <div className="bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-700">
                                                    <div className="overflow-x-auto">
                                                        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                                            <thead className="bg-zinc-100 dark:bg-zinc-800">
                                                                <tr>
                                                                    <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Serial Number</th>
                                                                    <th scope="col" className="hidden md:table-cell px-4 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Location</th>
                                                                    <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                                                                {paginatedItems.map(item => (
                                                                    <tr key={item.id}>
                                                                        <td className="px-4 py-3 whitespace-nowrap">
                                                                            <div className="text-sm font-mono text-zinc-900 dark:text-zinc-100">{item.barcode}</div>
                                                                            <div className="text-xs text-zinc-500 dark:text-zinc-400 md:hidden mt-0.5">{item.location}</div>
                                                                        </td>
                                                                        <td className="hidden md:table-cell px-4 py-3 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{item.location}</td>
                                                                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                                                          <div className="flex justify-end items-center space-x-2">
                                                                            <button 
                                                                                onClick={() => {
                                                                                    setScannedItem(item);
                                                                                    setAssignment({ location: item.location, team: item.assigned_to });
                                                                                }}
                                                                                className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                                                                aria-label={`Assign item ${item.barcode}`}
                                                                                title="Assign Item"
                                                                            >
                                                                                <ArrowRightCircleIcon className="w-4 h-4" />
                                                                            </button>
                                                                            {isAdminProfile && (
                                                                              <button 
                                                                                  onClick={() => handleDeleteStockItem(item)}
                                                                                  className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                                                                  aria-label={`Delete item ${item.barcode}`}
                                                                                  title="Delete Item"
                                                                              >
                                                                                  <TrashIcon className="w-4 h-4" />
                                                                              </button>
                                                                            )}
                                                                          </div>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    {isPaginated && (
                                                      <div className="px-4 py-3 flex items-center justify-between border-t border-zinc-200 dark:border-zinc-700">
                                                          <button
                                                              onClick={() => handlePageChange(name, currentPage - 1)}
                                                              disabled={currentPage === 1}
                                                              className="px-3 py-1 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-600"
                                                          >
                                                              Previous
                                                          </button>
                                                          <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                                              Page {currentPage} of {totalPages}
                                                          </span>
                                                          <button
                                                              onClick={() => handlePageChange(name, currentPage + 1)}
                                                              disabled={currentPage === totalPages}
                                                              className="px-3 py-1 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-600"
                                                          >
                                                              Next
                                                          </button>
                                                      </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}) : (
                                        <EmptyState 
                                          icon={<BoxIcon />}
                                          title="No Stock Items Found"
                                          message="Your stock is currently empty. Add your first item to get started."
                                          action={
                                            <button
                                              onClick={() => navigateTo(View.ADD_ITEM)}
                                              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800"
                                            >
                                              <AddIcon className="-ml-1 mr-2 h-5 w-5" />
                                              Add First Item
                                            </button>
                                          }
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                      </Page>
                    )}

                    {currentView === View.ASSIGNMENTS && isAdminProfile && (
                      <Page title={viewConfig[currentView].title}>
                          <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                              <div className="p-4 md:p-6 border-b border-zinc-200 dark:border-zinc-700">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                                      <div>
                                          <label htmlFor="filter-team" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Filter by Team</label>
                                          <select 
                                              id="filter-team" 
                                              name="team"
                                              value={assignmentFilters.team}
                                              onChange={(e) => setAssignmentFilters(prev => ({...prev, team: e.target.value}))}
                                              className={`${formInputStyle} mt-1 text-sm py-2`}
                                          >
                                              <option value="All">All Teams</option>
                                              {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                                          </select>
                                      </div>
                                      <div>
                                          <label htmlFor="filter-item-type" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Filter by Item Type</label>
                                          <select 
                                              id="filter-item-type" 
                                              name="itemType"
                                              value={assignmentFilters.itemType}
                                              onChange={(e) => setAssignmentFilters(prev => ({...prev, itemType: e.target.value}))}
                                              className={`${formInputStyle} mt-1 text-sm py-2`}
                                          >
                                              <option value="All">All Item Types</option>
                                              {itemTypes.map(type => <option key={type.id} value={type.name}>{type.name}</option>)}
                                          </select>
                                      </div>
                                      <div>
                                          <label htmlFor="filter-location" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Filter by Location</label>
                                          <select 
                                              id="filter-location" 
                                              name="location"
                                              value={assignmentFilters.location}
                                              onChange={(e) => setAssignmentFilters(prev => ({...prev, location: e.target.value}))}
                                              className={`${formInputStyle} mt-1 text-sm py-2`}
                                          >
                                              <option value="All">All Locations</option>
                                              {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                                          </select>
                                      </div>
                                      <div className="flex items-center pt-5">
                                        <label htmlFor="assigned-by-me-toggle" className="relative inline-flex items-center cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                id="assigned-by-me-toggle" 
                                                className="sr-only peer" 
                                                checked={assignmentFilters.assignedByMe}
                                                onChange={(e) => setAssignmentFilters(prev => ({...prev, assignedByMe: e.target.checked}))}
                                            />
                                            <div className="w-11 h-6 bg-zinc-200 dark:bg-zinc-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 dark:after:border-zinc-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                            <span className="ml-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Assigned by me</span>
                                        </label>
                                      </div>
                                      <div className="flex justify-start lg:justify-end space-x-2">
                                          <button 
                                              onClick={handleOpenBatchReturn}
                                              className="w-full lg:w-auto px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors text-sm font-medium flex items-center justify-center whitespace-nowrap"
                                          >
                                              Batch Return
                                          </button>
                                          <button 
                                              onClick={() => setAssignmentFilters({ team: 'All', itemType: 'All', location: 'All', assignedByMe: false })}
                                              className="w-full lg:w-auto px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
                                          >
                                              Clear Filters
                                          </button>
                                      </div>
                                  </div>
                              </div>
                              {stockLoading ? (
                                  <ListItemSkeleton count={5} />
                              ) : (
                                  <div>
                                      <div className="md:hidden">
                                          {groupedAssignedStock.length > 0 ? (
                                              <div className="space-y-4 p-4">
                                                  {groupedAssignedStock.map(item => (
                                                      <div key={item.id} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 p-4">
                                                          <div>
                                                              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</p>
                                                              {item.quantity > 1 ? (
                                                                <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">{item.quantity} items</p>
                                                              ) : (
                                                                <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">{item.barcodes[0]}</p>
                                                              )}
                                                          </div>
                                                          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                                                              <div className="flex justify-between">
                                                                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Assigned To:</span>
                                                                  <span>{item.assigned_to}</span>
                                                              </div>
                                                              <div className="flex justify-between">
                                                                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Assigned By:</span>
                                                                  <span>{item.assigned_by || 'N/A'}</span>
                                                              </div>
                                                              <div className="flex justify-between">
                                                                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Date:</span>
                                                                  <span className="text-right">{item.assigned_at ? new Date(item.assigned_at).toLocaleString() : 'N/A'}</span>
                                                              </div>
                                                              {item.quantity > 1 && (
                                                                <div className="pt-2">
                                                                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Barcodes:</span>
                                                                  <p className="text-xs text-zinc-400 mt-1">{item.barcodes.slice(0, 5).join(', ')}{item.barcodes.length > 5 ? '...' : ''}</p>
                                                                </div>
                                                              )}
                                                          </div>
                                                          <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-700 flex justify-end space-x-2">
                                                              <button
                                                                  onClick={() => handleReturnToStock(item)}
                                                                  className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-medium rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                                              >
                                                                  Return to Stock
                                                              </button>
                                                              {isAdminProfile && (
                                                                <button 
                                                                    onClick={() => handleDeleteStockItem(item)}
                                                                    className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm font-medium rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                                                    aria-label={`Delete item ${item.barcodes[0]}`}
                                                                    title="Delete Item"
                                                                >
                                                                    Delete
                                                                </button>
                                                              )}
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          ) : (
                                              <EmptyState 
                                                  icon={<ArchiveIcon />}
                                                  title="No Assigned Items"
                                                  message="No items are currently assigned out. Scan an item to assign it to a team."
                                              />
                                          )}
                                      </div>
                                      <div className="hidden md:block overflow-x-auto">
                                          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                              <thead className="bg-zinc-50 dark:bg-zinc-800">
                                                  <tr>
                                                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item Details</th>
                                                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Qty</th>
                                                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Assigned To</th>
                                                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Assigned By</th>
                                                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Date Assigned</th>
                                                      <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                                                  </tr>
                                              </thead>
                                              <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                                                  {groupedAssignedStock.length > 0 ? groupedAssignedStock.map(item => (
                                                      <tr key={item.id}>
                                                          <td className="px-6 py-4 whitespace-nowrap">
                                                              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.name}</div>
                                                              <div className="text-sm text-zinc-500 dark:text-zinc-400 font-mono" title={item.barcodes.join(', ')}>
                                                                {item.quantity === 1 ? item.barcodes[0] : `${item.barcodes.slice(0, 3).join(', ')}${item.barcodes.length > 3 ? '...' : ''}`}
                                                              </div>
                                                          </td>
                                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-900 dark:text-zinc-100 font-medium">
                                                              {item.quantity}
                                                          </td>
                                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{item.assigned_to}</td>
                                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{item.assigned_by || 'N/A'}</td>
                                                          <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                                                              {item.assigned_at ? new Date(item.assigned_at).toLocaleString() : 'N/A'}
                                                          </td>
                                                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                            <div className="flex justify-end items-center space-x-3">
                                                              <button 
                                                                  onClick={() => handleReturnToStock(item)}
                                                                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                                              >
                                                                  Return to Stock
                                                              </button>
                                                              {isAdminProfile && (
                                                                <button 
                                                                    onClick={() => handleDeleteStockItem(item)}
                                                                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors flex items-center"
                                                                    title="Delete Item"
                                                                >
                                                                    <TrashIcon className="w-4 h-4" />
                                                                </button>
                                                              )}
                                                            </div>
                                                          </td>
                                                      </tr>
                                                  )) : (
                                                      <tr>
                                                          <td colSpan="5">
                                                              <EmptyState 
                                                                  icon={<ArchiveIcon />}
                                                                  title="No Assigned Items Found"
                                                                  message="Your filter combination returned no results. Try clearing the filters."
                                                              />
                                                          </td>
                                                      </tr>
                                                  )}
                                              </tbody>
                                          </table>
                                      </div>
                                  </div>
                              )}
                          </div>
                      </Page>
                    )}

                    {currentView === View.ADD_ITEM && (
                      <Page title={viewConfig[currentView].title}>
                        <div className="max-w-3xl mx-auto">
                          <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                            <form onSubmit={handleAddItem}>
                              <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <label htmlFor="name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Type</label>
                                    <SearchableSelect
                                      options={groupedItemTypes}
                                      value={newItem.name}
                                      onChange={handleNewItemChange}
                                      loading={itemTypesLoading}
                                      placeholder={itemTypesLoading ? 'Loading types...' : 'Select an item type'}
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor="new-item-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                      Storehouse / Location <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                      id="new-item-location"
                                      name="location"
                                      value={newItem.location || (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))}
                                      onChange={handleNewItemChange}
                                      className={formInputStyle}
                                      required
                                    >
                                      {displayLocations.map(loc => (
                                        <option key={loc} value={loc}>{loc}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label htmlFor="description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description (Optional)</label>
                                  <textarea name="description" id="description" rows={3} className={formInputStyle} value={newItem.description} onChange={handleNewItemChange}></textarea>
                                </div>
                                
                                {selectedItemType ? (
                                  selectedItemType.is_unique ? (
                                    <div className="pt-6 border-t border-zinc-200 dark:border-zinc-700">
                                      <button type="button" onClick={() => setIsSerialsExpanded(!isSerialsExpanded)} className="w-full flex justify-between items-center text-left py-2">
                                          <div>
                                              <h3 className="text-lg font-medium leading-6 text-zinc-900 dark:text-white">Serial Numbers</h3>
                                              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">This is a unique item. Add individuals by range or list.</p>
                                          </div>
                                          <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform ${isSerialsExpanded ? 'rotate-180' : ''}`} />
                                      </button>
                                      
                                      {isSerialsExpanded && (
                                        <div className="mt-4 animate-fade-in">
                                          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                                            <button
                                              type="button"
                                              onClick={() => setAddMode('range')}
                                              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${addMode === 'range' ? 'border-blue-600 text-blue-600 dark:text-blue-500' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
                                            >
                                              Serial Range
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setAddMode('quantity_range')}
                                              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${addMode === 'quantity_range' ? 'border-blue-600 text-blue-600 dark:text-blue-500' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
                                            >
                                              Quantity Range
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setAddMode('list')}
                                              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${addMode === 'list' ? 'border-blue-600 text-blue-600 dark:text-blue-500' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'}`}
                                            >
                                              Enter List
                                            </button>
                                          </div>

                                          <div className="mt-6">
                                            {addMode === 'range' ? (
                                              <div className="grid grid-cols-2 gap-4">
                                                  <div>
                                                      <label htmlFor="firstSerial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">First Serial Number</label>
                                                      <input 
                                                          name="firstSerial" 
                                                          id="firstSerial" 
                                                          className={formInputStyle + " font-mono"}
                                                          placeholder="e.g., H25YU360161"
                                                          value={newItem.firstSerial} 
                                                          onChange={handleNewItemChange} 
                                                          required
                                                      />
                                                  </div>
                                                  <div>
                                                      <label htmlFor="lastSerial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Last Serial Number</label>
                                                      <input 
                                                          name="lastSerial" 
                                                          id="lastSerial" 
                                                          className={formInputStyle + " font-mono"}
                                                          placeholder="e.g., H25YU360170"
                                                          value={newItem.lastSerial} 
                                                          onChange={handleNewItemChange} 
                                                          required
                                                      />
                                                  </div>
                                              </div>
                                            ) : addMode === 'quantity_range' ? (
                                              <div className="grid grid-cols-2 gap-4">
                                                  <div>
                                                      <label htmlFor="firstSerialQty" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">First Serial Number</label>
                                                      <input 
                                                          name="firstSerial" 
                                                          id="firstSerialQty" 
                                                          className={formInputStyle + " font-mono"}
                                                          placeholder="e.g., H25YU360161"
                                                          value={newItem.firstSerial} 
                                                          onChange={handleNewItemChange} 
                                                          required
                                                      />
                                                  </div>
                                                  <div>
                                                      <label htmlFor="quantityQty" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity</label>
                                                      <input 
                                                          type="number"
                                                          min="1"
                                                          name="quantity" 
                                                          id="quantityQty" 
                                                          className={formInputStyle + " font-mono"}
                                                          placeholder="Enter quantity"
                                                          value={newItem.quantity} 
                                                          onChange={handleNewItemChange} 
                                                          required
                                                      />
                                                  </div>
                                              </div>
                                            ) : (
                                              <div>
                                                  <label htmlFor="barcodes" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Serial Numbers</label>
                                                  <textarea 
                                                      name="barcodes" 
                                                      id="barcodes" 
                                                      rows={8} 
                                                      className={formInputStyle + " font-mono"}
                                                      placeholder={"H25YU360161\nH25YU360162\n..."}
                                                      value={newItem.barcodes} 
                                                      onChange={handleNewItemChange} 
                                                      required
                                                  />
                                                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Enter one serial number per line.</p>
                                              </div>
                                            )}
                                          </div>
                                          <AddItemsPreview />
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="pt-6 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
                                      <div>
                                        <label htmlFor="barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Serial Number / Barcode</label>
                                        {existingBarcodesForItemType.length > 0 ? (
                                          <>
                                            <select 
                                              name="barcodeSelection" 
                                              id="barcodeSelection" 
                                              className={formInputStyle}
                                              value={newItemBarcodeSelection} 
                                              onChange={handleNewItemChange}
                                            >
                                              <optgroup label="Existing Barcodes">
                                                {existingBarcodesForItemType.map(bc => <option key={bc} value={bc}>{bc}</option>)}
                                              </optgroup>
                                              <option value="new">-- Use a new barcode --</option>
                                            </select>
                                            {newItemBarcodeSelection === 'new' && (
                                              <input 
                                                name="barcode" 
                                                id="barcode" 
                                                className={`${formInputStyle} mt-2 font-mono`}
                                                placeholder="Enter new barcode"
                                                value={newItem.barcode} 
                                                onChange={handleNewItemChange} 
                                                required
                                              />
                                            )}
                                          </>
                                        ) : (
                                          <input 
                                            name="barcode" 
                                            id="barcode" 
                                            className={formInputStyle + " font-mono"}
                                            placeholder="Enter barcode for this item type"
                                            value={newItem.barcode} 
                                            onChange={handleNewItemChange} 
                                            required
                                          />
                                        )}
                                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                          {existingBarcodesForItemType.length > 0
                                            ? "Select an existing barcode or enter a new one."
                                            : "No existing barcodes found for this type. Please enter one."
                                          }
                                        </p>
                                      </div>
                                      <div>
                                        <label htmlFor="quantity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity</label>
                                        <input 
                                          type="number"
                                          name="quantity" 
                                          id="quantity" 
                                          className={formInputStyle}
                                          placeholder="Enter quantity"
                                          value={newItem.quantity} 
                                          onChange={handleNewItemChange} 
                                          required
                                          min="1"
                                          step="1"
                                        />
                                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">How many of this item are you adding?</p>
                                      </div>
                                    </div>
                                  )
                                ) : (
                                  <div className="pt-6 border-t border-zinc-200 dark:border-zinc-700">
                                     <p className="text-sm text-center text-zinc-500 dark:text-zinc-400 py-4">Select an item type to see options for adding stock.</p>
                                  </div>
                                )}
                              </div>
                              <div className="bg-zinc-50 dark:bg-zinc-800 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                                <button type="button" onClick={handleCancelAddItem} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                                <button type="submit" disabled={isSubmitting || isAddFormInvalid} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[130px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                  {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                                  {isSubmitting ? 'Adding...' : addFormButtonText}
                                </button>
                              </div>
                            </form>
                          </div>
                        </div>
                      </Page>
                    )}

                    {currentView === View.STOCK_TAKE && isAdminProfile && (
                       <StockTakePage 
                           stock={stock} 
                           setStock={setStock} 
                           setError={setError} 
                           logUnrecognizedBarcode={logUnrecognizedBarcode}
                           dbLocations={displayLocations}
                           activeLocation={activeLocation}
                           itemTypes={itemTypes}
                           supplierPartNumbers={supplierPartNumbers}
                           refetchStock={refetchStock}
                       />
                    )}

                    {currentView === View.ADMIN && isAdminProfile && (
                      <Page title={viewConfig[currentView].title}>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            <AdminActionCard 
                              icon={<PurchasingIcon/>}
                              title="Purchasing"
                              description="Create and manage purchase orders for new stock."
                              onClick={() => navigateTo(View.PURCHASING)}
                              buttonText="Manage POs"
                            />
                            <AdminActionCard 
                              icon={<ChartBarIcon/>}
                              title="Reporting"
                              description="Generate and view stock movement reports."
                              onClick={() => navigateTo(View.REPORTING)}
                              buttonText="View Reports"
                            />
                            <AdminActionCard 
                              icon={<ClipboardCheckIcon/>}
                              title="Stock Takes"
                              description="Perform full or rolling stock counts and manage historical reports."
                              onClick={() => navigateTo(View.STOCK_TAKE)}
                              buttonText="Manage Stock Takes"
                            />
                             <AdminActionCard 
                                icon={<TagIcon/>}
                                title="Categories & Sub-Categories"
                                description="Create, edit, rename, and organise item categories and their sub-categories."
                                onClick={() => setIsManageCategoriesModalOpen(true)}
                                buttonText="Manage Categories"
                            />
                            <AdminActionCard 
                                icon={<UsersIcon/>}
                                title="Manage Profiles"
                                description="Add, remove, or edit user profiles and their PINs."
                                onClick={handleOpenProfilesModal}
                                buttonText="Manage Profiles"
                            />
                             <AdminActionCard 
                                icon={<CalculatorIcon/>}
                                title="Automate Stock Thresholds"
                                description="Automatically calculate and update the re-order threshold for all item types based on usage over the last 4 weeks."
                                onClick={handleCalculateThresholds}
                                buttonText={isCalculatingThresholds ? 'Calculating...' : 'Calculate Thresholds'}
                                disabled={isCalculatingThresholds}
                                infoAction={() => setIsThresholdInfoModalOpen(true)}
                            />

                            <div className="md:col-span-2 xl:col-span-3 h-px bg-zinc-200 dark:bg-zinc-700 my-2"></div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                              <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Login Accounts</h2>
                                <button onClick={() => setIsCreateUserModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                  <AddIcon className="w-4 h-4" />
                                  <span>Create Account</span>
                                </button>
                              </div>
                              {usersLoading ? (
                                  <ListItemSkeleton />
                              ) : (
                                <div className="max-h-96 overflow-y-auto">
                                  {users.length > 0 ? (
                                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                        {users.map(user => (
                                            <li key={user.id} className="px-4 py-3">
                                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate" title={user.username}>{user.username}</p>
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate" title={user.email}>{user.email}</p>
                                                    </div>
                                                    <div className="flex-shrink-0 sm:w-32">
                                                        <select
                                                            value={user.role}
                                                            onChange={(e) => updateUserRole(user.id, e.target.value)}
                                                            className={`${formInputStyle} mt-0 w-full py-1 text-sm`}
                                                            disabled={user.id === userProfile.id}
                                                            aria-label={`Role for ${user.username}`}
                                                        >
                                                            <option>User</option>
                                                            <option>Admin</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                    ) : (
                                      <EmptyState icon={<UsersIcon />} title="No Other Users" message="You are the only user. Create new users to grant them access." />
                                    )}
                                </div>
                              )}
                            </div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Item Types</h2>
                                    <button onClick={() => setIsAddItemTypeModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                      <AddIcon className="w-4 h-4" />
                                      <span>Add New</span>
                                    </button>
                                                                </div>
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <SearchIcon className="h-4 w-4 text-zinc-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            placeholder="Search item types or barcode..." 
                                            value={adminItemTypeSearchTerm}
                                            onChange={(e) => setAdminItemTypeSearchTerm(e.target.value)}
                                            className={`${formInputStyle} pl-9 pr-9`}
                                        />
                                        {adminItemTypeSearchTerm && (
                                            <button 
                                                type="button"
                                                onClick={() => setAdminItemTypeSearchTerm('')}
                                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                                title="Clear search"
                                            >
                                                <XIcon className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {itemTypesLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="p-2 md:p-4 space-y-2 max-h-96 overflow-y-auto">
                                    {itemTypes.length > 0 ? Object.entries(groupedItemTypes).map(([category, subGroups]) => (
                                      <div key={category} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                        <button onClick={() => setExpandedItemTypeGroups(prev => ({...prev, [category]: !(prev[category] ?? !!adminItemTypeSearchTerm.trim())}))} className="w-full flex justify-between items-center p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                          <h3 className="font-semibold text-zinc-800 dark:text-zinc-100">{category}</h3>
                                          <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform ${(expandedItemTypeGroups[category] ?? !!adminItemTypeSearchTerm.trim()) ? 'rotate-180' : ''}`} />
                                        </button>
                                        {(expandedItemTypeGroups[category] ?? !!adminItemTypeSearchTerm.trim()) && (
                                          <div className="pl-4 border-t border-zinc-200 dark:border-zinc-700">
                                            {Object.entries(subGroups).map(([subCategory, types]) => (
                                              <div key={subCategory}>
                                                <button onClick={() => setExpandedSubCategory(prev => ({...prev, [`${category}-${subCategory}`]: !(prev[`${category}-${subCategory}`] ?? !!adminItemTypeSearchTerm.trim())}))} className="w-full flex justify-between items-center p-3 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/20">
                                                    <h4 className="font-medium text-zinc-700 dark:text-zinc-300">{subCategory} ({types.length})</h4>
                                                    <ChevronDownIcon className={`w-4 h-4 text-zinc-400 transition-transform ${(expandedSubCategory[`${category}-${subCategory}`] ?? !!adminItemTypeSearchTerm.trim()) ? 'rotate-180' : ''}`} />
                                                </button>
                                                {(expandedSubCategory[`${category}-${subCategory}`] ?? !!adminItemTypeSearchTerm.trim()) && (
                                                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-700">
                                                      {types.map(type => {
                                                           const associatedBarcodes = itemTypeBarcodesMap[type.name] || (type.barcode ? [String(type.barcode)] : []);
                                                           const typeSupplierParts = supplierPartNumbersByItemTypeId[type.id] || [];
                                                           return (
                                                           <li key={type.id} className="px-4 py-3 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
                                                               <div className="flex-1 min-w-0 pr-3">
                                                                   <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                                                                     <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{type.name}</span>
                                                                     {type.is_unique && <span className="text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded-full">Unique</span>}
                                                                     {type.suppliers?.name && <span className="text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300 px-2 py-0.5 rounded-full">{type.suppliers.name}</span>}
                                                                   </div>
                                                                   <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                                                       Price: £{Number(type.price || 0).toFixed(2)} &bull; Threshold: {type.stock_threshold || 0}
                                                                   </span>
                                                                   <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                                       <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 font-medium">
                                                                           <BarcodeIcon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                                                                           Internal Barcodes:
                                                                       </span>
                                                                       {associatedBarcodes.length > 0 ? (
                                                                           associatedBarcodes.map(barcode => {
                                                                               const isSearchMatch = adminItemTypeSearchTerm.trim() && barcode.toLowerCase().includes(adminItemTypeSearchTerm.toLowerCase().trim());
                                                                               return (
                                                                                   <span 
                                                                                       key={barcode} 
                                                                                       className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border transition-all ${
                                                                                           isSearchMatch 
                                                                                               ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600 ring-1 ring-amber-400 font-semibold' 
                                                                                               : 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                                                                       }`}
                                                                                   >
                                                                                       {barcode}
                                                                                   </span>
                                                                               );
                                                                           })
                                                                       ) : (
                                                                           <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">None assigned</span>
                                                                       )}
                                                                   </div>

                                                                   {/* Supplier Part Numbers */}
                                                                   <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                                                       <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 font-medium">
                                                                           <TagIcon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                                                                           Supplier Part Nos:
                                                                       </span>
                                                                       {typeSupplierParts.length > 0 ? (
                                                                           typeSupplierParts.map(sp => {
                                                                               const searchLower = adminItemTypeSearchTerm.trim().toLowerCase();
                                                                               const isSearchMatch = searchLower && (
                                                                                   (sp.part_number && sp.part_number.toLowerCase().includes(searchLower)) ||
                                                                                   (sp.barcode && sp.barcode.toLowerCase().includes(searchLower))
                                                                               );
                                                                               return (
                                                                                   <span
                                                                                       key={sp.id}
                                                                                       className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border transition-all ${
                                                                                           isSearchMatch
                                                                                               ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600 ring-1 ring-amber-400 font-bold'
                                                                                               : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                                                       }`}
                                                                                   >
                                                                                       <span className="font-sans font-semibold text-[10px] text-zinc-500 dark:text-zinc-400">{sp.suppliers?.name || sp.supplier_name || 'Part'}:</span>
                                                                                       <span>{sp.part_number}</span>
                                                                                   </span>
                                                                               );
                                                                           })
                                                                       ) : (
                                                                           <span className="text-xs text-zinc-400 dark:text-zinc-500 italic">None registered</span>
                                                                       )}
                                                                       <button
                                                                           type="button"
                                                                           onClick={() => {
                                                                               setSelectedItemTypeForParts(type);
                                                                               setIsManagePartNumbersModalOpen(true);
                                                                           }}
                                                                           className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline ml-1"
                                                                       >
                                                                           + Manage Part Nos
                                                                       </button>
                                                                   </div>
                                                               </div>
                                                               <div className="flex space-x-1 sm:space-x-2 flex-shrink-0">
                                                                   <button 
                                                                       onClick={() => {
                                                                           setSelectedItemTypeForParts(type);
                                                                           setIsManagePartNumbersModalOpen(true);
                                                                       }} 
                                                                       className="p-2 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" 
                                                                       aria-label="Manage Supplier Part Numbers"
                                                                       title="Manage Supplier Part Numbers"
                                                                   >
                                                                       <TagIcon className="w-4 h-4" />
                                                                   </button>
                                                                   <button onClick={() => {
                                                                       const associated = itemTypeBarcodesMap[type.name] || [];
                                                                       setEditingItemType({
                                                                           ...type,
                                                                           barcode: type.barcode || (associated.length === 1 ? associated[0] : "")
                                                                       });
                                                                   }} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit">
                                                                       <EditIcon className="w-4 h-4" />
                                                                   </button>
                                                                   <button onClick={() => handleDeleteItemType(type)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete">
                                                                       <TrashIcon className="w-4 h-4" />
                                                                   </button>
                                                               </div>
                                                           </li>
                                                       );})}
                            
                                                  </ul>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )) : <EmptyState icon={<TagIcon />} title="No Item Types" message="Create item types to categorise your stock." />}
                                  </div>
                                )}
                            </div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Locations</h2>
                                    <button onClick={() => setIsAddLocationModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                      <AddIcon className="w-4 h-4" />
                                      <span>Add Location</span>
                                    </button>
                                </div>
                                {locationsLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="max-h-96 overflow-y-auto">
                                    {dbLocations.length > 0 ? (
                                      <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                          {dbLocations.map(location => (
                                              <li key={location.id} className="px-4 py-3 flex justify-between items-center">
                                                  <div className="flex-1 min-w-0">
                                                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{location.name}</p>
                                                  </div>
                                                  <div className="flex space-x-2">
                                                      <button onClick={() => setEditingLocation(location)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit Location">
                                                          <EditIcon className="w-4 h-4" />
                                                      </button>
                                                      <button onClick={() => handleDeleteLocation(location)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete Location">
                                                          <TrashIcon className="w-4 h-4" />
                                                      </button>
                                                  </div>
                                              </li>
                                          ))}
                                      </ul>
                                    ) : <div className="p-6 text-center text-zinc-500 dark:text-zinc-400 text-sm">No custom locations. Using hardcoded defaults.</div>}
                                  </div>
                                )}
                            </div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Suppliers</h2>
                                    <button onClick={() => setIsAddSupplierModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                      <AddIcon className="w-4 h-4" />
                                      <span>Add Supplier</span>
                                    </button>
                                                                </div>
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <SearchIcon className="h-4 w-4 text-zinc-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            placeholder="Search suppliers..." 
                                            value={adminSupplierSearchTerm}
                                            onChange={(e) => setAdminSupplierSearchTerm(e.target.value)}
                                            className={`${formInputStyle} pl-9`}
                                        />
                                    </div>
                                </div>
                                {suppliersLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="max-h-96 overflow-y-auto">
                                    {filteredAdminSuppliers.length > 0 ? (
                                      <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                          {filteredAdminSuppliers.map(supplier => {
                                            const itemCount = supplierItemCount[supplier.id] || 0;
                                            const supplierParts = supplierPartNumbersBySupplierId[supplier.id] || [];
                                            const isExpanded = !!expandedSupplierCatalog[supplier.id];
                                            return (
                                              <li key={supplier.id} className="px-4 py-3">
                                                <div className="flex justify-between items-center">
                                                   <div className="flex-1 min-w-0">
                                                       <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{supplier.name}</p>
                                                       <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                         {supplier.contact_person || 'No contact person'} &bull; {itemCount} item{itemCount !== 1 ? 's' : ''} &bull; {supplierParts.length} registered part no{supplierParts.length !== 1 ? 's' : ''}
                                                       </p>
                                                   </div>
                                                   <div className="flex items-center space-x-2">
                                                       {supplierParts.length > 0 && (
                                                         <button
                                                           type="button"
                                                           onClick={() => setExpandedSupplierCatalog(prev => ({ ...prev, [supplier.id]: !prev[supplier.id] }))}
                                                           className="text-xs px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 rounded font-medium transition-colors"
                                                         >
                                                           {isExpanded ? 'Hide Parts' : `View Parts (${supplierParts.length})`}
                                                         </button>
                                                       )}
                                                       <button onClick={() => setEditingSupplier(supplier)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit Supplier">
                                                           <EditIcon className="w-4 h-4" />
                                                       </button>
                                                       <button onClick={() => handleDeleteSupplier(supplier)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete Supplier">
                                                           <TrashIcon className="w-4 h-4" />
                                                       </button>
                                                   </div>
                                                </div>
                                                {isExpanded && supplierParts.length > 0 && (
                                                  <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-700/60 bg-zinc-50/50 dark:bg-zinc-900/30 p-2.5 rounded-md">
                                                    <p className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Supplier Part Catalog:</p>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                      {supplierParts.map(sp => (
                                                        <div key={sp.id} className="p-2 bg-white dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 text-xs">
                                                          <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{sp.item_types?.name || 'Item'}</div>
                                                          <div className="font-mono text-blue-600 dark:text-blue-400 mt-0.5">Part #: {sp.part_number}</div>
                                                          {sp.purchase_price > 0 && <div className="text-zinc-500 dark:text-zinc-400 text-[11px]">Cost: £{Number(sp.purchase_price).toFixed(2)}</div>}
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </li>
                                            )
                                          })}
                                      </ul>
                                    ) : <EmptyState icon={<BuildingStoreIcon />} title="No Suppliers" message="Add your first supplier to assign them to item types." />}
                                  </div>
                                )}
                            </div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center flex-wrap gap-2">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Teams</h2>
                                    <div className="flex items-center gap-2">
                                      <button 
                                        type="button" 
                                        onClick={() => setIsPrintTeamBadgesModalOpen(true)} 
                                        className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-xs sm:text-sm font-medium rounded-md transition-colors flex items-center space-x-1.5"
                                        title="View and print team barcodes"
                                      >
                                        <BarcodeIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                        <span>Team Barcodes</span>
                                      </button>
                                      <button onClick={() => setIsAddTeamModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                        <AddIcon className="w-4 h-4" />
                                        <span>Add Team</span>
                                      </button>
                                    </div>
                                </div>
                                {teamsLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="p-2 md:p-4 space-y-2 max-h-96 overflow-y-auto">
                                    {teams.length > 0 ? Object.entries(groupedTeams).map(([type, teamsOfType]) => (
                                      <div key={type} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                        <button onClick={() => setExpandedTeamGroups(prev => ({...prev, [type]: !prev[type]}))} className="w-full flex justify-between items-center p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                          <h3 className="font-semibold text-zinc-800 dark:text-zinc-100">{type}s ({teamsOfType.length})</h3>
                                          <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform ${expandedTeamGroups[type] ? 'rotate-180' : ''}`} />
                                        </button>
                                        {expandedTeamGroups[type] && (
                                          <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-700">
                                            {teamsOfType.map(team => (
                                                <li key={team.id} className="px-4 py-3 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{team.name}</span>
                                                        {team.barcode ? (
                                                            <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                                                                <BarcodeIcon className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                                {team.barcode}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-zinc-400 italic">No barcode</span>
                                                        )}
                                                    </div>
                                                    <div className="flex space-x-2">
                                                        <button onClick={() => setEditingTeam(team)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit">
                                                            <EditIcon className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => handleDeleteTeam(team)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete">
                                                            <TrashIcon className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    )) : <EmptyState icon={<UsersIcon />} title="No Teams" message="Add teams or surveyors to assign stock to." />}
                                  </div>
                                )}
                            </div>
                        </div>
                      </Page>
                    )}

                     {currentView === View.REPORTING && isAdminProfile && (
                       <ReportingPage
                          teams={teams}
                          dbLocations={dbLocations}
                          filters={reportFilters}
                          setFilters={setReportFilters}
                          reportData={reportData}
                          setReportData={setReportData}
                          loading={reportLoading}
                          setLoading={setReportLoading}
                          itemTypes={itemTypes}
                          stock={stock}
                          setError={setError}
                          setIsPrintInfoModalOpen={setIsPrintInfoModalOpen}
                       />
                     )}
                     {currentView === View.PURCHASING && isAdminProfile && (
                       <PurchasingPage
                          userProfile={userProfile}
                          selectedProfile={selectedProfile}
                          setError={setError}
                          setSuccessMessage={setSuccessMessage}
                          itemTypes={itemTypes}
                          suppliers={suppliers}
                          refetchStock={refetchStock}
                          navigateTo={navigateTo}
                          groupedItemTypes={groupedItemTypes}
                       />
                     )}
                </div>
                )}
          </main>
        </div>

        <footer 
            className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-800 shadow-top pt-2 px-2 md:hidden border-t border-zinc-200 dark:border-zinc-700" 
            style={{ paddingBottom: Capacitor.isNativePlatform() ? 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' : 'env(safe-area-inset-bottom, 0.5rem)' }}
        >
            <nav className="flex">
                <MobileNavItem icon={<ListIcon/>} label="Stock" isActive={currentView === View.LIST} onClick={() => navigateTo(View.LIST)} />
                {isAdminProfile && (
                  <MobileNavItem icon={<ArchiveIcon/>} label="Log" isActive={currentView === View.ASSIGNMENTS} onClick={() => navigateTo(View.ASSIGNMENTS)} />
                )}
                <MobileNavItem icon={<ScanIcon/>} label="Scan" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />
                
                {isAdminProfile && (
                  <MobileNavItem icon={<AdminIcon/>} label="Admin" isActive={[View.ADMIN, View.PURCHASING, View.REPORTING].includes(currentView)} onClick={handleAdminClick} />
                )}
                {syncQueue && syncQueue.length > 0 && (
      <MobileNavItem icon={<div className="relative"><UploadIcon/><span className="absolute -top-1 -right-2 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-red-600 rounded-full">{syncQueue.length}</span></div>} label="Sync Queue" isActive={isQueueModalOpen} onClick={() => setIsQueueModalOpen(true)} />
  )}
  <MobileNavItem icon={<SettingsIcon/>} label="Settings" isActive={isSettingsModalOpen} onClick={() => setIsSettingsModalOpen(true)} />
            </nav>
        </footer>
      </div>

      <Modal isOpen={!!scannedItem} onClose={() => setScannedItem(null)} title="Assign Stock Item">
        {scannedItem && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{scannedItem.name}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{scannedItem.description}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-700 px-2.5 py-1 rounded-md text-zinc-800 dark:text-zinc-200">
                  Serial: {scannedItem.barcode}
                </span>
                <span className="text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800 flex items-center gap-1">
                  <BuildingStoreIcon className="w-3.5 h-3.5" />
                  Stored at: {scannedItem.location || 'Unassigned'}
                </span>
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
               <div>
                 <label htmlFor="location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Storehouse Location</label>
                 <select id="location" value={assignment.location} onChange={(e) => setAssignment(prev => ({ ...prev, location: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                   {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                 </select>
               </div>
               <div>
                 <label htmlFor="team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Assign to Team (or Keep in Store)</label>
                 <select id="team" value={assignment.team} onChange={(e) => setAssignment(prev => ({ ...prev, team: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                   <option value={Team.UNASSIGNED}>{Team.UNASSIGNED} (Remain in Storehouse / Transfer)</option>
                   {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                 </select>
               </div>
            </div>
             <div className="flex justify-end space-x-3 pt-6">
                <button type="button" onClick={() => setScannedItem(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button type="button" onClick={handleAssignmentSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                  {assignment.team !== Team.UNASSIGNED 
                    ? `Sign Out to ${assignment.team}` 
                    : (assignment.location !== scannedItem.location ? `Transfer to ${assignment.location}` : 'Save Changes')}
                </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isReturnSetupModalOpen} onClose={() => setIsReturnSetupModalOpen(false)} title="Return Stock">
        <div className="space-y-4">
            <div>
                <label htmlFor="return-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Returning Team / Surveyor</label>
                <select 
                    id="return-team" 
                    value={returnContext.team} 
                    onChange={(e) => setReturnContext(prev => ({...prev, team: e.target.value}))} 
                    className={`${formInputStyle} py-2.5`}
                >
                    <option value="" disabled>Select a team...</option>
                    {teams.map(team => (
                        <option key={team.id} value={team.name}>
                            {team.name} {team.barcode ? `(Barcode: ${team.barcode})` : ''}
                        </option>
                    ))}
                </select>

                <div className="mt-2.5 flex items-center gap-2">
                    <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-400">
                            <BarcodeIcon className="w-3.5 h-3.5" />
                        </div>
                        <input
                            type="text"
                            placeholder="Scan or type team barcode..."
                            value={returnTeamBarcodeInput}
                            onChange={(e) => {
                                const val = e.target.value;
                                setReturnTeamBarcodeInput(val);
                                const match = teamBarcodeLookup[val.trim().toLowerCase()];
                                if (match) {
                                    setReturnContext(prev => ({ ...prev, team: match.name }));
                                    playBeep('success');
                                    addToast(`Selected returning team: ${match.name}`, 'success');
                                }
                            }}
                            className="w-full text-xs font-mono pl-8 pr-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setIsReturnSetupModalOpen(false);
                            setScanMode('team-scan-return');
                            handleSetView(View.SCAN);
                        }}
                        className="px-2.5 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors shrink-0"
                        title="Scan Team Badge / Barcode with Camera/Scanner"
                    >
                        <ScanIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Scan Badge</span>
                    </button>
                </div>
            </div>
            <div>
                <label htmlFor="return-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Return Into Storehouse / Location</label>
                <select 
                    id="return-location" 
                    value={returnContext.location || (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))} 
                    onChange={(e) => setReturnContext(prev => ({...prev, location: e.target.value}))}
                    className={`${formInputStyle} py-2.5`}
                >
                    {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button 
                    type="button" 
                    onClick={() => { setIsReturnSetupModalOpen(false); setIsScanReturnModeSelectionOpen(true); }}
                    className="w-full sm:w-auto px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors text-center"
                >
                    Other Modes (Rapid / Quantity)
                </button>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button type="button" onClick={() => setIsReturnSetupModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button 
                        type="button" 
                        disabled={!returnContext.team} 
                        onClick={() => { 
                            setIsReturnSetupModalOpen(false); 
                            setScanMode('return-batch'); 
                            setStagedReturnItems([]); 
                            handleSetView(View.SCAN); 
                        }} 
                        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm font-semibold disabled:bg-purple-400 dark:disabled:bg-purple-800 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-sm"
                    >
                        <ScanIcon className="w-4 h-4" />
                        <span>Scan Items to Return</span>
                    </button>
                </div>
            </div>
        </div>
      </Modal>

      <Modal isOpen={isScanReturnModeSelectionOpen} onClose={() => setIsScanReturnModeSelectionOpen(false)} title="Choose Scan Return Mode">
        <div className="space-y-4">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-md text-xs text-purple-900 dark:text-purple-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BuildingStoreIcon className="w-4 h-4 flex-shrink-0 text-purple-600" />
              <span>Returning from: <strong>{returnContext.team}</strong> &rarr; <strong>{returnContext.location || (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))}</strong></span>
            </div>
          </div>

          <button
              onClick={() => { 
                  setScanMode('return-batch'); 
                  setStagedReturnItems([]); 
                  setIsScanReturnModeSelectionOpen(false); 
                  handleSetView(View.SCAN); 
              }}
              className="w-full text-left p-4 bg-purple-50/70 dark:bg-purple-900/20 border-2 border-purple-500/60 dark:border-purple-700 rounded-lg hover:bg-purple-100/60 dark:hover:bg-purple-900/40 transition-colors shadow-xs"
          >
              <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-purple-900 dark:text-purple-200 text-sm">Scan & Confirm (Batch Return)</p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-600 text-white">Recommended</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">Scan all the items you want to return from this team, review the staged list, and confirm before adding back to stock.</p>
          </button>

          <button
              onClick={() => { setScanMode('return-rapid'); setIsScanReturnModeSelectionOpen(false); setToasts([]); setRapidScanSummary({}); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Rapid Return Mode</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Scan an item to instantly return one unit assigned to this team. Best for speed.</p>
          </button>
          <button
              onClick={() => { setScanMode('return-quantity'); setIsScanReturnModeSelectionOpen(false); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Quantity Return Mode</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Scan an item, then enter the quantity to return. Best for bulk items.</p>
          </button>
        </div>
      </Modal>

      

      <Modal isOpen={isReturnQuantityModalOpen} onClose={() => { setIsReturnQuantityModalOpen(false); setItemForQuantityReturn(null); setQuantityToReturn(''); handleSetView(View.SCAN); }} title="Return Quantity">
        {itemForQuantityReturn && itemForQuantityReturn.length > 0 && (
          <form onSubmit={async (e) => {
              e.preventDefault();
              const numToReturn = parseInt(quantityToReturn, 10);
              if (isNaN(numToReturn) || numToReturn <= 0) {
                  setError("Please enter a valid quantity.");
                  return;
              }
              if (numToReturn > itemForQuantityReturn.length) {
                  setError(`Cannot return more than ${itemForQuantityReturn.length} items.`);
                  return;
              }
              try {
                  const targetReturnLoc = returnContext.location || (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES));
                  const itemsToUpdate = itemForQuantityReturn.slice(0, numToReturn).map(i => i.id);
                  if (itemsToUpdate.length === 1) {
                      await updateStockItemAssignment(itemsToUpdate[0], targetReturnLoc, Team.UNASSIGNED, selectedProfile.name);
                  } else {
                      await bulkUpdateAssignments(itemsToUpdate, targetReturnLoc, Team.UNASSIGNED, selectedProfile.name);
                  }
                  await refetchStock();
                  addToast(`Returned ${numToReturn} x ${itemForQuantityReturn[0].name} to ${targetReturnLoc}`, 'success');
                  setIsReturnQuantityModalOpen(false);
                  setItemForQuantityReturn(null);
                  setQuantityToReturn('');
                  handleSetView(View.SCAN);
              } catch (err) {
                  setError(err.message);
              }
          }} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Item: <span className="font-semibold">{itemForQuantityReturn[0].name}</span>
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Currently assigned to {returnContext.team} in last 24h: <span className="font-semibold">{itemForQuantityReturn.length}</span>
              </p>
              <div>
                  <label htmlFor="return-qty" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Return</label>
                  <input type="number" id="return-qty" min="1" max={itemForQuantityReturn.length} value={quantityToReturn} onChange={(e) => setQuantityToReturn(e.target.value)} className={formInputStyle} placeholder="Enter quantity" required autoFocus />
              </div>
              <div className="flex justify-end space-x-3 pt-6">
                  <button type="button" onClick={() => { setIsReturnQuantityModalOpen(false); setItemForQuantityReturn(null); setQuantityToReturn(''); handleSetView(View.SCAN); }} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">Return Items</button>
              </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={isScanModeModalOpen} onClose={() => setIsScanModeModalOpen(false)} title="Select Action">
          <div className="grid grid-cols-2 gap-4">
              <button
                  onClick={() => { 
                      setIsScanModeModalOpen(false); 
                      setReturnContext(prev => ({
                          ...prev,
                          location: activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES)
                      }));
                      setIsReturnSetupModalOpen(true); 
                  }}
                  className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-400 dark:hover:border-purple-600 transition-all text-center"
              >
                  <RefreshIcon className="w-10 h-10 text-purple-600 dark:text-purple-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan Return</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Rapidly return items to stock via barcode.</p>
              </button>
              <button
                  onClick={() => { setScanMode('in'); setIsScanModeModalOpen(false); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-600 transition-all text-center"
              >
                  <PlusCircleIcon className="w-10 h-10 text-blue-600 dark:text-blue-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan In</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Add new items to stock via barcode.</p>
              </button>
              <button
                  onClick={() => { 
                      setIsScanModeModalOpen(false); 
                      setAssignmentContext(prev => ({
                          ...prev,
                          location: activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES)
                      }));
                      setIsAssignmentSetupModalOpen(true); 
                  }}
                  className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:border-yellow-400 dark:hover:border-yellow-600 transition-all text-center"
              >
                  <ArrowRightCircleIcon className="w-10 h-10 text-yellow-600 dark:text-yellow-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan Out</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Assign items to a team via barcode.</p>
              </button>
              <button
                  onClick={() => { setIsScanModeModalOpen(false); navigateTo(View.ADD_ITEM); }}
                  className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-400 dark:hover:border-green-600 transition-all text-center"
              >
                  <AddIcon className="w-10 h-10 text-green-600 dark:text-green-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Add Manually</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Enter item details without scanning.</p>
              </button>
          </div>
      </Modal>

      <Modal isOpen={isAssignmentSetupModalOpen} onClose={() => setIsAssignmentSetupModalOpen(false)} title="Sign Out Stock...">
        <div className="space-y-4">
            <div>
                <label htmlFor="assign-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Sign Out From Storehouse / Location
                </label>
                <select id="assign-location" value={assignmentContext.location} onChange={(e) => setAssignmentContext(prev => ({ ...prev, location: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                    {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Stock will be deducted specifically from this storehouse.</p>
            </div>
            <div>
                <label htmlFor="assign-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Assign to Team / Surveyor</label>
                <select id="assign-team" required value={assignmentContext.team} onChange={(e) => setAssignmentContext(prev => ({ ...prev, team: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                    {teamsLoading ? <option disabled>Loading teams...</option> : teams.map(team => (
                        <option key={team.id} value={team.name}>
                            {team.name} {team.barcode ? `(Barcode: ${team.barcode})` : ''}
                        </option>
                    ))}
                </select>

                <div className="mt-2.5 flex items-center gap-2">
                    <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-400">
                            <BarcodeIcon className="w-3.5 h-3.5" />
                        </div>
                        <input
                            type="text"
                            placeholder="Scan or type team barcode..."
                            value={teamBarcodeInput}
                            onChange={(e) => {
                                const val = e.target.value;
                                setTeamBarcodeInput(val);
                                const match = teamBarcodeLookup[val.trim().toLowerCase()];
                                if (match) {
                                    setAssignmentContext(prev => ({ ...prev, team: match.name }));
                                    playBeep('success');
                                    addToast(`Selected: ${match.name}`, 'success');
                                }
                            }}
                            className="w-full text-xs font-mono pl-8 pr-2.5 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setIsAssignmentSetupModalOpen(false);
                            setScanMode('team-scan');
                            handleSetView(View.SCAN);
                        }}
                        className="px-2.5 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors shrink-0"
                        title="Scan Team Badge / Barcode with Camera/Scanner"
                    >
                        <ScanIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Scan Badge</span>
                    </button>
                </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button 
                    type="button" 
                    onClick={() => { setIsAssignmentSetupModalOpen(false); setIsScanOutModeSelectionOpen(true); }}
                    className="w-full sm:w-auto px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors text-center"
                >
                    Other Modes (Rapid / Qty / Range)
                </button>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button type="button" onClick={() => setIsAssignmentSetupModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button 
                        type="button" 
                        disabled={!assignmentContext.team}
                        onClick={() => { 
                            setScanMode('out-batch'); 
                            setStagedBatchItems([]); 
                            setIsAssignmentSetupModalOpen(false); 
                            handleSetView(View.SCAN); 
                        }} 
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-semibold disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800 flex items-center justify-center gap-1.5 shadow-sm"
                    >
                        <ScanIcon className="w-4 h-4" />
                        <span>Scan Items to Sign Out</span>
                    </button>
                </div>
            </div>
        </div>
      </Modal>

      <Modal isOpen={isScanOutModeSelectionOpen} onClose={() => setIsScanOutModeSelectionOpen(false)} title="Choose Scan Out Mode">
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BuildingStoreIcon className="w-4 h-4 flex-shrink-0 text-blue-600" />
              <span>Signing out from: <strong>{assignmentContext.location}</strong> &rarr; <strong>{assignmentContext.team}</strong></span>
            </div>
          </div>

          <button
              onClick={() => { 
                  setScanMode('out-batch'); 
                  setStagedBatchItems([]); 
                  setIsScanOutModeSelectionOpen(false); 
                  handleSetView(View.SCAN); 
              }}
              className="w-full text-left p-4 bg-blue-50/70 dark:bg-blue-900/20 border-2 border-blue-500/60 dark:border-blue-700 rounded-lg hover:bg-blue-100/60 dark:hover:bg-blue-900/40 transition-colors shadow-xs"
          >
              <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-blue-900 dark:text-blue-200 text-sm">Scan & Confirm (Batch Sign Out)</p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-600 text-white">Recommended</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">Scan all the items you want to sign out to this team, review the staged list, and confirm before deducting stock.</p>
          </button>

          <button
              onClick={() => { setScanMode('out-rapid'); setIsScanOutModeSelectionOpen(false); setToasts([]); setRapidScanSummary({}); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Rapid Mode</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Scan an item to instantly assign one unit. Best for speed.</p>
          </button>
          <button
              onClick={() => { setScanMode('out-quantity'); setIsScanOutModeSelectionOpen(false); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Quantity Mode</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Scan an item, then enter the quantity to assign. Best for bulk items.</p>
          </button>
          <button
              onClick={() => { setScanMode('out-range-start'); setIsScanOutModeSelectionOpen(false); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Range Mode</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Scan the first serial number, then enter the last serial number to assign a range.</p>
          </button>
        </div>
      </Modal>

      <Modal isOpen={isAssignQuantityModalOpen} onClose={() => { setIsAssignQuantityModalOpen(false); setItemForQuantityAssign(null); setQuantityToAssign(''); }} title="Assign Quantity">
        {itemForQuantityAssign && (
            <form onSubmit={handleAssignQuantitySubmit} className="space-y-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-xs text-blue-900 dark:text-blue-200 flex items-center gap-2">
                    <BuildingStoreIcon className="w-4 h-4 flex-shrink-0 text-blue-600" />
                    <span>Signing out from <strong>{assignmentContext.location}</strong> to <strong>{assignmentContext.team}</strong></span>
                </div>
                <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{itemForQuantityAssign[0].name}</h3>
                    <p className="text-sm font-mono bg-zinc-100 dark:bg-zinc-700 p-2 rounded-md mt-2">Serial / Barcode: {itemForQuantityAssign[0].barcode}</p>
                </div>
                <div>
                    <label htmlFor="quantity-to-assign" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Assign</label>
                    <input 
                        type="number"
                        id="quantity-to-assign"
                        name="quantity"
                        min="1"
                        step="1"
                        required
                        autoFocus
                        placeholder="Enter quantity"
                        value={quantityToAssign}
                        onChange={(e) => setQuantityToAssign(e.target.value)}
                        className={formInputStyle}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        <strong>{itemForQuantityAssign.length}</strong> available in stock at {assignmentContext.location}.
                      </span>
                      {parseInt(quantityToAssign, 10) > itemForQuantityAssign.length && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          +{parseInt(quantityToAssign, 10) - itemForQuantityAssign.length} excess units
                        </span>
                      )}
                    </div>
                    {parseInt(quantityToAssign, 10) > itemForQuantityAssign.length && (
                      <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-md text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                        <AlertTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <span>Entered quantity exceeds recorded stock ({itemForQuantityAssign.length}). You will be prompted to confirm this discrepancy upon submitting.</span>
                      </div>
                    )}
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => { setIsAssignQuantityModalOpen(false); setItemForQuantityAssign(null); setQuantityToAssign(''); }} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[170px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                        {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                        {isSubmitting ? 'Processing...' : (parseInt(quantityToAssign, 10) > itemForQuantityAssign.length ? `Sign Out (${quantityToAssign} Units)` : `Assign to ${assignmentContext.team}`)}
                    </button>
                </div>
            </form>
        )}
      </Modal>

      {/* --- Excess Quantity Sign-Out Confirmation Modal --- */}
      <Modal 
        isOpen={!!excessSignOutConfirmation} 
        onClose={() => setExcessSignOutConfirmation(null)} 
        title="Confirm Quantity & Stock Discrepancy"
        maxWidth="max-w-lg"
      >
        {excessSignOutConfirmation && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-lg flex items-start gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/60 rounded-full text-amber-700 dark:text-amber-300 flex-shrink-0">
                <AlertTriangleIcon className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Please check: Are you sure of this quantity?
                </h4>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  You are attempting to sign out <strong>{excessSignOutConfirmation.numToAssign} units</strong> of <strong>{excessSignOutConfirmation.itemName}</strong>, but only <strong>{excessSignOutConfirmation.availableCount} unit{excessSignOutConfirmation.availableCount !== 1 ? 's are' : ' is'}</strong> currently recorded in stock at <strong>{excessSignOutConfirmation.location}</strong>.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs space-y-2 text-zinc-600 dark:text-zinc-300">
              <p className="font-semibold text-zinc-800 dark:text-zinc-200">What happens when you proceed:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  All <strong>{excessSignOutConfirmation.availableCount}</strong> available units in stock will be assigned to <strong>{excessSignOutConfirmation.team}</strong>.
                </li>
                <li>
                  An alert for the <strong>{excessSignOutConfirmation.excessQty} excess unit{excessSignOutConfirmation.excessQty !== 1 ? 's' : ''}</strong> will be logged in the <strong>Unrecognised Scans Log</strong> encouraging the administrator to conduct a stock take.
                </li>
              </ul>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setExcessSignOutConfirmation(null)}
                className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 text-sm font-medium rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors"
              >
                Cancel & Re-check Count
              </button>
              <button
                type="button"
                onClick={handleConfirmExcessSignOut}
                disabled={isSubmitting}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-md shadow-xs transition-colors flex items-center justify-center disabled:opacity-50"
              >
                {isSubmitting && <Spinner className="w-4 h-4 mr-2" />}
                Yes, Confirm & Sign Out ({excessSignOutConfirmation.numToAssign} Units)
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- Batch Sign-Out Review & Confirmation Modal --- */}
      <Modal 
        isOpen={isBatchConfirmModalOpen} 
        onClose={() => setIsBatchConfirmModalOpen(false)} 
        title="Confirm Sign Out to Team"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Header banner */}
          <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <span className="text-sm font-bold text-blue-900 dark:text-blue-100">{assignmentContext.team}</span>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                Deducting stock from storehouse: <strong>{assignmentContext.location}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-blue-600 text-white font-mono font-bold text-xs rounded-full shadow-xs">
                {stagedTotalCount} Total Unit{stagedTotalCount !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                ({stagedBatchItems.length} item type{stagedBatchItems.length !== 1 ? 's' : ''})
              </span>
            </div>
          </div>

          {/* Discrepancy warning banner if any item exceeds available count */}
          {stagedBatchItems.some(item => !item.isUnique && item.quantity > item.availableCount) && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangleIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Stock Discrepancy Notice</p>
                <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                  One or more items exceed recorded stock for {assignmentContext.location}. All in-stock units will be signed out to {assignmentContext.team}, and any excess will be logged in the Unrecognised Scans audit log for stock take reconciliation.
                </p>
              </div>
            </div>
          )}

          {/* Staged Items Table */}
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              {stagedBatchItems.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No items staged for sign out yet.
                </div>
              ) : (
                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/80 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300">Item</th>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300">Type / Barcode</th>
                      <th className="px-3 py-2 text-center font-semibold text-zinc-600 dark:text-zinc-300">Stock Status</th>
                      <th className="px-3 py-2 text-center font-semibold text-zinc-600 dark:text-zinc-300">Quantity</th>
                      <th className="px-2 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {stagedBatchItems.map((item) => {
                      const isExcess = !item.isUnique && item.quantity > item.availableCount;
                      return (
                        <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100 max-w-[180px] truncate">
                            {item.name}
                            {item.partNumber && (
                              <span className="block text-[10px] text-zinc-400 font-mono">Part #{item.partNumber}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                            {item.isUnique ? (
                              <span className="inline-flex items-center gap-1 text-[11px] bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                Serial: {item.serial}
                              </span>
                            ) : (
                              <span>{item.barcode}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {item.isUnique ? (
                              <span className="inline-flex items-center text-[10px] font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800">
                                1 In Stock
                              </span>
                            ) : isExcess ? (
                              <span className="inline-flex items-center text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700">
                                {item.availableCount} in stock (+{item.quantity - item.availableCount} excess)
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-[10px] font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800">
                                {item.availableCount} In Stock
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {!item.isUnique ? (
                              <div className="inline-flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleUpdateStagedQuantity(item.id, -1);
                                  }}
                                  className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 rounded font-bold touch-manipulation select-none"
                                  title="Decrease quantity"
                                >
                                  -
                                </button>
                                <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100 min-w-[20px] text-center select-none">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleUpdateStagedQuantity(item.id, 1);
                                  }}
                                  className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 rounded font-bold touch-manipulation select-none"
                                  title="Increase quantity"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">1</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveStagedItem(item.id)}
                              className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors"
                              title="Remove item from batch"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsBatchConfirmModalOpen(false)}
              className="w-full sm:w-auto px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <ScanIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Scan More Items</span>
            </button>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleCancelScan}
                className="px-3 py-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 text-xs font-medium"
              >
                Cancel Sign Out
              </button>
              <button
                type="button"
                disabled={isSubmittingBatchSignOut || stagedTotalCount === 0}
                onClick={handleConfirmBatchSignOut}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-md shadow-sm transition-colors flex items-center justify-center gap-2 min-w-[200px]"
              >
                {isSubmittingBatchSignOut ? (
                  <>
                    <Spinner className="w-4 h-4 text-white animate-spin" />
                    <span>Signing Out...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Confirm Sign Out ({stagedTotalCount} Units)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* --- Batch Return Review & Confirmation Modal --- */}
      <Modal 
        isOpen={isReturnBatchConfirmModalOpen} 
        onClose={() => setIsReturnBatchConfirmModalOpen(false)} 
        title="Confirm Return from Team"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Header banner */}
          <div className="p-3.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                <span className="text-sm font-bold text-purple-900 dark:text-purple-100">{returnContext.team}</span>
              </div>
              <p className="text-xs text-purple-700 dark:text-purple-300 mt-0.5">
                Returning stock into storehouse: <strong>{(returnContext.location && returnContext.location !== 'All') ? returnContext.location : (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 bg-purple-600 text-white font-mono font-bold text-xs rounded-full shadow-xs">
                {stagedReturnTotalCount} Total Unit{stagedReturnTotalCount !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                ({stagedReturnItems.length} item type{stagedReturnItems.length !== 1 ? 's' : ''})
              </span>
            </div>
          </div>

          {/* Staged Return Items Table */}
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              {stagedReturnItems.length === 0 ? (
                <div className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No items staged for return yet.
                </div>
              ) : (
                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700 text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/80 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300">Item</th>
                      <th className="px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300">Type / Barcode</th>
                      <th className="px-3 py-2 text-center font-semibold text-zinc-600 dark:text-zinc-300">Team Holding</th>
                      <th className="px-3 py-2 text-center font-semibold text-zinc-600 dark:text-zinc-300">Return Qty</th>
                      <th className="px-2 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {stagedReturnItems.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100 max-w-[180px] truncate">
                          {item.name}
                          {item.partNumber && (
                            <span className="block text-[10px] text-zinc-400 font-mono">Part #{item.partNumber}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                          {item.isUnique ? (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                              Serial: {item.serial}
                            </span>
                          ) : (
                            <span>{item.barcode}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {item.isUnique ? (
                            <span className="inline-flex items-center text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                              Assigned
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                              {item.availableCount} with Team
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {!item.isUnique ? (
                            <div className="inline-flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">
                              <button
                                type="button"
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleUpdateStagedReturnQuantity(item.id, -1);
                                }}
                                disabled={item.quantity <= 1}
                                className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 disabled:opacity-40 disabled:pointer-events-none rounded font-bold touch-manipulation select-none"
                                title="Decrease quantity"
                              >
                                -
                              </button>
                              <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100 min-w-[20px] text-center select-none">
                                {item.quantity}{item.availableCount ? ` / ${item.availableCount}` : ''}
                              </span>
                              <button
                                type="button"
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleUpdateStagedReturnQuantity(item.id, 1);
                                }}
                                disabled={typeof item.availableCount === 'number' && item.quantity >= item.availableCount}
                                className="w-7 h-7 sm:w-6 sm:h-6 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 disabled:opacity-40 disabled:pointer-events-none rounded font-bold touch-manipulation select-none"
                                title={typeof item.availableCount === 'number' && item.quantity >= item.availableCount ? `Max quantity (${item.availableCount}) reached` : 'Increase quantity'}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">1</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveStagedReturnItem(item.id)}
                            className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors"
                            title="Remove item from batch"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsReturnBatchConfirmModalOpen(false)}
              className="w-full sm:w-auto px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium flex items-center justify-center gap-1.5"
            >
              <ScanIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Scan More Items</span>
            </button>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleCancelScan}
                className="px-3 py-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 text-xs font-medium"
              >
                Cancel Return
              </button>
              <button
                type="button"
                disabled={isSubmittingBatchReturn || stagedReturnTotalCount === 0}
                onClick={handleConfirmBatchReturn}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 dark:disabled:bg-purple-900 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-md shadow-sm transition-colors flex items-center justify-center gap-2 min-w-[200px]"
              >
                {isSubmittingBatchReturn ? (
                  <>
                    <Spinner className="w-4 h-4 text-white animate-spin" />
                    <span>Returning Stock...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Confirm Return ({stagedReturnTotalCount} Units)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isAssignRangeModalOpen} onClose={() => { setIsAssignRangeModalOpen(false); setRangeAssignDetails({ firstSerial: '', lastSerial: '' }); }} title="Assign Serial Range">
        <form onSubmit={handleAssignRangeSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label htmlFor="assign-range-first" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">First Serial Number</label>
                    <input 
                        type="text"
                        id="assign-range-first"
                        value={rangeAssignDetails.firstSerial}
                        readOnly
                        className="mt-1 block w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md font-mono text-zinc-500 dark:text-zinc-400"
                    />
                </div>
                <div>
                    <label htmlFor="assign-range-last" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Last Serial Number</label>
                    <input 
                        type="text"
                        id="assign-range-last"
                        value={rangeAssignDetails.lastSerial}
                        onChange={(e) => setRangeAssignDetails(prev => ({...prev, lastSerial: e.target.value}))}
                        className={`${formInputStyle} font-mono`}
                        required
                    />
                </div>
            </div>
            {rangeAssignProcessingResult.error ? (
                <p className="text-sm text-red-600 dark:text-red-400">{rangeAssignProcessingResult.error}</p>
            ) : rangeAssignProcessingResult.serials.length > 0 && (
                <p className="text-sm text-green-700 dark:text-green-400">
                    {rangeAssignProcessingResult.serials.length} item(s) will be assigned.
                </p>
            )}
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => { setIsAssignRangeModalOpen(false); setRangeAssignDetails({ firstSerial: '', lastSerial: '' }); }} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button type="submit" disabled={isSubmitting || !!rangeAssignProcessingResult.error || rangeAssignProcessingResult.serials.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[170px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                    {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                    {isSubmitting ? 'Assigning...' : `Assign to ${assignmentContext.team}`}
                </button>
            </div>
        </form>
      </Modal>

      <Modal isOpen={isAddScannedItemModalOpen} onClose={() => setIsAddScannedItemModalOpen(false)} title="Add Scanned Item">
        <form onSubmit={handleAddScannedItem} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="scanned-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Serial / Barcode</label>
              <input type="text" id="scanned-barcode" value={newScannedItemDetails.barcode} readOnly className="mt-1 block w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 rounded-md font-mono text-zinc-500 dark:text-zinc-400" />
            </div>
            <div>
              <label htmlFor="scanned-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Storehouse Location</label>
              <select
                id="scanned-location"
                value={newScannedItemDetails.location || (activeLocation !== 'All' ? activeLocation : (displayLocations[0] || Location.LEADING_STORES))}
                onChange={(e) => setNewScannedItemDetails(prev => ({ ...prev, location: e.target.value }))}
                className={formInputStyle}
              >
                {displayLocations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
              <label htmlFor="scanned-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Type</label>
              <SearchableSelect
                placeholder={itemTypesLoading ? 'Loading types...' : 'Select an item type'}
                options={groupedItemTypes}
                value={newScannedItemDetails.name}
                onChange={(e) => setNewScannedItemDetails(prev => ({...prev, name: e.target.value, quantity: '', lastSerial: prev.firstSerial }))}
                loading={itemTypesLoading}
              />
          </div>
          <div>
              <label htmlFor="scanned-description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description (Optional)</label>
              <textarea name="description" id="scanned-description" rows={3} className={formInputStyle} value={newScannedItemDetails.description} onChange={(e) => setNewScannedItemDetails(prev => ({...prev, description: e.target.value}))}></textarea>
          </div>

          {isMeterType ? (
            <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="scanned-first-serial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">First Serial Number</label>
                        <input 
                            type="text"
                            id="scanned-first-serial"
                            value={newScannedItemDetails.firstSerial}
                            readOnly
                            className="mt-1 block w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 rounded-md font-mono text-zinc-500 dark:text-zinc-400"
                        />
                    </div>
                    <div>
                        <label htmlFor="scanned-last-serial" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Last Serial Number</label>
                        <input 
                            name="lastSerial" 
                            id="scanned-last-serial" 
                            className={`${formInputStyle} font-mono`}
                            placeholder="e.g., H25YU360170"
                            value={newScannedItemDetails.lastSerial} 
                            onChange={(e) => setNewScannedItemDetails(prev => ({...prev, lastSerial: e.target.value}))}
                            required
                        />
                    </div>
                </div>
                {scannedSerialsProcessingResult.error ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{scannedSerialsProcessingResult.error}</p>
                ) : scannedSerialsProcessingResult.serials.length > 0 && (
                    <p className="text-sm text-green-700 dark:text-green-400">
                        {scannedSerialsProcessingResult.serials.length} item(s) will be added.
                    </p>
                )}
            </div>
          ) : (
            <>
                {!selectedScannedItemType?.is_unique && (
                    <div className="pt-4 border-t border-zinc-200 dark:border-zinc-700">
                        <label htmlFor="scanned-quantity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity</label>
                        <input type="number" name="quantity" id="scanned-quantity" min="1" step="1" required placeholder="Enter quantity" className={formInputStyle} value={newScannedItemDetails.quantity} onChange={(e) => setNewScannedItemDetails(prev => ({...prev, quantity: e.target.value}))}/>
                    </div>
                )}
            </>
          )}

          <div className="flex justify-end space-x-3 pt-4">
              <button type="button" onClick={() => setIsAddScannedItemModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
              <button type="submit" disabled={isSubmitting || !newScannedItemDetails.name || !!scannedSerialsProcessingResult.error} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                  {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                  {isSubmitting ? 'Adding...' : 'Add Item(s)'}
              </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isAddQuantityModalOpen} onClose={() => { setIsAddQuantityModalOpen(false); setItemForQuantityAdd(null); setQuantityToAdd(''); }} title="Add More Stock">
        {itemForQuantityAdd && (
            <form onSubmit={handleConfirmAddQuantity} className="space-y-4">
                <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{itemForQuantityAdd.name}</h3>
                    <p className="text-sm font-mono bg-zinc-100 dark:bg-zinc-700 p-2 rounded-md mt-2">Serial Number: {itemForQuantityAdd.barcode}</p>
                </div>
                <div>
                    <label htmlFor="quantity-add-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Sign In To Storehouse / Location
                    </label>
                    <select
                        id="quantity-add-location"
                        value={quantityAddLocation || (activeLocation !== 'All' ? activeLocation : (itemForQuantityAdd.location || displayLocations[0] || Location.LEADING_STORES))}
                        onChange={(e) => setQuantityAddLocation(e.target.value)}
                        className={formInputStyle}
                    >
                        {displayLocations.map(loc => (
                            <option key={loc} value={loc}>{loc}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="quantity-to-add" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Add</label>
                    <input 
                        type="number"
                        id="quantity-to-add"
                        name="quantity"
                        min="1"
                        step="1"
                        required
                        autoFocus
                        placeholder="Enter quantity"
                        value={quantityToAdd}
                        onChange={(e) => setQuantityToAdd(e.target.value)}
                        className={formInputStyle}
                    />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => { setIsAddQuantityModalOpen(false); setItemForQuantityAdd(null); setQuantityToAdd(''); }} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[120px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                        {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                        {isSubmitting ? 'Adding...' : 'Confirm Add'}
                    </button>
                </div>
            </form>
        )}
      </Modal>
      
      <Modal isOpen={isCreateUserModalOpen} onClose={() => setIsCreateUserModalOpen(false)} title="Create New Account">
          <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                  <label htmlFor="new-username">Username</label>
                  <input id="new-username" name="username" type="text" required value={newUserInfo.username} onChange={handleNewUserFormChange} className={formInputStyle} />
              </div>
              <div>
                  <label htmlFor="new-email">Email</label>
                  <input id="new-email" name="email" type="email" required value={newUserInfo.email} onChange={handleNewUserFormChange} className={formInputStyle} />
              </div>
              <div>
                  <label htmlFor="new-password">Password</label>
                  <input id="new-password" name="password" type="password" required value={newUserInfo.password} onChange={handleNewUserFormChange} className={formInputStyle} />
              </div>
              <div>
                  <label htmlFor="new-role">Role</label>
                  <select id="new-role" name="role" value={newUserInfo.role} onChange={handleNewUserFormChange} className={formInputStyle}>
                      <option>User</option>
                      <option>Admin</option>
                  </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  <button type="button" onClick={() => setIsCreateUserModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                  <button type="submit" disabled={createUserLoading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[130px]">
                      {createUserLoading && <Spinner className="-ml-1 mr-2 h-4 w-4" />}
                      {createUserLoading ? 'Creating...' : 'Create Account'}
                  </button>
              </div>
          </form>
      </Modal>
            
      <Modal isOpen={isAddItemTypeModalOpen} onClose={() => setIsAddItemTypeModalOpen(false)} title="Add New Item Type" maxWidth="max-w-lg">
          <form onSubmit={handleAddItemType} className="space-y-4">
              <div>
                  <label htmlFor="type-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Item Name <span className="text-red-500">*</span>
                  </label>
                  <input
                      id="type-name"
                      type="text"
                      required
                      placeholder="e.g. Cat6 Ethernet Cable 2m"
                      value={newItemTypeInfo.name}
                      onChange={(e) => setNewItemTypeInfo(prev => ({...prev, name: e.target.value}))}
                      className={formInputStyle}
                  />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <div className="flex items-center justify-between">
                          <label htmlFor="type-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Barcode / Part No.</label>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">Optional</span>
                      </div>
                      <div className="relative mt-1">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                              <BarcodeIcon className="w-4 h-4" />
                          </div>
                          <input
                              id="type-barcode"
                              type="text"
                              placeholder="e.g. 501234567890"
                              value={newItemTypeInfo.barcode || ''}
                              onChange={(e) => setNewItemTypeInfo(prev => ({...prev, barcode: e.target.value}))}
                              className={`${formInputStyle} !mt-0 pl-9 font-mono`}
                          />
                      </div>
                  </div>
                  <div>
                      <label htmlFor="type-supplier" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier</label>
                      <select id="type-supplier" value={newItemTypeInfo.supplier_id} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, supplier_id: e.target.value}))} className={formInputStyle}>
                          <option value="">None</option>
                          {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                      </select>
                  </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <div className="flex items-center justify-between mb-1">
                          <label htmlFor="type-category" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                              Category <span className="text-red-500">*</span>
                          </label>
                          <button
                              type="button"
                              onClick={() => { setNewCategoryName(''); setIsAddCategoryModalOpen(true); }}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-medium"
                          >
                              <AddIcon className="w-3 h-3" />
                              <span>+ New</span>
                          </button>
                      </div>
                      <select id="type-category" value={newItemTypeInfo.category} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, category: e.target.value, subcategory_id: ''}))} className={formInputStyle}>
                          {categoriesLoading ? <option>Loading...</option> : categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                      </select>
                  </div>
                  <div>
                      <div className="flex items-center justify-between mb-1">
                          <label htmlFor="type-subcategory" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-Category</label>
                          <button
                              type="button"
                              onClick={() => {
                                  const parent = categories.find(c => c.name === newItemTypeInfo.category) || categories[0];
                                  if (parent) setSelectedParentCategoryId(parent.id);
                                  setNewSubcategoryName('');
                                  setIsAddSubcategoryModalOpen(true);
                              }}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-medium"
                          >
                              <AddIcon className="w-3 h-3" />
                              <span>+ New</span>
                          </button>
                      </div>
                      <select id="type-subcategory" value={newItemTypeInfo.subcategory_id} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, subcategory_id: e.target.value}))} className={formInputStyle}>
                          <option value="">None</option>
                          {getFilteredSubcategories(newItemTypeInfo.category).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                      </select>
                  </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label htmlFor="type-price" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Price (£)</label>
                      <input id="type-price" type="number" step="0.01" min="0" placeholder="0.00" value={newItemTypeInfo.price} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, price: e.target.value}))} className={formInputStyle} />
                  </div>
                  <div>
                      <label htmlFor="type-threshold" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Stock Threshold</label>
                      <input id="type-threshold" type="number" min="0" step="1" placeholder="0" value={newItemTypeInfo.stock_threshold} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, stock_threshold: e.target.value}))} className={formInputStyle} />
                  </div>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-start space-x-3">
                  <div className="flex items-center h-5 pt-0.5">
                      <input id="type-isunique" type="checkbox" checked={newItemTypeInfo.is_unique} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, is_unique: e.target.checked}))} className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                  </div>
                  <div className="text-sm">
                      <label htmlFor="type-isunique" className="font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer select-none">Unique Item (Individual Serials)</label>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Enable if units are tracked by unique individual serial numbers (e.g. meters) rather than bulk quantity.</p>
                  </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  <button type="button" onClick={() => setIsAddItemTypeModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                  <button type="submit" disabled={isSubmitting || !newItemTypeInfo.name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[130px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                      {isSubmitting && <Spinner className="-ml-1 mr-2 h-4 w-4" />}
                      {isSubmitting ? 'Adding...' : 'Add Item Type'}
                  </button>
              </div>
          </form>
      </Modal>

       <Modal isOpen={!!editingItemType} onClose={() => setEditingItemType(null)} title="Edit Item Type" maxWidth="max-w-lg">
        {editingItemType && (
            <form onSubmit={handleUpdateItemType} className="space-y-4">
                 <div>
                     <label htmlFor="edit-type-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                         Item Name <span className="text-red-500">*</span>
                     </label>
                     <input id="edit-type-name" type="text" required value={editingItemType.name} onChange={(e) => setEditingItemType(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                 </div>

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                         <div className="flex items-center justify-between">
                             <label htmlFor="edit-type-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Barcode / Part No.</label>
                             <span className="text-xs text-zinc-400 dark:text-zinc-500">Optional</span>
                         </div>
                         <div className="relative mt-1">
                             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                                 <BarcodeIcon className="w-4 h-4" />
                             </div>
                             <input id="edit-type-barcode" type="text" placeholder="e.g. 501234567890" value={editingItemType.barcode || ''} onChange={(e) => setEditingItemType(prev => ({...prev, barcode: e.target.value}))} className={`${formInputStyle} !mt-0 pl-9 font-mono`} />
                         </div>
                         {itemTypeBarcodesMap[editingItemType.name]?.length > 0 && (
                             <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                 <span className="text-xs text-zinc-500 dark:text-zinc-400">From stock:</span>
                                 {itemTypeBarcodesMap[editingItemType.name].map(bc => (
                                     <button
                                         key={bc}
                                         type="button"
                                         onClick={() => setEditingItemType(prev => ({ ...prev, barcode: bc }))}
                                         className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
                                             editingItemType.barcode === bc
                                                 ? "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border-blue-400 font-semibold"
                                                 : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-50 dark:hover:bg-zinc-700 border-zinc-200 dark:border-zinc-700"
                                         }`}
                                         title="Click to set this as the master barcode"
                                     >
                                         {bc}
                                     </button>
                                 ))}
                             </div>
                         )}
                     </div>
                     <div>
                         <label htmlFor="edit-type-supplier" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier</label>
                         <select id="edit-type-supplier" value={editingItemType.supplier_id || ''} onChange={(e) => setEditingItemType(prev => ({...prev, supplier_id: e.target.value}))} className={formInputStyle}>
                             <option value="">None</option>
                             {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                         </select>
                     </div>
                 </div>

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                         <div className="flex items-center justify-between mb-1">
                             <label htmlFor="edit-type-category" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                 Category <span className="text-red-500">*</span>
                             </label>
                             <button
                                 type="button"
                                 onClick={() => { setNewCategoryName(''); setIsAddCategoryModalOpen(true); }}
                                 className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-medium"
                             >
                                 <AddIcon className="w-3 h-3" />
                                 <span>+ New</span>
                             </button>
                         </div>
                         <select id="edit-type-category" value={editingItemType.category} onChange={(e) => setEditingItemType(prev => ({...prev, category: e.target.value, subcategory_id: ''}))} className={formInputStyle}>
                            {categoriesLoading ? <option>Loading...</option> : categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                         </select>
                     </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                            <label htmlFor="edit-type-subcategory" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-Category</label>
                            <button
                                type="button"
                                onClick={() => {
                                    const parent = categories.find(c => c.name === editingItemType.category) || categories[0];
                                    if (parent) setSelectedParentCategoryId(parent.id);
                                    setNewSubcategoryName('');
                                    setIsAddSubcategoryModalOpen(true);
                                }}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-medium"
                            >
                                <AddIcon className="w-3 h-3" />
                                <span>+ New</span>
                            </button>
                        </div>
                         <select id="edit-type-subcategory" value={editingItemType.subcategory_id || ''} onChange={(e) => setEditingItemType(prev => ({...prev, subcategory_id: e.target.value}))} className={formInputStyle}>
                             <option value="">None</option>
                             {getFilteredSubcategories(editingItemType.category).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                         </select>
                     </div>
                 </div>

                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                         <label htmlFor="edit-type-price" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Price (£)</label>
                         <input id="edit-type-price" type="number" step="0.01" min="0" placeholder="0.00" value={editingItemType.price || ''} onChange={(e) => setEditingItemType(prev => ({...prev, price: e.target.value}))} className={formInputStyle} />
                     </div>
                     <div>
                         <label htmlFor="edit-type-threshold" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Stock Threshold</label>
                         <input id="edit-type-threshold" type="number" min="0" step="1" placeholder="0" value={editingItemType.stock_threshold || ''} onChange={(e) => setEditingItemType(prev => ({...prev, stock_threshold: e.target.value}))} className={formInputStyle} />
                     </div>
                 </div>

                <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-start space-x-3">
                    <div className="flex items-center h-5 pt-0.5">
                        <input id="edit-type-isunique" type="checkbox" checked={editingItemType.is_unique} onChange={(e) => setEditingItemType(prev => ({...prev, is_unique: e.target.checked}))} className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    </div>
                    <div className="text-sm">
                        <label htmlFor="edit-type-isunique" className="font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer select-none">Unique Item (Individual Serials)</label>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Enable if units are tracked by unique individual serial numbers (e.g. meters) rather than bulk quantity.</p>
                    </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                    <button type="button" onClick={() => setEditingItemType(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={isSubmitting || !editingItemType.name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[130px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                        {isSubmitting && <Spinner className="-ml-1 mr-2 h-4 w-4" />}
                        {isSubmitting ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        )}
      </Modal>

      <Modal isOpen={isAddTeamModalOpen} onClose={() => setIsAddTeamModalOpen(false)} title="Add New Team/Surveyor">
        <form onSubmit={handleAddTeam} className="space-y-4">
             <div>
                <label htmlFor="team-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                <input id="team-name" type="text" required value={newTeamInfo.name} onChange={(e) => setNewTeamInfo(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
            </div>
             <div>
                <label htmlFor="team-type" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="team-type" value={newTeamInfo.type} onChange={(e) => setNewTeamInfo(prev => ({...prev, type: e.target.value}))} className={formInputStyle}>
                    <option value={TeamType.TEAM}>Team</option>
                    <option value={TeamType.SURVEYOR}>Surveyor</option>
                </select>
            </div>
            <div>
                <div className="flex items-center justify-between">
                    <label htmlFor="team-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Barcode / Code</label>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">Optional</span>
                </div>
                <div className="relative mt-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                        <BarcodeIcon className="w-4 h-4" />
                    </div>
                    <input 
                        id="team-barcode" 
                        type="text" 
                        placeholder="e.g. TEAM-001 or scan badge" 
                        value={newTeamInfo.barcode || ''} 
                        onChange={(e) => setNewTeamInfo(prev => ({...prev, barcode: e.target.value}))} 
                        className={`${formInputStyle} !mt-0 pl-9 font-mono`} 
                    />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Scan or enter a unique code to instantly sign out stock by scanning this team's badge.
                </p>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button type="button" onClick={() => setIsAddTeamModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium">Add Team</button>
            </div>
        </form>
      </Modal>

       <Modal isOpen={!!editingTeam} onClose={() => setEditingTeam(null)} title="Edit Team/Surveyor">
        {editingTeam && (
            <form onSubmit={handleUpdateTeam} className="space-y-4">
                <div>
                    <label htmlFor="edit-team-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                    <input id="edit-team-name" type="text" required value={editingTeam.name} onChange={(e) => setEditingTeam(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                </div>
                <div>
                    <label htmlFor="edit-team-type" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                    <select id="edit-team-type" value={editingTeam.type} onChange={(e) => setEditingTeam(prev => ({...prev, type: e.target.value}))} className={formInputStyle}>
                        <option value={TeamType.TEAM}>Team</option>
                        <option value={TeamType.SURVEYOR}>Surveyor</option>
                    </select>
                </div>
                <div>
                    <div className="flex items-center justify-between">
                        <label htmlFor="edit-team-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Barcode / Code</label>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">Optional</span>
                    </div>
                    <div className="relative mt-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                            <BarcodeIcon className="w-4 h-4" />
                        </div>
                        <input 
                            id="edit-team-barcode" 
                            type="text" 
                            placeholder="e.g. TEAM-001 or scan badge" 
                            value={editingTeam.barcode || ''} 
                            onChange={(e) => setEditingTeam(prev => ({...prev, barcode: e.target.value}))} 
                            className={`${formInputStyle} !mt-0 pl-9 font-mono`} 
                        />
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        Scan or enter a unique code to instantly sign out stock by scanning this team's badge.
                    </p>
                </div>
                <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                    <button type="button" onClick={() => setEditingTeam(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium">Save Changes</button>
                </div>
            </form>
        )}
      </Modal>

      {/* --- Team & Surveyor Barcode Badges Modal --- */}
      <Modal 
        isOpen={isPrintTeamBadgesModalOpen} 
        onClose={() => setIsPrintTeamBadgesModalOpen(false)} 
        title="Team & Surveyor Barcodes"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            View and manage barcodes for each team or surveyor. Scanning a team barcode in the scanner will automatically select them for signing out stock.
          </p>

          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
              <SearchIcon className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search teams, surveyors, or barcodes..."
              value={teamBadgesFilter}
              onChange={(e) => setTeamBadgesFilter(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Badge cards grid */}
          <div className="max-h-96 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {teams
                .filter(t => {
                  if (!teamBadgesFilter.trim()) return true;
                  const q = teamBadgesFilter.toLowerCase().trim();
                  return (
                    t.name.toLowerCase().includes(q) ||
                    (t.barcode && t.barcode.toLowerCase().includes(q)) ||
                    (t.type && t.type.toLowerCase().includes(q))
                  );
                })
                .map(team => (
                  <div 
                    key={team.id}
                    className="p-3 bg-white dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xs flex flex-col justify-between hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div>
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">{team.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                          {team.type || 'Team'}
                        </span>
                      </div>

                      {/* Barcode display box */}
                      <div className="mt-2.5 p-2 bg-zinc-50 dark:bg-zinc-900/60 rounded border border-zinc-200 dark:border-zinc-700 text-center">
                        {team.barcode ? (
                          <>
                            {/* Simulated barcode visual lines for badges */}
                            <div className="flex justify-center items-center gap-[2px] h-5 mb-1 opacity-70 dark:opacity-85" aria-hidden="true">
                              {team.barcode.split('').map((char, i) => (
                                <span 
                                  key={i} 
                                  className={`inline-block h-full bg-zinc-800 dark:bg-zinc-200 ${
                                    (char.charCodeAt(0) % 3 === 0) ? 'w-[3px]' : (char.charCodeAt(0) % 2 === 0) ? 'w-[2px]' : 'w-[1px]'
                                  }`} 
                                />
                              ))}
                            </div>
                            <span className="font-mono text-xs font-bold tracking-wider text-blue-700 dark:text-blue-300">
                              {team.barcode}
                            </span>
                          </>
                        ) : (
                          <div className="py-1.5">
                            <span className="text-[11px] text-zinc-400 italic">No barcode assigned</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-700/60 flex justify-end items-center text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPrintTeamBadgesModalOpen(false);
                          setEditingTeam(team);
                        }}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors flex items-center gap-1"
                      >
                        <EditIcon className="w-3.5 h-3.5" />
                        <span>{team.barcode ? 'Edit Barcode' : '+ Set Barcode'}</span>
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsPrintTeamBadgesModalOpen(false)}
              className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
      
      {/* --- Manage Categories & Sub-Categories Modal --- */}
      <Modal
        isOpen={isManageCategoriesModalOpen}
        onClose={() => setIsManageCategoriesModalOpen(false)}
        title="Manage Categories & Sub-Categories"
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Create, rename, and organise product categories and their nested sub-categories.
            </p>
            <button
              type="button"
              onClick={() => { setNewCategoryName(''); setIsAddCategoryModalOpen(true); }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors shrink-0"
            >
              <AddIcon className="w-3.5 h-3.5" />
              <span>Add Category</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
              <SearchIcon className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search categories or sub-categories..."
              value={categorySearchTerm}
              onChange={(e) => setCategorySearchTerm(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Categories List */}
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
            {categories
              .filter(cat => {
                if (!categorySearchTerm.trim()) return true;
                const q = categorySearchTerm.toLowerCase().trim();
                const matchesCat = cat.name.toLowerCase().includes(q);
                const subs = subcategories.filter(sc => sc.category_id === cat.id);
                const matchesSub = subs.some(sc => sc.name.toLowerCase().includes(q));
                return matchesCat || matchesSub;
              })
              .map(cat => {
                const subs = subcategories.filter(sc => sc.category_id === cat.id);
                const isExpanded = expandedCategoryIds[cat.id] !== false; // Default expanded
                const catItemCount = itemTypes.filter(it => it.category === cat.name).length;

                return (
                  <div
                    key={cat.id}
                    className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-800/80 shadow-xs"
                  >
                    {/* Category Header */}
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-800 flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-700/60">
                      <div
                        className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 select-none"
                        onClick={() => setExpandedCategoryIds(prev => ({ ...prev, [cat.id]: !isExpanded }))}
                      >
                        <ChevronDownIcon className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                        <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate">{cat.name}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          {catItemCount} item{catItemCount !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                          {subs.length} sub-cat{subs.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedParentCategoryId(cat.id);
                            setNewSubcategoryName('');
                            setIsAddSubcategoryModalOpen(true);
                          }}
                          className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded flex items-center gap-1 font-medium transition-colors"
                          title="Add Sub-Category"
                        >
                          <AddIcon className="w-3 h-3" />
                          <span className="hidden sm:inline">Add Sub-Cat</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCategory(cat);
                            setEditCategoryName(cat.name);
                          }}
                          className="p-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                          title="Edit Category Name"
                        >
                          <EditIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
                          title="Delete Category"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Subcategories List */}
                    {isExpanded && (
                      <div className="p-3 bg-white dark:bg-zinc-800/40">
                        {subs.length === 0 ? (
                          <div className="text-center py-2 text-xs text-zinc-400 italic">
                            No sub-categories defined under {cat.name}.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {subs.map(sub => {
                              const subItemCount = itemTypes.filter(it => it.subcategory_id === sub.id).length;
                              return (
                                <div
                                  key={sub.id}
                                  className="flex items-center justify-between p-2 rounded-md bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700/60 text-xs"
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate block">{sub.name}</span>
                                    <span className="text-[10px] text-zinc-400">{subItemCount} item{subItemCount !== 1 ? 's' : ''}</span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSubcategory(sub);
                                        setEditSubcategoryName(sub.name);
                                      }}
                                      className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
                                      title="Edit Sub-Category"
                                    >
                                      <EditIcon className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSubcategory(sub)}
                                      className="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
                                      title="Delete Sub-Category"
                                    >
                                      <TrashIcon className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          <div className="flex justify-end pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsManageCategoriesModalOpen(false)}
              className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* --- Add Category Modal --- */}
      <Modal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        title="Add New Category"
      >
        <form onSubmit={handleAddCategory} className="space-y-4">
          <div>
            <label htmlFor="new-category-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Category Name <span className="text-red-500">*</span>
            </label>
            <input
              id="new-category-name"
              type="text"
              required
              autoFocus
              placeholder="e.g. Electrical, Plumbing, Safety..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className={formInputStyle}
            />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsAddCategoryModalOpen(false)}
              className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !newCategoryName.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-semibold disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Category'}
            </button>
          </div>
        </form>
      </Modal>

      {/* --- Edit Category Modal --- */}
      <Modal
        isOpen={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        title={`Edit Category: ${editingCategory?.name}`}
      >
        {editingCategory && (
          <form onSubmit={handleUpdateCategory} className="space-y-4">
            <div>
              <label htmlFor="edit-category-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Category Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-category-name"
                type="text"
                required
                autoFocus
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                className={formInputStyle}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Renaming this category will automatically update all associated item types.
              </p>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !editCategoryName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-semibold disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* --- Add Sub-Category Modal --- */}
      <Modal
        isOpen={isAddSubcategoryModalOpen}
        onClose={() => setIsAddSubcategoryModalOpen(false)}
        title="Add New Sub-Category"
      >
        <form onSubmit={handleAddSubcategory} className="space-y-4">
          <div>
            <label htmlFor="subcategory-parent-cat" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Parent Category <span className="text-red-500">*</span>
            </label>
            <select
              id="subcategory-parent-cat"
              value={selectedParentCategoryId || (categories[0]?.id || '')}
              onChange={(e) => setSelectedParentCategoryId(parseInt(e.target.value, 10))}
              className={formInputStyle}
            >
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="new-subcategory-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Sub-Category Name <span className="text-red-500">*</span>
            </label>
            <input
              id="new-subcategory-name"
              type="text"
              required
              autoFocus
              placeholder="e.g. 25mm Fittings, Boots, Cables..."
              value={newSubcategoryName}
              onChange={(e) => setNewSubcategoryName(e.target.value)}
              className={formInputStyle}
            />
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setIsAddSubcategoryModalOpen(false)}
              className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !newSubcategoryName.trim() || !selectedParentCategoryId}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-semibold disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Sub-Category'}
            </button>
          </div>
        </form>
      </Modal>

      {/* --- Edit Sub-Category Modal --- */}
      <Modal
        isOpen={!!editingSubcategory}
        onClose={() => setEditingSubcategory(null)}
        title={`Edit Sub-Category: ${editingSubcategory?.name}`}
      >
        {editingSubcategory && (
          <form onSubmit={handleUpdateSubcategory} className="space-y-4">
            <div>
              <label htmlFor="edit-subcategory-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Sub-Category Name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-subcategory-name"
                type="text"
                required
                autoFocus
                value={editSubcategoryName}
                onChange={(e) => setEditSubcategoryName(e.target.value)}
                className={formInputStyle}
              />
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setEditingSubcategory(null)}
                className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !editSubcategoryName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-semibold disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={isAddLocationModalOpen} onClose={() => setIsAddLocationModalOpen(false)} title="Add New Location">
        <form onSubmit={handleAddLocation} className="space-y-4">
            <div>
                <label htmlFor="new-location-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location Name</label>
                <input id="new-location-name" type="text" required value={newLocationInfo.name} onChange={(e) => setNewLocationInfo({ name: e.target.value })} className={formInputStyle} placeholder="e.g. Warehouse B" />
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button type="button" onClick={() => setIsAddLocationModalOpen(false)} className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-500 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Add Location</button>
            </div>
        </form>
      </Modal>

      <Modal isOpen={!!editingLocation} onClose={() => setEditingLocation(null)} title="Edit Location">
        {editingLocation && (
            <form onSubmit={handleUpdateLocation} className="space-y-4">
                <div>
                    <label htmlFor="edit-location-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location Name</label>
                    <input id="edit-location-name" type="text" required value={editingLocation.name} onChange={(e) => setEditingLocation(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                </div>
                <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                    <button type="button" onClick={() => setEditingLocation(null)} className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-500 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600">Cancel</button>
                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Save Changes</button>
                </div>
            </form>
        )}
      </Modal>

      <Modal isOpen={isAddSupplierModalOpen} onClose={() => setIsAddSupplierModalOpen(false)} title="Add New Supplier">
        <form onSubmit={handleAddSupplier} className="space-y-4">
             <div>
                <label htmlFor="supplier-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier Name</label>
                <input id="supplier-name" type="text" required value={newSupplierInfo.name} onChange={(e) => setNewSupplierInfo(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
                <label htmlFor="supplier-contact" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Contact Person</label>
                <input id="supplier-contact" type="text" value={newSupplierInfo.contact_person} onChange={(e) => setNewSupplierInfo(prev => ({...prev, contact_person: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
                <label htmlFor="supplier-phone" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Phone</label>
                <input id="supplier-phone" type="tel" value={newSupplierInfo.phone} onChange={(e) => setNewSupplierInfo(prev => ({...prev, phone: e.target.value}))} className={formInputStyle} />
            </div>
             <div>
                <label htmlFor="supplier-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                <input id="supplier-email" type="email" value={newSupplierInfo.email} onChange={(e) => setNewSupplierInfo(prev => ({...prev, email: e.target.value}))} className={formInputStyle} />
            </div>
             <div>
                <label htmlFor="supplier-lead-time" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Lead Time (days)</label>
                <input id="supplier-lead-time" type="number" min="0" value={newSupplierInfo.lead_time_days} onChange={(e) => setNewSupplierInfo(prev => ({...prev, lead_time_days: e.target.value}))} className={formInputStyle} />
            </div>
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setIsAddSupplierModalOpen(false)}>Cancel</button>
                <button type="submit">Add Supplier</button>
            </div>
        </form>
      </Modal>

      <Modal isOpen={!!editingSupplier} onClose={() => setEditingSupplier(null)} title="Edit Supplier">
        {editingSupplier && (
            <form onSubmit={handleUpdateSupplier} className="space-y-4">
                <div>
                    <label htmlFor="edit-supplier-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier Name</label>
                    <input id="edit-supplier-name" type="text" required value={editingSupplier.name} onChange={(e) => setEditingSupplier(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                </div>
                <div>
                    <label htmlFor="edit-supplier-contact" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Contact Person</label>
                    <input id="edit-supplier-contact" type="text" value={editingSupplier.contact_person || ''} onChange={(e) => setEditingSupplier(prev => ({...prev, contact_person: e.target.value}))} className={formInputStyle} />
                </div>
                <div>
                    <label htmlFor="edit-supplier-phone" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Phone</label>
                    <input id="edit-supplier-phone" type="tel" value={editingSupplier.phone || ''} onChange={(e) => setEditingSupplier(prev => ({...prev, phone: e.target.value}))} className={formInputStyle} />
                </div>
                <div>
                    <label htmlFor="edit-supplier-email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
                    <input id="edit-supplier-email" type="email" value={editingSupplier.email || ''} onChange={(e) => setEditingSupplier(prev => ({...prev, email: e.target.value}))} className={formInputStyle} />
                </div>
                <div>
                    <label htmlFor="edit-supplier-lead-time" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Lead Time (days)</label>
                    <input id="edit-supplier-lead-time" type="number" min="0" value={editingSupplier.lead_time_days || ''} onChange={(e) => setEditingSupplier(prev => ({...prev, lead_time_days: e.target.value}))} className={formInputStyle} />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setEditingSupplier(null)}>Cancel</button>
                    <button type="submit">Save Changes</button>
                </div>
            </form>
        )}
      </Modal>
      
      <Modal isOpen={isBatchReturnModalOpen} onClose={() => setIsBatchReturnModalOpen(false)} title="Batch Return from Team">
          <form onSubmit={handleBatchReturn} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  Select a team to view items assigned to them within the last 24 hours. You can then specify how many of each item you want to return to stock (Leading Stores).
              </p>
              
              <div>
                  <label htmlFor="batch-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team</label>
                  <select 
                      id="batch-team" 
                      value={batchReturnTeam} 
                      onChange={(e) => {
                          setBatchReturnTeam(e.target.value);
                          setBatchReturnQuantities({});
                      }}
                      className={formInputStyle}
                      required
                  >
                      <option value="" disabled>Select a team...</option>
                      {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                  </select>
              </div>

              {batchReturnTeam && (
                  <div className="mt-4 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                          <thead className="bg-zinc-50 dark:bg-zinc-800 sticky top-0 z-10">
                              <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item Name</th>
                                  <th className="px-4 py-3 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Assigned (Last 24h)</th>
                                  <th className="px-4 py-3 text-center text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Qty to Return</th>
                              </tr>
                          </thead>
                          <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                              {(() => {
                                  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                                  const teamStock = stock.filter(s => s.assigned_to === batchReturnTeam && s.assigned_at && new Date(s.assigned_at) >= twentyFourHoursAgo);
                                  if (teamStock.length === 0) {
                                      return (
                                          <tr>
                                              <td colSpan="3" className="px-4 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                                                  No items assigned to {batchReturnTeam} in the last 24 hours.
                                              </td>
                                          </tr>
                                      );
                                  }

                                  const grouped = {};
                                  teamStock.forEach(item => {
                                      if (!grouped[item.name]) grouped[item.name] = 0;
                                      grouped[item.name]++;
                                  });

                                  return Object.entries(grouped).map(([name, count]) => (
                                      <tr key={name}>
                                          <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</td>
                                          <td className="px-4 py-3 text-sm text-center text-zinc-500 dark:text-zinc-400">{count}</td>
                                          <td className="px-4 py-3 text-center">
                                              <input 
                                                  type="number"
                                                  min="0"
                                                  max={count}
                                                  value={batchReturnQuantities[name] || ''}
                                                  onChange={(e) => setBatchReturnQuantities(prev => ({...prev, [name]: e.target.value}))}
                                                  className="w-20 text-center rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 sm:text-sm py-1"
                                                  placeholder="0"
                                              />
                                          </td>
                                      </tr>
                                  ));
                              })()}
                          </tbody>
                      </table>
                  </div>
              )}
              
              <div className="flex justify-end space-x-3 pt-6 mt-6">
                  <button type="button" onClick={() => setIsBatchReturnModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isBatchReturning || !batchReturnTeam} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center disabled:bg-blue-400">
                      {isBatchReturning && <Spinner className="w-4 h-4 mr-2" />}
                      {isBatchReturning ? 'Processing...' : 'Submit Batch Return'}
                  </button>
              </div>
          </form>
      </Modal>

      <Modal isOpen={!!returnModalData} onClose={() => setReturnModalData(null)} title="Return Items to Stock">
        {returnModalData && (
          <form onSubmit={handleConfirmReturn} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  You are returning <strong>{returnModalData.name}</strong> from <strong>{returnModalData.assigned_to}</strong> back to stock ({(activeLocation && activeLocation !== 'All') ? activeLocation : (displayLocations[0] || Location.LEADING_STORES)}).
              </p>
              
              {(returnModalData.quantity > 1 || (returnModalData.items && returnModalData.items.length > 1)) && (
                  <div>
                      <label htmlFor="return-quantity" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Quantity to Return (Max {returnModalData.quantity || returnModalData.items.length})
                      </label>
                      <input 
                          type="number" 
                          id="return-quantity" 
                          min="1" 
                          max={returnModalData.quantity || returnModalData.items.length} 
                          value={returnQuantity} 
                          onChange={(e) => setReturnQuantity(e.target.value)}
                          className={formInputStyle}
                          required
                      />
                  </div>
              )}
              
              <div className="flex justify-end space-x-3 pt-6 border-t border-zinc-200 dark:border-zinc-700 mt-6">
                  <button type="button" onClick={() => setReturnModalData(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isReturningStock} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium flex items-center disabled:bg-blue-400">
                      {isReturningStock && <Spinner className="w-4 h-4 mr-2" />}
                      {isReturningStock ? 'Returning...' : 'Confirm Return'}
                  </button>
              </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={confirmationModal.isOpen} onClose={() => setConfirmationModal({isOpen: false})} title={confirmationModal.title}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{confirmationModal.message}</p>
        <div className="flex justify-end space-x-3 pt-6">
          <button type="button" onClick={() => setConfirmationModal({isOpen: false})} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
          <button 
            type="button" 
            onClick={executeConfirmationAction} 
            disabled={isConfirmingAction}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium disabled:bg-red-400 flex items-center justify-center min-w-[120px]"
          >
             {isConfirmingAction && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
             {confirmationModal.confirmText || 'Confirm'}
          </button>
        </div>
      </Modal>
      
      <Modal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} title="App Settings">
        <div className="space-y-6">
           <div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Appearance</h3>
              <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                  <label htmlFor="dark-mode-toggle" className="font-medium text-zinc-700 dark:text-zinc-300">Dark Mode</label>
                   <button
                    id="dark-mode-toggle"
                    onClick={toggleDarkMode}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 ${
                        isDarkMode ? 'bg-blue-600' : 'bg-zinc-200'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isDarkMode ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
              </div>
           </div>
           <div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Scanner</h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg space-y-4">
                  <div className="flex items-center justify-between">
                     <label htmlFor="beep-toggle" className="font-medium text-zinc-700 dark:text-zinc-300">Audible Beep on Scan</label>
                      <button
                        id="beep-toggle"
                        onClick={() => setIsBeepEnabled(!isBeepEnabled)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 ${
                            isBeepEnabled ? 'bg-blue-600' : 'bg-zinc-200'
                        }`}
                      >
                        <span className="sr-only">Enable beep</span>
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isBeepEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                  </div>
                  {Capacitor.isNativePlatform() && (
                    <div className="pt-4 border-t border-zinc-200 dark:border-zinc-600">
                        <label className="block font-medium text-zinc-700 dark:text-zinc-300">Scanner Type</label>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Use the built-in camera or an external handheld scanner.</p>
                        <div className="flex rounded-md shadow-sm">
                            <button
                                type="button"
                                disabled
                                className={`relative inline-flex items-center rounded-l-md px-4 py-2 text-sm font-medium border focus:z-10 focus:outline-none focus:ring-1 focus:ring-blue-500 ${scannerPreference === 'camera' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                Camera
                            </button>
                            <button
                                type="button"
                                onClick={() => setScannerPreference('external')}
                                className={`relative -ml-px inline-flex items-center rounded-r-md px-4 py-2 text-sm font-medium border focus:z-10 focus:outline-none focus:ring-1 focus:ring-blue-500 ${scannerPreference === 'external' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                            >
                                External
                            </button>
                        </div>
                    </div>
                  )}
              </div>
           </div>
           <div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Security</h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                  <button 
                      onClick={() => {
                          setIsSettingsModalOpen(false);
                          setPinChangeError('');
                          setPinChangeData({ currentPin: '', newPin: '', confirmNewPin: '' });
                          setIsChangePinModalOpen(true);
                      }}
                      className="w-full text-left font-medium text-zinc-700 dark:text-zinc-300"
                  >
                      <div className="flex justify-between items-center">
                          <span>Change Your PIN</span>
                          <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">Edit &rarr;</span>
                      </div>
                  </button>
              </div>
            </div>
            {isAdminProfile && (
               <div>
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">System Administration</h3>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      <button 
                          onClick={() => {
                              setIsSettingsModalOpen(false);
                              handleAdminClick();
                          }}
                          className="w-full text-left font-medium text-zinc-700 dark:text-zinc-300"
                      >
                          <div className="flex justify-between items-center">
                              <span>Go to Admin Panel</span>
                              <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">Manage &rarr;</span>
                          </div>
                      </button>
                  </div>
                </div>
            )}
            
            
            {isAdminProfile && (
               <div>
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Developer Tools</h3>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      {!isDevMode ? (
                          <button 
                              onClick={() => {
                                  setIsSettingsModalOpen(false);
                                  setIsDevLoginModalOpen(true);
                              }}
                              className="w-full text-left font-medium text-zinc-700 dark:text-zinc-300"
                          >
                              <div className="flex justify-between items-center">
                                  <span>Enable Developer Mode</span>
                                  <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">Unlock &rarr;</span>
                              </div>
                          </button>
                      ) : (
                          <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                  <span className="text-green-600 dark:text-green-400 font-bold text-sm uppercase tracking-wider">Dev Mode Active</span>
                                  <button onClick={() => setIsDevMode(false)} className="text-xs text-red-600 hover:underline">Disable</button>
                              </div>
                              <button 
                                  onClick={() => {
                                      setIsSettingsModalOpen(false);
                                      setIsDevPurgeModalOpen(true);
                                  }}
                                  className="w-full text-left font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800/30"
                              >
                                  <div className="flex justify-between items-center">
                                      <span>Purge Barcode Items</span>
                                      <span className="text-sm font-semibold">&rarr;</span>
                                  </div>
                              </button>
                          </div>
                      )}
                  </div>
                </div>
            )}

                        <div className="pt-6 mt-6 border-t border-zinc-200 dark:border-zinc-700 flex justify-center">
                <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-mono rounded-full font-medium tracking-wide">
                    Version v0.10
                </span>
            </div>
        </div>
      </Modal>

      
      <Modal isOpen={isDevLoginModalOpen} onClose={() => setIsDevLoginModalOpen(false)} title="Developer Mode">
          <form onSubmit={handleDevLogin} className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Enter the developer password to access advanced tools.</p>
              <div>
                  <label htmlFor="dev-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
                  <input
                      type="password"
                      id="dev-password"
                      value={devPasswordInput}
                      onChange={(e) => setDevPasswordInput(e.target.value)}
                      className={formInputStyle}
                      autoFocus
                  />
                  {devLoginError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{devLoginError}</p>}
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  <button type="button" onClick={() => setIsDevLoginModalOpen(false)} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-300 dark:hover:bg-zinc-600 font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">Unlock</button>
              </div>
          </form>
      </Modal>

      <Modal isOpen={isDevPurgeModalOpen} onClose={() => setIsDevPurgeModalOpen(false)} title="Purge Barcode Items">
          <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Search for a barcode to delete ALL associated stock items and its item type from the database. 
                  <strong className="text-red-600 block mt-2">WARNING: This is a destructive action and cannot be undone.</strong>
              </p>
              
              <form onSubmit={handleDevPurgeSearch} className="flex gap-2">
                  <input
                      type="text"
                      placeholder="Scan or enter barcode"
                      value={devPurgeBarcode}
                      onChange={(e) => setDevPurgeBarcode(e.target.value)}
                      className={formInputStyle}
                  />
                  <button type="submit" disabled={devPurgeLoading} className="px-4 py-2 bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 rounded-md whitespace-nowrap font-medium disabled:opacity-50">
                      {devPurgeLoading ? 'Searching...' : 'Search'}
                  </button>
              </form>

              {devPurgeResults && (
                  <div className="mt-4 p-4 border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 rounded-lg">
                      <h4 className="font-bold text-red-800 dark:text-red-300 mb-2">Search Results</h4>
                      <ul className="list-disc pl-5 text-sm text-red-700 dark:text-red-400 space-y-1 mb-4">
                          <li>Found <strong>{devPurgeResults.stockItems.length}</strong> physical stock items.</li>
                          <li>Found <strong>{devPurgeResults.itemType ? '1' : '0'}</strong> registered item type.</li>
                      </ul>
                      
                      {devPurgeResults.stockItems.length > 0 || devPurgeResults.itemType ? (
                          <div className="flex justify-end gap-3 pt-3 border-t border-red-200 dark:border-red-800/30">
                              <button onClick={() => setDevPurgeResults(null)} className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md">
                                  Cancel
                              </button>
                              <button onClick={() => {
                                  setConfirmationModal({
                                      isOpen: true,
                                      title: 'Confirm Total Purge',
                                      message: `Are you absolutely sure you want to permanently delete ${devPurgeResults.stockItems.length} stock items${devPurgeResults.itemType ? ' and the item type' : ''} for barcode ${devPurgeBarcode}? This action cannot be reversed.`,
                                      onConfirm: handleDevPurgeConfirm,
                                      confirmText: 'Yes, Delete Everything',
                                      isDestructive: true
                                  });
                              }} className="px-4 py-2 text-sm font-bold bg-red-600 text-white hover:bg-red-700 rounded-md shadow-sm">
                                  Delete All
                              </button>
                          </div>
                      ) : (
                          <p className="text-sm font-medium text-zinc-600">No items or types found for this barcode.</p>
                      )}
                  </div>
              )}
          </div>
      </Modal>

      <Modal isOpen={isChangePinModalOpen} onClose={() => setIsChangePinModalOpen(false)} title="Change PIN">
        <form onSubmit={handleChangePinSubmit} className="space-y-4">
            {selectedProfile.pin && (
                <div>
                    <label htmlFor="current-pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Current PIN</label>
                    <input
                        id="current-pin"
                        type="password"
                        inputMode="numeric"
                        maxLength="4"
                        required
                        value={pinChangeData.currentPin}
                        onChange={(e) => setPinChangeData(p => ({...p, currentPin: e.target.value.replace(/\D/g, '')}))}
                        className={`${formInputStyle} font-mono tracking-widest`}
                    />
                </div>
            )}
            <div>
                <label htmlFor="new-pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">New 4-Digit PIN</label>
                <input
                    id="new-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    minLength="4"
                    pattern="\d{4}"
                    required
                    value={pinChangeData.newPin}
                    onChange={(e) => setPinChangeData(p => ({...p, newPin: e.target.value.replace(/\D/g, '')}))}
                    className={`${formInputStyle} font-mono tracking-widest`}
                />
            </div>
            <div>
                <label htmlFor="confirm-new-pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Confirm New PIN</label>
                <input
                    id="confirm-new-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength="4"
                    minLength="4"
                    pattern="\d{4}"
                    required
                    value={pinChangeData.confirmNewPin}
                    onChange={(e) => setPinChangeData(p => ({...p, confirmNewPin: e.target.value.replace(/\D/g, '')}))}
                    className={`${formInputStyle} font-mono tracking-widest`}
                />
            </div>

            {pinChangeError && <p className="text-sm text-red-600 dark:text-red-400">{pinChangeError}</p>}

            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setIsChangePinModalOpen(false)} className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-500 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400 flex items-center justify-center min-w-[120px]">
                    {isSubmitting ? <Spinner className="w-5 h-5"/> : 'Save Changes'}
                </button>
            </div>
        </form>
    </Modal>

      <Modal isOpen={isPrintInfoModalOpen} onClose={() => setIsPrintInfoModalOpen(false)} title="Printing on Mobile">
        <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            To print this report from your mobile device, please take a screenshot and use your device's built-in printing functionality from the Photos or Gallery app.
          </p>
          <p>
            This allows you to select any compatible AirPrint (iOS) or Wi-Fi Direct (Android) printer connected to your network.
          </p>
          <div className="flex justify-end pt-4">
            <button onClick={() => setIsPrintInfoModalOpen(false)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Got it
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isProfilesModalOpen} onClose={() => setIsProfilesModalOpen(false)} title="Manage Profiles">
        <div className="space-y-4">
          <form onSubmit={handleAddProfile} className="space-y-4 pb-4 border-b border-zinc-200 dark:border-zinc-700">
             <div className="grid grid-cols-2 gap-4">
                <div>
                    <label htmlFor="profile-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Profile Name</label>
                    <input id="profile-name" type="text" required value={newProfileInfo.name} onChange={(e) => setNewProfileInfo(p => ({ ...p, name: e.target.value }))} className={formInputStyle}/>
                </div>
                 <div>
                    <label htmlFor="profile-pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">4-Digit PIN</label>
                    <input id="profile-pin" type="tel" inputMode="numeric" pattern="\d{4}" maxLength="4" required value={newProfileInfo.pin} onChange={(e) => setNewProfileInfo(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} className={`${formInputStyle} font-mono tracking-widest`}/>
                </div>
             </div>
             <div>
                <label htmlFor="profile-role" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
                <select id="profile-role" value={newProfileInfo.role} onChange={e => setNewProfileInfo(p => ({...p, role: e.target.value}))} className={formInputStyle}>
                    <option value="User">User</option>
                    <option value="Admin">Admin</option>
                </select>
             </div>
             <div className="text-right">
                <button type="submit" disabled={isAddingProfile} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-blue-400 flex items-center justify-center min-w-[120px]">
                    {isAddingProfile ? <Spinner /> : 'Add Profile'}
                </button>
             </div>
          </form>

          <div>
              <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">Existing Profiles</h3>
              {profilesLoading ? (
                <ListItemSkeleton count={3} />
              ) : (
                <div className="max-h-60 overflow-y-auto -mx-6 px-6">
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                      {profiles.map(profile => (
                        <li key={profile.id} className="py-3 flex justify-between items-center">
                           <div>
                              <p className="font-medium text-zinc-800 dark:text-zinc-100">{profile.name}</p>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">{profile.role}</p>
                           </div>
                           <div className="flex items-center space-x-2">
                               <button onClick={() => setEditingProfile(profile)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit Profile">
                                   <EditIcon className="w-4 h-4" />
                               </button>
                               <button onClick={() => handleDeleteProfile(profile.id)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete Profile">
                                   <TrashIcon className="w-4 h-4" />
                               </button>
                           </div>
                        </li>
                      ))}
                    </ul>
                </div>
              )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editingProfile} onClose={() => setEditingProfile(null)} title={`Edit ${editingProfile?.name}`}>
        {editingProfile && (
            <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                    <label htmlFor="edit-profile-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Profile Name</label>
                    <input id="edit-profile-name" type="text" required value={editingProfile.name} onChange={(e) => setEditingProfile(p => ({ ...p, name: e.target.value }))} className={formInputStyle}/>
                </div>
                <div>
                    <label htmlFor="edit-profile-pin" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">4-Digit PIN</label>
                    <input id="edit-profile-pin" type="tel" inputMode="numeric" pattern="\d{4}" maxLength="4" required value={editingProfile.pin} onChange={(e) => setEditingProfile(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} className={`${formInputStyle} font-mono tracking-widest`}/>
                </div>
                 <div>
                    <label htmlFor="edit-profile-role" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
                    <select id="edit-profile-role" value={editingProfile.role} onChange={e => setEditingProfile(p => ({...p, role: e.target.value}))} className={formInputStyle}>
                        <option value="User">User</option>
                        <option value="Admin">Admin</option>
                    </select>
                </div>
                 <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setEditingProfile(null)} className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-500 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600">Cancel</button>
                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400 flex items-center justify-center min-w-[120px]">
                        {isSubmitting ? <Spinner /> : 'Save Changes'}
                    </button>
                </div>
            </form>
        )}
      </Modal>

      <Modal isOpen={isThresholdInfoModalOpen} onClose={() => setIsThresholdInfoModalOpen(false)} title="How Thresholds Are Calculated">
        <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
            <p>
                When you run the <strong>Calculate Thresholds</strong> action, the system analyses the past 4 weeks of "OUT" movements (items assigned to teams) to determine a safe reorder point for each item type.
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md p-4">
                <h4 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">The Formula</h4>
                <ul className="list-disc pl-5 space-y-1">
                    <li>We calculate the total usage over the last <strong>4 weeks</strong>.</li>
                    <li>We target a <strong>6-week stock cover</strong> buffer, which means multiplying the 4-week usage by <strong>1.5</strong> (or 150%).</li>
                    <li>Any calculated threshold below <strong>5</strong> is automatically rounded up to <strong>5</strong> to ensure low-usage items aren't caught off guard.</li>
                </ul>
            </div>
            <p>
                <em>Example: If you used 10 items in the last 4 weeks, the new threshold will be set to 15. If you only used 2, the threshold will be safely clamped to the minimum of 5.</em>
            </p>
            <div className="flex justify-end pt-4">
                <button onClick={() => setIsThresholdInfoModalOpen(false)} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Understood</button>
            </div>
        </div>
      </Modal>
      
      <Modal isOpen={isThresholdSummaryModalOpen} onClose={() => setIsThresholdSummaryModalOpen(false)} title="Stock Threshold Update Summary">
        {thresholdSummary && (
            <div className="space-y-4">
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                    Successfully updated {thresholdSummary.updatedCount} item thresholds.
                </p>
                {thresholdSummary.changes.length > 0 ? (
                    <div className="max-h-60 overflow-y-auto border-t border-b border-zinc-200 dark:border-zinc-700 -mx-6 px-6">
                        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                            {thresholdSummary.changes.map(change => (
                                <li key={change.name} className="py-2">
                                    <p className="font-medium text-zinc-800 dark:text-zinc-100">{change.name}</p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Old: {change.oldThreshold} &rarr; New: <span className="font-bold">{change.newThreshold}</span>
                                    </p>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <p className="text-zinc-600 dark:text-zinc-300">No thresholds required an update.</p>
                )}
                <div className="flex justify-end pt-4">
                    <button onClick={() => setIsThresholdSummaryModalOpen(false)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        Close
                    </button>
                </div>
            </div>
        )}
      </Modal>

      <Modal isOpen={isUnrecognizedModalOpen} onClose={() => setIsUnrecognizedModalOpen(false)} title="Unrecognised Scans & Discrepancies Log" maxWidth="max-w-xl">
          <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  These records include unrecognised barcodes scanned across storehouses and stock discrepancy alerts when items were signed out beyond recorded stock.
              </p>
              {unrecognizedScans.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
                      No unrecognised scans or stock discrepancies found.
                  </div>
              ) : (
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                      {unrecognizedScans.map(scan => {
                          const isDiscrepancy = scan.barcode && (scan.barcode.includes('Stock Discrepancy') || scan.barcode.includes('Stock Take') || scan.barcode.includes('excess'));
                          
                          if (isDiscrepancy) {
                              return (
                                  <li key={scan.id} className="p-4 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors">
                                      <div className="flex items-start justify-between gap-3">
                                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                              <div className="p-1.5 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-full flex-shrink-0 mt-0.5">
                                                  <AlertTriangleIcon className="w-4 h-4" />
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                                      <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200 rounded">
                                                          Stock Discrepancy
                                                      </span>
                                                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                                          {new Date(scan.scanned_at).toLocaleString('en-GB')}
                                                          {scan.profile_name && ` by ${scan.profile_name}`}
                                                      </span>
                                                  </div>
                                                  <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed">
                                                      {scan.barcode}
                                                  </p>
                                                  <div className="mt-2.5 flex items-center gap-2">
                                                      <button
                                                          type="button"
                                                          onClick={() => {
                                                              setIsUnrecognizedModalOpen(false);
                                                              navigateTo(View.STOCK_TAKE);
                                                          }}
                                                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                                                      >
                                                          <ClipboardCheckIcon className="w-3.5 h-3.5" />
                                                          <span>Conduct Stock Take</span>
                                                      </button>
                                                  </div>
                                              </div>
                                          </div>
                                          <button 
                                              onClick={() => deleteUnrecognizedScan(scan.id)}
                                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors flex-shrink-0"
                                              title="Dismiss notification"
                                          >
                                              <TrashIcon className="w-4 h-4" />
                                          </button>
                                      </div>
                                  </li>
                              );
                          }

                          return (
                              <li key={scan.id} className="p-4 flex items-center justify-between bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                  <div>
                                      <div className="flex items-center gap-2 mb-1">
                                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded">
                                              Unrecognised Barcode
                                          </span>
                                      </div>
                                      <p className="font-mono font-bold text-sm text-zinc-900 dark:text-zinc-100">{scan.barcode}</p>
                                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                          Scanned: {new Date(scan.scanned_at).toLocaleString('en-GB')}
                                          {scan.profile_name && ` by ${scan.profile_name}`}
                                      </p>
                                  </div>
                                  <button 
                                      onClick={() => deleteUnrecognizedScan(scan.id)}
                                      className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                      title="Dismiss notification"
                                  >
                                      <TrashIcon className="w-5 h-5" />
                                  </button>
                              </li>
                          );
                      })}
                  </ul>
              )}
          </div>
      </Modal>

      {/* --- Manage Supplier Part Numbers Modal --- */}
      <Modal
        isOpen={isManagePartNumbersModalOpen && !!selectedItemTypeForParts}
        onClose={() => {
          setIsManagePartNumbersModalOpen(false);
          setSelectedItemTypeForParts(null);
          setEditingPartNumber(null);
          setNewPartNumberInfo({ supplier_id: '', supplier_name: '', part_number: '', barcode: '', purchase_price: '', notes: '' });
        }}
        title={`Supplier Part Numbers`}
        maxWidth="max-w-2xl"
      >
        {selectedItemTypeForParts && (
          <div className="space-y-6">
            {/* Header info */}
            <div className="p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/60 rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">{selectedItemTypeForParts.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 mt-1 flex-wrap">
                    <span>Category: <strong>{selectedItemTypeForParts.category}</strong></span>
                    {selectedItemTypeForParts.item_subcategory?.name && (
                      <>
                        <span>&bull;</span>
                        <span>Subcategory: <strong>{selectedItemTypeForParts.item_subcategory.name}</strong></span>
                      </>
                    )}
                    {selectedItemTypeForParts.barcode && (
                      <>
                        <span>&bull;</span>
                        <span className="font-mono">Internal Barcode: <strong>{selectedItemTypeForParts.barcode}</strong></span>
                      </>
                    )}
                  </div>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200">
                  {(supplierPartNumbersByItemTypeId[selectedItemTypeForParts.id] || []).length} Registered
                </span>
              </div>
              <p className="text-xs text-blue-800 dark:text-blue-300 mt-2">
                Different suppliers can supply this item with their own unique part numbers. Add them below so scanning or searching any supplier's part number instantly identifies this item.
              </p>
            </div>

            {/* Existing Registered Part Numbers List */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-2.5 flex items-center justify-between">
                <span>Existing Supplier Part Numbers</span>
              </h4>

              {(() => {
                const parts = supplierPartNumbersByItemTypeId[selectedItemTypeForParts.id] || [];
                if (parts.length === 0) {
                  return (
                    <div className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">
                      No supplier part numbers registered for this item type yet. Add the first one below!
                    </div>
                  );
                }

                return (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {parts.map(part => {
                      const isEditingThis = editingPartNumber?.id === part.id;
                      if (isEditingThis) {
                        return (
                          <div key={part.id} className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-blue-400 dark:border-blue-500 space-y-3">
                            <div className="font-semibold text-xs text-blue-600 dark:text-blue-400">Editing Supplier Part Number</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Supplier</label>
                                <select
                                  value={editingPartNumber.supplier_id || ''}
                                  onChange={(e) => setEditingPartNumber(prev => ({ ...prev, supplier_id: e.target.value }))}
                                  className={`${formInputStyle} !mt-0 text-xs py-1.5`}
                                >
                                  <option value="">Select Supplier...</option>
                                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Part Number *</label>
                                <input
                                  type="text"
                                  value={editingPartNumber.part_number}
                                  onChange={(e) => setEditingPartNumber(prev => ({ ...prev, part_number: e.target.value }))}
                                  className={`${formInputStyle} !mt-0 text-xs py-1.5 font-mono`}
                                  placeholder="e.g. RX-CAT6-2M"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Packaging Barcode</label>
                                <input
                                  type="text"
                                  value={editingPartNumber.barcode || ''}
                                  onChange={(e) => setEditingPartNumber(prev => ({ ...prev, barcode: e.target.value }))}
                                  className={`${formInputStyle} !mt-0 text-xs py-1.5 font-mono`}
                                  placeholder="Optional package barcode"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Purchase Price (£)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editingPartNumber.purchase_price || ''}
                                  onChange={(e) => setEditingPartNumber(prev => ({ ...prev, purchase_price: e.target.value }))}
                                  className={`${formInputStyle} !mt-0 text-xs py-1.5`}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Notes</label>
                              <input
                                type="text"
                                value={editingPartNumber.notes || ''}
                                onChange={(e) => setEditingPartNumber(prev => ({ ...prev, notes: e.target.value }))}
                                className={`${formInputStyle} !mt-0 text-xs py-1.5`}
                                placeholder="e.g., Box of 10 units"
                              />
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditingPartNumber(null)}
                                className="px-3 py-1 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-xs font-medium text-zinc-700 dark:text-zinc-200 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateSupplierPartNumber(part.id, editingPartNumber)}
                                disabled={isSubmitting || !editingPartNumber.part_number.trim()}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white rounded disabled:opacity-50"
                              >
                                Save Changes
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={part.id} className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-lg border border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-3 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
                                {part.suppliers?.name || part.supplier_name || 'Standard Supplier'}
                              </span>
                              <span className="font-mono font-bold text-sm text-blue-600 dark:text-blue-400">
                                {part.part_number}
                              </span>
                              {part.barcode && (
                                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                                  Barcode: {part.barcode}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex-wrap">
                              {part.purchase_price > 0 && <span>Cost: £{Number(part.purchase_price).toFixed(2)}</span>}
                              {part.notes && <span className="italic">Note: {part.notes}</span>}
                            </div>
                          </div>
                          <div className="flex items-center space-x-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingPartNumber({ ...part })}
                              className="p-1.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                              title="Edit Part Number"
                            >
                              <EditIcon className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSupplierPartNumber(part.id)}
                              className="p-1.5 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                              title="Delete Part Number"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Add New Supplier Part Number Form */}
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3 flex items-center gap-1.5">
                <AddIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Add Supplier Part Number</span>
              </h4>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  await handleAddSupplierPartNumber(selectedItemTypeForParts.id, newPartNumberInfo);
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Supplier <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={newPartNumberInfo.supplier_id}
                      onChange={(e) => setNewPartNumberInfo(prev => ({ ...prev, supplier_id: e.target.value }))}
                      className={formInputStyle + " text-sm py-2"}
                    >
                      <option value="">Select a Supplier...</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Supplier's Part Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. CEF-CAT6-02M or RX-9801"
                      required
                      value={newPartNumberInfo.part_number}
                      onChange={(e) => setNewPartNumberInfo(prev => ({ ...prev, part_number: e.target.value }))}
                      className={formInputStyle + " text-sm py-2 font-mono"}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Supplier Barcode (Optional)
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                        <BarcodeIcon className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        placeholder="e.g. 501234567890"
                        value={newPartNumberInfo.barcode}
                        onChange={(e) => setNewPartNumberInfo(prev => ({ ...prev, barcode: e.target.value }))}
                        className={formInputStyle + " pl-9 text-sm py-2 font-mono"}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Supplier Purchase Price (£)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={newPartNumberInfo.purchase_price}
                      onChange={(e) => setNewPartNumberInfo(prev => ({ ...prev, purchase_price: e.target.value }))}
                      className={formInputStyle + " text-sm py-2"}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Notes / Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Comes in pack of 10, order code XYZ"
                    value={newPartNumberInfo.notes}
                    onChange={(e) => setNewPartNumberInfo(prev => ({ ...prev, notes: e.target.value }))}
                    className={formInputStyle + " text-sm py-2"}
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || !newPartNumberInfo.part_number.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isSubmitting && <Spinner className="w-4 h-4 mr-1" />}
                    <AddIcon className="w-4 h-4" />
                    <span>Add Supplier Part Number</span>
                  </button>
                </div>
              </form>
            </div>

            <div className="flex justify-end pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => {
                  setIsManagePartNumbersModalOpen(false);
                  setSelectedItemTypeForParts(null);
                  setEditingPartNumber(null);
                  setNewPartNumberInfo({ supplier_id: '', supplier_name: '', part_number: '', barcode: '', purchase_price: '', notes: '' });
                }}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 text-sm font-medium rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default StockManagerApp;
