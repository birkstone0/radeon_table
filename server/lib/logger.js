// Simple logger with log levels to reduce terminal noise and avoid logging sensitive data.
//
// LOG_LEVEL environment variable controls verbosity:
// - error: Only errors
// - warn: Warnings and errors (default in production)
// - info: General info, warnings, errors (default in development)
// - debug: All messages including detailed diagnostics
//
// Never logs: cookies, tokens, passwords, session IDs, or auth headers.

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const currentLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info')).toLowerCase();

function shouldLog(level) {
    const currentIndex = LOG_LEVELS.indexOf(level);
    const currentLevelIndex = LOG_LEVELS.indexOf(currentLevel);
    return currentIndex <= currentLevelIndex;
}

function formatMessage(prefix, message) {
    return `[${prefix}] ${message}`;
}

const logger = {
    error: (prefix, message) => {
        if (shouldLog('error')) {
            console.error(formatMessage(prefix, message));
        }
    },
    warn: (prefix, message) => {
        if (shouldLog('warn')) {
            console.warn(formatMessage(prefix, message));
        }
    },
    info: (prefix, message) => {
        if (shouldLog('info')) {
            console.log(formatMessage(prefix, message));
        }
    },
    debug: (prefix, message) => {
        if (shouldLog('debug')) {
            console.log(formatMessage(prefix, message));
        }
    }
};

module.exports = logger;
