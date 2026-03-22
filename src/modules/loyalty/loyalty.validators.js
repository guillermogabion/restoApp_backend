// src/modules/loyalty/loyalty.validators.js
const Joi = require('joi');

module.exports = {
  upsertProgram: {
    body: Joi.object({
      pointsPerPeso:   Joi.number().min(0.1).required(),
      redemptionRate:  Joi.number().min(1).required(),
      minRedeemPoints: Joi.number().integer().min(1).required(),
      isActive:        Joi.boolean().default(true),
    }),
  },
  redeem: {
    body: Joi.object({
      customerId:     Joi.string().uuid().required(),
      pointsToRedeem: Joi.number().integer().min(1).required(),
    }),
  },
};
