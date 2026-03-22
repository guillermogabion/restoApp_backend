// src/modules/delivery/delivery.validators.js
const Joi = require('joi');

module.exports = {
  assign: {
    body: Joi.object({
      orderId:     Joi.string().uuid().required(),
      riderId:     Joi.string().uuid().required(),
      zoneId:      Joi.string().uuid().optional(),
      address:     Joi.string().max(300).required(),
      lat:         Joi.number().optional(),
      lng:         Joi.number().optional(),
      deliveryFee: Joi.number().min(0).default(0),
    }),
  },
  updateStatus: {
    body: Joi.object({
      status: Joi.string().valid('ASSIGNED','PICKED_UP','IN_TRANSIT','DELIVERED','FAILED').required(),
    }),
  },
  location: {
    body: Joi.object({
      deliveryId: Joi.string().uuid().required(),
      lat:        Joi.number().required(),
      lng:        Joi.number().required(),
    }),
  },
  createZone: {
    body: Joi.object({
      branchId:   Joi.string().uuid().required(),
      name:       Joi.string().max(100).required(),
      fee:        Joi.number().min(0).required(),
      estMinutes: Joi.number().integer().min(1).default(30),
    }),
  },
};
