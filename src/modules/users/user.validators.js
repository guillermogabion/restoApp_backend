// src/modules/users/user.validators.js
const Joi = require('joi');

module.exports = {
  create: {
    body: Joi.object({
      name:     Joi.string().max(100).required(),
      email:    Joi.string().email().required(),
      password: Joi.string().min(8).required(),
      phone:    Joi.string().max(20).optional(),
      role:     Joi.string().valid('OWNER','MANAGER','CASHIER','KITCHEN','WAITER','DELIVERY_RIDER').required(),
      branchId: Joi.string().uuid().optional(),
      pin:      Joi.string().length(4).pattern(/^\d+$/).optional(),
    }),
  },
  update: {
    body: Joi.object({
      name:     Joi.string().max(100).optional(),
      email:    Joi.string().email().optional(),
      phone:    Joi.string().max(20).optional(),
      role:     Joi.string().valid('OWNER','MANAGER','CASHIER','KITCHEN','WAITER','DELIVERY_RIDER').optional(),
      branchId: Joi.string().uuid().optional().allow(null),
      isActive: Joi.boolean().optional(),
    }),
  },
  resetPin: {
    body: Joi.object({
      pin: Joi.string().length(4).pattern(/^\d+$/).required(),
    }),
  },
};
