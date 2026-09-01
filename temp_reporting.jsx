const ReportingPage = ({ filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen }) => {
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
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
