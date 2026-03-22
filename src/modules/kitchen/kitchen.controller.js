// src/modules/kitchen/kitchen.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { emitToBranch, emitToKitchen } = require('../../utils/socket');

// Live orders for KDS - only active ones
const getKitchenDisplay = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { tenantId } = req.user;

    const orders = await prisma.order.findMany({
      where: {
        branchId,
        tenantId,
        status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] },
      },
      include: {
        items: {
          where: { status: { notIn: ['DONE', 'CANCELLED'] } },
          include: { menuItem: { select: { name: true, imageUrl: true } } },
        },
        table: { select: { tableNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Annotate each order with elapsed time in seconds for the KDS timer
    const annotated = orders.map((o) => ({
      ...o,
      elapsedSeconds: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 1000),
    }));

    res.json({ success: true, data: annotated });
  } catch (err) {
    next(err);
  }
};

const bumpItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    await prisma.orderItem.update({ where: { id: itemId }, data: { status: 'DONE' } });

    // Check if all items are done -> auto-ready
    const remaining = await prisma.orderItem.count({
      where: { orderId, status: { notIn: ['DONE', 'CANCELLED'] } },
    });

    if (remaining === 0) {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } });
      await prisma.orderStatusHistory.create({
        data: { orderId, status: 'READY', changedBy: userId, note: 'All items done — auto bumped' },
      });
      const io = req.app.get('io');
      emitToBranch(io, order.branchId, 'order:status', { orderId, status: 'READY', orderNumber: order.orderNumber });
    }

    res.json({ success: true, message: 'Item bumped' });
  } catch (err) {
    next(err);
  }
};

const bumpOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    await prisma.$transaction([
      prisma.orderItem.updateMany({ where: { orderId, status: 'PREPARING' }, data: { status: 'DONE' } }),
      prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } }),
      prisma.orderStatusHistory.create({
        data: { orderId, status: 'READY', changedBy: userId, note: 'Bumped from KDS' },
      }),
    ]);

    const io = req.app.get('io');
    emitToBranch(io, order.branchId, 'order:status', { orderId, status: 'READY', orderNumber: order.orderNumber });
    emitToKitchen(io, order.branchId, 'order:bumped', { orderId });

    res.json({ success: true, message: 'Order bumped to READY' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getKitchenDisplay, bumpItem, bumpOrder };
