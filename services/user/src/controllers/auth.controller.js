const { z } = require('zod');
const authService = require('../services/auth.service');
const demoService = require('../services/demo.service');
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

// POST /auth/demo: hands out a throwaway account pre-loaded with sample data.
// Responds 404 (not 403) when demo mode is off so the route is indistinguishable
// from one that doesn't exist on a real deployment.
async function demo(req, res) {
  if (!demoService.isDemoEnabled()) {
    return sendError(res, 404, 'Route not found');
  }
  try {
    const { user, token } = await demoService.createDemoSession();
    return sendSuccess(res, 201, { user, token });
  } catch (err) {
    console.error('Demo session error:', err.message);
    return sendError(res, 500, 'Could not start demo session');
  }
}

module.exports = { register, login, demo };
