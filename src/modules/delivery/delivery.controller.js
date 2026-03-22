// src/modules/delivery/delivery.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');
const { emitToBranch } = require('../../utils/socket');

const assignRider = async (req, res, next) => {
  try {
    const { orderId, riderId, zoneId, address, lat, lng, deliveryFee } = req.body;
    const { tenantId } = req.user;

    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new AppError('Order not found', 404);

    const rider = await prisma.user.findFirst({ where: { id: riderId, tenantId, role: 'DELIVERY_RIDER', isActive: true } });
    if (!rider) throw new AppError('Rider not found', 404);

    const existing = await prisma.deliveryOrder.findUnique({ where: { orderId } });
    if (existing) throw new AppError('Order already has a delivery', 400);

    const delivery = await prisma.deliveryOrder.create({
      data: { orderId, riderId, zoneId: zoneId || null, address, lat: lat || null, lng: lng || null, deliveryFee: deliveryFee || 0, status: 'ASSIGNED' },
    });

    const io = req.app.get('io');
    // Notify the rider directly
    io.to(`rider:${riderId}`).emit('delivery:assigned', { deliveryId: delivery.id, orderId, address });
    emitToBranch(io, order.branchId, 'delivery:assigned', { deliveryId: delivery.id, orderId, riderId });

    res.status(201).json({ success: true, data: delivery });
  } catch (err) { next(err); }
};

const updateStatus = async (req, res, next) => {
  try {
    const { deliveryId } = req.params;
    const { status } = req.body;
    const { tenantId, userId, role } = req.user;

    const delivery = await prisma.deliveryOrder.findFirst({
      where: { id: deliveryId },
      include: { order: true },
    });
    if (!delivery) throw new AppError('Delivery not found', 404);
    if (delivery.order.tenantId !== tenantId) throw new AppError('Access denied', 403);

    // Rider can only update their own deliveries
    if (role === 'DELIVERY_RIDER' && delivery.riderId !== userId) {
      throw new AppError('Access denied', 403);
    }

    const updateData = { status };
    if (status === 'PICKED_UP')  updateData.pickedUpAt  = new Date();
    if (status === 'DELIVERED')  updateData.deliveredAt = new Date();

    const updated = await prisma.deliveryOrder.update({ where: { id: deliveryId }, data: updateData });

    const io = req.app.get('io');
    emitToBranch(io, delivery.order.branchId, 'delivery:status', { deliveryId, orderId: delivery.orderId, status });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
};

const activeDeliveries = async (req, res, next) => {
  try {
    const deliveries = await prisma.deliveryOrder.findMany({
      where: {
        status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] },
        order: { branchId: req.params.branchId, tenantId: req.user.tenantId },
      },
      include: {
        order: { select: { orderNumber: true, total: true, createdAt: true } },
      },
    });
    res.json({ success: true, data: deliveries });
  } catch (err) { next(err); }
};

const myDeliveries = async (req, res, next) => {
  try {
    const deliveries = await prisma.deliveryOrder.findMany({
      where: { riderId: req.user.userId, status: { in: ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } },
      include: { order: { select: { orderNumber: true, total: true, notes: true } } },
    });
    res.json({ success: true, data: deliveries });
  } catch (err) { next(err); }
};

const updateLocation = async (req, res, next) => {
  try {
    const { lat, lng, deliveryId } = req.body;
    const io = req.app.get('io');
    // Broadcast location to branch room so managers can track on map
    const delivery = await prisma.deliveryOrder.findFirst({
      where: { id: deliveryId, riderId: req.user.userId },
      include: { order: true },
    });
    if (!delivery) throw new AppError('Delivery not found', 404);

    io.to(`branch:${delivery.order.branchId}`).emit('rider:location:update', {
      riderId: req.user.userId,
      deliveryId,
      lat, lng,
      timestamp: new Date(),
    });
    res.json({ success: true });
  } catch (err) { next(err); }
};

const getZones = async (req, res, next) => {
  try {
    const zones = await prisma.deliveryZone.findMany({ where: { branchId: req.params.branchId } });
    res.json({ success: true, data: zones });
  } catch (err) { next(err); }
};

const createZone = async (req, res, next) => {
  try {
    const { branchId, name, fee, estMinutes } = req.body;
    const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: req.user.tenantId } });
    if (!branch) throw new AppError('Branch not found', 404);
    const zone = await prisma.deliveryZone.create({ data: { branchId, name, fee, estMinutes } });
    res.status(201).json({ success: true, data: zone });
  } catch (err) { next(err); }
};

const updateZone = async (req, res, next) => {
  try {
    const zone = await prisma.deliveryZone.update({ where: { id: req.params.zoneId }, data: req.body });
    res.json({ success: true, data: zone });
  } catch (err) { next(err); }
};

const deleteZone = async (req, res, next) => {
  try {
    await prisma.deliveryZone.delete({ where: { id: req.params.zoneId } });
    res.json({ success: true, message: 'Zone deleted' });
  } catch (err) { next(err); }
};

module.exports = { assignRider, updateStatus, activeDeliveries, myDeliveries, updateLocation, getZones, createZone, updateZone, deleteZone };
