const { z } = require('zod');
const authService = require('../services/auth.service');
const { sendError, sendSuccess } = require('../utils/errors');

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function register(req, res) {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const { user, token } = await authService.register(
      result.data.email,
      result.data.password
    );
    return sendSuccess(res, 201, { user, token });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

async function login(req, res) {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return sendError(res, 400, 'Validation failed', result.error.errors);
  }

  try {
    const { user, token } = await authService.login(
      result.data.email,
      result.data.password
    );
    return sendSuccess(res, 200, { user, token });
  } catch (err) {
    return sendError(res, err.statusCode || 500, err.message);
  }
}

module.exports = { register, login };
