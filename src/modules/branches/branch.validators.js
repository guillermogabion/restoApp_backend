// src/modules/branches/branch.validators.js
const Joi = require('joi');

module.exports = {
  create: {
    body: Joi.object({
      name:      Joi.string().max(100).required(),
      address:   Joi.string().max(300).required(),
      phone:     Joi.string().max(20).optional(),
      timezone:  Joi.string().max(50).default('Asia/Manila'),
      openTime:  Joi.string().pattern(/^\d{2}:\d{2}$/).default('08:00'),
      closeTime: Joi.string().pattern(/^\d{2}:\d{2}$/).default('22:00'),
    }),
  },
  update: {
    body: Joi.object({
      name:      Joi.string().max(100).optional(),
      address:   Joi.string().max(300).optional(),
      phone:     Joi.string().max(20).optional(),
      timezone:  Joi.string().max(50).optional(),
      openTime:  Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
      closeTime: Joi.string().pattern(/^\d{2}:\d{2}$/).optional(),
      isActive:  Joi.boolean().optional(),
    }),
  },
};
