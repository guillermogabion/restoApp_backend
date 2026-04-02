// src/docs/realtime-inventory-example.js
/**
 * Real-Time Inventory Tracking - Frontend Integration Example
 *
 * This example shows how to integrate with the real-time inventory monitoring system
 * using Socket.io for live updates and alerts.
 */

const io = require('socket.io-client');

// Connect to the restaurant backend
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token-here' // User must be authenticated
  }
});

// Listen for real-time inventory events
socket.on('connect', () => {
  console.log('Connected to real-time inventory monitoring');

  // Join inventory monitoring room (automatically done server-side based on role)
  // OWNER, MANAGER, CASHIER roles get inventory updates
});

// ─── INVENTORY ALERTS ──────────────────────────────────────────────────────
socket.on('inventory:alert', (data) => {
  /**
   * Triggered when inventory levels reach alert thresholds
   * Sent to: inventory:${branchId} room (management roles)
   */
  console.log('Inventory Alert:', data);

  const { inventoryId, name, quantity, lowStockAt, alertLevel, alertType } = data;

  switch (alertLevel) {
    case 'OUT_OF_STOCK':
      showCriticalAlert(`🚨 ${name} is OUT OF STOCK!`, 'error');
      break;
    case 'CRITICAL':
      showCriticalAlert(`⚠️ ${name} critically low: ${quantity} remaining`, 'error');
      break;
    case 'LOW_STOCK':
      showWarningAlert(`⚠️ ${name} running low: ${quantity} remaining`, 'warning');
      break;
    case 'WARNING':
      showInfoAlert(`ℹ️ ${name} getting low: ${quantity} remaining`, 'info');
      break;
  }

  // Update dashboard
  updateInventoryItem(inventoryId, { quantity, alertLevel });
});

// ─── QUANTITY UPDATES ──────────────────────────────────────────────────────
socket.on('inventory:quantity_update', (data) => {
  /**
   * Triggered on any inventory quantity change
   * Sent to: inventory:${branchId} room
   */
  console.log('Inventory Updated:', data);

  const { inventoryId, name, quantity, previousQuantity, change } = data;

  // Update UI elements
  updateInventoryDisplay(inventoryId, quantity);

  // Show change indicator
  if (change !== null) {
    showQuantityChange(inventoryId, change > 0 ? `+${change}` : change);
  }
});

// ─── ORDER IMPACT ALERTS ───────────────────────────────────────────────────
socket.on('inventory:order_impact', (data) => {
  /**
   * Triggered when orders reduce inventory
   * Sent to: inventory:${branchId} room
   */
  console.log('Order Impact:', data);

  const { inventoryId, name, previousQuantity, newQuantity, reduced } = data;

  // Show order impact notification
  showOrderImpact(`Order reduced ${name} by ${reduced} units`);

  // Update progress bars or charts
  updateStockLevelChart(inventoryId, newQuantity);
});

// ─── MANUAL ADJUSTMENTS ────────────────────────────────────────────────────
socket.on('inventory:adjustment', (data) => {
  /**
   * Triggered on manual inventory adjustments
   * Sent to: inventory:${branchId} room
   */
  console.log('Manual Adjustment:', data);

  const { inventoryId, name, adjustment, type, note, userId } = data;

  // Log adjustment activity
  logInventoryActivity(`${name}: ${adjustment > 0 ? '+' : ''}${adjustment} (${type})`);

  // Refresh audit trail
  refreshInventoryMovements(inventoryId);
});

// ─── BULK UPDATES ──────────────────────────────────────────────────────────
socket.on('inventory:bulk_update', (data) => {
  /**
   * Triggered on bulk inventory operations (restocking, etc.)
   * Sent to: inventory:${branchId} room
   */
  console.log('Bulk Update:', data);

  const { updates } = data;

  updates.forEach(update => {
    updateInventoryItem(update.inventoryId, {
      quantity: update.newQuantity,
      change: update.change
    });
  });

  showBulkUpdateNotification(`Updated ${updates.length} inventory items`);
});

// ─── GENERAL BRANCH UPDATES ────────────────────────────────────────────────
socket.on('inventory:update', (data) => {
  /**
   * General inventory updates sent to all branch users
   * Sent to: branch:${branchId} room (all authenticated users)
   */
  console.log('Branch Inventory Update:', data);

  // Handle different update types
  switch (data.type) {
    case 'alert':
      // Handle alert updates for all users
      break;
    case 'adjustment':
      // Handle adjustment notifications
      break;
    case 'bulk_update':
      // Handle bulk update notifications
      break;
  }
});

// ─── CRITICAL ALERTS (TENANT LEVEL) ────────────────────────────────────────
socket.on('inventory:critical', (data) => {
  /**
   * Critical alerts sent to tenant owners
   * Sent to: tenant:${tenantId} room (owner roles only)
   */
  console.log('Critical Tenant Alert:', data);

  // Show owner-level critical notifications
  showOwnerAlert(`🚨 Critical: ${data.name} ${data.alertLevel}`, 'error');

  // Could trigger SMS/email notifications for owners
  if (data.alertLevel === 'OUT_OF_STOCK') {
    sendOwnerNotification(data);
  }
});

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────────────
function showCriticalAlert(message, type) {
  // Implement your alert system (toast, modal, etc.)
  console.error(message);
}

function showWarningAlert(message, type) {
  console.warn(message);
}

function showInfoAlert(message, type) {
  console.info(message);
}

function updateInventoryItem(inventoryId, updates) {
  // Update your inventory table/grid
  const item = document.querySelector(`[data-inventory-id="${inventoryId}"]`);
  if (item) {
    Object.keys(updates).forEach(key => {
      const element = item.querySelector(`[data-field="${key}"]`);
      if (element) {
        element.textContent = updates[key];
        element.classList.add('updated');
        setTimeout(() => element.classList.remove('updated'), 2000);
      }
    });
  }
}

function updateInventoryDisplay(inventoryId, quantity) {
  // Update quantity displays
  const displays = document.querySelectorAll(`[data-inventory-id="${inventoryId}"][data-field="quantity"]`);
  displays.forEach(display => {
    display.textContent = quantity;
  });
}

function showQuantityChange(inventoryId, changeText) {
  // Show animated change indicator
  const item = document.querySelector(`[data-inventory-id="${inventoryId}"]`);
  if (item) {
    const indicator = document.createElement('span');
    indicator.className = `change-indicator ${changeText.startsWith('+') ? 'positive' : 'negative'}`;
    indicator.textContent = changeText;
    item.appendChild(indicator);

    setTimeout(() => indicator.remove(), 3000);
  }
}

// ─── DASHBOARD INTEGRATION ──────────────────────────────────────────────────
/**
 * Example: Real-time inventory dashboard
 */
class InventoryDashboard {
  constructor() {
    this.charts = {};
    this.alerts = [];
    this.setupSocketListeners();
    this.loadInitialData();
  }

  setupSocketListeners() {
    // Listen for all inventory events
    socket.on('inventory:alert', (data) => this.handleAlert(data));
    socket.on('inventory:quantity_update', (data) => this.handleQuantityUpdate(data));
    socket.on('inventory:order_impact', (data) => this.handleOrderImpact(data));
  }

  async loadInitialData() {
    try {
      // Load current inventory status
      const response = await fetch('/api/inventory/realtime/branch-123');
      const data = await response.json();

      this.updateDashboard(data.data);
    } catch (error) {
      console.error('Failed to load inventory data:', error);
    }
  }

  handleAlert(alert) {
    this.alerts.unshift(alert);
    this.updateAlertsList();
    this.updateAlertSummary();
  }

  handleQuantityUpdate(update) {
    this.updateCharts(update);
    this.updateStockLevels(update);
  }

  handleOrderImpact(impact) {
    this.showOrderNotification(impact);
    this.updateOrderHistory(impact);
  }

  updateDashboard(data) {
    // Update all dashboard components
    this.updateCharts(data.inventory);
    this.updateAlertsList(data.alerts);
    this.updateSummaryStats(data);
  }
}

// ─── POLLING FALLBACK ──────────────────────────────────────────────────────
/**
 * Fallback for environments where WebSocket isn't available
 */
class InventoryPoller {
  constructor(branchId, interval = 30000) { // 30 seconds
    this.branchId = branchId;
    this.interval = interval;
    this.lastUpdate = null;
  }

  start() {
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.interval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async poll() {
    try {
      const response = await fetch(`/api/inventory/realtime/${this.branchId}`, {
        headers: {
          'If-Modified-Since': this.lastUpdate || ''
        }
      });

      if (response.status === 200) {
        const data = await response.json();
        this.lastUpdate = new Date().toUTCString();

        // Emit events as if they came from WebSocket
        data.data.inventory.forEach(item => {
          if (item.updatedAt > this.lastUpdate) {
            // Simulate real-time events
            this.emitSimulatedEvent('inventory:quantity_update', item);
          }
        });
      }
    } catch (error) {
      console.error('Polling failed:', error);
    }
  }

  emitSimulatedEvent(event, data) {
    // Dispatch custom events for components that expect WebSocket events
    window.dispatchEvent(new CustomEvent(event, { detail: data }));
  }
}

// ─── USAGE EXAMPLES ────────────────────────────────────────────────────────

// Initialize real-time dashboard
const dashboard = new InventoryDashboard();

// Or use polling fallback
const poller = new InventoryPoller('branch-123');
poller.start();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  poller.stop();
  socket.disconnect();
});

module.exports = {
  InventoryDashboard,
  InventoryPoller,
  socket
};