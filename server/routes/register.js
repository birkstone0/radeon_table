// Registration routes: enqueue phone numbers, run the register.js workflow one
// account at a time, and submit OTPs. Requires an authenticated session; access
// is validated server-side. No password, OTP, device id, or security header
// ever reaches the client — only masked phones and statuses.
//
// Route ordering: literal paths come before the catch-all `/:queueId` routes.
const express = require('express');
const register = require('../services/register');
const { badRequest } = require('../lib/errors');
const { requireString, optionalString } = require('../lib/validate');

const router = express.Router();

// Enqueue phone numbers (with a shared registration password) into the queue.
router.post('/enqueue', async (req, res, next) => {
    try {
        const phones = Array.isArray(req.body.phones) ? req.body.phones : [];
        const password = optionalString(req.body.password, 'Registration password', { max: 128 });
        if (!password) throw badRequest('A registration password is required');
        const result = await register.enqueue({ ownerId: req.user.id, phones, password });
        return res.json(result);
    } catch (error) {
        next(error);
    }
});

// Start the next queued account: obtain a journey ticket, send the OTP, and
// park it at awaiting_otp. Only advances one account at a time.
router.post('/start', async (req, res, next) => {
    try {
        const row = await register.start(req.user.id);
        return res.json({ row });
    } catch (error) {
        next(error);
    }
});

// List the authenticated user's own registration queue.
router.get('/', async (req, res, next) => {
    try {
        const rows = await register.listForOwner(req.user.id);
        return res.json({ items: rows, total: rows.length });
    } catch (error) {
        next(error);
    }
});

// Pause / resume the queued-but-not-started accounts.
router.post('/pause', async (req, res, next) => {
    try {
        return res.json(await register.pauseAll(req.user.id));
    } catch (error) {
        next(error);
    }
});

router.post('/resume', async (req, res, next) => {
    try {
        return res.json(await register.resumeAll(req.user.id));
    } catch (error) {
        next(error);
    }
});

// Remove the queued-but-not-started accounts (keeps finished results).
router.post('/clear', async (req, res, next) => {
    try {
        if (req.body && req.body.confirm !== true) throw badRequest('Confirmation required to clear the queue');
        return res.json(await register.clearForOwner(req.user.id));
    } catch (error) {
        next(error);
    }
});

// Submit the OTP for the account currently awaiting verification.
router.post('/:queueId/otp', async (req, res, next) => {
    try {
        const otp = requireString(req.body.otp, 'OTP', { min: 1, max: 32 });
        const row = await register.submitOtp(req.user.id, req.params.queueId, otp);
        return res.json({ row });
    } catch (error) {
        next(error);
    }
});

// Cancel an in-flight / awaiting-OTP registration.
router.post('/:queueId/cancel', async (req, res, next) => {
    try {
        const row = await register.cancelForOwner(req.user.id, req.params.queueId);
        return res.json({ row });
    } catch (error) {
        next(error);
    }
});

// Re-queue a finished (failed/cancelled/unknown) account.
router.post('/:queueId/requeue', async (req, res, next) => {
    try {
        const row = await register.requeueForOwner(req.user.id, req.params.queueId);
        return res.json({ row });
    } catch (error) {
        next(error);
    }
});

// Remove a queued (not started) account.
router.delete('/:queueId', async (req, res, next) => {
    try {
        const result = await register.removeForOwner(req.user.id, req.params.queueId);
        return res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;