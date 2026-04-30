// src/utils/helpers.js
const { prisma } = require('../config/db');

/**
 * Generate a sequential, human-readable order number per branch.
 * e.g. #0001, #0002 ... resets daily at midnight.
 */
async function generateOrderNumber(branchId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Count today's orders + 1 instead of parsing the last order number
  // This is more reliable under concurrent requests
  const count = await prisma.order.count({
    where: {
      branchId,
      createdAt: { gte: today },
    },
  });

  const num = (count + 1).toString().padStart(4, '0');
  return `#${num}`;
}

async function generateUniqueOrderNumber(branchId, maxRetries = 20) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.order.count({
      where: { branchId, createdAt: { gte: today } },
    });

    // Offset by attempt to avoid repeated collisions
    const num = (count + attempt).toString().padStart(4, '0');
    const orderNumber = `#${num}`;


    // return console.log(orderNumber, 'ordernumber');

    const exists = await prisma.order.findFirst({ where: { branchId, orderNumber } });
    if (!exists) return orderNumber;
  }
  throw new Error(branchId, 'Unable to generate a unique order number after multiple attempts');
}

async function generateUniqueOrderNumber(branchId, maxRetries = 10) {
  let orderNumber = await generateOrderNumber(branchId);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const exists = await prisma.order.findFirst({ where: { branchId, orderNumber } });
    if (!exists) return orderNumber;

    // If candidate already exists (race / out-of-order data), increment and retry.
    const numeric = parseInt(orderNumber.replace(/\D/g, ''), 10);
    const next = Number.isNaN(numeric) ? attempt + 1 : numeric + 1;
    orderNumber = `#${next.toString().padStart(4, '0')}`;
  }
  throw new Error('Unable to generate a unique order number after multiple attempts');
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

module.exports = { generateOrderNumber, generateUniqueOrderNumber, paginate, sanitizeUser };
