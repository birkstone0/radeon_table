// TablePH service adapter.
//
// Wraps the existing account-processing functions in login.js (login, daily
// reward claim, balance retrieval) so Express routes can invoke them with
// records imported through the website. No business logic is duplicated here:
// the adapter only handles token/session bookkeeping, delays, and result
// normalization for storage.
const { randomUUID } = require('crypto');
const tableph = require('../../login');
const logger = require('../lib/logger');

const DELAY_LOGIN_TO_ACTION_MS = 1500;
const DELAY_BETWEEN_ACCOUNTS_MS = 3000;

// Retry policy for transient upstream failures. Permanent credential /
// validation failures are never retried where we can tell them apart. Where we
// cannot (e.g. an ambiguous reward response), we do not retry either, so we
// never double-claim.
const MAX_RETRIES = 2; // 2 retries => up to 3 attempts
const RETRY_BACKOFFS_MS = [1000, 2000]; // 1s then 2s exponential backoff

// HTTP statuses eligible for retry: 429 and 5xx are transient; 4xx other than
// 429 (and 408) are permanent credential/validation failures.
function isRetryableStatus(status) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
}

// Reads a Retry-After header (seconds) and returns the wait in ms, clamped.
function retryAfterMs(headers) {
    if (!headers) return 0;
    const raw = headers['retry-after'];
    if (raw === undefined || raw === null) return 0;
    const value = Number(raw);
    if (Number.isFinite(value)) return Math.min(Math.max(value * 1000, 0), 30000);
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        const diff = parsed.getTime() - Date.now();
        return Math.min(Math.max(diff, 0), 30000);
    }
    return 0;
}

// Wraps a single upstream request with bounded retries and exponential backoff.
// Only transient errors (network, timeout, 429, 5xx) are retried. Respects
// Retry-After when present; otherwise uses the fixed backoff schedule.
async function withRetry(requestFn, { onRetry, isSuccess, isAlreadyClaimed } = {}) {
    let attempt = 1;
    let retryCount = 0;
    for (;;) {
        try {
            const result = await requestFn();
            // Already-claimed results are treated as a terminal success and
            // never retried, so we cannot double-claim.
            if (isAlreadyClaimed && isAlreadyClaimed(result)) {
                return { ...result, attempt, retryCount, status: 'already_claimed' };
            }
            if (isSuccess && isSuccess(result)) {
                return { ...result, attempt, retryCount };
            }
            return { ...result, attempt, retryCount };
        } catch (error) {
            const status = error.response && error.response.status;
            const retryAfter = retryAfterMs(error.response && error.response.headers);
            if (retryCount >= MAX_RETRIES || !isRetryableStatus(status)) {
                throw error;
            }
            retryCount += 1;
            attempt = retryCount + 1;
            if (onRetry) onRetry(attempt);
            const backoff = retryAfter > 0 ? retryAfter : RETRY_BACKOFFS_MS[retryCount - 1];
            await sleep(backoff);
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs a single account through the existing login.js flow.
// `credentials` is provided by the in-memory credential store (server-side only).
async function runAccount({ operation, credentials, delays = {}, attempts = 1, onRetry, updateStep }) {
    const startedAt = Date.now();
    const phoneMasked = credentials.phone ? credentials.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : 'unknown';
    logger.debug('TABLEPH', `Starting ${operation} for ${phoneMasked}`);

    if (updateStep) updateStep('Logging in');

    let loginResult;
    try {
        loginResult = await withRetry(
            () => tableph.loginAccount(credentials.phone, credentials.password),
            {
                onRetry: (a) => { if (onRetry) onRetry(a); if (updateStep) updateStep(`Retrying login (attempt ${a})`); },
                isSuccess: (r) => r.success === true
            }
        );
    } catch (error) {
        logger.error('TABLEPH', `Login failed: ${error.message || 'Unknown error'}`);
        return {
            status: 'failed',
            summary: 'Login failed',
            error: (error && (error.response?.data?.msg || error.message)) || 'Login failed',
            durationMs: Date.now() - startedAt,
            attempt: 1,
            retryCount: 0
        };
    }

    if (!loginResult.success) {
        logger.error('TABLEPH', `Login failed: ${loginResult.error}`);
        return {
            status: 'failed',
            summary: 'Login failed',
            error: loginResult.error || 'Login failed',
            durationMs: Date.now() - startedAt,
            attempt: loginResult.attempt,
            retryCount: loginResult.retryCount
        };
    }

    const token = loginResult.data && loginResult.data.accessToken;
    if (!token) {
        logger.error('TABLEPH', 'No access token returned');
        return {
            status: 'failed',
            summary: 'Login failed',
            error: 'No access token returned',
            durationMs: Date.now() - startedAt,
            attempt: loginResult.attempt,
            retryCount: loginResult.retryCount
        };
    }
    logger.debug('TABLEPH', 'Login successful');

    if (delays.beforeAction !== null) {
        if (updateStep) updateStep('Verifying credentials');
        await sleep(delays.beforeAction === undefined ? DELAY_LOGIN_TO_ACTION_MS : delays.beforeAction);
    }

    if (operation === 'claim_daily_reward') {
        if (updateStep) updateStep('Claiming reward');

        // Claim is wrapped in a small retry loop too, but only transient errors
        // are retried. An ambiguous or already-claimed result is never retried,
        // preventing duplicate claims; we pass through the attempts below.
        let claimResult;
        try {
            claimResult = await withRetry(
                () => tableph.claimDailyReward(token, loginResult.deviceId),
                {
                    onRetry: (a) => { if (onRetry) onRetry(a); if (updateStep) updateStep(`Retrying claim (attempt ${a})`); },
                    isSuccess: (r) => r.success === true,
                    isAlreadyClaimed: (r) => r.success === true && r.msg && r.msg.includes('already claimed')
                }
            );
        } catch (error) {
            const msg = (error && (error.response?.data?.msg || error.message)) || 'Claim failed';
            return {
                status: 'failed',
                summary: 'Daily reward not claimed',
                error: msg,
                durationMs: Date.now() - startedAt,
                attempt: 1,
                retryCount: 0
            };
        }
        logger.debug('TABLEPH', `Claim result: ${claimResult.success} - ${claimResult.msg}`);

        // Handle already_claimed status from withRetry
        if (claimResult.status === 'already_claimed') {
            return {
                status: 'already_claimed',
                summary: claimResult.msg || 'Already claimed today',
                result: claimResult.msg,
                durationMs: Date.now() - startedAt,
                attempt: claimResult.attempt,
                retryCount: claimResult.retryCount
            };
        }

        return {
            status: claimResult.success ? 'success' : 'failed',
            summary: claimResult.success ? claimResult.msg : 'Daily reward not claimed',
            result: claimResult.success ? claimResult.msg : undefined,
            error: claimResult.success ? undefined : claimResult.msg,
            durationMs: Date.now() - startedAt,
            attempt: claimResult.attempt,
            retryCount: claimResult.retryCount
        };
    }

    if (updateStep) updateStep('Checking balance');
    let balanceResult;
    try {
        balanceResult = await withRetry(
            () => tableph.getBalance(token, loginResult.deviceId),
            {
                onRetry: (a) => { if (onRetry) onRetry(a); if (updateStep) updateStep(`Retrying balance check (attempt ${a})`); },
                isSuccess: (r) => r.success === true
            }
        );
    } catch (error) {
        return {
            status: 'failed',
            summary: 'Balance unavailable',
            error: (error && (error.response?.data?.msg || error.message)) || 'Balance unavailable',
            durationMs: Date.now() - startedAt,
            attempt: 1,
            retryCount: 0
        };
    }
    console.log(`[TABLEPH] getBalance returned: success=${balanceResult.success}, total=${balanceResult.total}, error=${balanceResult.error}`);
    return {
        status: balanceResult.success ? 'success' : 'failed',
        summary: balanceResult.success ? `Balance ₱${balanceResult.total}` : 'Balance unavailable',
        result: balanceResult.success ? `₱${balanceResult.total}` : undefined,
        error: balanceResult.success ? undefined : balanceResult.error,
        durationMs: Date.now() - startedAt,
        attempt: balanceResult.attempt,
        retryCount: balanceResult.retryCount
    };
}

module.exports = {
    runAccount,
    delays: {
        loginToAction: DELAY_LOGIN_TO_ACTION_MS,
        betweenAccounts: DELAY_BETWEEN_ACCOUNTS_MS
    },
    sleep,
    newRequestKey: () => randomUUID()
};
