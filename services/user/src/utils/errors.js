function sendError(res, statusCode, message, errors = null) {
  const body = { status: 'error', message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

function sendSuccess(res, statusCode, data) {
  return res.status(statusCode).json({ status: 'success', data });
}

module.exports = { sendError, sendSuccess };
