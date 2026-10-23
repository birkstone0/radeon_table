// Centralized error handling. Known HttpErrors become their status code with a
// safe message; unknown errors are logged without leaking internals.
const logger = require('../lib/logger');

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const status = error.status || 500;

    // Log detailed error information for debugging (without sensitive data)
    logger.error('API', `${req.method} ${req.originalUrl} - ${status} - ${error.message}`);
    logger.error('API', `Error name: ${error.name}`);

    // Log stack trace only in debug mode
    if (process.env.LOG_LEVEL === 'debug') {
        logger.error('API', `Stack: ${error.stack}`);
    }

    // For validation errors (400), include the message
    // For server errors (500), return a generic message to avoid leaking internals
    const body = {
        error: {
            message: status >= 500 ? 'Internal server error' : error.message,
            status
        }
    };

    // Include details for non-500 errors (e.g., validation failures)
    if (error.details && status < 500) {
        body.error.details = error.details;
    }

    // For 500 errors, include a safe error code for debugging
    if (status >= 500) {
        body.error.code = error.name || 'InternalServerError';
    }

    return res.status(status).json(body);
}

function notFoundHandler(req, res) {
    return res.status(404).json({
        error: { message: 'Not found', status: 404 }
    });
}

module.exports = { errorHandler, notFoundHandler };
