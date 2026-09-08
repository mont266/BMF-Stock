import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useStock } from '../hooks/useStock';
import { View, Location, Team, TeamType, StockCategory, POStatus } from '../types';
import { LOCATIONS, STOCK_CATEGORIES } from '../constants';
import { useDarkMode } from '../hooks/useDarkMode';
import Scanner from './Scanner';
import Modal from './Modal';
import PurchasingPage from './PurchasingPage';
import StockTakePage from './StockTakePage';
import { BrandIcon, ScanIcon, InformationCircleIcon, AddIcon, ListIcon, ChevronDownIcon, LogoutIcon, AdminIcon, BoxIcon, TagIcon, UsersIcon, BuildingStoreIcon, SunIcon, MoonIcon, EditIcon, TrashIcon, CurrencyPoundIcon, ArchiveIcon, PlusCircleIcon, ArrowRightCircleIcon, CheckCircleIcon, XCircleIcon, SettingsIcon, XIcon, ChartBarIcon, PurchasingIcon, SwitchUserIcon, CalculatorIcon, DocumentArrowDownIcon, UploadIcon, RefreshIcon, ClipboardCheckIcon, BellIcon } from './Icons';
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

const ReportingPage = ({ filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen }) => {
  
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
        const threshold = parseInt(type.stock_threshold) || 0;
        
        let status = 'OK';
        if (currentStock <= threshold) {
            status = 'CRITICAL';
        } else if (threshold > 0 && currentStock <= threshold * 1.5) {
            status = 'WARNING';
        }

        if (status !== 'OK') {
            report.push({
                name: type.name,
                currentStock,
                threshold,
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
        doc.text(`Period: ${new Date(filters.startDate).toLocaleDateString()} to ${new Date(filters.endDate).toLocaleDateString()}`, 14, 32);
        
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Start Date</label>
              <input type="date" id="start-date" value={filters.startDate} onChange={e => setFilters(prev => ({...prev, startDate: e.target.value}))} className={formInputStyle} />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">End Date</label>
              <input type="date" id="end-date" value={filters.endDate} onChange={e => setFilters(prev => ({...prev, endDate: e.target.value}))} className={formInputStyle} />
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
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            For period {new Date(filters.startDate).toLocaleDateString()} to {new Date(filters.endDate).toLocaleDateString()}
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
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Currently signed out inventory.</p>
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
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Items that are below or nearing their minimum stock thresholds.</p>
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
                                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Threshold</th>
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
                    <p className="text-sm text-zinc-500 mt-2">
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
    const lowercasedFilter = searchTerm.toLowerCase();
    
    const filtered = {};
    Object.keys(options).forEach(category => {
      const subcategories = options[category];
      const filteredSubcategories = {};
      Object.keys(subcategories).forEach(subcategory => {
        const items = subcategories[subcategory];
        const filteredItems = items.filter(item =>
          item.name.toLowerCase().includes(lowercasedFilter)
        );
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
                                className={`w-full text-left px-4 py-2 text-sm ${type.name === value ? 'bg-blue-600 text-white' : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}
                                onClick={() => handleSelect(type.name)}
                            >
                                {type.name}
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

const StatCard = ({ title, value, icon, colorClass }) => (
    <div className="bg-white dark:bg-zinc-800/50 p-5 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 flex items-center">
        <div className={`rounded-full p-3 ${colorClass}`}>
            {icon}
        </div>
        <div className="ml-4">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
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

const ExternalScannerPage = ({ onScanSuccess, onCancel }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        const focusInput = () => {
            inputRef.current?.focus();
        };
        // Needs a small delay to ensure the element is focusable after render.
        const timeoutId = setTimeout(focusInput, 100); 
        return () => clearTimeout(timeoutId);
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        const scannedValue = inputRef.current?.value.trim();
        if (scannedValue) {
            onScanSuccess(scannedValue);
            // Clear the input field to prepare for the next scan. This is
            // crucial for continuous scanning modes like 'Rapid Out'.
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
                    // Visually hidden but still focusable and able to receive input
                    className="absolute top-[-9999px] left-[-9999px] opacity-0"
                    aria-label="External scanner input"
                    // Re-focus if the input somehow loses focus, making it robust
                    onBlur={() => inputRef.current?.focus()} 
                />
                <button
                    type="button"
                    onClick={onCancel}
                    className="mt-8 px-8 py-3 bg-white/80 dark:bg-zinc-800/80 text-zinc-800 dark:text-zinc-100 rounded-lg backdrop-blur-md text-lg font-semibold border border-zinc-300 dark:border-zinc-700"
                >
                    Cancel
                </button>
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

const RapidScanSummary = ({ summary }) => {
    const summaryItems = Object.entries(summary);

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-sm p-4 z-[10001]">
            <div className="bg-zinc-800/90 dark:bg-zinc-900/90 backdrop-blur-sm shadow-lg rounded-xl p-4 text-white">
                <h3 className="text-lg font-bold mb-2 border-b border-zinc-700 pb-2">Session Summary</h3>
                {summaryItems.length === 0 ? (
                    <p className="text-zinc-400 text-sm">Scan an item to begin...</p>
                ) : (
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                        {summaryItems.map(([name, count]) => (
                            <li key={name} className="flex justify-between items-center text-sm">
                                <span className="font-medium text-zinc-200">{name}</span>
                                <span className="font-mono bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-full">{count}</span>
                            </li>
                        ))}
                    </ul>
                )}
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
  const [newItem, setNewItem] = useState({ name: '', description: '', barcodes: '', firstSerial: '', lastSerial: '', barcode: '', quantity: '1' });
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
  const [dashboardFilters, setDashboardFilters] = useState({ location: 'All' });
  const [assignmentFilters, setAssignmentFilters] = useState({ team: 'All', itemType: 'All', location: 'All', assignedByMe: false });

  const [itemTypes, setItemTypes] = useState([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(true);
  const [editingItemType, setEditingItemType] = useState(null); // e.g., { id, name, price, category, stock_threshold, is_unique, subcategory_id, supplier_id }
  const [newItemTypeInfo, setNewItemTypeInfo] = useState({ name: '', price: '', category: '', subcategory_id: '', stock_threshold: '', is_unique: false, supplier_id: '' });
  const [isAddItemTypeModalOpen, setIsAddItemTypeModalOpen] = useState(false);
  const [expandedItemTypeGroups, setExpandedItemTypeGroups] = useState({});
  const [expandedSubCategory, setExpandedSubCategory] = useState({});

  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [editingTeam, setEditingTeam] = useState(null);
  const [newTeamInfo, setNewTeamInfo] = useState({ name: '', type: TeamType.TEAM });
  const [expandedTeamGroups, setExpandedTeamGroups] = useState({});
  const [isAddTeamModalOpen, setIsAddTeamModalOpen] = useState(false);
  
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [newSupplierInfo, setNewSupplierInfo] = useState({ name: '', contact_person: '', phone: '', email: '', lead_time_days: 7 });
  const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);

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

  // --- State for Scan In ---
  const [isScanModeModalOpen, setIsScanModeModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState(null); // 'in', 'out-quantity', 'out-rapid'
  const [isAddScannedItemModalOpen, setIsAddScannedItemModalOpen] = useState(false);
  const [newScannedItemDetails, setNewScannedItemDetails] = useState({ barcode: '', name: '', description: '', quantity: '1', firstSerial: '', lastSerial: '' });
  const [isAddQuantityModalOpen, setIsAddQuantityModalOpen] = useState(false);
  const [itemForQuantityAdd, setItemForQuantityAdd] = useState(null);
  const [quantityToAdd, setQuantityToAdd] = useState('1');

  // --- State for new Scan Out flow ---
  const [isAssignmentSetupModalOpen, setIsAssignmentSetupModalOpen] = useState(false);
  const [assignmentContext, setAssignmentContext] = useState({ location: Location.LEADING_STORES, team: '' });
  const [isScanOutModeSelectionOpen, setIsScanOutModeSelectionOpen] = useState(false);
  const [isAssignQuantityModalOpen, setIsAssignQuantityModalOpen] = useState(false);
  const [itemForQuantityAssign, setItemForQuantityAssign] = useState(null);
  const [quantityToAssign, setQuantityToAssign] = useState('1');
  const [scanFlash, setScanFlash] = useState({ active: false, type: '' });
  const [toasts, setToasts] = useState([]);
  const isProcessingScanRef = useRef(false);
  const [rapidScanSummary, setRapidScanSummary] = useState({});

  const [isAssignRangeModalOpen, setIsAssignRangeModalOpen] = useState(false);
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
  }, [handleSetView]);

  // --- Native App Back Button/Gesture Handling ---
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const listener = CapacitorApp.addListener('backButton', () => {
        // Priority 1: Close any open modal
        if (scannedItem) { setScannedItem(null); return; }
        if (isAssignmentSetupModalOpen) { setIsAssignmentSetupModalOpen(false); return; }
        if (isScanModeModalOpen) { setIsScanModeModalOpen(false); return; }
        if (isSettingsModalOpen) { setIsSettingsModalOpen(false); return; }
        if (isDevLoginModalOpen) { setIsDevLoginModalOpen(false); return; }
        if (isDevPurgeModalOpen) { setIsDevPurgeModalOpen(false); return; }
        if (isChangePinModalOpen) { setIsChangePinModalOpen(false); return; }
        if (isCreateUserModalOpen) { setIsCreateUserModalOpen(false); return; }
        if (editingItemType) { setEditingItemType(null); return; }
        if (isAddItemTypeModalOpen) { setIsAddItemTypeModalOpen(false); return; }
        if (editingTeam) { setEditingTeam(null); return; }
        if (isAddTeamModalOpen) { setIsAddTeamModalOpen(false); return; }
        if (editingSupplier) { setEditingSupplier(null); return; }
        if (isAddSupplierModalOpen) { setIsAddSupplierModalOpen(false); return; }
        if (isScanOutModeSelectionOpen) { setIsScanOutModeSelectionOpen(false); return; }
        if (isAssignQuantityModalOpen) { setIsAssignQuantityModalOpen(false); return; }
        if (isAssignRangeModalOpen) { setIsAssignRangeModalOpen(false); setRangeAssignDetails({ firstSerial: '', lastSerial: '' }); return; }
        if (isAddScannedItemModalOpen) { setIsAddScannedItemModalOpen(false); return; }
        if (isAddQuantityModalOpen) { setIsAddQuantityModalOpen(false); return; }
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
    editingTeam,
    isAddSupplierModalOpen,
    editingSupplier,
    isScanModeModalOpen,
    isAssignmentSetupModalOpen,
    isScanOutModeSelectionOpen,
    isAssignQuantityModalOpen,
    isAssignRangeModalOpen,
    isAddScannedItemModalOpen,
    isAddQuantityModalOpen,
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
        setTeams(data || []);
        setAssignmentContext(prev => ({ ...prev, team: data?.[0]?.name || '' }));
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
  }, [fetchItemTypes, fetchTeams, fetchCategories, fetchSuppliers, fetchLocations, fetchUnrecognizedScans]);

  const handleScanSuccess = useCallback(async (decodedText) => {
    setError(null);
    try {
        if (scanMode === 'in') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner for 'in' mode
            const items = await getStockItemsByBarcode(decodedText);
            const itemTypeDetails = items.length > 0 ? itemTypes.find(it => it.name === items[0].name) : null;
            if (items.length === 0) {
                const defaultItemType = itemTypes.length > 0 ? itemTypes[0].name : '';
                setNewScannedItemDetails({ 
                    barcode: decodedText, 
                    name: defaultItemType, 
                    description: '', 
                    quantity: '1',
                    firstSerial: decodedText,
                    lastSerial: decodedText,
                });
                setIsAddScannedItemModalOpen(true);
            } else {
                if (itemTypeDetails?.is_unique) {
                    setError(`An item with serial number "${decodedText}" already exists. Unique items cannot be duplicated.`);
                } else {
                    setItemForQuantityAdd(items[0]);
                    setQuantityToAdd('1');
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
                    const items = await getStockItemsByBarcode(decodedText);
                    
                    if (items.length === 0) {
                        logUnrecognizedBarcode(decodedText);
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

                    const itemToAssign = items.find(i => i.assigned_to === Team.UNASSIGNED);
        
                    if (!itemToAssign) {
                        addToast(`Item not in stock`, 'error', decodedText);
                        triggerScanFeedback('error');
                        return; 
                    }
                    
                    // This now returns the updated item without refetching the whole list
                    const updatedItem = await updateStockItemAssignment(itemToAssign.id, assignmentContext.location, assignmentContext.team, selectedProfile.name);
                    
                    // Optimistically update the local state for a super-fast UI response
                    setStock(prevStock => prevStock.map(item => item.id === updatedItem.id ? updatedItem : item));
                    
                    addToast(`${updatedItem.name} assigned`, 'success', decodedText);
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

        } else if (scanMode === 'out-quantity') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner for quantity mode
            const items = await getStockItemsByBarcode(decodedText);
            
            if (items.length === 0) {
                logUnrecognizedBarcode(decodedText);
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

            const availableItems = items.filter(i => i.assigned_to === Team.UNASSIGNED);
            if (availableItems.length === 0) {
                setError(`No available stock found for serial number "${decodedText}".`);
                return;
            }
            setItemForQuantityAssign(availableItems);
            setQuantityToAssign('1');
            setIsAssignQuantityModalOpen(true);
        } else if (scanMode === 'out-range-start') {
            playBeep('success');
            handleSetView(View.LIST); // Stop scanner
            setRangeAssignDetails({ firstSerial: decodedText, lastSerial: decodedText });
            setIsAssignRangeModalOpen(true);
        }
    } catch (e) {
        playBeep('error');
        setError(`Failed to process scan: ${e.message}`);
        handleSetView(View.LIST);
    }
  }, [getStockItemsByBarcode, handleSetView, scanMode, itemTypes, assignmentContext, selectedProfile, playBeep, triggerScanFeedback, addToast, setStock, updateStockItemAssignment, logUnrecognizedBarcode]);
  
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
            updated.quantity = '1';
            updated.firstSerial = '';
            updated.lastSerial = '';
            updated.barcodes = '';

            const newSelectedItemType = itemTypes.find(it => it.name === value);
            if (newSelectedItemType && !newSelectedItemType.is_unique) {
                const barcodesForNewType = [...new Set(stock.filter(item => item.name === value && item.barcode).map(item => item.barcode))].sort();
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
    setNewItem({ name: '', description: '', barcodes: '', firstSerial: '', lastSerial: '', barcode: '', quantity: '1' });
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

            itemsToAdd = barcodes.map(barcode => ({
                name,
                description,
                barcode,
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

            itemsToAdd = Array.from({ length: quantity }, () => ({
                name,
                description,
                barcode: barcode.trim(),
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

            itemsToAdd = serials.map(barcode => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode,
                purchase_price: parseFloat(selectedItemType.price) || 0,
            }));
            successCount = itemsToAdd.length;

        } else {
            const quantity = parseInt(newScannedItemDetails.quantity, 10) || 1;
            if (selectedItemType?.is_unique) {
                if (quantity > 1) {
                    throw new Error("Cannot add multiple unique items with the same serial number.");
                }
                const existing = await getStockItemsByBarcode(newScannedItemDetails.barcode);
                if (existing.length > 0) {
                    throw new Error(`An item with serial number "${newScannedItemDetails.barcode}" already exists.`);
                }
            }
            itemsToAdd = Array.from({ length: quantity }, () => ({
                name: newScannedItemDetails.name,
                description: newScannedItemDetails.description,
                barcode: newScannedItemDetails.barcode,
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
        const itemsToAdd = Array.from({ length: quantity }, () => ({
            name: itemForQuantityAdd.name,
            description: itemForQuantityAdd.description,
            barcode: itemForQuantityAdd.barcode,
            purchase_price: parseFloat(itemTypeDetails?.price) || 0,
        }));

        await bulkAddStockItems(itemsToAdd, selectedProfile.name);
        setSuccessMessage(`+${quantity} Added to ${itemForQuantityAdd.name}`);
        setTimeout(() => setSuccessMessage(null), 3000);
        setIsAddQuantityModalOpen(false);
        setItemForQuantityAdd(null);
    } catch (err) {
        setError(`Failed to add quantity: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleAssignQuantitySubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const numToAssign = parseInt(quantityToAssign, 10);
      if (isNaN(numToAssign) || numToAssign <= 0) {
        throw new Error("Please enter a valid quantity.");
      }
      if (numToAssign > itemForQuantityAssign.length) {
        throw new Error(`Not enough stock. Available: ${itemForQuantityAssign.length}, Requested: ${numToAssign}`);
      }
      const itemsToUpdate = itemForQuantityAssign.slice(0, numToAssign);
      const itemIdsToUpdate = itemsToUpdate.map(item => item.id);

      await bulkUpdateAssignments(itemIdsToUpdate, assignmentContext.location, assignmentContext.team, selectedProfile.name);
      
      setSuccessMessage(`${numToAssign} x ${itemsToUpdate[0].name} assigned to ${assignmentContext.team}.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      setIsAssignQuantityModalOpen(false);
      setItemForQuantityAssign(null);
      await refetchStock();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
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
        const itemsToAssign = stock.filter(item => 
            serials.includes(item.barcode) && item.assigned_to === Team.UNASSIGNED
        );

        if (itemsToAssign.length === 0) {
            throw new Error("No available items found in stock for the given serial range.");
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

  const handleAddItemType = async (e) => {
    e.preventDefault();
    if (!newItemTypeInfo.name.trim()) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('User not authenticated');
      
      const subId = newItemTypeInfo.subcategory_id ? parseInt(newItemTypeInfo.subcategory_id) : null;
      const supId = newItemTypeInfo.supplier_id ? parseInt(newItemTypeInfo.supplier_id) : null;

      const { error } = await supabase.from('item_types').insert([{ 
        name: newItemTypeInfo.name.trim(), 
        price: parseFloat(newItemTypeInfo.price) || 0,
        category: newItemTypeInfo.category,
        subcategory_id: subId,
        supplier_id: supId,
        stock_threshold: parseInt(newItemTypeInfo.stock_threshold, 10) || 0,
        is_unique: newItemTypeInfo.is_unique,
        user_id: user.id 
      }]);
      if (error) throw error;
      setNewItemTypeInfo({ name: '', price: '', category: '', subcategory_id: '', stock_threshold: '', is_unique: false, supplier_id: '' });
      await fetchItemTypes();
      await fetchCategories();
      setIsAddItemTypeModalOpen(false);
    } catch (err) {
      setError(`Failed to add item type: ${err.message}`);
    }
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
        } else if (actionType === 'RETURN_TO_STOCK') {
             if (item.items && item.items.length > 1) {
                 const itemIds = item.items.map(i => i.id);
                 await bulkUpdateAssignments(itemIds, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
             } else {
                 const itemId = item.items ? item.items[0].id : item.id;
                 await updateStockItemAssignment(itemId, Location.LEADING_STORES, Team.UNASSIGNED, selectedProfile.name);
             }
             await refetchStock();
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
    try {
        const subId = editingItemType.subcategory_id ? parseInt(editingItemType.subcategory_id) : null;
        const supId = editingItemType.supplier_id ? parseInt(editingItemType.supplier_id) : null;

        const { error } = await supabase
            .from('item_types')
            .update({ 
                name: editingItemType.name.trim(),
                price: parseFloat(editingItemType.price) || 0,
                category: editingItemType.category,
                subcategory_id: subId,
                supplier_id: supId,
                stock_threshold: parseInt(editingItemType.stock_threshold, 10) || 0,
                is_unique: editingItemType.is_unique,
            })
            .eq('id', editingItemType.id);
        if (error) throw error;
        setEditingItemType(null);
        await fetchItemTypes();
    } catch (err) {
      setError(`Failed to update item type: ${err.message}`);
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
      const { error } = await supabase.from('teams').insert([{ name: trimmedName, type: newTeamInfo.type, user_id: user.id }]);
      if (error) throw error;
      setNewTeamInfo({ name: '', type: TeamType.TEAM });
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
        const { error } = await supabase
            .from('teams')
            .update({ name: trimmedName, type: editingTeam.type })
            .eq('id', editingTeam.id);
        if (error) throw error;
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
    const isGroup = groupOrItem.items && groupOrItem.items.length > 1;
    const message = isGroup 
        ? `Are you sure you want to return ${groupOrItem.quantity}x ${groupOrItem.name} to stock? They will be moved to "Leading Stores".`
        : `Are you sure you want to return item ${groupOrItem.barcode || groupOrItem.barcodes[0]} to stock? It will be moved to "Leading Stores".`;
        
    setConfirmationModal({
        isOpen: true,
        title: 'Return to Stock',
        message: message,
        actionType: 'RETURN_TO_STOCK',
        item: groupOrItem
    });
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
    return currentStock.filter(item => {
        const locationMatch = dashboardFilters.location === 'All' || item.location === dashboardFilters.location;
        return locationMatch;
    });
  }, [currentStock, dashboardFilters.location]);
  
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
    const totalItems = currentStock.length;
    const itemTypesCount = new Set(currentStock.map(i => i.name)).size;
    const itemsAssigned = assignedStock.length;
    const itemsInStore = currentStock.filter(item => item.location !== Location.UNASSIGNED).length;
    return { totalItems, itemTypesCount, itemsAssigned, itemsInStore };
  }, [currentStock, assignedStock]);
    
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

  const totalInventoryValue = useMemo(() => {
    if (!currentStock || !isAdminProfile) return 0;
    return currentStock.reduce((total, item) => {
        const details = itemTypeDetailsMap[item.name];
        const price = item.purchase_price != null ? item.purchase_price : (details ? details.price : 0);
        return total + parseFloat(price);
    }, 0);
  }, [currentStock, itemTypeDetailsMap, isAdminProfile]);

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

  const groupedItemTypes = useMemo(() => {
    if (!itemTypes) return {};
    return itemTypes.reduce((acc, type) => {
        const category = type.category || 'Uncategorized';
        const subCategory = type.item_subcategory?.name || 'General';

        if (!acc[category]) {
            acc[category] = {};
        }
        if (!acc[category][subCategory]) {
            acc[category][subCategory] = [];
        }
        acc[category][subCategory].push(type);
        return acc;
    }, {});
  }, [itemTypes]);

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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">A summary of items will appear here.</p>
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
          <nav className="flex-1 p-4 space-y-1.5">
              <SidebarNavItem icon={<ListIcon />} label="Dashboard" isActive={currentView === View.LIST} onClick={() => navigateTo(View.LIST)} />
              {isAdminProfile && (
                <SidebarNavItem icon={<ArchiveIcon />} label="Log" isActive={currentView === View.ASSIGNMENTS} onClick={() => navigateTo(View.ASSIGNMENTS)} />
              )}
              {!Capacitor.isNativePlatform() && (
                <SidebarNavItem icon={<AddIcon />} label="Add Stock" isActive={currentView === View.ADD_ITEM} onClick={() => navigateTo(View.ADD_ITEM)} />
              )}
              {Capacitor.isNativePlatform() && (
                <SidebarNavItem icon={<ScanIcon />} label="Scan / Add" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />
              )}
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
                  <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 tracking-wider">v0.07</span>
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
                              persistent={scanMode === 'out-rapid'}
                          />
                      ) : (
                          <ExternalScannerPage
                              onScanSuccess={handleScanSuccess}
                              onCancel={handleCancelScan}
                          />
                      )}
                      {scanMode === 'out-rapid' && (
                          <RapidScanSummary summary={rapidScanSummary} />
                      )}
                      {scanMode === 'out-rapid' && (
                        <div className="fixed inset-x-0 bottom-0 z-[10000] p-4 pointer-events-none">
                          <div className="max-w-md mx-auto p-3 bg-zinc-800/80 dark:bg-zinc-900/80 backdrop-blur-sm pointer-events-auto shadow-lg rounded-xl flex justify-between items-center">
                            <div>
                              <p className="text-sm text-zinc-300">Assigning to:</p>
                              <p className="font-bold text-white">{assignmentContext.team}</p>
                            </div>
                            <button 
                              onClick={handleCancelScan}
                              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold"
                            >
                              Finish Session
                            </button>
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
                              <StatCard title="Total Items In Stock" value={stockSummary.totalItems} icon={<BoxIcon className="w-6 h-6 text-white"/>} colorClass="bg-blue-500" />
                              <StatCard title="Item Types In Stock" value={stockSummary.itemTypesCount} icon={<TagIcon className="w-6 h-6 text-white"/>} colorClass="bg-green-500" />
                              <StatCard title="Items Assigned Out" value={stockSummary.itemsAssigned} icon={<UsersIcon className="w-6 h-6 text-white"/>} colorClass="bg-yellow-500" />
                              {isAdminProfile && (
                                <StatCard 
                                    title="In-Stock Value" 
                                    value={new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(totalInventoryValue)} 
                                    icon={<CurrencyPoundIcon className="w-6 h-6 text-white"/>} 
                                    colorClass="bg-indigo-500" 
                                />
                              )}
                          </div>
                        )}
                        
                        <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                            <div className="p-4 md:p-6 border-b border-zinc-200 dark:border-zinc-700">
                                <h2 className="text-xl font-bold text-zinc-800 dark:text-white mb-4">Current Stock</h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                                  <div>
                                      <label htmlFor="filter-location" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Location</label>
                                      <select 
                                          id="filter-location" 
                                          name="location" 
                                          value={dashboardFilters.location} 
                                          onChange={(e) => setDashboardFilters(prev => ({...prev, location: e.target.value}))}
                                          className={`${formInputStyle} mt-1 text-sm py-2`}
                                      >
                                          <option value="All">All Locations</option>
                                          {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                                      </select>
                                  </div>
                                  <div className="flex justify-start sm:justify-end">
                                      <button 
                                          onClick={() => setDashboardFilters({ location: 'All' })}
                                          className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium"
                                      >
                                          Clear Filter
                                      </button>
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

                                        return (
                                        <div key={name} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                            <button onClick={() => setExpandedGroup(expandedGroup === name ? null : name)} className="w-full flex justify-between items-center p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                                <div className="flex items-center">
                                                    {indicator && (
                                                      <span 
                                                          className={`flex-shrink-0 w-3 h-3 rounded-full mr-3 ${indicator.color}`} 
                                                          title={indicator.label}
                                                          aria-label={indicator.label}
                                                      ></span>
                                                    )}
                                                    <div>
                                                        <h3 className="font-semibold text-zinc-800 dark:text-zinc-100">{name}</h3>
                                                        <div className="flex items-center flex-wrap gap-x-2 text-sm text-zinc-500 dark:text-zinc-400">
                                                            <span>{items.length} in stock</span>
                                                            <span className="text-zinc-300 dark:text-zinc-600 hidden sm:inline">&bull;</span>
                                                            <span className="hidden sm:inline">Threshold: {threshold}</span>
                                                            {isAdminProfile && groupValue > 0 && (
                                                                <>
                                                                    <span className="text-zinc-300 dark:text-zinc-600">&bull;</span>
                                                                    <span>
                                                                        {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(groupValue)}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform ${expandedGroup === name ? 'rotate-180' : ''}`} />
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
                                      <div className="flex justify-start lg:justify-end">
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
                                <div>
                                  <label htmlFor="name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Type</label>
                                  <SearchableSelect
                                    options={groupedItemTypes}
                                    value={newItem.name}
                                    onChange={handleNewItemChange}
                                    loading={itemTypesLoading}
                                    placeholder={itemTypesLoading ? 'Loading types...' : 'Search for an item type...'}
                                  />
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
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                                          placeholder="e.g., 10"
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
                                                        <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate" title={user.email}>{user.email}</p>
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
                                {itemTypesLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="p-2 md:p-4 space-y-2 max-h-96 overflow-y-auto">
                                    {itemTypes.length > 0 ? Object.entries(groupedItemTypes).map(([category, subGroups]) => (
                                      <div key={category} className="bg-white dark:bg-zinc-800 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                                        <button onClick={() => setExpandedItemTypeGroups(prev => ({...prev, [category]: !prev[category]}))} className="w-full flex justify-between items-center p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors">
                                          <h3 className="font-semibold text-zinc-800 dark:text-zinc-100">{category}</h3>
                                          <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform ${expandedItemTypeGroups[category] ? 'rotate-180' : ''}`} />
                                        </button>
                                        {expandedItemTypeGroups[category] && (
                                          <div className="pl-4 border-t border-zinc-200 dark:border-zinc-700">
                                            {Object.entries(subGroups).map(([subCategory, types]) => (
                                              <div key={subCategory}>
                                                <button onClick={() => setExpandedSubCategory(prev => ({...prev, [`${category}-${subCategory}`]: !prev[`${category}-${subCategory}`]}))} className="w-full flex justify-between items-center p-3 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700/20">
                                                    <h4 className="font-medium text-zinc-700 dark:text-zinc-300">{subCategory} ({types.length})</h4>
                                                    <ChevronDownIcon className={`w-4 h-4 text-zinc-400 transition-transform ${expandedSubCategory[`${category}-${subCategory}`] ? 'rotate-180' : ''}`} />
                                                </button>
                                                {expandedSubCategory[`${category}-${subCategory}`] && (
                                                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-700">
                                                      {types.map(type => (
                                                          <li key={type.id} className="px-4 py-3 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
                                                              <div>
                                                                  <div className="flex items-center flex-wrap gap-x-2">
                                                                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{type.name}</span>
                                                                    {type.is_unique && <span className="text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded-full">Unique</span>}
                                                                    {type.suppliers?.name && <span className="text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300 px-2 py-0.5 rounded-full">{type.suppliers.name}</span>}
                                                                  </div>
                                                                  <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                                                      Price: £{Number(type.price || 0).toFixed(2)} &bull; Threshold: {type.stock_threshold || 0}
                                                                  </span>
                                                              </div>
                                                              <div className="flex space-x-2">
                                                                  <button onClick={() => setEditingItemType(type)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit">
                                                                      <EditIcon className="w-4 h-4" />
                                                                  </button>
                                                                  <button onClick={() => handleDeleteItemType(type)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete">
                                                                      <TrashIcon className="w-4 h-4" />
                                                                  </button>
                                                              </div>
                                                          </li>
                                                      ))}
                                                  </ul>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )) : <EmptyState icon={<TagIcon />} title="No Item Types" message="Create item types to categorize your stock." />}
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
                                {suppliersLoading ? (
                                    <ListItemSkeleton />
                                ) : (
                                  <div className="max-h-96 overflow-y-auto">
                                    {suppliers.length > 0 ? (
                                      <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                          {suppliers.map(supplier => {
                                            const itemCount = supplierItemCount[supplier.id] || 0;
                                            return (
                                              <li key={supplier.id} className="px-4 py-3 flex justify-between items-center">
                                                  <div className="flex-1 min-w-0">
                                                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{supplier.name}</p>
                                                      <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                                                        {supplier.contact_person || 'No contact person'} &bull; {itemCount} item{itemCount !== 1 ? 's' : ''}
                                                      </p>
                                                  </div>
                                                  <div className="flex space-x-2">
                                                      <button onClick={() => setEditingSupplier(supplier)} className="p-2 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Edit Supplier">
                                                          <EditIcon className="w-4 h-4" />
                                                      </button>
                                                      <button onClick={() => handleDeleteSupplier(supplier)} className="p-2 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700" aria-label="Delete Supplier">
                                                          <TrashIcon className="w-4 h-4" />
                                                      </button>
                                                  </div>
                                              </li>
                                            )
                                          })}
                                      </ul>
                                    ) : <EmptyState icon={<BuildingStoreIcon />} title="No Suppliers" message="Add your first supplier to assign them to item types." />}
                                  </div>
                                )}
                            </div>

                            <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Teams</h2>
                                    <button onClick={() => setIsAddTeamModalOpen(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                                      <AddIcon className="w-4 h-4" />
                                      <span>Add Team</span>
                                    </button>
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
                                                    <span className="text-sm text-zinc-800 dark:text-zinc-200">{team.name}</span>
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
                {Capacitor.isNativePlatform() && (
                  <MobileNavItem icon={<ScanIcon/>} label="Scan / Add" isActive={currentView === View.SCAN || currentView === View.ADD_ITEM} onClick={() => setIsScanModeModalOpen(true)} />
                )}
                {!Capacitor.isNativePlatform() && (
                  <MobileNavItem icon={<AddIcon/>} label="Add" isActive={currentView === View.ADD_ITEM} onClick={() => navigateTo(View.ADD_ITEM)} />
                )}
                
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
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{scannedItem.description}</p>
              <p className="text-sm font-mono bg-zinc-100 dark:bg-zinc-700 p-2 rounded-md mt-2">Serial Number: {scannedItem.barcode}</p>
            </div>
            <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
               <div>
                 <label htmlFor="location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location</label>
                 <select id="location" value={assignment.location} onChange={(e) => setAssignment(prev => ({ ...prev, location: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                   {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                 </select>
               </div>
               <div>
                 <label htmlFor="team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Assign to Team</label>
                 <select id="team" value={assignment.team} onChange={(e) => setAssignment(prev => ({ ...prev, team: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                   <option value={Team.UNASSIGNED}>{Team.UNASSIGNED}</option>
                   {teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                 </select>
               </div>
            </div>
             <div className="flex justify-end space-x-3 pt-6">
                <button type="button" onClick={() => setScannedItem(null)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button type="button" onClick={handleAssignmentSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">Update Assignment</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isScanModeModalOpen} onClose={() => setIsScanModeModalOpen(false)} title="Select Action">
          <div className="grid grid-cols-1 gap-4">
              <button
                  onClick={() => { setScanMode('in'); setIsScanModeModalOpen(false); handleSetView(View.SCAN); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-400 dark:hover:border-blue-600 transition-all text-center"
              >
                  <PlusCircleIcon className="w-10 h-10 text-blue-600 dark:text-blue-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan In</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Add new items to stock via barcode.</p>
              </button>
              <button
                  onClick={() => { setIsScanModeModalOpen(false); setIsAssignmentSetupModalOpen(true); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:border-yellow-400 dark:hover:border-yellow-600 transition-all text-center"
              >
                  <ArrowRightCircleIcon className="w-10 h-10 text-yellow-600 dark:text-yellow-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Scan Out</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Assign items to a team via barcode.</p>
              </button>
              <button
                  onClick={() => { setIsScanModeModalOpen(false); navigateTo(View.ADD_ITEM); }}
                  className="flex flex-col items-center justify-center p-6 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-400 dark:hover:border-green-600 transition-all text-center"
              >
                  <AddIcon className="w-10 h-10 text-green-600 dark:text-green-400 mb-2" />
                  <p className="font-semibold text-zinc-800 dark:text-zinc-100">Add Manually</p>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Enter item details without scanning.</p>
              </button>
          </div>
      </Modal>

      <Modal isOpen={isAssignmentSetupModalOpen} onClose={() => setIsAssignmentSetupModalOpen(false)} title="Assign To...">
        <div className="space-y-4">
            <div>
                <label htmlFor="assign-location" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Location</label>
                <select id="assign-location" value={assignmentContext.location} onChange={(e) => setAssignmentContext(prev => ({ ...prev, location: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                    {displayLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="assign-team" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Team / Surveyor</label>
                <select id="assign-team" required value={assignmentContext.team} onChange={(e) => setAssignmentContext(prev => ({ ...prev, team: e.target.value }))} className={`${formInputStyle} py-2.5`}>
                    {teamsLoading ? <option disabled>Loading teams...</option> : teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}
                </select>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setIsAssignmentSetupModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                <button 
                    type="button" 
                    disabled={!assignmentContext.team}
                    onClick={() => { setIsAssignmentSetupModalOpen(false); setIsScanOutModeSelectionOpen(true); }} 
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800"
                >
                    Continue
                </button>
            </div>
        </div>
      </Modal>

      <Modal isOpen={isScanOutModeSelectionOpen} onClose={() => setIsScanOutModeSelectionOpen(false)} title="Choose Scan Out Mode">
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You are assigning to <span className="font-bold">{assignmentContext.team}</span>.
          </p>
          <button
              onClick={() => { setScanMode('out-quantity'); setIsScanOutModeSelectionOpen(false); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Quantity Mode</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Scan an item, then enter the quantity to assign. Best for bulk items.</p>
          </button>
          <button
              onClick={() => { setScanMode('out-rapid'); setIsScanOutModeSelectionOpen(false); setToasts([]); setRapidScanSummary({}); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Rapid Mode</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Scan an item to instantly assign one unit. Best for speed.</p>
          </button>
          <button
              onClick={() => { setScanMode('out-range-start'); setIsScanOutModeSelectionOpen(false); handleSetView(View.SCAN); }}
              className="w-full text-left p-4 bg-white dark:bg-zinc-700/50 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Range Mode</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Scan the first serial number, then enter the last serial number to assign a range.</p>
          </button>
        </div>
      </Modal>

      <Modal isOpen={isAssignQuantityModalOpen} onClose={() => setIsAssignQuantityModalOpen(false)} title="Assign Quantity">
        {itemForQuantityAssign && (
            <form onSubmit={handleAssignQuantitySubmit} className="space-y-4">
                <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{itemForQuantityAssign[0].name}</h3>
                    <p className="text-sm font-mono bg-zinc-100 dark:bg-zinc-700 p-2 rounded-md mt-2">Serial Number: {itemForQuantityAssign[0].barcode}</p>
                </div>
                <div>
                    <label htmlFor="quantity-to-assign" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity to Assign</label>
                    <input 
                        type="number"
                        id="quantity-to-assign"
                        name="quantity"
                        min="1"
                        max={itemForQuantityAssign.length}
                        step="1"
                        required
                        autoFocus
                        value={quantityToAssign}
                        onChange={(e) => setQuantityToAssign(e.target.value)}
                        className={formInputStyle}
                    />
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {itemForQuantityAssign.length} available in stock.
                    </p>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setIsAssignQuantityModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 dark:disabled:bg-blue-800 disabled:cursor-not-allowed flex items-center justify-center min-w-[170px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-800">
                        {isSubmitting && <Spinner className="-ml-1 mr-3 h-5 w-5" />}
                        {isSubmitting ? 'Assigning...' : `Assign to ${assignmentContext.team}`}
                    </button>
                </div>
            </form>
        )}
      </Modal>

      <Modal isOpen={isAssignRangeModalOpen} onClose={() => { setIsAssignRangeModalOpen(false); setRangeAssignDetails({ firstSerial: '', lastSerial: '' }); }} title="Assign Serial Range">
        <form onSubmit={handleAssignRangeSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div>
              <label htmlFor="scanned-barcode" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Serial Number</label>
              <input type="text" id="scanned-barcode" value={newScannedItemDetails.barcode} readOnly className="mt-1 block w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 rounded-md font-mono text-zinc-500 dark:text-zinc-400" />
          </div>
          <div>
              <label htmlFor="scanned-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Item Type</label>
              <SearchableSelect
                placeholder={itemTypesLoading ? 'Loading types...' : 'Select an item type'}
                options={groupedItemTypes}
                value={newScannedItemDetails.name}
                onChange={(e) => setNewScannedItemDetails(prev => ({...prev, name: e.target.value, quantity: '1', lastSerial: prev.firstSerial }))}
                loading={itemTypesLoading}
              />
          </div>
          <div>
              <label htmlFor="scanned-description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description (Optional)</label>
              <textarea name="description" id="scanned-description" rows={3} className={formInputStyle} value={newScannedItemDetails.description} onChange={(e) => setNewScannedItemDetails(prev => ({...prev, description: e.target.value}))}></textarea>
          </div>

          {isMeterType ? (
            <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <input type="number" name="quantity" id="scanned-quantity" min="1" step="1" required className={formInputStyle} value={newScannedItemDetails.quantity} onChange={(e) => setNewScannedItemDetails(prev => ({...prev, quantity: e.target.value}))}/>
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

      <Modal isOpen={isAddQuantityModalOpen} onClose={() => setIsAddQuantityModalOpen(false)} title="Add More Stock">
        {itemForQuantityAdd && (
            <form onSubmit={handleConfirmAddQuantity} className="space-y-4">
                <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{itemForQuantityAdd.name}</h3>
                    <p className="text-sm font-mono bg-zinc-100 dark:bg-zinc-700 p-2 rounded-md mt-2">Serial Number: {itemForQuantityAdd.barcode}</p>
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
                        value={quantityToAdd}
                        onChange={(e) => setQuantityToAdd(e.target.value)}
                        className={formInputStyle}
                    />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setIsAddQuantityModalOpen(false)} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
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
              <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={() => setIsCreateUserModalOpen(false)}>Cancel</button>
                  <button type="submit" disabled={createUserLoading}>
                      {createUserLoading ? 'Creating...' : 'Create Account'}
                  </button>
              </div>
          </form>
      </Modal>
            
      <Modal isOpen={isAddItemTypeModalOpen} onClose={() => setIsAddItemTypeModalOpen(false)} title="Add New Item Type">
          <form onSubmit={handleAddItemType} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label htmlFor="type-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                      <input id="type-name" type="text" required value={newItemTypeInfo.name} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                  </div>
                  <div>
                      <label htmlFor="type-price" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Price (£)</label>
                      <input id="type-price" type="number" step="0.01" min="0" value={newItemTypeInfo.price} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, price: e.target.value}))} className={formInputStyle} />
                  </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label htmlFor="type-category" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
                      <select id="type-category" value={newItemTypeInfo.category} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, category: e.target.value, subcategory_id: ''}))} className={formInputStyle}>
                          {categoriesLoading ? <option>Loading...</option> : categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                      </select>
                  </div>
                  <div>
                      <label htmlFor="type-subcategory" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-Category</label>
                      <select id="type-subcategory" value={newItemTypeInfo.subcategory_id} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, subcategory_id: e.target.value}))} className={formInputStyle}>
                          <option value="">None</option>
                          {getFilteredSubcategories(newItemTypeInfo.category).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                      </select>
                  </div>
              </div>
              <div>
                <label htmlFor="type-supplier" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier</label>
                  <select id="type-supplier" value={newItemTypeInfo.supplier_id} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, supplier_id: e.target.value}))} className={formInputStyle}>
                    <option value="">None</option>
                    {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
              </div>
                <div>
                  <label htmlFor="type-threshold" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Stock Threshold</label>
                  <input id="type-threshold" type="number" min="0" step="1" value={newItemTypeInfo.stock_threshold} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, stock_threshold: e.target.value}))} className={formInputStyle} />
              </div>
              <div className="flex items-center">
                  <input id="type-isunique" type="checkbox" checked={newItemTypeInfo.is_unique} onChange={(e) => setNewItemTypeInfo(prev => ({...prev, is_unique: e.target.checked}))} className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500" />
                  <label htmlFor="type-isunique" className="ml-2 block text-sm text-zinc-900 dark:text-zinc-100">Unique Item (Individual Serials)</label>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                  <button type="button" onClick={() => setIsAddItemTypeModalOpen(false)}>Cancel</button>
                  <button type="submit">Add Item Type</button>
              </div>
          </form>
      </Modal>

       <Modal isOpen={!!editingItemType} onClose={() => setEditingItemType(null)} title="Edit Item Type">
        {editingItemType && (
            <form onSubmit={handleUpdateItemType} className="space-y-4">
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="edit-type-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
                        <input id="edit-type-name" type="text" required value={editingItemType.name} onChange={(e) => setEditingItemType(prev => ({...prev, name: e.target.value}))} className={formInputStyle} />
                    </div>
                    <div>
                        <label htmlFor="edit-type-price" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Price (£)</label>
                        <input id="edit-type-price" type="number" step="0.01" min="0" value={editingItemType.price || ''} onChange={(e) => setEditingItemType(prev => ({...prev, price: e.target.value}))} className={formInputStyle} />
                    </div>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="edit-type-category" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
                        <select id="edit-type-category" value={editingItemType.category} onChange={(e) => setEditingItemType(prev => ({...prev, category: e.target.value, subcategory_id: ''}))} className={formInputStyle}>
                           {categoriesLoading ? <option>Loading...</option> : categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                        </select>
                    </div>
                     <div>
                       <label htmlFor="edit-type-subcategory" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-Category</label>
                        <select id="edit-type-subcategory" value={editingItemType.subcategory_id || ''} onChange={(e) => setEditingItemType(prev => ({...prev, subcategory_id: e.target.value}))} className={formInputStyle}>
                            <option value="">None</option>
                            {getFilteredSubcategories(editingItemType.category).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
                        </select>
                    </div>
                 </div>
                  <div>
                      <label htmlFor="edit-type-supplier" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier</label>
                       <select id="edit-type-supplier" value={editingItemType.supplier_id || ''} onChange={(e) => setEditingItemType(prev => ({...prev, supplier_id: e.target.value}))} className={formInputStyle}>
                          <option value="">None</option>
                          {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                       </select>
                    </div>
                 <div>
                    <label htmlFor="edit-type-threshold" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Stock Threshold</label>
                    <input id="edit-type-threshold" type="number" min="0" step="1" value={editingItemType.stock_threshold || ''} onChange={(e) => setEditingItemType(prev => ({...prev, stock_threshold: e.target.value}))} className={formInputStyle} />
                </div>
                <div className="flex items-center">
                    <input id="edit-type-isunique" type="checkbox" checked={editingItemType.is_unique} onChange={(e) => setEditingItemType(prev => ({...prev, is_unique: e.target.checked}))} className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500" />
                    <label htmlFor="edit-type-isunique" className="ml-2 block text-sm text-zinc-900 dark:text-zinc-100">Unique Item (Individual Serials)</label>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setEditingItemType(null)}>Cancel</button>
                    <button type="submit">Save Changes</button>
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
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setIsAddTeamModalOpen(false)}>Cancel</button>
                <button type="submit">Add</button>
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
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={() => setEditingTeam(null)}>Cancel</button>
                    <button type="submit">Save Changes</button>
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
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Use the built-in camera or an external handheld scanner.</p>
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
                    Version v0.07
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
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                              <p className="text-sm text-zinc-500 dark:text-zinc-400">{profile.role}</p>
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
                When you run the <strong>Calculate Thresholds</strong> action, the system analyzes the past 4 weeks of "OUT" movements (items assigned to teams) to determine a safe reorder point for each item type.
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
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
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

      <Modal isOpen={isUnrecognizedModalOpen} onClose={() => setIsUnrecognizedModalOpen(false)} title="Unrecognized Scans Log">
          <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  These barcodes were scanned but could not be found in the system's stock inventory.
              </p>
              {unrecognizedScans.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                      No unrecognized scans found.
                  </div>
              ) : (
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      {unrecognizedScans.map(scan => (
                          <li key={scan.id} className="p-4 flex items-center justify-between bg-white dark:bg-zinc-800">
                              <div>
                                  <p className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{scan.barcode}</p>
                                  <p className="text-xs text-zinc-500 mt-1">
                                      Scanned: {new Date(scan.scanned_at).toLocaleString()}
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
                      ))}
                  </ul>
              )}
          </div>
      </Modal>
    </>
  );
};

export default StockManagerApp;
