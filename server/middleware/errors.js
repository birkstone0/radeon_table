// Centralized error handling. Known HttpErrors become their status code with a
// safe message; unknown errors are logged without leaking internals.
const logger = require('../lib/logger');

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const status = error.status || 500;
    logger.error('API', `${req.method} ${req.originalUrl} - ${status} - ${error.message}`);

    // Log stack trace only in debug mode
    if (process.env.LOG_LEVEL === 'debug') {
        logger.error('API', `Stack: ${error.stack}`);
    }

    const body = {
        error: {
            message: status >= 500 ? 'Internal server error' : error.message,
            status
        }
    };
    if (error.details) body.error.details = error.details;
    return res.status(status).json(body);
}

function notFoundHandler(req, res) {
    return res.status(404).json({
        error: { message: 'Not found', status: 404 }
    });
}

module.exports = { errorHandler, notFoundHandler };
