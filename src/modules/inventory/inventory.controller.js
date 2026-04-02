// src/modules/inventory/inventory.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { emitToBranch } = require('../../utils/socket');
const { checkInventoryAlerts, handleManualAdjustment } = require('../../utils/inventoryAlerts');
const logger = require('../../utils/logger');
const { InventoryCache } = require('../../utils/cache');

const list = async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { branchId: req.params.branchId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { branchId, name, unit, quantity, lowStockAt, costPerUnit } = req.body;

    // Verify branch belongs to tenant
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: req.user.tenantId } });
    if (!branch) throw new AppError('Branch not found', 404);

    const item = await prisma.inventory.create({
      data: { branchId, name, unit, quantity, lowStockAt, costPerUnit },
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const item = await prisma.inventory.findFirst({
      where: { id: req.params.id, branch: { tenantId: req.user.tenantId } },
    });
    if (!item) throw new AppError('Inventory item not found', 404);

    const updated = await prisma.inventory.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const addMovement = async (req, res, next) => {
  try {
    const { type, quantity, note } = req.body;
    const { userId } = req.user;

    const item = await prisma.inventory.findFirst({
      where: { id: req.params.id, branch: { tenantId: req.user.tenantId } },
    });
    if (!item) throw new AppError('Inventory item not found', 404);

    const delta = ['IN', 'ADJUSTMENT'].includes(type) ? quantity : -Math.abs(quantity);

    const [movement, updated] = await prisma.$transaction([
      prisma.inventoryMovement.create({
        data: { inventoryId: item.id, type, quantity: Math.abs(quantity), note, createdBy: userId },
      }),
      prisma.inventory.update({
        where: { id: item.id },
        data: { quantity: { increment: delta } },
      }),
    ]);

    // Real-time inventory monitoring and alerts
    const io = req.app.get('io');
    await checkInventoryAlerts(io, updated, item.quantity);
    await handleManualAdjustment(io, updated, delta, type, note, userId);

    // Invalidate cache for this branch
    InventoryCache.invalidateBranchInventory(item.branchId);

    res.json({ success: true, data: { movement, currentQuantity: updated.quantity } });
  } catch (err) { next(err); }
};

const getMovements = async (req, res, next) => {
  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: { inventoryId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: movements });
  } catch (err) { next(err); }
};

const getLowStock = async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany({
      where: {
        branchId: req.params.branchId,
        quantity: { lte: prisma.inventory.fields.lowStockAt },
      },
    });
    // Fallback: raw query since Prisma can't compare two columns directly
    const lowStock = await prisma.$queryRaw`
      SELECT * FROM "Inventory"
      WHERE "branchId" = ${req.params.branchId}
      AND quantity <= "lowStockAt"
      ORDER BY quantity ASC
    `;
    res.json({ success: true, data: lowStock });
  } catch (err) { next(err); }
};

const getDashboard = async (req, res, next) => {
  try {
    const branchId = req.params.branchId;
    const { alertLevel } = req.query; // 'all', 'critical', 'warning', 'low'

    // Build where clause for alerts
    let alertWhere = { branchId };
    if (alertLevel === 'critical') {
      alertWhere.quantity = { lte: 0 };
    } else if (alertLevel === 'low') {
      alertWhere.quantity = { lte: prisma.inventory.fields.lowStockAt };
    } else if (alertLevel === 'warning') {
      // Get items that are between lowStockAt and 1.5 * lowStockAt
      alertWhere = {
        branchId,
        AND: [
          { quantity: { gt: 0 } },
          { quantity: { lte: prisma.inventory.fields.lowStockAt } }
        ]
      };
    }

    const [totalItems, lowStockItems, outOfStockItems, recentMovements] = await Promise.all([
      // Total inventory items
      prisma.inventory.count({ where: { branchId } }),

      // Low stock items (quantity <= lowStockAt)
      prisma.$queryRaw`
        SELECT id, name, quantity, "lowStockAt", unit,
               CASE
                 WHEN quantity <= 0 THEN 'out_of_stock'
                 WHEN quantity <= "lowStockAt" * 0.1 THEN 'critical'
                 WHEN quantity <= "lowStockAt" THEN 'low'
                 WHEN quantity <= "lowStockAt" * 1.5 THEN 'warning'
                 ELSE 'normal'
               END as alert_level
        FROM "Inventory"
        WHERE "branchId" = ${branchId}
        AND (quantity <= "lowStockAt" OR quantity <= 0)
        ORDER BY quantity / NULLIF("lowStockAt", 0) ASC
      `,

      // Out of stock items
      prisma.inventory.count({
        where: { branchId, quantity: { lte: 0 } }
      }),

      // Recent movements (last 24 hours)
      prisma.inventoryMovement.findMany({
        where: {
          inventory: { branchId },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        include: {
          inventory: { select: { name: true, unit: true } },
          createdByUser: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      })
    ]);

    // Calculate summary statistics
    const criticalCount = lowStockItems.filter(item => item.alert_level === 'critical' || item.alert_level === 'out_of_stock').length;
    const warningCount = lowStockItems.filter(item => item.alert_level === 'warning').length;
    const lowCount = lowStockItems.filter(item => item.alert_level === 'low').length;

    res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          outOfStockCount: outOfStockItems,
          lowStockCount: lowStockItems.length,
          criticalCount,
          warningCount,
          lowCount
        },
        alerts: lowStockItems,
        recentMovements: recentMovements.map(movement => ({
          id: movement.id,
          inventoryId: movement.inventoryId,
          inventoryName: movement.inventory.name,
          type: movement.type,
          quantity: movement.quantity,
          unit: movement.inventory.unit,
          note: movement.note,
          createdAt: movement.createdAt,
          createdBy: movement.createdByUser?.name || 'System'
        }))
      }
    });
  } catch (err) { next(err); }
};

const getRealTimeStatus = async (req, res, next) => {
  try {
    const { branchId } = req.params; // Using destructuring for clarity

    // 1. Check Cache first
    const cachedData = InventoryCache.getInventoryStatus(branchId);
    if (cachedData) {
      return res.json({ success: true, data: cachedData, cached: true });
    }

    const startTime = Date.now();

    // 2. Fetch data
    // Added a check to ensure branchId exists before querying
    if (!branchId) {
      throw new AppError('Branch ID is required', 400);
    }

    const [branchRecord, inventoryStatus, activeAlerts] = await Promise.all([
      prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true, name: true }
      }),
      prisma.inventory.findMany({
        where: { branchId },
        select: {
          id: true,
          name: true,
          quantity: true,
          lowStockAt: true,
          unit: true,
          updatedAt: true
        },
        orderBy: { name: 'asc' }
      }),
      prisma.$queryRaw`
        SELECT id, name, quantity, "lowStockAt", unit,
               CASE
                 WHEN quantity <= 0 THEN 'out_of_stock'
                 WHEN quantity <= "lowStockAt" * 0.1 THEN 'critical'
                 WHEN quantity <= "lowStockAt" THEN 'low'
                 WHEN quantity <= "lowStockAt" * 1.5 THEN 'warning'
                 ELSE NULL
               END as alert_level,
               quantity / NULLIF("lowStockAt", 0) as stock_ratio
        FROM "Inventory"
        WHERE "branchId" = ${branchId}
        AND (
          quantity <= 0 OR
          quantity <= "lowStockAt" OR
          quantity <= "lowStockAt" * 1.5
        )
        ORDER BY stock_ratio ASC
      `
    ]);

    // 3. Guard: Use branchRecord instead of 'branch' to avoid naming conflicts
    if (!branchRecord) {
      return next(new AppError('Branch not found', 404));
    }

    const filteredAlerts = activeAlerts.filter(item => item.alert_level !== null);
    const responseTime = Date.now() - startTime;

    const responseData = {
      branchId: branchRecord.id,
      branchName: branchRecord.name,
      inventory: inventoryStatus,
      alerts: filteredAlerts,
      timestamp: new Date().toISOString(),
      metadata: {
        totalItems: inventoryStatus.length,
        alertCount: filteredAlerts.length,
        responseTimeMs: responseTime
      }
    };

    // 4. Log success using the record we just found
    logger.info(`Real-time inventory status for branch ${branchRecord.id}: ${inventoryStatus.length} items, ${filteredAlerts.length} alerts, ${responseTime}ms`);

    InventoryCache.setInventoryStatus(branchId, responseData);

    res.json({ success: true, data: responseData, cached: false });

  } catch (err) {
    // The error in your logs happens here or just before
    logger.error('Real-time inventory status error:', err.message);
    next(err);
  }
};

module.exports = { list, create, update, addMovement, getMovements, getLowStock, getDashboard, getRealTimeStatus };
