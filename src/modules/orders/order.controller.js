// src/modules/orders/order.controller.js
const { prisma } = require('../../config/db');
const { computeOrderPricing, computeTotals } = require('../../utils/pricing');
const { AppError } = require('../../middleware/errorHandler');
const { emitToKitchen, emitToBranch } = require('../../utils/socket');
const { generateOrderNumber } = require('../../utils/helpers');

// ─── Create Order ────────────────────────────────────────────────────────────
const createOrder = async (req, res, next) => {
  try {
    const { tenantId, branchId, userId } = req.user;
    const { tableId, orderType, items, notes, customerId, clientOrderId, discountAmount } = req.body;

    // Dedup check for offline sync
    if (clientOrderId) {
      const existing = await prisma.order.findUnique({ where: { branchId_clientOrderId: { branchId, clientOrderId } } });
      if (existing) return res.json({ success: true, data: existing, duplicate: true });
    }

    // Validate table belongs to this branch
    if (tableId) {
      const table = await prisma.table.findFirst({ where: { id: tableId, branchId, isActive: true } });
      if (!table) throw new AppError('Table not found in this branch', 404);
    }

    // SERVER always computes prices - client price is ignored
    const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);

    // Apply discount (validated, not trusted from client)
    const discount = discountAmount > 0 ? parseFloat(discountAmount) : 0;
    const { total } = computeTotals({ subtotal, discountAmount: discount });

    const orderNumber = await generateOrderNumber(branchId);

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          tenantId,
          branchId,
          orderNumber,
          tableId: tableId || null,
          customerId: customerId || null,
          createdByUserId: userId,
          orderType: orderType || 'DINE_IN',
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          subtotal,
          discount,
          total,
          notes: notes || null,
          clientOrderId: clientOrderId || null,
          syncedAt: clientOrderId ? new Date() : null,
          items: { create: computedItems },
        },
        include: { items: true, table: true },
      });

      // Log status history
      await tx.orderStatusHistory.create({
        data: { orderId: newOrder.id, status: 'PENDING', changedBy: userId },
      });

      // Deduct inventory if applicable
      for (const item of computedItems) {
        const links = await tx.inventoryLink.findMany({ where: { menuItemId: item.menuItemId } });
        for (const link of links) {
          await tx.inventory.update({
            where: { id: link.inventoryId },
            data: { quantity: { decrement: parseFloat(link.quantityUsed) * item.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              inventoryId: link.inventoryId,
              type: 'OUT',
              quantity: parseFloat(link.quantityUsed) * item.quantity,
              referenceId: newOrder.id,
              note: `Order ${orderNumber}`,
              createdBy: userId,
            },
          });
        }
      }

      return newOrder;
    });

    // Real-time: push new order to kitchen display
    const io = req.app.get('io');
    emitToKitchen(io, branchId, 'order:new', { orderId: order.id, orderNumber, items: computedItems, orderType });
    emitToBranch(io, branchId, 'order:created', { orderId: order.id, orderNumber, total });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

// ─── QR Customer Self-Order ──────────────────────────────────────────────────
const qrOrder = async (req, res, next) => {
  try {
    const { qrCode, items, notes, customerName, customerPhone } = req.body;

    const table = await prisma.table.findUnique({
      where: { qrCode },
      include: { branch: true },
    });
    if (!table || !table.isActive) throw new AppError('Invalid or inactive QR code', 400);

    const { tenantId, branchId } = table;

    // Find or create customer
    let customer = null;
    if (customerPhone) {
      customer = await prisma.customer.upsert({
        where: { tenantId_phone: { tenantId, phone: customerPhone } },
        update: { name: customerName || undefined },
        create: { tenantId, name: customerName || 'Guest', phone: customerPhone },
      });
    }

    const { computedItems, subtotal } = await computeOrderPricing(items, tenantId);
    const { discount, total } = computeTotals({ subtotal, discountAmount: 0 });
    const orderNumber = await generateOrderNumber(branchId);

    const order = await prisma.order.create({
      data: {
        tenantId, branchId,
        orderNumber,
        tableId: table.id,
        customerId: customer?.id || null,
        orderType: 'QR_ORDER',
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        subtotal, discount, total,
        notes: notes || null,
        items: { create: computedItems },
      },
      include: { items: true },
    });

    const io = req.app.get('io');
    emitToKitchen(io, branchId, 'order:new', { orderId: order.id, orderNumber, items: computedItems, orderType: 'QR_ORDER', tableId: table.id });

    res.status(201).json({ success: true, data: { orderId: order.id, orderNumber, total } });
  } catch (err) {
    next(err);
  }
};

// ─── List Orders ─────────────────────────────────────────────────────────────
const listOrders = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { status, orderType, date, page = 1, limit = 20 } = req.query;

    const where = { branchId, tenantId: req.user.tenantId };
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end = new Date(date); end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true, table: { select: { tableNumber: true } }, createdBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ success: true, data: orders, meta: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    next(err);
  }
};

// ─── Get Single Order ─────────────────────────────────────────────────────────
const getOrder = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, tenantId: req.user.tenantId },
      include: {
        items: true,
        table: true,
        createdBy: { select: { name: true, role: true } },
        customer: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        delivery: true,
      },
    });
    if (!order) throw new AppError('Order not found', 404);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

// ─── Update Order Status ──────────────────────────────────────────────────────
const updateStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;
    const { userId, tenantId, branchId, role } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    // Role-based status transition rules
    const transitions = {
      KITCHEN: ['PREPARING', 'READY'],
      WAITER: ['SERVED'],
      CASHIER: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
      MANAGER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
      OWNER: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
    };
    const allowed = transitions[role] || [];
    if (!allowed.includes(status)) throw new AppError(`Role ${role} cannot set status to ${status}`, 403);

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.order.update({
        where: { id: orderId },
        data: { status, updatedAt: new Date() },
      });
      await tx.orderStatusHistory.create({
        data: { orderId, status, changedBy: userId, note: note || null },
      });
      return upd;
    });

    const io = req.app.get('io');
    emitToBranch(io, order.branchId, 'order:status', { orderId, status, orderNumber: order.orderNumber });

    if (['PREPARING', 'READY'].includes(status)) {
      emitToKitchen(io, order.branchId, 'order:status', { orderId, status, orderNumber: order.orderNumber });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// ─── Process Payment ──────────────────────────────────────────────────────────
const processPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, amountTendered, loyaltyPointsRedeem } = req.body;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { customer: true },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.paymentStatus === 'PAID') throw new AppError('Order already paid', 400);

    let finalTotal = parseFloat(order.total);
    let loyaltyDiscount = 0;

    // Apply loyalty points redemption (server validates)
    if (loyaltyPointsRedeem && order.customerId && order.customer) {
      const program = await prisma.loyaltyProgram.findUnique({ where: { tenantId } });
      if (program?.isActive) {
        const maxRedeemable = Math.floor(order.customer.points / program.redemptionRate);
        const actualRedeem = Math.min(loyaltyPointsRedeem, order.customer.points, maxRedeemable * program.redemptionRate);
        loyaltyDiscount = parseFloat((actualRedeem / program.redemptionRate).toFixed(2));
        finalTotal = Math.max(0, finalTotal - loyaltyDiscount);
      }
    }

    const change = amountTendered ? Math.max(0, parseFloat(amountTendered) - finalTotal) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          paymentMethod,
          status: 'COMPLETED',
          discount: parseFloat(order.discount) + loyaltyDiscount,
          total: finalTotal,
          updatedAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: { orderId, status: 'COMPLETED', changedBy: userId, note: `Payment: ${paymentMethod}` },
      });

      // Earn loyalty points
      if (order.customerId) {
        const program = await tx.loyaltyProgram.findUnique({ where: { tenantId } });
        if (program?.isActive) {
          const earnedPoints = Math.floor(finalTotal * program.pointsPerPeso);
          const netPoints = earnedPoints - (loyaltyPointsRedeem || 0);

          await tx.customer.update({
            where: { id: order.customerId },
            data: {
              points: { increment: netPoints },
              totalSpend: { increment: finalTotal },
            },
          });

          await tx.loyaltyTransaction.create({
            data: { customerId: order.customerId, orderId, points: netPoints, type: netPoints >= 0 ? 'EARN' : 'REDEEM' },
          });
        }
      }
    });

    const io = req.app.get('io');
    emitToBranch(io, order.branchId, 'order:paid', { orderId, orderNumber: order.orderNumber, total: finalTotal });

    res.json({ success: true, data: { orderId, total: finalTotal, change, paymentMethod } });
  } catch (err) {
    next(err);
  }
};

// ─── Cancel Order ─────────────────────────────────────────────────────────────
const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) throw new AppError('Cannot cancel this order', 400);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
      await tx.orderStatusHistory.create({
        data: { orderId, status: 'CANCELLED', changedBy: userId, note: reason || 'Cancelled by staff' },
      });

      // Reverse inventory deductions
      const movements = await tx.inventoryMovement.findMany({ where: { referenceId: orderId, type: 'OUT' } });
      for (const m of movements) {
        await tx.inventory.update({ where: { id: m.inventoryId }, data: { quantity: { increment: m.quantity } } });
        await tx.inventoryMovement.create({
          data: { inventoryId: m.inventoryId, type: 'IN', quantity: m.quantity, referenceId: orderId, note: 'Order cancelled reversal', createdBy: userId },
        });
      }
    });

    const io = req.app.get('io');
    emitToBranch(io, order.branchId, 'order:cancelled', { orderId, orderNumber: order.orderNumber, reason });

    res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    next(err);
  }
};

// ─── Update Item Status (Kitchen) ─────────────────────────────────────────────
const updateItemStatus = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { status } = req.body;
    const { tenantId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    const item = await prisma.orderItem.update({
      where: { id: itemId },
      data: { status },
    });

    // Check if all items are DONE -> auto update order to READY
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const allDone = allItems.every((i) => i.status === 'DONE' || i.status === 'CANCELLED');

    if (allDone) {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } });
      const io = req.app.get('io');
      emitToBranch(io, order.branchId, 'order:status', { orderId, status: 'READY', orderNumber: order.orderNumber });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, qrOrder, listOrders, getOrder, updateStatus, processPayment, cancelOrder, updateItemStatus };
