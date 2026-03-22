// src/middleware/errorHandler.js
const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path });

  if (err.isOperational) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'Duplicate entry — resource already exists.' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, error: 'Record not found.' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Token expired.' });
  }

  return res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found.` });
};

module.exports = { AppError, errorHandler, notFoundHandler };
