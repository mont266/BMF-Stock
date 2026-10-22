// Training Mode Sandbox Environment
// Provides a completely isolated, in-memory data store for training.
// Zero changes are written to the backend database.
// All training state is cleared when Training Mode is exited or the app/tab is closed.

const TRAINING_SESSION_KEY = 'bregan_mainsflow_training_session';

export const INITIAL_TRAINING_STOCK = [];
export const INITIAL_TRAINING_MOVEMENTS = [];

class TrainingEnvironmentManager {
  constructor() {
    this.isActive = false;
    this.stock = [];
    this.movements = [];
    this.itemTypes = [];
    this.supplierPartNumbers = [];
    this.teams = [];
    this.locations = [];
    this.suppliers = [];
    this.categories = [];
    this.initialSnapshot = null;
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    this.subscribers = new Set();
    this.loadFromSession();
  }

  loadFromSession() {
    try {
      const raw = sessionStorage.getItem(TRAINING_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.isActive = !!parsed.isActive;
        this.stock = parsed.stock || [];
        this.movements = parsed.movements || [];
        this.itemTypes = parsed.itemTypes || [];
        this.supplierPartNumbers = parsed.supplierPartNumbers || [];
        this.teams = parsed.teams || [];
        this.locations = parsed.locations || [];
        this.suppliers = parsed.suppliers || [];
        this.categories = parsed.categories || [];
        this.initialSnapshot = parsed.initialSnapshot || null;
        this.activeStockTake = parsed.activeStockTake || null;
        this.stockTakeItems = parsed.stockTakeItems || [];
        this.completedStockTakes = parsed.completedStockTakes || [];
        this.unrecognizedScans = parsed.unrecognizedScans || [];
      }
    } catch {
      // Ignore sessionStorage errors
    }
  }

  saveToSession() {
    if (!this.isActive) {
      try {
        sessionStorage.removeItem(TRAINING_SESSION_KEY);
      } catch {}
      return;
    }
    try {
      sessionStorage.setItem(TRAINING_SESSION_KEY, JSON.stringify({
        isActive: this.isActive,
        stock: this.stock,
        movements: this.movements,
        itemTypes: this.itemTypes,
        supplierPartNumbers: this.supplierPartNumbers,
        teams: this.teams,
        locations: this.locations,
        suppliers: this.suppliers,
        categories: this.categories,
        initialSnapshot: this.initialSnapshot,
        activeStockTake: this.activeStockTake,
        stockTakeItems: this.stockTakeItems,
        completedStockTakes: this.completedStockTakes,
        unrecognizedScans: this.unrecognizedScans
      }));
    } catch (e) {
      console.warn("Could not save training session to sessionStorage:", e);
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this.saveToSession();
    this.subscribers.forEach(cb => {
      try { cb(); } catch (err) { console.error(err); }
    });
  }

  startTrainingSession(
    liveStock = [],
    liveMovements = [],
    liveItemTypes = [],
    liveSupplierParts = [],
    liveTeams = [],
    liveLocations = [],
    liveSuppliers = [],
    liveCategories = []
  ) {
    this.isActive = true;

    this.initialSnapshot = {
      stock: Array.isArray(liveStock) ? JSON.parse(JSON.stringify(liveStock)) : [],
      movements: Array.isArray(liveMovements) ? JSON.parse(JSON.stringify(liveMovements)) : [],
      itemTypes: Array.isArray(liveItemTypes) ? JSON.parse(JSON.stringify(liveItemTypes)) : [],
      supplierPartNumbers: Array.isArray(liveSupplierParts) ? JSON.parse(JSON.stringify(liveSupplierParts)) : [],
      teams: Array.isArray(liveTeams) ? JSON.parse(JSON.stringify(liveTeams)) : [],
      locations: Array.isArray(liveLocations) ? JSON.parse(JSON.stringify(liveLocations)) : [],
      suppliers: Array.isArray(liveSuppliers) ? JSON.parse(JSON.stringify(liveSuppliers)) : [],
      categories: Array.isArray(liveCategories) ? JSON.parse(JSON.stringify(liveCategories)) : []
    };

    this.stock = JSON.parse(JSON.stringify(this.initialSnapshot.stock));
    this.movements = JSON.parse(JSON.stringify(this.initialSnapshot.movements));
    this.itemTypes = JSON.parse(JSON.stringify(this.initialSnapshot.itemTypes));
    this.supplierPartNumbers = JSON.parse(JSON.stringify(this.initialSnapshot.supplierPartNumbers));
    this.teams = JSON.parse(JSON.stringify(this.initialSnapshot.teams));
    this.locations = JSON.parse(JSON.stringify(this.initialSnapshot.locations));
    this.suppliers = JSON.parse(JSON.stringify(this.initialSnapshot.suppliers));
    this.categories = JSON.parse(JSON.stringify(this.initialSnapshot.categories));

    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    this.notify();
    return true;
  }

  resetTrainingSession() {
    if (!this.isActive) return;
    if (this.initialSnapshot) {
      this.stock = JSON.parse(JSON.stringify(this.initialSnapshot.stock || []));
      this.movements = JSON.parse(JSON.stringify(this.initialSnapshot.movements || []));
      this.itemTypes = JSON.parse(JSON.stringify(this.initialSnapshot.itemTypes || []));
      this.supplierPartNumbers = JSON.parse(JSON.stringify(this.initialSnapshot.supplierPartNumbers || []));
      this.teams = JSON.parse(JSON.stringify(this.initialSnapshot.teams || []));
      this.locations = JSON.parse(JSON.stringify(this.initialSnapshot.locations || []));
      this.suppliers = JSON.parse(JSON.stringify(this.initialSnapshot.suppliers || []));
      this.categories = JSON.parse(JSON.stringify(this.initialSnapshot.categories || []));
    } else {
      this.stock = [];
      this.movements = [];
    }
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    this.notify();
  }

  exitTrainingSession() {
    this.isActive = false;
    this.stock = [];
    this.movements = [];
    this.itemTypes = [];
    this.supplierPartNumbers = [];
    this.teams = [];
    this.locations = [];
    this.suppliers = [];
    this.categories = [];
    this.initialSnapshot = null;
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    try {
      sessionStorage.removeItem(TRAINING_SESSION_KEY);
    } catch {}
    this.notify();
  }

  // Catalog Item Types
  getItemTypes() { return this.itemTypes; }
  addItemType(itemType) {
    const newType = { ...itemType, id: itemType.id || 'train-it-' + Math.random().toString(36).substr(2, 9) };
    this.itemTypes = [newType, ...this.itemTypes];
    this.notify();
    return newType;
  }
  updateItemType(id, updates) {
    this.itemTypes = this.itemTypes.map(it => it.id === id ? { ...it, ...updates } : it);
    this.notify();
    return this.itemTypes.find(it => it.id === id);
  }
  deleteItemType(id) {
    this.itemTypes = this.itemTypes.filter(it => it.id !== id);
    this.supplierPartNumbers = this.supplierPartNumbers.filter(sp => sp.item_type_id !== id);
    this.notify();
  }

  // Catalog Supplier Part Numbers
  getSupplierPartNumbers() { return this.supplierPartNumbers; }
  addSupplierPartNumber(part) {
    const newPart = {
      ...part,
      id: part.id || 'train-spn-' + Math.random().toString(36).substr(2, 9),
      created_at: new Date().toISOString()
    };
    this.supplierPartNumbers = [newPart, ...this.supplierPartNumbers];
    this.notify();
    return newPart;
  }
  updateSupplierPartNumber(id, updates) {
    this.supplierPartNumbers = this.supplierPartNumbers.map(sp => sp.id === id ? { ...sp, ...updates } : sp);
    this.notify();
    return this.supplierPartNumbers.find(sp => sp.id === id);
  }
  deleteSupplierPartNumber(id) {
    this.supplierPartNumbers = this.supplierPartNumbers.filter(sp => sp.id !== id);
    this.notify();
  }

  // Teams
  getTeams() { return this.teams; }
  addTeam(team) {
    const newTeam = { ...team, id: team.id || 'train-team-' + Math.random().toString(36).substr(2, 9) };
    this.teams = [...this.teams, newTeam];
    this.notify();
    return newTeam;
  }
  updateTeam(id, updates) {
    this.teams = this.teams.map(t => t.id === id ? { ...t, ...updates } : t);
    this.notify();
  }
  deleteTeam(id) {
    this.teams = this.teams.filter(t => t.id !== id);
    this.notify();
  }

  // Locations
  getLocations() { return this.locations; }
  addLocation(location) {
    const newLoc = { ...location, id: location.id || 'train-loc-' + Math.random().toString(36).substr(2, 9) };
    this.locations = [...this.locations, newLoc];
    this.notify();
    return newLoc;
  }
  updateLocation(id, updates) {
    this.locations = this.locations.map(l => l.id === id ? { ...l, ...updates } : l);
    this.notify();
  }
  deleteLocation(id) {
    this.locations = this.locations.filter(l => l.id !== id);
    this.notify();
  }

  // Suppliers
  getSuppliers() { return this.suppliers; }
  addSupplier(supplier) {
    const newSup = { ...supplier, id: supplier.id || 'train-sup-' + Math.random().toString(36).substr(2, 9) };
    this.suppliers = [...this.suppliers, newSup];
    this.notify();
    return newSup;
  }
  updateSupplier(id, updates) {
    this.suppliers = this.suppliers.map(s => s.id === id ? { ...s, ...updates } : s);
    this.notify();
  }
  deleteSupplier(id) {
    this.suppliers = this.suppliers.filter(s => s.id !== id);
    this.notify();
  }

  // Categories
  getCategories() { return this.categories; }
  addCategory(category) {
    const newCat = { ...category, id: category.id || 'train-cat-' + Math.random().toString(36).substr(2, 9) };
    this.categories = [...this.categories, newCat];
    this.notify();
    return newCat;
  }
  updateCategory(id, updates) {
    this.categories = this.categories.map(c => c.id === id ? { ...c, ...updates } : c);
    this.notify();
  }
  deleteCategory(id) {
    this.categories = this.categories.filter(c => c.id !== id);
    this.notify();
  }

  // Stock operations
  getStock() {
    return this.stock;
  }

  setStock(newStock) {
    this.stock = typeof newStock === 'function' ? newStock(this.stock) : newStock;
    this.notify();
  }

  addStockItem(item, assignerName = 'Trainee') {
    const tempId = 'train-' + Math.random().toString(36).substr(2, 9);
    const newItem = {
      ...item,
      id: tempId,
      location: item.location || 'Flamstead',
      assigned_to: item.assigned_to || 'Unassigned',
      user_id: 'training_user',
      created_at: new Date().toISOString()
    };
    this.stock = [newItem, ...this.stock];

    this.recordMovement({
      item_id: newItem.id,
      item_name: newItem.name,
      item_barcode: newItem.barcode,
      movement_type: 'IN',
      location_from: 'New Stock',
      location_to: newItem.location,
      username: assignerName
    });

    this.notify();
    return newItem;
  }

  bulkAddStockItems(items, assignerName = 'Trainee') {
    const createdItems = items.map(item => {
      const isAssigning = item.assigned_to && item.assigned_to !== 'Unassigned';
      return {
        ...item,
        id: 'train-' + Math.random().toString(36).substr(2, 9),
        location: item.location || 'Flamstead',
        assigned_to: item.assigned_to || 'Unassigned',
        assigned_at: isAssigning ? (item.assigned_at || new Date().toISOString()) : null,
        assigned_by: isAssigning ? (item.assigned_by || assignerName) : null,
        user_id: 'training_user',
        created_at: new Date().toISOString()
      };
    });

    this.stock = [...createdItems, ...this.stock];

    createdItems.forEach(newItem => {
      const isAssigning = newItem.assigned_to && newItem.assigned_to !== 'Unassigned';
      this.recordMovement({
        item_id: newItem.id,
        item_name: newItem.name,
        item_barcode: newItem.barcode,
        movement_type: isAssigning ? 'OUT' : 'IN',
        location_from: isAssigning ? newItem.location : 'New Stock',
        location_to: isAssigning ? newItem.assigned_to : newItem.location,
        username: assignerName
      });
    });

    this.notify();
    return createdItems;
  }

  updateStockItemAssignment(itemId, location, assigned_to, assignerName = 'Trainee') {
    const isAssigning = assigned_to && assigned_to !== 'Unassigned';
    let updated = null;
    let oldItem = null;

    this.stock = this.stock.map(item => {
      if (item.id === itemId) {
        oldItem = item;
        updated = {
          ...item,
          location,
          assigned_to,
          assigned_at: isAssigning ? new Date().toISOString() : null,
          assigned_by: isAssigning ? assignerName : null
        };
        return updated;
      }
      return item;
    });

    if (oldItem && updated) {
      const oldAssignedTo = oldItem.assigned_to;
      const oldLocation = oldItem.location;

      if (oldAssignedTo === 'Unassigned' && assigned_to !== 'Unassigned') {
        this.recordMovement({
          item_id: updated.id,
          item_name: updated.name,
          item_barcode: updated.barcode,
          movement_type: 'OUT',
          location_from: oldLocation,
          location_to: assigned_to,
          username: assignerName
        });
      } else if (oldAssignedTo !== 'Unassigned' && assigned_to === 'Unassigned') {
        this.recordMovement({
          item_id: updated.id,
          item_name: updated.name,
          item_barcode: updated.barcode,
          movement_type: 'IN',
          location_from: oldAssignedTo,
          location_to: location,
          username: assignerName
        });
      } else if (oldAssignedTo !== 'Unassigned' && assigned_to !== 'Unassigned' && oldAssignedTo !== assigned_to) {
        this.recordMovement({
          item_id: updated.id,
          item_name: updated.name,
          item_barcode: updated.barcode,
          movement_type: 'OUT',
          location_from: oldAssignedTo,
          location_to: assigned_to,
          username: assignerName
        });
      } else if (oldLocation !== location) {
        this.recordMovement({
          item_id: updated.id,
          item_name: updated.name,
          item_barcode: updated.barcode,
          movement_type: 'IN',
          location_from: oldLocation,
          location_to: location,
          username: assignerName
        });
      }
    }

    this.notify();
    return updated || { id: itemId, location, assigned_to };
  }

  bulkUpdateAssignments(itemIds, location, team, assignerName = 'Trainee') {
    if (!itemIds || itemIds.length === 0) return;
    const isAssigning = team && team !== 'Unassigned';

    this.stock = this.stock.map(item => {
      if (itemIds.includes(item.id)) {
        const oldAssignedTo = item.assigned_to;
        const oldLocation = item.location;

        if (oldAssignedTo === 'Unassigned' && team !== 'Unassigned') {
          this.recordMovement({
            item_id: item.id,
            item_name: item.name,
            item_barcode: item.barcode,
            movement_type: 'OUT',
            location_from: oldLocation,
            location_to: team,
            username: assignerName
          });
        } else if (oldAssignedTo !== 'Unassigned' && team === 'Unassigned') {
          this.recordMovement({
            item_id: item.id,
            item_name: item.name,
            item_barcode: item.barcode,
            movement_type: 'IN',
            location_from: oldAssignedTo,
            location_to: location,
            username: assignerName
          });
        } else if (oldAssignedTo !== 'Unassigned' && team !== 'Unassigned' && oldAssignedTo !== team) {
          this.recordMovement({
            item_id: item.id,
            item_name: item.name,
            item_barcode: item.barcode,
            movement_type: 'OUT',
            location_from: oldAssignedTo,
            location_to: team,
            username: assignerName
          });
        } else if (oldLocation !== location) {
          this.recordMovement({
            item_id: item.id,
            item_name: item.name,
            item_barcode: item.barcode,
            movement_type: 'IN',
            location_from: oldLocation,
            location_to: location,
            username: assignerName
          });
        }

        return {
          ...item,
          location,
          assigned_to: team,
          assigned_at: isAssigning ? new Date().toISOString() : null,
          assigned_by: isAssigning ? assignerName : null
        };
      }
      return item;
    });

    this.notify();
  }

  deleteStockItem(itemId, assignerName = 'Trainee') {
    const itemToDelete = this.stock.find(i => i.id === itemId);
    this.stock = this.stock.filter(i => i.id !== itemId);

    if (itemToDelete) {
      this.recordMovement({
        item_id: itemToDelete.id,
        item_name: itemToDelete.name,
        item_barcode: itemToDelete.barcode,
        movement_type: 'OUT',
        location_from: itemToDelete.assigned_to === 'Unassigned' ? itemToDelete.location : itemToDelete.assigned_to,
        location_to: 'Deleted',
        username: assignerName
      });
    }

    this.notify();
  }

  bulkDeleteStockItems(itemIds, assignerName = 'Trainee') {
    const itemsToDelete = this.stock.filter(i => itemIds.includes(i.id));
    this.stock = this.stock.filter(i => !itemIds.includes(i.id));

    itemsToDelete.forEach(item => {
      this.recordMovement({
        item_id: item.id,
        item_name: item.name,
        item_barcode: item.barcode,
        movement_type: 'OUT',
        location_from: item.assigned_to === 'Unassigned' ? item.location : item.assigned_to,
        location_to: 'Deleted',
        username: assignerName
      });
    });

    this.notify();
  }

  // Movements (Reporting)
  recordMovement({ item_id, item_name, item_barcode, movement_type, location_from, location_to, username }) {
    const newMovement = {
      id: 'train-mov-' + Math.random().toString(36).substr(2, 9),
      item_id: item_id || 'train-item',
      item_name: item_name || 'Item',
      item_barcode: item_barcode || 'N/A',
      movement_type: movement_type || 'IN',
      location_from: location_from || 'Unknown',
      location_to: location_to || 'Unknown',
      username: username || 'Trainee',
      user_id: 'training_user',
      created_at: new Date().toISOString()
    };
    this.movements = [newMovement, ...this.movements];
    this.notify();
    return newMovement;
  }

  deleteMovementsForBarcode(barcode, itemName = null, itemIds = []) {
    if (!barcode) return;
    const cleanBarcode = String(barcode).trim().toLowerCase();
    const cleanItemName = itemName ? String(itemName).trim().toLowerCase() : null;
    const idSet = new Set(itemIds || []);

    this.movements = this.movements.filter(m => {
      const mBarcode = String(m.item_barcode || m.barcode || '').trim().toLowerCase();
      const mName = String(m.item_name || '').trim().toLowerCase();
      const mItemId = m.item_id;

      if (mBarcode && mBarcode === cleanBarcode) return false;
      if (mItemId && idSet.has(mItemId)) return false;
      if (cleanItemName && mName === cleanItemName) return false;

      return true;
    });

    this.notify();
  }

  getMovements(filters = {}) {
    let result = [...this.movements];
    if (filters.startDate) {
      const startIso = new Date(filters.startDate).toISOString();
      result = result.filter(m => m.created_at >= startIso);
    }
    if (filters.endDate) {
      const endIso = new Date(`${filters.endDate}T23:59:59.999Z`).toISOString();
      result = result.filter(m => m.created_at <= endIso);
    }
    if (filters.itemName && filters.itemName !== 'All') {
      result = result.filter(m => m.item_name === filters.itemName);
    }
    if (filters.team && filters.team !== 'All') {
      result = result.filter(m => m.location_from === filters.team || m.location_to === filters.team);
    }
    if (filters.location && filters.location !== 'All') {
      result = result.filter(m => m.location_from === filters.location || m.location_to === filters.location);
    }
    if (filters.partNumber && filters.partNumber.trim()) {
      const term = filters.partNumber.trim().toLowerCase();
      result = result.filter(m => (m.item_barcode || '').toLowerCase().includes(term) || (m.item_name || '').toLowerCase().includes(term));
    }
    return result;
  }

  // Unrecognized Scans
  getUnrecognizedScans() {
    return this.unrecognizedScans;
  }

  logUnrecognizedScan(barcode, profileName = 'Trainee') {
    const scan = {
      id: 'train-unrec-' + Math.random().toString(36).substr(2, 9),
      barcode,
      scanned_at: new Date().toISOString(),
      profile_name: profileName
    };
    this.unrecognizedScans = [scan, ...this.unrecognizedScans];
    this.notify();
    return scan;
  }

  removeUnrecognizedScan(id) {
    this.unrecognizedScans = this.unrecognizedScans.filter(s => s.id !== id);
    this.notify();
  }

  // Stock Take operations
  getActiveStockTake() {
    return this.activeStockTake;
  }

  getStockTakeItems(stockTakeId) {
    if (!this.activeStockTake || this.activeStockTake.id !== stockTakeId) {
      return [];
    }
    return this.stockTakeItems;
  }

  getCompletedStockTakes() {
    return this.completedStockTakes;
  }

  startStockTake({ type, location, userId = 'training_user' }) {
    const targetLoc = location || 'Flamstead';
    const newStockTake = {
      id: 'train-st-' + Date.now(),
      type: type || 'FULL',
      status: 'IN_PROGRESS',
      location: targetLoc,
      started_by: userId,
      created_at: new Date().toISOString(),
      completed_at: null
    };

    let items = [];
    if (type === 'FULL') {
      const eligibleStock = this.stock.filter(item => 
        item.location === targetLoc && 
        (!item.assigned_to || item.assigned_to === 'Unassigned')
      );

      items = eligibleStock.map(stockItem => ({
        id: 'train-sti-' + Math.random().toString(36).substr(2, 9),
        stock_take_id: newStockTake.id,
        item_id: stockItem.id,
        expected_quantity: 1,
        counted_quantity: 0,
        status: 'PENDING',
        stock_items: { ...stockItem }
      }));
    }

    this.activeStockTake = newStockTake;
    this.stockTakeItems = items;
    this.notify();
    return { stockTake: newStockTake, items };
  }

  scanStockTakeItem({ barcode, location, matchedItemType }) {
    if (!this.activeStockTake) throw new Error("No active stock take in progress.");

    const loc = this.activeStockTake.location || location || 'Flamstead';
    const cleanBarcode = (barcode || '').trim();

    // Check if item exists in active stock take items
    const existingIndex = this.stockTakeItems.findIndex(i => 
      (i.stock_items?.barcode || '').toLowerCase() === cleanBarcode.toLowerCase()
    );

    if (existingIndex >= 0) {
      const existing = this.stockTakeItems[existingIndex];
      const updated = {
        ...existing,
        counted_quantity: (existing.counted_quantity || 0) + 1,
        status: 'COUNTED'
      };
      const updatedList = [...this.stockTakeItems];
      updatedList[existingIndex] = updated;
      this.stockTakeItems = updatedList;
      this.notify();
      return { item: updated, isNew: false };
    }

    // Check if in training stock
    const matchingStock = this.stock.find(i => 
      (i.barcode || '').toLowerCase() === cleanBarcode.toLowerCase() &&
      i.location === loc
    );

    let stockItemRef = matchingStock;
    if (!stockItemRef) {
      // Create new virtual stock item for this scanned barcode
      const name = matchedItemType?.name || (cleanBarcode.startsWith('SN-') ? 'MainsFlow Meter' : 'Scanned Stock Item');
      stockItemRef = {
        id: 'train-st-item-' + Date.now(),
        name,
        barcode: cleanBarcode,
        purchase_price: matchedItemType?.price || 50.00,
        description: 'Audited during training stock take',
        location: loc,
        assigned_to: 'Unassigned',
        created_at: new Date().toISOString()
      };
      // Add to training stock as live physical item
      this.stock = [stockItemRef, ...this.stock];
    }

    const newItem = {
      id: 'train-sti-' + Math.random().toString(36).substr(2, 9),
      stock_take_id: this.activeStockTake.id,
      item_id: stockItemRef.id,
      expected_quantity: matchingStock ? 1 : 0,
      counted_quantity: 1,
      status: 'COUNTED',
      stock_items: { ...stockItemRef }
    };

    this.stockTakeItems = [newItem, ...this.stockTakeItems];
    this.notify();
    return { item: newItem, isNew: true };
  }

  rangeCountStockTake({ itemType, firstSerial, lastSerial, location }) {
    if (!this.activeStockTake) throw new Error("No active stock take.");
    const loc = this.activeStockTake.location || location || 'Flamstead';

    // Parse prefix and range
    const firstMatch = firstSerial.match(/^(.*?)(\d+)$/);
    const lastMatch = lastSerial.match(/^(.*?)(\d+)$/);
    if (!firstMatch || !lastMatch || firstMatch[1] !== lastMatch[1]) {
      throw new Error("Invalid serial format or prefixes do not match.");
    }

    const prefix = firstMatch[1];
    const startNum = parseInt(firstMatch[2], 10);
    const endNum = parseInt(lastMatch[2], 10);
    const padLen = firstMatch[2].length;

    if (startNum > endNum) throw new Error("First serial number must be less than or equal to last.");
    const count = endNum - startNum + 1;
    if (count > 500) throw new Error("Serial range exceeds maximum of 500 units.");

    const generatedSerials = [];
    for (let i = startNum; i <= endNum; i++) {
      generatedSerials.push(`${prefix}${String(i).padStart(padLen, '0')}`);
    }

    const updatedItems = [...this.stockTakeItems];

    generatedSerials.forEach(sn => {
      const idx = updatedItems.findIndex(i => (i.stock_items?.barcode || '').toLowerCase() === sn.toLowerCase());
      if (idx >= 0) {
        updatedItems[idx] = {
          ...updatedItems[idx],
          counted_quantity: 1,
          status: 'COUNTED'
        };
      } else {
        let physical = this.stock.find(s => (s.barcode || '').toLowerCase() === sn.toLowerCase() && s.location === loc);
        const wasExisting = !!physical;
        if (!physical) {
          physical = {
            id: 'train-sn-' + Math.random().toString(36).substr(2, 9),
            name: itemType.name,
            barcode: sn,
            purchase_price: itemType.price || 48.00,
            description: itemType.description || '',
            location: loc,
            assigned_to: 'Unassigned',
            created_at: new Date().toISOString()
          };
          this.stock = [physical, ...this.stock];
        }

        updatedItems.push({
          id: 'train-sti-' + Math.random().toString(36).substr(2, 9),
          stock_take_id: this.activeStockTake.id,
          item_id: physical.id,
          expected_quantity: wasExisting ? 1 : 0,
          counted_quantity: 1,
          status: 'COUNTED',
          stock_items: { ...physical }
        });
      }
    });

    this.stockTakeItems = updatedItems;
    this.notify();
    return { count, generatedSerials };
  }

  finaliseStockTake(auditorName = 'Trainee') {
    if (!this.activeStockTake) return;
    const completedAt = new Date().toISOString();
    const loc = this.activeStockTake.location || 'Flamstead';

    const completed = {
      ...this.activeStockTake,
      status: 'COMPLETED',
      completed_at: completedAt,
      items: JSON.parse(JSON.stringify(this.stockTakeItems))
    };

    // Calculate discrepancies and reconcile training stock
    const itemTypeCounts = {};
    this.stockTakeItems.forEach(item => {
      const name = item.stock_items?.name || 'Item';
      if (!itemTypeCounts[name]) {
        itemTypeCounts[name] = { expected: 0, counted: 0, sample: item.stock_items };
      }
      itemTypeCounts[name].expected += (item.expected_quantity || 0);
      itemTypeCounts[name].counted += (item.counted_quantity || 0);
    });

    Object.entries(itemTypeCounts).forEach(([name, data]) => {
      const diff = data.counted - data.expected;
      if (diff > 0) {
        this.recordMovement({
          item_id: data.sample?.id || 'train-surplus',
          item_name: name,
          item_barcode: data.sample?.barcode || 'N/A',
          movement_type: 'IN',
          location_from: 'Stock Take Discrepancy (Surplus)',
          location_to: loc,
          username: auditorName
        });
      } else if (diff < 0) {
        this.recordMovement({
          item_id: data.sample?.id || 'train-deficit',
          item_name: name,
          item_barcode: data.sample?.barcode || 'N/A',
          movement_type: 'OUT',
          location_from: loc,
          location_to: 'Stock Take Discrepancy (Missing)',
          username: auditorName
        });
      }
    });

    this.completedStockTakes = [completed, ...this.completedStockTakes];
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.notify();
    return completed;
  }

  cancelStockTake() {
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.notify();
  }
}

export const trainingManager = new TrainingEnvironmentManager();
