// src/modules/inventory/inventory.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { emitToBranch } = require('../../utils/socket');

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

    // Alert if low stock
    if (parseFloat(updated.quantity) <= parseFloat(updated.lowStockAt)) {
      const io = req.app.get('io');
      emitToBranch(io, item.branchId, 'inventory:low_stock', {
        id: item.id, name: item.name, quantity: updated.quantity, lowStockAt: updated.lowStockAt,
      });
    }

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

module.exports = { list, create, update, addMovement, getMovements, getLowStock };
