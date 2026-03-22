// src/modules/kitchen/kitchen.controller.js
const Pusher = require('pusher');
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');

// ─── Pusher instance ──────────────────────────────────────────────────────────
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// Helper — replaces emitToBranch / emitToKitchen
const emit = (channel, event, data) => {
  return pusher.trigger(channel, event, data).catch((e) =>
    console.warn(`Pusher emit failed [${channel}/${event}]:`, e.message)
  );
};

// ─── Live orders for KDS ──────────────────────────────────────────────────────
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

    const annotated = orders.map((o) => ({
      ...o,
      elapsedSeconds: Math.floor(
        (Date.now() - new Date(o.createdAt).getTime()) / 1000
      ),
    }));

    res.json({ success: true, data: annotated });
  } catch (err) {
    next(err);
  }
};

// ─── Bump single item ─────────────────────────────────────────────────────────
const bumpItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    await prisma.orderItem.update({ where: { id: itemId }, data: { status: 'DONE' } });

    // Auto-ready if all items done
    const remaining = await prisma.orderItem.count({
      where: { orderId, status: { notIn: ['DONE', 'CANCELLED'] } },
    });

    if (remaining === 0) {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } });
      await prisma.orderStatusHistory.create({
        data: {
          orderId, status: 'READY',
          changedBy: userId,
          note: 'All items done — auto bumped',
        },
      });
      // Notify branch channel
      await emit(`branch-${order.branchId}`, 'order:status', {
        orderId,
        status: 'READY',
        orderNumber: order.orderNumber,
      });
    }

    res.json({ success: true, message: 'Item bumped' });
  } catch (err) {
    next(err);
  }
};

// ─── Bump entire order ────────────────────────────────────────────────────────
const bumpOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { tenantId, userId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    await prisma.$transaction([
      prisma.orderItem.updateMany({
        where: { orderId, status: 'PREPARING' },
        data: { status: 'DONE' },
      }),
      prisma.order.update({ where: { id: orderId }, data: { status: 'READY' } }),
      prisma.orderStatusHistory.create({
        data: {
          orderId, status: 'READY',
          changedBy: userId,
          note: 'Bumped from KDS',
        },
      }),
    ]);

    // Notify branch + kitchen channels
    await Promise.all([
      emit(`branch-${order.branchId}`, 'order:status', {
        orderId,
        status: 'READY',
        orderNumber: order.orderNumber,
      }),
      emit(`kitchen-${order.branchId}`, 'order:bumped', { orderId }),
    ]);

    res.json({ success: true, message: 'Order bumped to READY' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getKitchenDisplay, bumpItem, bumpOrder };