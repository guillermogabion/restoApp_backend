// src/modules/sync/sync.controller.js
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { computeOrderPricing, computeTotals } = require('../../utils/pricing');
const { generateOrderNumber } = require('../../utils/helpers');
const logger = require('../../utils/logger');

// ─── HMAC Verification ────────────────────────────────────────────────────────
function verifyHmac(payload, clientHmac) {
  const secret = process.env.SYNC_HMAC_SECRET;
  if (!secret) throw new Error('SYNC_HMAC_SECRET not configured');
  
  // payload must already be a canonical string - don't stringify again
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const computed = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(clientHmac));
}

// ─── Push Offline Batch ───────────────────────────────────────────────────────
const push = async (req, res, next) => {
  try {
    const { tenantId, branchId, userId } = req.user;
    const { batchId, deviceId, operations, hmac } = req.body;

    // ── Anti-Tamper Check ──────────────────────────────────────────────────────
    // Client must HMAC the full operations payload before sending.
    // Server re-computes and compares. If mismatch → reject.
    const canonicalPayload = JSON.stringify({ batchId, deviceId, operations });
    let hmacValid = false;
    try {
      hmacValid = verifyHmac(canonicalPayload, hmac);
    } catch {
      hmacValid = false;
    }

    if (!hmacValid) {
      await prisma.syncQueue.create({
        data: {
          id: uuidv4(), tenantId, branchId, deviceId,
          payload: JSON.stringify(req.body),
          checksum: hmac || '',
          status: 'REJECTED',
          rejectReason: 'HMAC verification failed',
          processedAt: new Date(),
        },
      });
      throw new AppError('Sync rejected: payload integrity check failed', 400);
    }

    // ── Log the sync queue entry ───────────────────────────────────────────────
    const queueEntry = await prisma.syncQueue.create({
      data: {
        id: uuidv4(), tenantId, branchId, deviceId,
        payload: JSON.stringify(req.body),
        checksum: hmac,
        status: 'PENDING',
      },
    });

    const results = [];

    for (const op of operations) {
      try {
        const result = await processOperation(op, { tenantId, branchId, userId });
        results.push({ clientId: op.clientId, status: 'applied', serverId: result?.id });
      } catch (err) {
        logger.warn(`Sync op failed: ${op.type} [${op.clientId}]`, err.message);
        results.push({ clientId: op.clientId, status: 'rejected', reason: err.message });
      }
    }

    // Mark queue entry as processed
    await prisma.syncQueue.update({
      where: { id: queueEntry.id },
      data: { status: 'APPLIED', processedAt: new Date() },
    });

    res.json({
      success: true,
      data: { batchId, results, appliedAt: new Date() },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Process a Single Operation ───────────────────────────────────────────────
async function processOperation(op, context) {
  const { tenantId, branchId, userId } = context;

  switch (op.type) {
    case 'CREATE_ORDER': {
      const { tableId, orderType, items, notes, customerId, clientOrderId } = op.data;

      // Dedup
      if (clientOrderId) {
        const existing = await prisma.order.findFirst({ where: { branchId, clientOrderId } });
        if (existing) return existing; // idempotent
      }

      // Server always recomputes prices — client prices are ignored
      const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);
      const { discount, tax, total } = computeTotals({ subtotal, discountAmount: 0, taxRate: 0.12 });
      const orderNumber = await generateOrderNumber(branchId);

      const order = await prisma.order.create({
        data: {
          tenantId, branchId, orderNumber,
          tableId: tableId || null,
          customerId: customerId || null,
          createdByUserId: userId,
          orderType: orderType || 'DINE_IN',
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          subtotal, discount, tax, total,
          notes: notes || null,
          clientOrderId: clientOrderId || null,
          syncedAt: new Date(),
          items: { create: computedItems },
        },
      });

      await prisma.orderStatusHistory.create({
        data: { orderId: order.id, status: 'PENDING', changedBy: userId, note: 'Created via offline sync' },
      });

      return order;
    }

    case 'UPDATE_ORDER_STATUS': {
      const { orderId, status } = op.data;
      const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
      if (!order) throw new Error(`Order ${orderId} not found`);

      await prisma.order.update({ where: { id: orderId }, data: { status } });
      await prisma.orderStatusHistory.create({
        data: { orderId, status, changedBy: userId, note: 'Updated via offline sync' },
      });
      return { id: orderId };
    }

    case 'PAY_ORDER': {
      const { orderId, paymentMethod } = op.data;
      const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
      if (!order) throw new Error(`Order ${orderId} not found`);
      if (order.paymentStatus === 'PAID') return order; // idempotent

      await prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'PAID', paymentMethod, status: 'COMPLETED' },
      });
      return { id: orderId };
    }

    case 'INVENTORY_ADJUSTMENT': {
      const { inventoryId, type, quantity, note } = op.data;
      const inventory = await prisma.inventory.findFirst({ where: { id: inventoryId, branch: { tenantId } } });
      if (!inventory) throw new Error(`Inventory ${inventoryId} not found`);

      const delta = ['IN', 'ADJUSTMENT'].includes(type) ? quantity : -Math.abs(quantity);
      await prisma.$transaction([
        prisma.inventory.update({ where: { id: inventoryId }, data: { quantity: { increment: delta } } }),
        prisma.inventoryMovement.create({ data: { inventoryId, type, quantity: Math.abs(quantity), note, createdBy: userId } }),
      ]);
      return { id: inventoryId };
    }

    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

// ─── Pull - Server Delta ──────────────────────────────────────────────────────
const pull = async (req, res, next) => {
  try {
    const { tenantId, branchId } = req.user;
    const { since } = req.query;

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [orders, menuItems, inventory] = await Promise.all([
      prisma.order.findMany({
        where: { branchId, tenantId, updatedAt: { gte: sinceDate } },
        include: { items: true },
        orderBy: { updatedAt: 'asc' },
      }),
      prisma.menuItem.findMany({
        where: { tenantId, updatedAt: { gte: sinceDate }, isArchived: false },
        include: { variants: true, modifiers: true },
      }),
      prisma.inventory.findMany({
        where: { branchId, updatedAt: { gte: sinceDate } },
      }),
    ]);

    res.json({
      success: true,
      data: {
        serverTime: new Date().toISOString(),
        since: sinceDate.toISOString(),
        orders,
        menuItems,
        inventory,
      },
    });
  } catch (err) { next(err); }
};

// ─── Batch Status ─────────────────────────────────────────────────────────────
const batchStatus = async (req, res, next) => {
  try {
    // batchId is stored inside the payload JSON
    const entry = await prisma.syncQueue.findFirst({
      where: {
        tenantId: req.user.tenantId,
        payload: { path: ['batchId'], equals: req.params.batchId },
      },
    });
    if (!entry) throw new AppError('Batch not found', 404);
    res.json({ success: true, data: { status: entry.status, rejectReason: entry.rejectReason, processedAt: entry.processedAt } });
  } catch (err) { next(err); }
};

module.exports = { push, pull, batchStatus };
