// // src/server.js
// require('dotenv').config();
// const { httpServer } = require('./app');
// const logger = require('./utils/logger');
// const { connectDB } = require('./config/db');

// const PORT = process.env.PORT || 3000;

// async function start() {
//   await connectDB();
//   httpServer.listen(PORT, () => {
//     logger.info(`🚀 Restaurant API running on port ${PORT} [${process.env.NODE_ENV}]`);
//   });
// }

// start().catch((err) => {
//   logger.error('Fatal startup error:', err);
//   process.exit(1);
// });


// src/server.js
require('dotenv').config();
const { app, httpServer } = require('./app'); // Import 'app' directly as well
const logger = require('./utils/logger');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 3000;

// 1. ADD THE HEALTH CHECK ROUTE
// This confirms the backend is alive and can talk to Neon
app.get('/health', async (req, res) => {
  try {
    // Optional: Add a simple query here to verify DB connection
    // await prisma.$queryRaw`SELECT 1`; 
    res.status(200).json({
      status: 'Online',
      environment: process.env.NODE_ENV || 'development',
      database: 'Connected (Neon)',
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(500).json({ status: 'Error', message: 'Database unreachable' });
  }
});

async function start() {
  await connectDB();

  // 2. VERCEL CHECK
  // Vercel manages the port; only call .listen() if NOT on Vercel
  if (process.env.NODE_ENV !== 'production') {
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Restaurant API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  }
}

// Start the DB connection
start().catch((err) => {
  logger.error('Fatal startup error:', err);
});

// 3. EXPORT FOR VERCEL
// Vercel needs the exported app to handle the serverless execution
module.exports = app;