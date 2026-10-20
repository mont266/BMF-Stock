// Training Mode Sandbox Environment
// Provides a completely isolated, in-memory data store for training.
// Zero changes are written to the backend database.
// All training state is cleared when Training Mode is exited or the app/tab is closed.

const TRAINING_SESSION_KEY = 'bregan_mainsflow_training_session';

export const INITIAL_TRAINING_STOCK = [
  // Unique serial number items - Meters (Flamstead)
  {
    id: 'train-stock-1',
    name: 'Elster A100C Single Phase Meter',
    barcode: 'SN-100C-001',
    purchase_price: 48.50,
    description: 'MID Approved Single Phase Residential Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-2',
    name: 'Elster A100C Single Phase Meter',
    barcode: 'SN-100C-002',
    purchase_price: 48.50,
    description: 'MID Approved Single Phase Residential Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-3',
    name: 'Elster A100C Single Phase Meter',
    barcode: 'SN-100C-003',
    purchase_price: 48.50,
    description: 'MID Approved Single Phase Residential Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-4',
    name: 'Elster A100C Single Phase Meter',
    barcode: 'SN-100C-004',
    purchase_price: 48.50,
    description: 'MID Approved Single Phase Residential Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-5',
    name: 'Elster A100C Single Phase Meter',
    barcode: 'SN-100C-005',
    purchase_price: 48.50,
    description: 'MID Approved Single Phase Residential Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  // Landis+Gyr E470 Smart Meters
  {
    id: 'train-stock-6',
    name: 'Landis+Gyr E470 Smart Meter',
    barcode: 'SN-E470-101',
    purchase_price: 62.00,
    description: 'SMETS2 Compliant Electricity Smart Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-7',
    name: 'Landis+Gyr E470 Smart Meter',
    barcode: 'SN-E470-102',
    purchase_price: 62.00,
    description: 'SMETS2 Compliant Electricity Smart Meter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-8',
    name: 'Landis+Gyr E470 Smart Meter',
    barcode: 'SN-E470-103',
    purchase_price: 62.00,
    description: 'SMETS2 Compliant Electricity Smart Meter',
    location: 'Leading Stores',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  // Gas Meter - Secure Liberty 100
  {
    id: 'train-stock-9',
    name: 'Secure Liberty 100 Gas Meter',
    barcode: 'SN-LIB-501',
    purchase_price: 75.00,
    description: 'Ultrasonic Domestic Gas Meter SMETS2',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-10',
    name: 'Secure Liberty 100 Gas Meter',
    barcode: 'SN-LIB-502',
    purchase_price: 75.00,
    description: 'Ultrasonic Domestic Gas Meter SMETS2',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  // Thermal Imaging Camera (Tooling)
  {
    id: 'train-stock-11',
    name: 'FLIR E4 Thermal Imaging Camera',
    barcode: 'FLIR-E4-001',
    purchase_price: 850.00,
    description: 'Infrared inspection camera with MSX enhancement',
    location: 'Flamstead',
    assigned_to: 'Team Alpha',
    assigned_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    assigned_by: 'Dave Miller',
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  {
    id: 'train-stock-12',
    name: 'FLIR E4 Thermal Imaging Camera',
    barcode: 'FLIR-E4-002',
    purchase_price: 850.00,
    description: 'Infrared inspection camera with MSX enhancement',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    user_id: 'training_user'
  },
  // Bulk / Non-unique items
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `train-stock-pipe-${i + 1}`,
    name: 'MDPE Blue Water Pipe 25mm (25m Coil)',
    barcode: 'PIPE-25MM',
    purchase_price: 24.50,
    description: 'Potable water supply pipe 25mm diameter',
    location: 'Flamstead',
    assigned_to: i < 3 ? 'Team Alpha' : 'Unassigned',
    assigned_at: i < 3 ? new Date(Date.now() - 2 * 86400000).toISOString() : null,
    assigned_by: i < 3 ? 'John Smith' : null,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    user_id: 'training_user'
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `train-stock-stopcock-${i + 1}`,
    name: 'Brass Stopcock 22mm Compression',
    barcode: 'BRASS-STOP-22',
    purchase_price: 8.90,
    description: 'BS 1010-2 compliant water isolation stopcock',
    location: 'Flamstead',
    assigned_to: i < 2 ? 'Team Bravo' : 'Unassigned',
    assigned_at: i < 2 ? new Date(Date.now() - 1 * 86400000).toISOString() : null,
    assigned_by: i < 2 ? 'Dave Miller' : null,
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    user_id: 'training_user'
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `train-stock-cutter-${i + 1}`,
    name: 'Rothenberger Pro Pipe Cutter 6-42mm',
    barcode: 'ROTH-CUT-01',
    purchase_price: 36.20,
    description: 'Heavy duty copper and plastic tube cutter',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    user_id: 'training_user'
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `train-stock-ppe-${i + 1}`,
    name: 'Hi-Vis Vest Class 3 (L)',
    barcode: 'PPE-HIVIS-L',
    purchase_price: 6.50,
    description: 'EN ISO 20471 compliant high visibility vest',
    location: 'Flamstead',
    assigned_to: 'Unassigned',
    assigned_at: null,
    assigned_by: null,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    user_id: 'training_user'
  }))
];

export const INITIAL_TRAINING_MOVEMENTS = [
  {
    id: 'train-mov-1',
    item_id: 'train-stock-1',
    item_name: 'Elster A100C Single Phase Meter',
    item_barcode: 'SN-100C-001',
    movement_type: 'IN',
    location_from: 'New Stock',
    location_to: 'Flamstead',
    username: 'Dave Miller',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 4 * 86400000).toISOString()
  },
  {
    id: 'train-mov-2',
    item_id: 'train-stock-2',
    item_name: 'Elster A100C Single Phase Meter',
    item_barcode: 'SN-100C-002',
    movement_type: 'IN',
    location_from: 'New Stock',
    location_to: 'Flamstead',
    username: 'Dave Miller',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 4 * 86400000).toISOString()
  },
  {
    id: 'train-mov-3',
    item_id: 'train-stock-6',
    item_name: 'Landis+Gyr E470 Smart Meter',
    item_barcode: 'SN-E470-101',
    movement_type: 'IN',
    location_from: 'New Stock',
    location_to: 'Flamstead',
    username: 'John Smith',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 3 * 86400000).toISOString()
  },
  {
    id: 'train-mov-4',
    item_id: 'train-stock-11',
    item_name: 'FLIR E4 Thermal Imaging Camera',
    item_barcode: 'FLIR-E4-001',
    movement_type: 'OUT',
    location_from: 'Flamstead',
    location_to: 'Team Alpha',
    username: 'Dave Miller',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 1 * 86400000).toISOString()
  },
  {
    id: 'train-mov-5',
    item_id: 'train-stock-pipe-1',
    item_name: 'MDPE Blue Water Pipe 25mm (25m Coil)',
    item_barcode: 'PIPE-25MM',
    movement_type: 'OUT',
    location_from: 'Flamstead',
    location_to: 'Team Alpha',
    username: 'John Smith',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 2 * 86400000).toISOString()
  },
  {
    id: 'train-mov-6',
    item_id: 'train-stock-stopcock-1',
    item_name: 'Brass Stopcock 22mm Compression',
    item_barcode: 'BRASS-STOP-22',
    movement_type: 'OUT',
    location_from: 'Flamstead',
    location_to: 'Team Bravo',
    username: 'Dave Miller',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 1 * 86400000).toISOString()
  },
  {
    id: 'train-mov-7',
    item_id: 'train-stock-9',
    item_name: 'Secure Liberty 100 Gas Meter',
    item_barcode: 'SN-LIB-501',
    movement_type: 'IN',
    location_from: 'New Stock',
    location_to: 'Flamstead',
    username: 'Sarah Connor',
    user_id: 'training_user',
    created_at: new Date(Date.now() - 5 * 86400000).toISOString()
  }
];

class TrainingEnvironmentManager {
  constructor() {
    this.isActive = false;
    this.stock = [];
    this.movements = [];
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

  startTrainingSession() {
    this.isActive = true;
    this.stock = JSON.parse(JSON.stringify(INITIAL_TRAINING_STOCK));
    this.movements = JSON.parse(JSON.stringify(INITIAL_TRAINING_MOVEMENTS));
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    this.notify();
    return true;
  }

  resetTrainingSession() {
    if (!this.isActive) return;
    this.stock = JSON.parse(JSON.stringify(INITIAL_TRAINING_STOCK));
    this.movements = JSON.parse(JSON.stringify(INITIAL_TRAINING_MOVEMENTS));
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
    this.activeStockTake = null;
    this.stockTakeItems = [];
    this.completedStockTakes = [];
    this.unrecognizedScans = [];
    try {
      sessionStorage.removeItem(TRAINING_SESSION_KEY);
    } catch {}
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
          expected_quantity: physical ? 1 : 0,
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
