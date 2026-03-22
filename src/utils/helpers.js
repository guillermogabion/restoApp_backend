// src/utils/helpers.js
const { prisma } = require('../config/db');

/**
 * Generate a sequential, human-readable order number per branch.
 * e.g. #0001, #0002 ... resets daily at midnight.
 */
async function generateOrderNumber(branchId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await prisma.order.count({
    where: {
      branchId,
      createdAt: { gte: today },
    },
  });

  const num = (count + 1).toString().padStart(4, '0');
  return `#${num}`;
}

/**
 * Paginate helper
 */
function paginate(page = 1, limit = 20) {
  const take = Math.min(parseInt(limit), 100);
  const skip = (Math.max(parseInt(page), 1) - 1) * take;
  return { take, skip };
}

/**
 * Strip sensitive fields from a user object
 */
function sanitizeUser(user) {
  const { passwordHash, pin, ...safe } = user;
  return safe;
}

module.exports = { generateOrderNumber, paginate, sanitizeUser };
