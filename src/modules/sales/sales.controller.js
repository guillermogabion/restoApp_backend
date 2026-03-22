// src/modules/sales/sales.controller.js
const { prisma } = require('../../config/db');
const { AppError } = require('../../middleware/errorHandler');

// ─── Daily Sales ──────────────────────────────────────────────────────────────
const dailySales = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const [orders, itemsSold] = await Promise.all([
      prisma.order.findMany({
        where: {
          branchId,
          tenantId: req.user.tenantId,
          paymentStatus: 'PAID',
          createdAt: { gte: start, lte: end },
        },
        include: { items: true },
      }),
      prisma.orderItem.findMany({
        where: {
          order: {
            branchId,
            tenantId: req.user.tenantId,
            paymentStatus: 'PAID',
            createdAt: { gte: start, lte: end },
          },
        },
      }),
    ]);

    const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total), 0);
    const totalDiscount = orders.reduce((s, o) => s + parseFloat(o.discount), 0);
    const cashSales = orders.filter((o) => o.paymentMethod === 'CASH').reduce((s, o) => s + parseFloat(o.total), 0);
    const cardSales = orders.filter((o) => o.paymentMethod === 'CARD').reduce((s, o) => s + parseFloat(o.total), 0);
    const gcashSales = orders.filter((o) => o.paymentMethod === 'GCASH').reduce((s, o) => s + parseFloat(o.total), 0);
    const mayaSales = orders.filter((o) => o.paymentMethod === 'MAYA').reduce((s, o) => s + parseFloat(o.total), 0);

    await prisma.salesReport.upsert({
      where: { branchId_date: { branchId, date: new Date(date) } },
      create: { branchId, date: new Date(date), totalOrders: orders.length, totalRevenue, totalDiscount, cashSales, cardSales },
      update: { totalOrders: orders.length, totalRevenue, totalDiscount, cashSales, cardSales, generatedAt: new Date() },
    });

    res.json({
      success: true,
      data: {
        date,
        totalOrders: orders.length,
        totalRevenue: totalRevenue.toFixed(2),
        totalDiscount: totalDiscount.toFixed(2),
        breakdown: {
          cash: cashSales.toFixed(2),
          card: cardSales.toFixed(2),
          gcash: gcashSales.toFixed(2),
          maya: mayaSales.toFixed(2),
        },
        averageOrderValue: orders.length ? (totalRevenue / orders.length).toFixed(2) : '0.00',
        totalItemsSold: itemsSold.reduce((s, i) => s + i.quantity, 0),
      },
    });
  } catch (err) { next(err); }
};

// ─── Sales Range ──────────────────────────────────────────────────────────────
const salesRange = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { from, to } = req.query;
    if (!from || !to) throw new AppError('from and to dates are required', 400);

    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end = new Date(to); end.setHours(23, 59, 59, 999);

    const reports = await prisma.salesReport.findMany({
      where: { branchId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });

    const totals = reports.reduce((acc, r) => ({
      revenue: acc.revenue + parseFloat(r.totalRevenue),
      orders: acc.orders + r.totalOrders,
      discount: acc.discount + parseFloat(r.totalDiscount),
    }), { revenue: 0, orders: 0, discount: 0 });

    res.json({ success: true, data: { reports, totals } });
  } catch (err) { next(err); }
};

// ─── Owner Dashboard ──────────────────────────────────────────────────────────
const ownerDashboard = async (req, res, next) => {
  try {
    const { tenantId } = req.user;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    const branches = await prisma.branch.findMany({ where: { tenantId, isActive: true } });

    const branchStats = await Promise.all(
      branches.map(async (branch) => {
        const [todayOrders, activeOrders, inventoryItems] = await Promise.all([
          prisma.order.aggregate({
            where: { branchId: branch.id, paymentStatus: 'PAID', createdAt: { gte: today, lte: todayEnd } },
            _sum: { total: true },
            _count: true,
          }),
          prisma.order.count({
            where: { branchId: branch.id, status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } },
          }),
          // ── Low stock: fetch all inventory, filter in JS ──
          // Prisma doesn't support field-to-field comparison in where clauses
          prisma.inventory.findMany({
            where: { branchId: branch.id },
            select: { quantity: true, lowStockAt: true },
          }),
        ]);

        const lowStockCount = inventoryItems.filter(
          (i) => parseFloat(i.quantity) <= parseFloat(i.lowStockAt)
        ).length;

        return {
          branchId: branch.id,
          branchName: branch.name,
          todayRevenue: todayOrders._sum.total || 0,
          todayOrders: todayOrders._count,
          activeOrders,
          lowStockAlerts: lowStockCount,
        };
      })
    );

    const totalRevenue = branchStats.reduce((s, b) => s + parseFloat(b.todayRevenue), 0);
    const totalOrders = branchStats.reduce((s, b) => s + b.todayOrders, 0);

    res.json({
      success: true,
      data: {
        today: new Date().toISOString().split('T')[0],
        summary: { totalRevenue: totalRevenue.toFixed(2), totalOrders, totalBranches: branches.length },
        branches: branchStats,
      },
    });
  } catch (err) { next(err); }
};

// ─── Top Items ────────────────────────────────────────────────────────────────
const topItems = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { from, to, limit = 10 } = req.query;

    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();

    const grouped = await prisma.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: {
        status: { not: 'CANCELLED' },
        order: {
          branchId,
          paymentStatus: 'PAID',
          createdAt: { gte: start, lte: end },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: parseInt(limit),
    });

    const items = grouped.map((g) => ({
      menuItemId: g.menuItemId,
      name: g.name,
      totalQuantity: g._sum.quantity || 0,
      totalRevenue: g._sum.subtotal || 0,
    }));

    res.json({ success: true, data: items });
  } catch (err) { next(err); }
};

// ─── Hourly Sales ─────────────────────────────────────────────────────────────
// Pure Prisma — fetch paid orders, group by hour in JavaScript
const hourlySales = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        branchId,
        paymentStatus: 'PAID',
        createdAt: { gte: start, lte: end },
      },
      select: { createdAt: true, total: true },
    });

    // Group by hour in JS — works on any database
    const hourMap = {};
    for (const order of orders) {
      const hour = new Date(order.createdAt).getHours();
      if (!hourMap[hour]) hourMap[hour] = { hour, orders: 0, revenue: 0 };
      hourMap[hour].orders += 1;
      hourMap[hour].revenue += parseFloat(order.total);
    }

    // Fill all 24 hours (even empty ones)
    const hourly = Array.from({ length: 24 }, (_, h) => hourMap[h] || { hour: h, orders: 0, revenue: 0 });

    res.json({ success: true, data: hourly });
  } catch (err) { next(err); }
};

module.exports = { dailySales, salesRange, ownerDashboard, topItems, hourlySales };