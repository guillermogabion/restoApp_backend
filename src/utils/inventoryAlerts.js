// src/utils/inventoryAlerts.js
const { emitToInventory, emitToBranch, emitToTenant } = require('./socket');

/**
 * Real-time inventory monitoring and alerting system
 */
class InventoryMonitor {
  constructor() {
    this.alertThresholds = {
      CRITICAL: 0.1,    // 10% of low stock level
      LOW: 1.0,        // At low stock level
      WARNING: 1.5,    // 150% of low stock level (getting close)
    };
  }

  /**
   * Check inventory levels and emit appropriate alerts
   */
  async checkAndAlert(io, inventoryItem, previousQuantity = null) {
    const { id, branchId, tenantId, name, quantity, lowStockAt, unit } = inventoryItem;
    const currentQty = parseFloat(quantity);
    const lowStockThreshold = parseFloat(lowStockAt || 0);

    // Determine alert level
    let alertLevel = null;
    let alertType = null;

    if (currentQty <= 0) {
      alertLevel = 'OUT_OF_STOCK';
      alertType = 'error';
    } else if (currentQty <= lowStockThreshold * this.alertThresholds.CRITICAL) {
      alertLevel = 'CRITICAL';
      alertType = 'error';
    } else if (currentQty <= lowStockThreshold) {
      alertLevel = 'LOW_STOCK';
      alertType = 'warning';
    } else if (currentQty <= lowStockThreshold * this.alertThresholds.WARNING) {
      alertLevel = 'WARNING';
      alertType = 'info';
    }

    if (alertLevel) {
      const alertData = {
        inventoryId: id,
        name,
        quantity: currentQty,
        lowStockAt: lowStockThreshold,
        unit,
        alertLevel,
        alertType,
        branchId,
        tenantId,
        timestamp: new Date().toISOString(),
        previousQuantity: previousQuantity ? parseFloat(previousQuantity) : null,
        change: previousQuantity ? currentQty - parseFloat(previousQuantity) : null
      };

      // Emit to inventory monitoring room (management)
      emitToInventory(io, branchId, 'inventory:alert', alertData);

      // Emit to branch (all users)
      emitToBranch(io, branchId, 'inventory:update', {
        ...alertData,
        type: 'alert'
      });

      // Critical alerts go to tenant level (owners)
      if (['CRITICAL', 'OUT_OF_STOCK'].includes(alertLevel)) {
        emitToTenant(io, tenantId, 'inventory:critical', alertData);
      }
    }

    // Always emit quantity update for real-time dashboards
    const updateData = {
      inventoryId: id,
      name,
      quantity: currentQty,
      lowStockAt: lowStockThreshold,
      unit,
      branchId,
      timestamp: new Date().toISOString(),
      previousQuantity: previousQuantity ? parseFloat(previousQuantity) : null,
      change: previousQuantity ? currentQty - parseFloat(previousQuantity) : null
    };

    emitToInventory(io, branchId, 'inventory:quantity_update', updateData);
  }

  /**
   * Handle order-related inventory changes
   */
  async handleOrderReduction(io, branchId, tenantId, orderItems) {
    const affectedIngredients = new Map();

    // Collect all affected ingredients
    for (const item of orderItems) {
      if (item.ingredients) {
        for (const ingredient of item.ingredients) {
          const key = `${ingredient.inventoryId}`;
          if (!affectedIngredients.has(key)) {
            affectedIngredients.set(key, {
              inventoryId: ingredient.inventoryId,
              name: ingredient.inventory.name,
              quantity: ingredient.inventory.quantity,
              lowStockAt: ingredient.inventory.lowStockAt,
              unit: ingredient.inventory.unit,
              branchId,
              tenantId,
              reduced: 0
            });
          }
          affectedIngredients.get(key).reduced += parseFloat(ingredient.quantityUsed) * item.quantity;
        }
      }
    }

    // Emit order impact alerts
    for (const [key, ingredient] of affectedIngredients) {
      const previousQty = ingredient.quantity;
      const newQty = previousQty - ingredient.reduced;

      emitToInventory(io, branchId, 'inventory:order_impact', {
        inventoryId: ingredient.inventoryId,
        name: ingredient.name,
        previousQuantity: previousQty,
        newQuantity: newQty,
        reduced: ingredient.reduced,
        unit: ingredient.unit,
        branchId,
        tenantId,
        timestamp: new Date().toISOString(),
        type: 'order_reduction'
      });

      // Check for alerts after reduction
      await this.checkAndAlert(io, {
        ...ingredient,
        quantity: newQty
      }, previousQty);
    }
  }

  /**
   * Handle manual inventory adjustments
   */
  async handleManualAdjustment(io, inventoryItem, adjustment, type, note, userId) {
    const adjustmentData = {
      inventoryId: inventoryItem.id,
      name: inventoryItem.name,
      quantity: parseFloat(inventoryItem.quantity),
      adjustment: parseFloat(adjustment),
      type,
      note,
      userId,
      branchId: inventoryItem.branchId,
      tenantId: inventoryItem.tenantId,
      unit: inventoryItem.unit,
      timestamp: new Date().toISOString()
    };

    emitToInventory(io, inventoryItem.branchId, 'inventory:adjustment', adjustmentData);
    emitToBranch(io, inventoryItem.branchId, 'inventory:update', {
      ...adjustmentData,
      type: 'adjustment'
    });
  }

  /**
   * Handle bulk inventory updates (restocking, etc.)
   */
  async handleBulkUpdate(io, branchId, tenantId, updates) {
    const bulkData = {
      branchId,
      tenantId,
      updates: updates.map(update => ({
        inventoryId: update.id,
        name: update.name,
        previousQuantity: update.previousQuantity,
        newQuantity: update.quantity,
        change: update.quantity - update.previousQuantity,
        unit: update.unit,
        timestamp: new Date().toISOString()
      })),
      timestamp: new Date().toISOString()
    };

    emitToInventory(io, branchId, 'inventory:bulk_update', bulkData);
    emitToBranch(io, branchId, 'inventory:update', {
      ...bulkData,
      type: 'bulk_update'
    });
  }
}

const inventoryMonitor = new InventoryMonitor();

module.exports = {
  InventoryMonitor,
  inventoryMonitor,
  checkInventoryAlerts: inventoryMonitor.checkAndAlert.bind(inventoryMonitor),
  handleOrderReduction: inventoryMonitor.handleOrderReduction.bind(inventoryMonitor),
  handleManualAdjustment: inventoryMonitor.handleManualAdjustment.bind(inventoryMonitor),
  handleBulkUpdate: inventoryMonitor.handleBulkUpdate.bind(inventoryMonitor)
};