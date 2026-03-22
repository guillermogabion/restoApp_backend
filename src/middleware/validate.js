// src/middleware/validate.js
const { AppError } = require('./errorHandler');

/**
 * Joi schema validation middleware factory.
 * @param {object} schema - Joi schema with optional body/params/query keys
 */
const validate = (schema) => (req, res, next) => {
  const errors = [];

  if (schema.body) {
    const { error } = schema.body.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) errors.push(...error.details.map((d) => d.message));
  }
  if (schema.params) {
    const { error } = schema.params.validate(req.params, { abortEarly: false });
    if (error) errors.push(...error.details.map((d) => d.message));
  }
  if (schema.query) {
    const { error } = schema.query.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) errors.push(...error.details.map((d) => d.message));
  }

  if (errors.length) {
    return next(new AppError(errors.join('; '), 422));
  }

  next();
};

module.exports = { validate };
