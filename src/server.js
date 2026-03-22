require('dotenv').config();
const { app } = require('./app'); // Import 'app' directly
const logger = require('./utils/logger');
const { connectDB } = require('./config/db');

// 1. Root Route for immediate visual confirmation
app.get('/', (req, res) => {
  res.send("RestoApp API is running...");
});

// 2. Status Route
app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'Ready',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: 'Neon PostgreSQL'
  });
});

// 3. Optimized Startup Logic
const start = async () => {
  try {
    await connectDB();

    // Only listen if we are NOT on Vercel
    // Vercel uses the exported 'app' and ignores .listen()
    if (process.env.VERCEL !== '1') {
      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        logger.info(`🚀 Server running locally on port ${PORT}`);
      });
    }
  } catch (err) {
    logger.error('Startup error:', err);
  }
};

// Execute start logic
start();

// 4. CRITICAL: Export app for Vercel's Serverless Handler
module.exports = app;