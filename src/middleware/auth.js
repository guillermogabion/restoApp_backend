// src/middleware/auth.js
const { verifyAccessToken } = require('../utils/jwt');
const { prisma } = require('../config/db');
const { AppError } = require('./errorHandler');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

// Cache users for 15 minutes (900 seconds) - fast auth without DB hit
const userCache = new NodeCache({ stdTTL: 900, checkperiod: 60 });

/**
 * Verify JWT and attach user to request.
 * Enforces that the user belongs to the tenant in the header/params.
 * Uses caching to avoid repeated database queries for the same user.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      throw new AppError('Authorization token required', 401);

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    // Check cache first
    const cacheKey = `user:${payload.userId}`;
    let user = userCache.get(cacheKey);
    let fromCache = false;

    if (!user) {
      // Not in cache, fetch from database
      user = await prisma.user.findFirst({
        where: { id: payload.userId, isActive: true },
      });

      if (!user) throw new AppError('User not found or deactivated', 401);

      // Cache the user data for 15 minutes
      userCache.set(cacheKey, user);
    } else {
      fromCache = true;
    }

    // Log cache hit/miss for debugging
    if (process.env.DEBUG_AUTH === '1') {
      logger.debug(`Auth: User ${payload.userId} - ${fromCache ? 'CACHE HIT' : 'DB QUERY'}`);
    }

    req.user = {
      userId: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      role: user.role,
      cached: fromCache
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Enforce tenant isolation.
 * Reads tenantId from JWT and rejects if resource doesn't belong to tenant.
 */
const enforceTenant = (req, res, next) => {
  const tenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;
  if (tenantId && tenantId !== req.user.tenantId) {
    return next(new AppError('Access denied: tenant mismatch', 403));
  }
  next();
};

/**
 * Enforce branch isolation for non-owner roles.
 * Owners and managers can access any branch in their tenant.
 */
const enforceBranch = (req, res, next) => {
  const { role, branchId } = req.user;
  const targetBranchId = req.params.branchId || req.body.branchId || req.query.branchId;

  if (!targetBranchId) return next();

  const canAccessAll = ['OWNER', 'MANAGER'].includes(role);
  if (!canAccessAll && targetBranchId !== branchId) {
    return next(new AppError('Access denied: branch mismatch', 403));
  }

  next();
};

/**
 * Role-based access control factory.
 * @param  {...string} roles - allowed roles
 */
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError(`Access denied: requires role(s) ${roles.join(', ')}`, 403));
  }
  next();
};

/**
 * Utility: Invalidate cached user (use after user update/deactivation)
 */
const invalidateUserCache = (userId) => {
  userCache.del(`user:${userId}`);
  logger.debug(`Auth cache invalidated for user ${userId}`);
};

/**
 * Utility: Clear all user cache
 */
const clearUserCache = () => {
  userCache.flushAll();
  logger.info('All user auth cache cleared');
};

/**
 * Utility: Get cache statistics
 */
const getAuthCacheStats = () => {
  return userCache.getStats();
};

module.exports = {
  authenticate,
  enforceTenant,
  enforceBranch,
  authorize,
  invalidateUserCache,
  clearUserCache,
  getAuthCacheStats
};
