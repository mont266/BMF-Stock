import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

// 1. Add state variables
const stateInsertionPoint = "const [usersLoading, setUsersLoading] = useState(false);";
const stateCode = `const [usersLoading, setUsersLoading] = useState(false);
  const [dbLocations, setDbLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [isAddLocationModalOpen, setIsAddLocationModalOpen] = useState(false);
  const [newLocationInfo, setNewLocationInfo] = useState({ name: '' });
  const [editingLocation, setEditingLocation] = useState(null);
  
  const displayLocations = dbLocations.length > 0 ? dbLocations.map(l => l.name) : LOCATIONS;`;
content = content.replace(stateInsertionPoint, stateCode);

// 2. Replace LOCATIONS.map with displayLocations.map
content = content.replace(/LOCATIONS\.map/g, 'displayLocations.map');

// 3. Add fetchLocations
const fetchInsertionPoint = "const fetchSuppliers = useCallback(async () => {";
const fetchCode = `const fetchLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
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

  const fetchSuppliers = useCallback(async () => {`;
content = content.replace(fetchInsertionPoint, fetchCode);

// 4. Add fetchLocations to useEffect
const effectTarget = `  useEffect(() => {
    fetchItemTypes();
    fetchTeams();
    fetchCategories();
    fetchSuppliers();
  }, [fetchItemTypes, fetchTeams, fetchCategories, fetchSuppliers]);`;
const effectCode = `  useEffect(() => {
    fetchItemTypes();
    fetchTeams();
    fetchCategories();
    fetchSuppliers();
    fetchLocations();
  }, [fetchItemTypes, fetchTeams, fetchCategories, fetchSuppliers, fetchLocations]);`;
content = content.replace(effectTarget, effectCode);

// 5. Add CRUD handlers for Locations
const handlersTarget = "const handleAddSupplier = async (e) => {";
const handlersCode = `const handleAddLocation = async (e) => {
    e.preventDefault();
    if (!newLocationInfo.name.trim()) return;
    try {
      const { error } = await supabase.from('locations').insert([{ name: newLocationInfo.name.trim() }]);
      if (error) throw error;
      setNewLocationInfo({ name: '' });
      await fetchLocations();
      setIsAddLocationModalOpen(false);
    } catch (err) {
      setError(\`Failed to add location (Did you create the table?): \${err.message}\`);
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
      setError(\`Failed to update location: \${err.message}\`);
    }
  };

  const handleDeleteLocation = async (location) => {
      setConfirmDialog({
          isOpen: true,
          title: 'Delete Location',
          message: \`Are you sure you want to delete the location "\${location.name}"? This will not affect existing historical stock movements but will remove it as a selectable option.\`,
          actionType: 'DELETE_LOCATION',
          item: location
      });
  };

  const handleAddSupplier = async (e) => {`;
content = content.replace(handlersTarget, handlersCode);

// 6. Handle DELETE_LOCATION in confirmDialog
const deleteHandlerTarget = `} else if (actionType === 'DELETE_SUPPLIER') {
             const { error } = await supabase.from('suppliers').delete().eq('id', item.id);
             if (error) throw error;
             await fetchSuppliers();
        }`;
const deleteHandlerCode = `} else if (actionType === 'DELETE_SUPPLIER') {
             const { error } = await supabase.from('suppliers').delete().eq('id', item.id);
             if (error) throw error;
             await fetchSuppliers();
        } else if (actionType === 'DELETE_LOCATION') {
             const { error } = await supabase.from('locations').delete().eq('id', item.id);
             if (error) throw error;
             await fetchLocations();
        }`;
content = content.replace(deleteHandlerTarget, deleteHandlerCode);

// 7. Add Manage Locations UI in Admin Panel
const adminPanelTarget = `<div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
                                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center">
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Suppliers</h2>`;

const adminPanelCode = `<div className="bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700">
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
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Manage Suppliers</h2>`;
content = content.replace(adminPanelTarget, adminPanelCode);

// 8. Add Modals for Add/Edit Locations
const modalsTarget = `<Modal isOpen={isAddSupplierModalOpen} onClose={() => setIsAddSupplierModalOpen(false)} title="Add New Supplier">`;
const modalsCode = `<Modal isOpen={isAddLocationModalOpen} onClose={() => setIsAddLocationModalOpen(false)} title="Add New Location">
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

      <Modal isOpen={isAddSupplierModalOpen} onClose={() => setIsAddSupplierModalOpen(false)} title="Add New Supplier">`;
content = content.replace(modalsTarget, modalsCode);

fs.writeFileSync('components/StockManagerApp.jsx', content);
console.log('StockManagerApp patched successfully.');
