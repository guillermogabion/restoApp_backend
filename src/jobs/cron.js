// src/jobs/cron.js
const cron = require('node-cron');
const { prisma } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Every day at 23:55 - generate / finalize daily sales reports for all branches
 */
cron.schedule('55 23 * * *', async () => {
  logger.info('[CRON] Generating daily sales reports...');
  try {
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    for (const { id: branchId } of branches) {
      const orders = await prisma.order.findMany({
        where: { branchId, paymentStatus: 'PAID', createdAt: { gte: today, lte: todayEnd } },
      });

      if (!orders.length) continue;

      const totalRevenue = orders.reduce((s, o) => s + parseFloat(o.total), 0);
      const totalDiscount = orders.reduce((s, o) => s + parseFloat(o.discount), 0);
      const cashSales = orders.filter((o) => o.paymentMethod === 'CASH').reduce((s, o) => s + parseFloat(o.total), 0);
      const cardSales = orders.filter((o) => o.paymentMethod === 'CARD').reduce((s, o) => s + parseFloat(o.total), 0);

      await prisma.salesReport.upsert({
        where: { branchId_date: { branchId, date: today } },
        create: { branchId, date: today, totalOrders: orders.length, totalRevenue, totalDiscount, cashSales, cardSales },
        update: { totalOrders: orders.length, totalRevenue, totalDiscount, cashSales, cardSales, generatedAt: new Date() },
      });

      logger.info(`[CRON] Sales report saved for branch ${branchId}: ₱${totalRevenue.toFixed(2)}`);
    }
  } catch (err) {
    logger.error('[CRON] Sales report error', err);
  }
});

/**
 * Every hour - check for expired refresh tokens and clean up
 */
cron.schedule('0 * * * *', async () => {
  try {
    const deleted = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (deleted.count > 0) logger.info(`[CRON] Cleaned up ${deleted.count} expired refresh tokens`);
  } catch (err) {
    logger.error('[CRON] Token cleanup error', err);
  }
});

/**
 * Every 6 hours - clean up old processed sync queue entries (older than 7 days)
 */
cron.schedule('0 */6 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.syncQueue.deleteMany({
      where: { status: { in: ['APPLIED', 'REJECTED'] }, processedAt: { lt: cutoff } },
    });
    if (deleted.count > 0) logger.info(`[CRON] Cleaned ${deleted.count} old sync queue entries`);
  } catch (err) {
    logger.error('[CRON] Sync cleanup error', err);
  }
});

logger.info('⏰ Cron jobs initialized');
module.exports = {};
