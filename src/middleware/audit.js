// src/middleware/audit.js
const { prisma } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Log sensitive actions to the audit log table.
 */
const audit = (action, entity) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = async (data) => {
    if (res.statusCode < 400 && req.user) {
      try {
        await prisma.auditLog.create({
          data: {
            tenantId: req.user.tenantId,
            branchId: req.user.branchId,
            userId: req.user.userId,
            action,
            entity,
            entityId: data?.data?.id || req.params?.id || null,
            newData: data?.data || null,
            ip: req.ip,
          },
        });
      } catch (err) {
        logger.warn('Audit log failed', err.message);
      }
    }
    originalJson(data);
  };
  next();
};

module.exports = { audit };
