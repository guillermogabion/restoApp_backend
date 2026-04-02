// src/utils/socket.js
const jwt = require('jsonwebtoken');
const logger = require('./logger');

function setupSocketIO(io) {
  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, branchId, role } = socket.user;
    logger.info(`Socket connected: ${socket.id} [${role}]`);

    // Join tenant + branch room
    socket.join(`tenant:${tenantId}`);
    socket.join(`branch:${branchId}`);

    // Kitchen staff joins kitchen room
    if (role === 'KITCHEN') socket.join(`kitchen:${branchId}`);

    // Management roles join inventory monitoring room
    if (['OWNER', 'MANAGER', 'CASHIER'].includes(role)) {
      socket.join(`inventory:${branchId}`);
    }

    // Delivery rider joins their room
    if (role === 'DELIVERY_RIDER') {
      socket.join(`rider:${socket.user.userId}`);
      socket.on('rider:location', (data) => {
        io.to(`branch:${branchId}`).emit('rider:location:update', {
          riderId: socket.user.userId,
          ...data,
        });
      });
    }

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });
}

// Emit helpers used by controllers
const emitToKitchen = (io, branchId, event, data) => {
  io.to(`kitchen:${branchId}`).emit(event, data);
};

const emitToBranch = (io, branchId, event, data) => {
  io.to(`branch:${branchId}`).emit(event, data);
};

const emitToInventory = (io, branchId, event, data) => {
  io.to(`inventory:${branchId}`).emit(event, data);
};

const emitToTenant = (io, tenantId, event, data) => {
  io.to(`tenant:${tenantId}`).emit(event, data);
};

module.exports = { setupSocketIO, emitToKitchen, emitToBranch, emitToInventory, emitToTenant };
