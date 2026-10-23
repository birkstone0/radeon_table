// Domain errors with HTTP status codes. Thrown from services and translated to
// JSON responses by the centralized error handler in middleware/errors.js.
class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        if (details) this.details = details;
    }
}

function badRequest(message, details) { return new HttpError(400, message, details); }
function unauthorized(message = 'Not authenticated') { return new HttpError(401, message); }
function forbidden(message = 'Forbidden') { return new HttpError(403, message); }
function notFound(message = 'Not found') { return new HttpError(404, message); }
function conflict(message, details) { return new HttpError(409, message, details); }
function tooManyRequests(message) { return new HttpError(429, message); }

module.exports = {
    HttpError,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    tooManyRequests
};
