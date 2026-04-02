// src/utils/cache.js
const NodeCache = require('node-cache');

// Cache for 5 minutes (300 seconds)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

class InventoryCache {
  static getInventoryStatus(branchId) {
    return cache.get(`inventory:status:${branchId}`);
  }

  static setInventoryStatus(branchId, data) {
    cache.set(`inventory:status:${branchId}`, data);
  }

  static invalidateInventoryStatus(branchId) {
    cache.del(`inventory:status:${branchId}`);
  }

  static getDashboardData(branchId) {
    return cache.get(`inventory:dashboard:${branchId}`);
  }

  static setDashboardData(branchId, data) {
    cache.set(`inventory:dashboard:${branchId}`, data);
  }

  static invalidateDashboardData(branchId) {
    cache.del(`inventory:dashboard:${branchId}`);
  }

  // Clear all inventory cache for a branch
  static invalidateBranchInventory(branchId) {
    this.invalidateInventoryStatus(branchId);
    this.invalidateDashboardData(branchId);
  }

  // Get cache statistics
  static getStats() {
    return cache.getStats();
  }

  // Clear all cache
  static clearAll() {
    cache.flushAll();
  }
}

module.exports = { InventoryCache };