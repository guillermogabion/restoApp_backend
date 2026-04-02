// src/modules/health/health.routes.js
const router = require('express').Router();
const ctrl = require('./health.controller');

// Health check endpoint (no auth required)
router.get('/health', ctrl.healthCheck);

// Detailed metrics (requires auth)
router.get('/metrics',
  require('../../middleware/auth').authenticate,
  require('../../middleware/auth').authorize('OWNER', 'MANAGER'),
  ctrl.metrics
);

module.exports = router;