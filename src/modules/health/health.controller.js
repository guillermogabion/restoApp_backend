// src/modules/health/health.controller.js
const { prisma } = require('../../config/db');
const { InventoryCache } = require('../../utils/cache');
const { getAuthCacheStats } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const healthCheck = async (req, res) => {
  const startTime = Date.now();
  const checks = {
    database: false,
    cache: false,
    websocket: false
  };

  try {
    // Database health check
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
    logger.debug('Database health check passed');

    // Cache health check
    const cacheStats = InventoryCache.getStats();
    checks.cache = cacheStats ? true : false;
    logger.debug('Cache health check passed');

    // WebSocket health check (if io is available)
    const io = req.app.get('io');
    checks.websocket = io ? true : false;

    const responseTime = Date.now() - startTime;
    const status = Object.values(checks).every(Boolean) ? 'healthy' : 'degraded';

    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks,
      cache: {
        stats: cacheStats,
        enabled: true
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      }
    };

    const statusCode = status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthData);

  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      checks
    });
  }
};

const metrics = async (req, res) => {
  try {
    const inventoryCacheStats = InventoryCache.getStats();
    const authCacheStats = getAuthCacheStats();

    // Get recent database performance metrics
    const [orderCount, inventoryCount, userCount] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      }),
      prisma.inventory.count(),
      prisma.user.count({ where: { isActive: true } })
    ]);

    res.json({
      success: true,
      data: {
        cache: {
          inventory: inventoryCacheStats,
          auth: authCacheStats
        },
        database: {
          ordersLast24h: orderCount,
          totalInventoryItems: inventoryCount,
          activeUsers: userCount
        },
        system: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Metrics collection failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to collect metrics'
    });
  }
};

module.exports = { healthCheck, metrics };