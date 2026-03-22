// src/modules/inventory/inventory.validators.js
const Joi = require('joi');

module.exports = {
  create: {
    body: Joi.object({
      branchId:    Joi.string().uuid().required(),
      name:        Joi.string().max(100).required(),
      unit:        Joi.string().max(20).required(),
      quantity:    Joi.number().min(0).default(0),
      lowStockAt:  Joi.number().min(0).default(0),
      costPerUnit: Joi.number().min(0).default(0),
    }),
  },
  update: {
    body: Joi.object({
      name:        Joi.string().max(100).optional(),
      unit:        Joi.string().max(20).optional(),
      lowStockAt:  Joi.number().min(0).optional(),
      costPerUnit: Joi.number().min(0).optional(),
    }),
  },
  movement: {
    body: Joi.object({
      type:     Joi.string().valid('IN', 'OUT', 'ADJUSTMENT', 'WASTE').required(),
      quantity: Joi.number().positive().required(),
      note:     Joi.string().max(200).optional(),
    }),
  },
};
