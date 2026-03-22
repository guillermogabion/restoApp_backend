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
const { app, httpServer } = require('./app');
const logger = require('./utils/logger');
const { connectDB } = require('./config/db');

// --- THE STATUS ROUTE ---
// Visit /status to see if your backend is alive
app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'Ready',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

async function start() {
  try {
    await connectDB();

    // Only call .listen() if NOT on Vercel. 
    // Vercel handles the port and listening for you.
    if (process.env.NODE_ENV !== 'production') {
      const PORT = process.env.PORT || 3000;
      httpServer.listen(PORT, () => {
        logger.info(`🚀 Server running locally on port ${PORT}`);
      });
    }
  } catch (err) {
    logger.error('Startup error:', err);
  }
}

start();

// CRITICAL: You must export 'app' for Vercel to work
module.exports = app;