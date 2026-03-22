// src/config/db.js
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});

async function connectDB() {
  await prisma.$connect();
  logger.info('✅ Database connected');
}

module.exports = { prisma, connectDB };
