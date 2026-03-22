// src/modules/loyalty/loyalty.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');

const getProgram = async (req, res, next) => {
  try {
    const program = await prisma.loyaltyProgram.findUnique({ where: { tenantId: req.user.tenantId } });
    res.json({ success: true, data: program });
  } catch (err) { next(err); }
};

const upsertProgram = async (req, res, next) => {
  try {
    const { pointsPerPeso, redemptionRate, minRedeemPoints, isActive } = req.body;
    const program = await prisma.loyaltyProgram.upsert({
      where: { tenantId: req.user.tenantId },
      update: { pointsPerPeso, redemptionRate, minRedeemPoints, isActive },
      create: { tenantId: req.user.tenantId, pointsPerPeso, redemptionRate, minRedeemPoints, isActive },
    });
    res.json({ success: true, data: program });
  } catch (err) { next(err); }
};

const getCustomerByPhone = async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: req.user.tenantId, phone: req.params.phone } },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    res.json({ success: true, data: customer });
  } catch (err) { next(err); }
};

const listCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const where = { tenantId: req.user.tenantId };
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { points: 'desc' }, skip: (page - 1) * limit, take: parseInt(limit) }),
      prisma.customer.count({ where }),
    ]);

    res.json({ success: true, data: customers, meta: { total, page: parseInt(page) } });
  } catch (err) { next(err); }
};

const customerHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const customer = await prisma.customer.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (!customer) throw new AppError('Customer not found', 404);

    const [transactions, recentOrders] = await Promise.all([
      prisma.loyaltyTransaction.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.order.findMany({ where: { customerId: id }, select: { orderNumber: true, total: true, createdAt: true, paymentMethod: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    res.json({ success: true, data: { customer, transactions, recentOrders } });
  } catch (err) { next(err); }
};

// Preview what discount a points redemption would give before payment
const previewRedeem = async (req, res, next) => {
  try {
    const { customerId, pointsToRedeem } = req.body;
    const { tenantId } = req.user;

    const [customer, program] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, tenantId } }),
      prisma.loyaltyProgram.findUnique({ where: { tenantId } }),
    ]);

    if (!customer) throw new AppError('Customer not found', 404);
    if (!program?.isActive) throw new AppError('Loyalty program not active', 400);
    if (pointsToRedeem > customer.points) throw new AppError('Insufficient points', 400);
    if (pointsToRedeem < program.minRedeemPoints) throw new AppError(`Minimum redemption is ${program.minRedeemPoints} points`, 400);

    const discountValue = parseFloat((pointsToRedeem / program.redemptionRate).toFixed(2));
    res.json({ success: true, data: { pointsToRedeem, discountValue, remainingPoints: customer.points - pointsToRedeem } });
  } catch (err) { next(err); }
};

module.exports = { getProgram, upsertProgram, getCustomerByPhone, listCustomers, customerHistory, previewRedeem };
