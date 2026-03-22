// src/modules/sync/sync.validators.js
const Joi = require('joi');

const operation = Joi.object({
  clientId: Joi.string().required(),
  type: Joi.string().valid('CREATE_ORDER', 'UPDATE_ORDER_STATUS', 'PAY_ORDER', 'INVENTORY_ADJUSTMENT').required(),
  data: Joi.object().required(),
  timestamp: Joi.string().isoDate().required(),
});

module.exports = {
  push: {
    body: Joi.object({
      batchId:    Joi.string().required(),
      deviceId:   Joi.string().required(),
      operations: Joi.array().items(operation).min(1).max(100).required(),
      hmac:       Joi.string().required(), // HMAC-SHA256 of {batchId, deviceId, operations}
    }),
  },
};
