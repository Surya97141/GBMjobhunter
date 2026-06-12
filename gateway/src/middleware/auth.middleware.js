const jwt = require('jsonwebtoken');

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ status: 'error', message });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-email'] = payload.email;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(res, 401, 'Token expired');
    }
    return sendError(res, 401, 'Invalid token');
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();

  if (!authHeader.startsWith('Bearer ')) return next();

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-email'] = payload.email;
  } catch {
    // invalid token on an optional route — ignore it, proceed as anonymous
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
