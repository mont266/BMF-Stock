import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { View, Location, Team, POStatus } from '../types';
import { Page, EmptyState, ListItemSkeleton, Spinner, formInputStyle, SearchableSelect } from './StockManagerApp';
import { AddIcon, TrashIcon, XIcon, PurchasingIcon, ScanIcon, EditIcon, DocumentArrowDownIcon } from './Icons';
import Modal from './Modal';
import Scanner from './Scanner';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';


const POStatusBadge = ({ status }) => {
    const statusClasses = {
        [POStatus.DRAFT]: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
        [POStatus.ORDERED]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        [POStatus.PARTIALLY_RECEIVED]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        [POStatus.COMPLETED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    };
    return (
        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClasses[status] || statusClasses[POStatus.DRAFT]}`}>
            {status}
        </span>
    );
};

const PurchaseOrderForm = ({ existingPO, onSave, onCancel, isSubmitting, suppliers, itemTypes, groupedItemTypes }) => {
    const [poHeader, setPoHeader] = useState({
        id: existingPO?.id || undefined,
        supplier_id: existingPO?.supplier_id || '',
        po_number: existingPO?.po_number || '',
        order_date: existingPO?.order_date ? new Date(existingPO.order_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        notes: existingPO?.notes || '',
        status: existingPO?.status || POStatus.DRAFT,
    });
    
    const [poItems, setPoItems] = useState(existingPO?.items.map(item => ({
        ...item,
        id: item.id,
        item_type_id: item.item_type_id,
        name: item.item_types.name,
        quantity_ordered: item.quantity_ordered,
        cost_per_item: item.cost_per_item
    })) || []);

    const handleHeaderChange = (e) => {
        const { name, value } = e.target;
        setPoHeader(prev => ({ ...prev, [name]: value }));
    };

    const handleItemChange = (index, field, value) => {
        const newItems = [...poItems];
        if (field === 'name') {
            const selectedType = itemTypes.find(it => it.name === value);
            newItems[index].item_type_id = selectedType?.id || null;
            newItems[index].name = value;
            // Reset cost when item changes
            newItems[index].cost_per_item = selectedType?.price || 0;
        } else {
            newItems[index][field] = value;
        }
        setPoItems(newItems);
    };

    const addItem = () => {
        setPoItems([...poItems, { item_type_id: null, name: '', quantity_ordered: 1, cost_per_item: 0 }]);
    };

    const removeItem = (index) => {
        setPoItems(poItems.filter((_, i) => i !== index));
    };

    const totalCost = useMemo(() => {
        return poItems.reduce((sum, item) => sum + (parseFloat(item.cost_per_item || 0) * parseInt(item.quantity_ordered || 0, 10)), 0);
    }, [poItems]);

    const handleSave = (newStatus) => {
        if (!poHeader.supplier_id) {
            alert('Please select a supplier.');
            return;
        }
        if (poItems.length === 0 || poItems.some(item => !item.item_type_id)) {
            alert('Please add at least one valid item to the purchase order.');
            return;
        }
        const headerToSave = { ...poHeader, status: newStatus };
        onSave(headerToSave, poItems);
    };

    return (
        <Page title={existingPO ? `Edit PO-${existingPO.id}` : 'Create Purchase Order'}>
             <button onClick={onCancel} className="mb-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">&larr; Back to all purchase orders</button>
             <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label htmlFor="supplier_id" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Supplier</label>
                            <select name="supplier_id" id="supplier_id" value={poHeader.supplier_id} onChange={handleHeaderChange} className={formInputStyle} required>
                                <option value="" disabled>Select a supplier</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                             <label htmlFor="po_number" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">PO Number</label>
                             <input type="text" name="po_number" id="po_number" value={poHeader.po_number} onChange={handleHeaderChange} className={formInputStyle} />
                        </div>
                        <div>
                             <label htmlFor="order_date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Order Date</label>
                             <input type="date" name="order_date" id="order_date" value={poHeader.order_date} onChange={handleHeaderChange} className={formInputStyle} />
                        </div>
                    </div>
                     <div>
                        <label htmlFor="notes" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Notes</label>
                        <textarea name="notes" id="notes" rows={3} value={poHeader.notes} onChange={handleHeaderChange} className={formInputStyle}></textarea>
                    </div>
                </div>

                <div className="p-6 border-t border-zinc-200 dark:border-zinc-700">
                     <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-4">Items</h3>
                     <div className="space-y-4">
                        {poItems.map((item, index) => (
                             <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start p-3 bg-zinc-50 dark:bg-zinc-800 rounded-md border border-zinc-200 dark:border-zinc-700">
                                <div className="col-span-1 md:col-span-5">
                                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Item</label>
                                    <SearchableSelect
                                        options={groupedItemTypes}
                                        value={item.name}
                                        onChange={(e) => handleItemChange(index, 'name', e.target.value)}
                                        placeholder="Search for an item..."
                                        loading={!itemTypes}
                                    />
                                </div>
                                <div className="col-span-1 md:col-span-2">
                                     <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Quantity</label>
                                    <input type="number" min="1" value={item.quantity_ordered} onChange={e => handleItemChange(index, 'quantity_ordered', e.target.value)} className={formInputStyle} />
                                </div>
                                <div className="col-span-1 md:col-span-2">
                                     <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Cost/Item (£)</label>
                                    <input type="number" min="0" step="0.01" value={item.cost_per_item} onChange={e => handleItemChange(index, 'cost_per_item', e.target.value)} className={formInputStyle} />
                                </div>
                                <div className="col-span-1 md:col-span-2 flex items-end">
                                     <label className="md:hidden block text-xs font-medium text-zinc-600 dark:text-zinc-400 mr-2">Total:</label>
                                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap pt-1 md:pt-7">
                                        £{(parseFloat(item.cost_per_item || 0) * parseInt(item.quantity_ordered || 0, 10)).toFixed(2)}
                                    </p>
                                </div>
                                <div className="col-span-1 flex items-end justify-end h-full">
                                    <button type="button" onClick={() => removeItem(index)} className="pt-1 md:pt-7 text-zinc-400 hover:text-red-500 transition-colors">
                                        <TrashIcon className="w-5 h-5"/>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <button type="button" onClick={addItem} className="mt-4 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md flex items-center space-x-2">
                        <AddIcon className="w-4 h-4" />
                        <span>Add Item</span>
                    </button>
                    <div className="mt-6 text-right">
                         <p className="text-sm text-zinc-500 dark:text-zinc-400">Total Cost</p>
                         <p className="text-2xl font-bold text-zinc-900 dark:text-white">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(totalCost)}</p>
                    </div>
                </div>
                
                 <div className="bg-zinc-50 dark:bg-zinc-900/50 px-6 py-4 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3 rounded-b-lg">
                    <button type="button" onClick={onCancel} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="button" onClick={() => handleSave(POStatus.DRAFT)} disabled={isSubmitting} className="px-4 py-2 bg-zinc-600 text-white rounded-md hover:bg-zinc-700 transition-colors text-sm font-medium disabled:bg-zinc-400 flex items-center justify-center">
                        {isSubmitting && <Spinner className="w-5 h-5 mr-2"/>}
                        Save as Draft
                    </button>
                    <button type="button" onClick={() => handleSave(POStatus.ORDERED)} disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 flex items-center justify-center">
                         {isSubmitting && <Spinner className="w-5 h-5 mr-2"/>}
                        Place Order
                    </button>
                </div>
             </div>
        </Page>
    );
};const PurchaseOrderDetail = ({ po, onBack, onEdit, onReceive, setError, setSuccessMessage }) => {
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const handleDelete = async () => {
        if(confirm(`Are you sure you want to delete PO-${po.id}? This action cannot be undone.`)) {
            try {
                const { error: itemError } = await supabase.from('purchase_order_items').delete().eq('po_id', po.id);
                if(itemError) throw itemError;
                const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id);
                if (error) throw error;
                onBack();
            } catch (err) {
                setError(`Failed to delete PO: ${err.message}`);
            }
        }
    };

    const isReceivable = po.status === POStatus.ORDERED || po.status === POStatus.PARTIALLY_RECEIVED;
    const isEditable = po.status === POStatus.DRAFT;

    const exportToPDF = async () => {
        setIsGeneratingPdf(true);
        try {
            const doc = new jsPDF();
            const poNumber = po.po_number || `PO-${po.id}`;
            doc.setFontSize(20);
            doc.text(`Purchase Order: ${poNumber}`, 14, 22);
            doc.setFontSize(12);
            doc.text(`Supplier: ${po.suppliers?.name || 'N/A'}`, 14, 32);
            doc.text(`Order Date: ${po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A'}`, 14, 38);
            doc.text(`Status: ${po.status}`, 14, 44);

            let startY = 50;
            if (po.notes) {
                const splitNotes = doc.splitTextToSize(`Notes: ${po.notes}`, 180);
                doc.text(splitNotes, 14, startY);
                startY += splitNotes.length * 6;
            }

            const tableColumn = ["Item", "Ordered", "Received", "Cost (£)", "Total (£)"];
            const tableRows = [];

            po.items.forEach(item => {
                const itemData = [
                    item.item_types.name,
                    item.quantity_ordered.toString(),
                    item.quantity_received.toString(),
                    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(item.cost_per_item || 0),
                    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((item.cost_per_item || 0) * item.quantity_ordered)
                ];
                tableRows.push(itemData);
            });

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: startY + 5,
            });

            const fileName = `PurchaseOrder_${poNumber}.pdf`;

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
                            title: `Purchase Order ${poNumber}`,
                            url: savedFile.uri,
                            dialogTitle: 'Share or Save PDF'
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
                        title: `Purchase Order ${poNumber}`,
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
            console.error(err);
            setError(`Failed to export PDF: ${err.message}`);
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    return (
        <Page title={`Purchase Order ${po.po_number || `PO-${po.id}`}`}>
             <button onClick={onBack} className="mb-4 text-sm text-blue-600 dark:text-blue-400 hover:underline">&larr; Back to all purchase orders</button>
             <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                <div className="p-6">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div>
                            <POStatusBadge status={po.status} />
                            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                                Supplier: <span className="font-medium text-zinc-800 dark:text-zinc-200">{po.suppliers?.name || 'N/A'}</span>
                            </p>
                             <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                Order Date: <span className="font-medium text-zinc-800 dark:text-zinc-200">{po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A'}</span>
                            </p>
                        </div>
                         <div className="flex flex-wrap gap-2 flex-shrink-0">
                            {isEditable && (
                                <>
                                    <button onClick={onEdit} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium flex items-center space-x-2">
                                        <EditIcon className="w-4 h-4" /><span>Edit</span>
                                    </button>
                                     <button onClick={handleDelete} className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-sm font-medium flex items-center space-x-2">
                                        <TrashIcon className="w-4 h-4" /><span>Delete</span>
                                    </button>
                                </>
                            )}
                            <button onClick={exportToPDF} disabled={isGeneratingPdf} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                {isGeneratingPdf ? <Spinner className="w-4 h-4" /> : <DocumentArrowDownIcon className="w-4 h-4" />}
                                <span>{isGeneratingPdf ? 'Generating...' : 'Export PDF'}</span>
                            </button>
                            {isReceivable && (
                                <button onClick={onReceive} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium">
                                    Receive Stock
                                </button>
                            )}
                        </div>
                    </div>
                     {po.notes && <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-md border border-zinc-200 dark:border-zinc-700"><strong>Notes:</strong> {po.notes}</p>}
                </div>
                 <div className="border-t border-zinc-200 dark:border-zinc-700">
                    {/* --- Mobile View --- */}
                    <div className="md:hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                        {po.items.map(item => {
                            const outstanding = item.quantity_ordered - item.quantity_received;
                            return (
                                <div key={item.id} className="p-4">
                                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{item.item_types.name}</p>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                        <div>
                                            <p className="text-zinc-500 dark:text-zinc-400">Qty Ordered</p>
                                            <p className="text-zinc-800 dark:text-zinc-200">{item.quantity_ordered}</p>
                                        </div>
                                         <div>
                                            <p className="text-zinc-500 dark:text-zinc-400">Qty Received</p>
                                            <p className={outstanding > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}>{item.quantity_received}</p>
                                        </div>
                                         <div>
                                            <p className="text-zinc-500 dark:text-zinc-400">Cost/Item</p>
                                            <p className="text-zinc-800 dark:text-zinc-200">£{parseFloat(item.cost_per_item).toFixed(2)}</p>
                                        </div>
                                         <div>
                                            <p className="text-zinc-500 dark:text-zinc-400">Line Total</p>
                                            <p className="font-medium text-zinc-900 dark:text-zinc-100">£{(item.quantity_ordered * item.cost_per_item).toFixed(2)}</p>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* --- Desktop View --- */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-zinc-50 dark:bg-zinc-800">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Item</th>
                                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Qty Ordered</th>
                                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Qty Received</th>
                                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Cost / Item</th>
                                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Line Total</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                                {po.items.map(item => {
                                    const outstanding = item.quantity_ordered - item.quantity_received;
                                    return (
                                    <tr key={item.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.item_types.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 text-right">{item.quantity_ordered}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                                            <span className={outstanding > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}>
                                                {item.quantity_received}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400 text-right">£{parseFloat(item.cost_per_item).toFixed(2)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-800 dark:text-zinc-200 font-medium text-right">£{(item.quantity_ordered * item.cost_per_item).toFixed(2)}</td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                </div>
                 <div className="bg-zinc-50 dark:bg-zinc-800 p-4 text-right">
                     <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Grand Total: </span>
                     <span className="text-lg font-bold text-zinc-900 dark:text-white">
                        {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(po.total_cost)}
                    </span>
                </div>
             </div>

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
                               download={`PurchaseOrder_${po.po_number || po.id}.pdf`}
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

const ReceiveStockModal = ({ isOpen, onClose, po, userProfile, selectedProfile, setError, setSuccessMessage, refetchStock, fetchPurchaseOrders }) => {
    const outstandingItems = useMemo(() => 
        po.items.filter(item => item.quantity_ordered > item.quantity_received)
    , [po.items]);

    const [receivedQuantities, setReceivedQuantities] = useState(() => 
        outstandingItems.reduce((acc, item) => {
            const outstanding = item.quantity_ordered - item.quantity_received;
            acc[item.id] = { 
                quantity: outstanding, 
                serials: item.item_types.is_unique ? Array(outstanding).fill('') : [] 
            };
            return acc;
        }, {})
    );
    
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const scanningTarget = useRef(null);

    const handleQuantityChange = (itemId, newQuantity) => {
        const item = outstandingItems.find(i => i.id === itemId);
        if (!item) return;
        
        const outstanding = item.quantity_ordered - item.quantity_received;
        const cappedQuantity = Math.max(0, Math.min(newQuantity, outstanding));
        
        setReceivedQuantities(prev => ({
            ...prev,
            [itemId]: {
                ...prev[itemId],
                quantity: cappedQuantity,
                serials: item.item_types.is_unique ? Array(cappedQuantity).fill('').map((s, i) => prev[itemId]?.serials[i] || '') : []
            }
        }));
    };

    const handleSerialChange = (itemId, serialIndex, value) => {
         setReceivedQuantities(prev => {
            const newSerials = [...prev[itemId].serials];
            newSerials[serialIndex] = value;
            return {
                ...prev,
                [itemId]: { ...prev[itemId], serials: newSerials }
            }
         });
    };

    const handleScanForSerial = (itemId, serialIndex) => {
        scanningTarget.current = { itemId, serialIndex };
        setIsScanning(true);
    };

    const onScanSuccess = (scannedValue) => {
        if (scanningTarget.current) {
            const { itemId, serialIndex } = scanningTarget.current;
            handleSerialChange(itemId, serialIndex, scannedValue);
        }
        setIsScanning(false);
        scanningTarget.current = null;
    };
    
    const onScanCancel = () => {
        setIsScanning(false);
        scanningTarget.current = null;
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not authenticated');

            const stockToAdd = [];
            const poItemsToUpdate = [];
            let totalItemsReceived = 0;

            for (const item of outstandingItems) {
                const received = receivedQuantities[item.id];
                if (!received || received.quantity <= 0) continue;

                totalItemsReceived += received.quantity;
                
                if (item.item_types.is_unique) {
                    if (received.serials.some(s => !s.trim())) {
                        throw new Error(`Please enter all serial numbers for "${item.item_types.name}".`);
                    }
                    if (new Set(received.serials).size !== received.serials.length) {
                        throw new Error(`Duplicate serial numbers found for "${item.item_types.name}".`);
                    }
                    received.serials.forEach(serial => {
                        stockToAdd.push({
                            name: item.item_types.name,
                            barcode: serial,
                            location: Location.LEADING_STORES,
                            assigned_to: Team.UNASSIGNED,
                            user_id: user.id
                        });
                    });
                } else {
                    const { data: existingItem, error: findError } = await supabase
                        .from('stock_items')
                        .select('barcode')
                        .eq('name', item.item_types.name)
                        .limit(1)
                        .single();

                    if (findError && findError.code !== 'PGRST116') { // PGRST116 = "exact one row not found"
                        throw findError;
                    }

                    if (!existingItem) {
                        throw new Error(`Cannot receive stock for "${item.item_types.name}" because no existing item with a barcode could be found. Please add at least one item of this type manually first to establish its barcode.`);
                    }

                    const barcodeToUse = existingItem.barcode;

                    for (let i = 0; i < received.quantity; i++) {
                        stockToAdd.push({
                            name: item.item_types.name,
                            barcode: barcodeToUse,
                            location: Location.LEADING_STORES,
                            assigned_to: Team.UNASSIGNED,
                            user_id: user.id
                        });
                    }
                }
                
                poItemsToUpdate.push({
                    id: item.id,
                    newReceivedQty: item.quantity_received + received.quantity
                });
            }

            if (stockToAdd.length === 0) {
                onClose();
                return;
            }
            
            // 1. Add new stock items
            const { data: insertedStock, error: stockError } = await supabase.from('stock_items').insert(stockToAdd).select();
            if (stockError) throw stockError;

            // 2. Log stock movements
            const movements = insertedStock.map(d => ({
                item_id: d.id, item_barcode: d.barcode, item_name: d.name, movement_type: 'IN',
                location_from: `PO-${po.id}`, location_to: Location.LEADING_STORES,
                user_id: user.id, username: selectedProfile.name,
            }));
            const { error: moveError } = await supabase.from('stock_movements').insert(movements);
            if (moveError) console.error("Movement log failed for received stock:", moveError.message);

            // 3. Update PO item quantities
            await Promise.all(poItemsToUpdate.map(update => 
                supabase.from('purchase_order_items').update({ quantity_received: update.newReceivedQty }).eq('id', update.id)
            ));

            // 4. Update PO status
            const allItems = (await supabase.from('purchase_order_items').select('*').eq('po_id', po.id)).data;
            const isComplete = allItems.every(i => i.quantity_ordered <= i.quantity_received);
            const newStatus = isComplete ? POStatus.COMPLETED : POStatus.PARTIALLY_RECEIVED;
            await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', po.id);
            
            setSuccessMessage(`${totalItemsReceived} item(s) successfully received into stock.`);
            await refetchStock();
            await fetchPurchaseOrders();
            onClose();

        } catch (err) {
            setError(`Failed to receive stock: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    if (isScanning) {
        return <Scanner onScanSuccess={onScanSuccess} onScanError={(err) => { setError(err); onScanCancel(); }} onCancel={onScanCancel} />;
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Receive Stock for PO-${po.id}`}>
            <div className="space-y-4">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Enter the quantities you are receiving for each item.</p>
                {outstandingItems.map(item => {
                    const outstanding = item.quantity_ordered - item.quantity_received;
                    const received = receivedQuantities[item.id];
                    return (
                        <div key={item.id} className="p-4 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                             <h4 className="font-semibold text-zinc-800 dark:text-zinc-100">{item.item_types.name}</h4>
                             <p className="text-xs text-zinc-500 dark:text-zinc-400">{outstanding} unit(s) outstanding</p>
                             <div className="mt-2">
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Quantity Receiving</label>
                                <input 
                                    type="number" 
                                    min="0"
                                    max={outstanding}
                                    value={received.quantity}
                                    onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value, 10))}
                                    className={formInputStyle}
                                />
                             </div>
                             {item.item_types.is_unique && received.quantity > 0 && (
                                <div className="mt-3 space-y-2">
                                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Serial Numbers</label>
                                    {received.serials.map((serial, i) => (
                                        <div key={i} className="flex items-center space-x-2">
                                            <input
                                                type="text"
                                                placeholder={`Serial #${i + 1}`}
                                                value={serial}
                                                onChange={(e) => handleSerialChange(item.id, i, e.target.value)}
                                                className={`${formInputStyle} font-mono`}
                                            />
                                            {Capacitor.isNativePlatform() && (
                                                <button type="button" onClick={() => handleScanForSerial(item.id, i)} className="p-2.5 bg-zinc-200 dark:bg-zinc-600 rounded-md hover:bg-zinc-300 dark:hover:bg-zinc-500">
                                                    <ScanIcon className="w-5 h-5"/>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                             )}
                        </div>
                    );
                })}

                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors text-sm font-medium">Cancel</button>
                    <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium disabled:bg-blue-400 flex items-center justify-center min-w-[150px]">
                        {isSubmitting && <Spinner className="w-5 h-5 mr-2"/>}
                        {isSubmitting ? 'Receiving...' : 'Confirm Delivery'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const PurchasingPage = ({ userProfile, selectedProfile, setError, setSuccessMessage, itemTypes, suppliers, groupedItemTypes, refetchStock, navigateTo }) => {
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [poLoading, setPoLoading] = useState(true);
    const [currentView, setCurrentView] = useState('list'); // 'list', 'create', 'detail', 'edit'
    const [selectedPoId, setSelectedPoId] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isReceivingModalOpen, setIsReceivingModalOpen] = useState(false);
    const [supplierFilter, setSupplierFilter] = useState('All');

    const filteredPOs = useMemo(() => {
        if (supplierFilter === 'All') return purchaseOrders;
        return purchaseOrders.filter(po => po.supplier_id === supplierFilter);
    }, [purchaseOrders, supplierFilter]);

    const fetchPurchaseOrders = useCallback(async () => {
        if (userProfile?.role !== 'Admin') return;
        setPoLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not authenticated');

            const { data: pos, error: poError } = await supabase
                .from('purchase_orders')
                .select('*, suppliers(name)')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });
            if (poError) throw poError;

            if (!pos || pos.length === 0) {
                setPurchaseOrders([]);
                setPoLoading(false);
                return;
            }

            const poIds = pos.map(p => p.id);
            const { data: items, error: itemsError } = await supabase
                .from('purchase_order_items')
                .select('*, item_types(id, name, is_unique)')
                .in('po_id', poIds);
            if (itemsError) throw itemsError;

            const itemsByPoId = items.reduce((acc, item) => {
                if (!acc[item.po_id]) acc[item.po_id] = [];
                acc[item.po_id].push(item);
                return acc;
            }, {});

            const hydratedPOs = pos.map(po => ({
                ...po,
                items: itemsByPoId[po.id] || [],
                total_cost: (itemsByPoId[po.id] || []).reduce((sum, item) => sum + (parseFloat(item.cost_per_item || 0) * item.quantity_ordered), 0)
            }));
            
            setPurchaseOrders(hydratedPOs);
        } catch (err) {
            setError(`Failed to fetch purchase orders: ${err.message}`);
        } finally {
            setPoLoading(false);
        }
    }, [userProfile, setError]);

    useEffect(() => {
        fetchPurchaseOrders();
    }, [fetchPurchaseOrders]);

    const handleCreateNew = () => {
        setSelectedPoId(null);
        setCurrentView('create');
    };

    const handleViewDetails = (poId) => {
        setSelectedPoId(poId);
        setCurrentView('detail');
    };

    const handleBackToList = () => {
        setSelectedPoId(null);
        setCurrentView('list');
        fetchPurchaseOrders(); // Refetch to see latest status
    };

    const handleSavePO = async (poData, poItems) => {
        setIsSubmitting(true);
        setError(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('User not authenticated');

            // 1. Insert/Update Purchase Order Header
            const { id, ...headerData } = poData;
            
            let savedPO;
            if (id) {
                const { data, error } = await supabase.from('purchase_orders').update(headerData).eq('id', id).select().single();
                if (error) throw error;
                savedPO = data;
            } else {
                 const { data, error } = await supabase.from('purchase_orders').insert({ ...headerData, user_id: user.id }).select().single();
                 if (error) throw error;
                 savedPO = data;
            }
            
            // 2. Delete existing items for this PO to handle edits/deletions
            const { error: deleteError } = await supabase
                .from('purchase_order_items')
                .delete()
                .eq('po_id', savedPO.id);
            
            if (deleteError) throw deleteError;
            
            // 3. Insert new line items
            const itemsToInsert = poItems.map(item => ({
                po_id: savedPO.id,
                item_type_id: item.item_type_id,
                quantity_ordered: item.quantity_ordered,
                cost_per_item: item.cost_per_item,
                user_id: user.id
            }));

            if (itemsToInsert.length > 0) {
              const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsToInsert);
              if (itemsError) throw itemsError;
            }

            setSuccessMessage(`Purchase Order ${id ? 'updated' : 'created'} successfully.`);
            await fetchPurchaseOrders();
            handleViewDetails(savedPO.id);

        } catch (err) {
            setError(`Failed to save Purchase Order: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const selectedPo = useMemo(() => {
        return purchaseOrders.find(po => po.id === selectedPoId);
    }, [selectedPoId, purchaseOrders]);

    if (currentView === 'list') {
        return (
            <Page title="Purchase Orders">
                <div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                    <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">All Purchase Orders</h2>
                        <div className="flex items-center space-x-3">
                            <select className={`${formInputStyle} max-w-xs py-1.5 text-sm`} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                                <option value="All">All Suppliers</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <button onClick={handleCreateNew} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2 whitespace-nowrap">
                                <AddIcon className="w-4 h-4" />
                                <span>Create PO</span>
                            </button>
                        </div>
                    </div>
                    {poLoading ? (
                        <ListItemSkeleton />
                    ) : filteredPOs.length > 0 ? (
                        <div>
                            {/* --- Mobile Card View --- */}
                            <div className="md:hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                                {filteredPOs.map(po => (
                                    <div key={po.id} className="p-4" onClick={() => handleViewDetails(po.id)}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{po.po_number || `PO-${po.id}`}</p>
                                                <p className="text-sm text-zinc-500 dark:text-zinc-400">{po.suppliers?.name || 'N/A'}</p>
                                            </div>
                                            <POStatusBadge status={po.status} />
                                        </div>
                                        <div className="mt-3 flex justify-between items-end">
                                            <div>
                                                <p className="text-xs text-zinc-500 dark:text-zinc-400">Date: {po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A'}</p>
                                            </div>
                                            <p className="font-semibold text-zinc-800 dark:text-zinc-200">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(po.total_cost)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* --- Desktop Table View --- */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                                    <thead className="bg-zinc-50 dark:bg-zinc-800">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">PO Number</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Supplier</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Order Date</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total</th>
                                            <th scope="col" className="relative px-6 py-3"><span className="sr-only">View</span></th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-zinc-800/50 divide-y divide-zinc-200 dark:divide-zinc-700">
                                        {filteredPOs.map(po => (
                                            <tr key={po.id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100">{po.po_number || `PO-${po.id}`}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{po.suppliers?.name || 'N/A'}</td>
                                                <td className="px-6 py-4 whitespace-nowrap"><POStatusBadge status={po.status} /></td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A'}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(po.total_cost)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <button onClick={() => handleViewDetails(po.id)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">View</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <EmptyState 
                            icon={<PurchasingIcon />} 
                            title="No Purchase Orders" 
                            message="Create your first purchase order to track incoming stock."
                            action={
                                <button
                                  onClick={handleCreateNew}
                                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                                >
                                  <AddIcon className="-ml-1 mr-2 h-5 w-5" />
                                  Create First PO
                                </button>
                            }
                        />
                    )}
                </div>
            </Page>
        );
    }
    
    if(currentView === 'create' || currentView === 'edit') {
        return (
            <PurchaseOrderForm
                existingPO={currentView === 'edit' ? selectedPo : null}
                onSave={handleSavePO}
                onCancel={handleBackToList}
                isSubmitting={isSubmitting}
                suppliers={suppliers}
                itemTypes={itemTypes}
                groupedItemTypes={groupedItemTypes}
            />
        );
    }

    if (currentView === 'detail') {
        if (!selectedPo) return <Page title="Loading..."><Spinner /></Page>;
        return (
            <>
                <PurchaseOrderDetail
                    po={selectedPo}
                    onBack={handleBackToList}
                    onEdit={() => setCurrentView('edit')}
                    onReceive={() => setIsReceivingModalOpen(true)}
                    setError={setError}
                    setSuccessMessage={setSuccessMessage}
                />
                {isReceivingModalOpen && (
                    <ReceiveStockModal
                        isOpen={isReceivingModalOpen}
                        onClose={() => setIsReceivingModalOpen(false)}
                        po={selectedPo}
                        userProfile={userProfile}
                        selectedProfile={selectedProfile}
                        setError={setError}
                        setSuccessMessage={setSuccessMessage}
                        refetchStock={refetchStock}
                        fetchPurchaseOrders={fetchPurchaseOrders}
                    />
                )}
            </>
        );
    }

    return null;
};

export default PurchasingPage;