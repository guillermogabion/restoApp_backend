// src/server.js
require('dotenv').config();
const { httpServer } = require('./app');
const logger = require('./utils/logger');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    logger.info(`🚀 Restaurant API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
}

start().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
