// Registration service for the TablePH VIP Console.
//
// This adapts the root-level CLI script `register.js` into a reusable backend
// service. The crypto/header/request logic is extracted verbatim from
// register.js (single source of truth) so the web feature performs the exact
// same upstream calls. The only behavioral changes from the CLI script:
//
//  1. A shared registration password is supplied by the console user when they
//     build the queue (matching how the existing "shared password" import
//     works). register.js reads the same password from the first line of
//     register.txt and applies it to every number.
//  2. The OTP is provided by the authenticated console user via the API
//     instead of an interactive readline prompt.
//  3. Passwords and OTPs are held only in memory, never persisted or logged.
//  4. Registrations run strictly one account at a time, waiting for the actual
//     upstream register response before advancing, so a success/failure is
//     confirmed before the next number is attempted.
//
// Nothing sensitive (password, OTP, security header) ever reaches the frontend.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CryptoJS = require('crypto-js');
const RegistrationQueue = require('../models/RegistrationQueue');
const Account = require('../models/Account');
const ImportBatch = require('../models/ImportBatch');
const credentials = require('../lib/credentials');
const { maskPhone } = require('../lib/mask');
const { badRequest, conflict, notFound, forbidden, tooManyRequests } = require('../lib/errors');
const users = require('../lib/users');
const audit = require('../lib/audit');
const logger = require('../lib/logger');
const { normalizePhone } = require('../../login');

// --- CONFIG (mirrors register.js CONFIG) ---------------------------------
const CONFIG = {
    baseURL: 'https://www.tablephvip.com',
    registerEndpoint: '/lobby/api/user/register',
    sendCodeEndpoint: '/lobby/api/user/sendCode',
    journeyEndpoint: '/lobby/api/journey/',
    countryCode: '+63',
    rsaPublicKey: `-----BEGIN RSA PUBLIC KEY-----
MEgCQQDma8beoM2DXKLKZnJypL3byVzsXj5nOblDdN5gFQT5UiDoROCfIXaXlf0H
POcbd3KpVmEIucQjBB03up6IqK7PAgMBAAE=
-----END RSA PUBLIC KEY-----`,
    appVersion: '1.0.2',
    channelId: 2,
    gameVersion: 21,
    hmacSecret: 'UrgHp*co13a8',
    systemKey: 'UrgHp*co13a8',
    passwordSalt: 'd41d8cd98f00b204e9800998ecf8427e'
};

// Bounds on retries / OTP attempts. Never unlimited.
const MAX_OTP_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30000;
// How long a queued registration's password stays valid in memory before it is
// discarded. The OTP hold window.
const SECRET_TTL_MS = 60 * 60 * 1000;

// --- Crypto helpers (identical to register.js) ---------------------------
function rsaEncrypt(text, publicKey) {
    return crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text)).toString('base64');
}
function base64Encode(str) { return Buffer.from(str).toString('base64'); }
function hmacSha256(text, secret) { return CryptoJS.HmacSHA256(text, secret).toString(CryptoJS.enc.Base64); }

function generateSecurityHeader(url, method, params, data) {
    const time = Math.floor(Date.now() / 1000);
    const dataStr = method.toUpperCase() === 'GET' ? '' : (typeof data === 'string' ? data : JSON.stringify(data || {}));
    const dataHash = CryptoJS.MD5(dataStr).toString();
    const signUrl = params ? `${url}?${params}` : url;
    const signPayload = [time.toString(), method.toUpperCase(), signUrl, '', dataHash].join('\n');
    const signature = hmacSha256(signPayload, CONFIG.hmacSecret);
    const rsaPayload = ['type=0', `key=${base64Encode(CONFIG.systemKey)}`, `time=${time}`].join(';');
    const secret = rsaEncrypt(rsaPayload, CONFIG.rsaPublicKey);
    return `key=${CONFIG.systemKey};secret=${secret};signature=${signature}`;
}

function generateDeviceId() {
    const ua = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
    return Buffer.from(ua).toString('base64').substring(0, 20) + String(Math.random() * 10000000).slice(0, 5) + String(Date.now()).slice(-5);
}

function generateJunkFields(targetObj, min, max) {
    const count = Math.floor(Math.random() * (max - min + 1)) + min;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < count; i++) {
        const len = Math.floor(Math.random() * 3) + 3;
        let key = '';
        for (let j = 0; j < len; j++) key += chars.charAt(Math.floor(Math.random() * chars.length));
        if (Math.random() > 0.5) {
            targetObj[key] = Math.floor(Math.random() * 10);
        } else {
            targetObj[key] = chars.charAt(Math.floor(Math.random() * 26)).repeat(Math.floor(Math.random() * 32) + 1);
        }
    }
}

function getBaseHeaders(token, deviceId, securityHeader) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-ChannelID': CONFIG.channelId.toString(),
        'Accept-DeviceID': deviceId,
        'Accept-PlatformID': '3',
        'Accept-Version': CONFIG.appVersion,
        'Accept-SubChannelID': '0',
        'Accept-Language': 'en',
        'Origin': CONFIG.baseURL,
        'Referer': CONFIG.baseURL + '/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
        'x-content-security': securityHeader,
        'Authorization': token
    };
}

// register.js appends a successfully registered local phone number (without
// the +63) to accounts.txt. We reuse the same behavior here so successful
// registrations are written back to the existing accounts file, keeping that
// source of truth intact.
function appendToAccountsFile(localPhone) {
    try {
        const config = require('../config');
        const accountsPath = config.paths.legacyAccountsFile;
        fs.appendFileSync(accountsPath, `\n${localPhone}`);
    } catch (e) {
        logger.warn('REGISTER', `Could not append to accounts file: ${e.message}`);
    }
}

// Persist a successfully created account into the canonical Account collection
// so it immediately appears in the Accounts table. Reuses the existing
// credential and ImportBatch architecture; never duplicates an existing record.
async function persistRegisteredAccount({ ownerId, localPhone, password }) {
    try {
        const existing = await Account.findOne({ ownerId, phone: localPhone });
        if (existing) {
            // Reconcile: refresh credential and ensure the account looks usable.
            const newRef = credentials.create(ownerId, localPhone, password);
            // Remove stale credential reference if any (best-effort).
            if (existing.credRef) credentials.remove(ownerId, existing.credRef);
            await Account.updateOne(
                { _id: existing._id },
                {
                    credRef: newRef,
                    source: 'registered',
                    validationStatus: 'valid',
                    lastResult: 'Registered and reconciled',
                    lastError: null,
                }
            );
            await audit.record({
                actor: { id: ownerId, username: null },
                action: 'register.reconciled',
                targetType: 'account',
                targetId: existing._id,
                metadata: { phoneMasked: maskPhone(localPhone) }
            });
            return { reconciled: true, accountId: existing._id };
        }

        let batchId = null;
        try {
            const batch = await ImportBatch.create({
                ownerId,
                method: 'registered',
                total: 1,
                valid: 1,
                invalid: 0,
                duplicates: 0
            });
            batchId = batch._id;
        } catch (_) {
            // Non-fatal: account can be created without a batch row.
        }

        const account = await Account.create({
            ownerId,
            phone: localPhone,
            phoneMasked: maskPhone(localPhone),
            credRef: credentials.create(ownerId, localPhone, password),
            source: 'registered',
            importBatchId: batchId,
            validationStatus: 'valid',
            processingStatus: 'pending',
            lastResult: 'Successfully registered',
            lastError: null,
            lastActivityAt: new Date()
        });
        await audit.record({
            actor: { id: ownerId, username: null },
            action: 'register.persisted',
            targetType: 'account',
            targetId: account._id,
            metadata: { phoneMasked: maskPhone(localPhone), source: 'registered' }
        });
        return { created: true, accountId: account._id };
    } catch (e) {
        // Registration itself succeeded (code===0); a DB issue must not flip
        // the queue row to failed. Surface a warning but keep queue success.
        logger.warn('REGISTER', `Failed to persist registered account ${maskPhone(localPhone)}: ${e.message}`);
        return { error: e.message };
    }
}

// --- In-memory per-registration secrets (never persisted / logged) --------
// Keyed by the RegistrationQueue document id. Holds the shared password and
// the deviceId for the account currently being registered. The OTP itself is
// only held transiently while validating a submission and cleared immediately.
const pendingSecrets = new Map();

function setSecret(queueId, { password, deviceId, ticket }) {
    const prev = pendingSecrets.get(String(queueId));
    pendingSecrets.set(String(queueId), {
        password: password !== undefined ? password : (prev && prev.password),
        deviceId: deviceId !== undefined ? deviceId : (prev && prev.deviceId),
        ticket: ticket !== undefined ? ticket : (prev && prev.ticket),
        expiresAt: Date.now() + SECRET_TTL_MS
    });
}
function getSecret(queueId) {
    const entry = pendingSecrets.get(String(queueId));
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        pendingSecrets.delete(String(queueId));
        return null;
    }
    return entry;
}
function clearSecret(queueId) {
    pendingSecrets.delete(String(queueId));
}

// --- Upstream calls (mirrors register.js) ---------------------------------
async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Step 1: obtain a journey ticket. Returns '' when the ticket could not be
// obtained; register.js proceeds with an empty ticket in that case.
async function getJourneyTicket(deviceId) {
    const journeyUrl = CONFIG.journeyEndpoint + deviceId;
    const journeyPayload = { key: "v1.NkiqG3WIjjhg9Uh-e5c0cEMlCk2PnBl0DKZbFzgs8aHKG_edvtkiLQDnNIVkPML5XjQYfo1MR7kBoAbSYPTmZm3CgftagImNZwSNXdTdX9grkKNM5JA6sr7q0APxo8Py_ZJAKTlljAcOpF4" };
    const journeyHeader = generateSecurityHeader(journeyUrl, 'POST', '', journeyPayload);
    const journeyHeaders = getBaseHeaders('', deviceId, journeyHeader);
    delete journeyHeaders['Authorization'];

    let ticket = '';
    try {
        const res = await fetchWithTimeout(CONFIG.baseURL + journeyUrl, {
            method: 'POST',
            headers: journeyHeaders,
            body: JSON.stringify(journeyPayload)
        });
        const data = await res.json().catch(() => ({}));
        if (data.code === 0 && data.data && data.data.ticket) ticket = data.data.ticket;
    } catch (e) {
        logger.warn('REGISTER', `Journey ticket failed: ${e.message}`);
    }
    return ticket;
}

// Step 2: send the OTP to the phone. Returns { code, msg } so delivery failures
// (code !== 0) can be surfaced. register.js ignored the response, but we keep
// the result so a delivery failure can be shown instead of waiting forever.
async function sendCode(apiPhone, deviceId) {
    const sendCodeUrl = CONFIG.sendCodeEndpoint;
    const sendCodePayload = { mobile_or_email: apiPhone, token: "", type: 1 };
    const sendCodeHeader = generateSecurityHeader(sendCodeUrl, 'POST', '', sendCodePayload);
    const sendCodeHeaders = getBaseHeaders('', deviceId, sendCodeHeader);
    delete sendCodeHeaders['Authorization'];

    try {
        const res = await fetchWithTimeout(CONFIG.baseURL + sendCodeUrl, {
            method: 'POST',
            headers: sendCodeHeaders,
            body: JSON.stringify(sendCodePayload)
        });
        const data = await res.json().catch(() => ({}));
        return { code: data.code, msg: data.msg };
    } catch (e) {
        return { code: -1, msg: e.message };
    }
}

// Step 4: submit the registration. Returns the upstream decision exactly as
// register.js sees it: { success } when code === 0, otherwise { success, error }.
async function submitRegistration(apiPhone, localPhone, password, otp, deviceId, ticket) {
    const registerUrl = CONFIG.registerEndpoint;
    const passwordB64 = base64Encode(password + CONFIG.passwordSalt);

    const registerPayload = {
        mobile: apiPhone, email: "", username: localPhone, password: passwordB64, verify_code: otp,
        client_type: 1, device_id: deviceId, client_id: deviceId, device_detail: "Android Pixel 10",
        device_model: "H5", os_version: "Chrome", app_version: CONFIG.appVersion, game_version: CONFIG.gameVersion,
        channel_id: CONFIG.channelId, invitation_code: "", ticket: ticket,
        regist_finger: "551787c1f915d8736807ad438e94816e", login_finger: "551787c1f915d8736807ad438e94816e"
    };

    generateJunkFields(registerPayload, 2, 10);
    const registerHeader = generateSecurityHeader(registerUrl, 'POST', '', registerPayload);
    const registerHeaders = getBaseHeaders('', deviceId, registerHeader);
    delete registerHeaders['Authorization'];

    const res = await fetchWithTimeout(CONFIG.baseURL + registerUrl, {
        method: 'POST',
        headers: registerHeaders,
        body: JSON.stringify(registerPayload)
    });
    const data = await res.json().catch(() => ({}));

    if (data && data.code === 0) {
        return { success: true };
    }
    return { success: false, error: data.msg || 'Registration rejected by the service' };
}

// --- Queue helpers --------------------------------------------------------
function toPublic(row) {
    return {
        id: row._id,
        phoneMasked: row.phoneMasked,
        status: row.status,
        otpStatus: row.otpStatus,
        otpAttemptCount: row.otpAttemptCount,
        result: row.result || null,
        error: row.error || null,
        sequence: row.sequence,
        enabled: row.enabled,
        startedAt: row.startedAt || null,
        completedAt: row.completedAt || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function isTerminal(status) {
    return ['success', 'failed', 'cancelled', 'unknown'].includes(status);
}

// The rows that block sequential progress (mid-flow or awaiting input).
function isActive(status) {
    return ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(status);
}

async function nextSequence(ownerId) {
    const last = await RegistrationQueue.findOne({ ownerId }).sort({ sequence: -1 });
    return (last && last.sequence) ? last.sequence + 1 : 0;
}

// --- Queue + registration workflow ---------------------------------------
async function enqueue({ ownerId, phones, password }) {
    if (!Array.isArray(phones) || phones.length === 0) throw badRequest('Provide at least one phone number');
    if (phones.length > 500) throw badRequest('Maximum 500 numbers per registration queue');
    if (typeof password !== 'string' || password.length < 1) throw badRequest('A registration password is required');
    if (password.length > 128) throw badRequest('Registration password is too long');

    const owner = await users.findById(ownerId);
    if (!owner) throw forbidden('Account not found');
    const access = users.accessBlockedFor(owner);
    if (access.blocked) {
        throw forbidden(access.reason === 'Access expired' ? 'Account Access Expired' : access.reason);
    }

    // The password is kept only in memory and shared across every number in
    // this batch, exactly like register.txt's first line in register.js.
    const added = [];
    const skipped = [];
    for (const raw of phones) {
        const local = normalizePhone(raw);
        if (!local) {
            skipped.push({ phone: String(raw).replace(/[^0-9]/g, ''), reason: 'Invalid phone number' });
            continue;
        }
        const exists = await RegistrationQueue.findOne({ ownerId, phone: local });
        if (exists) {
            skipped.push({ phone: maskPhone(local), reason: 'Already in the queue' });
            continue;
        }
        const row = await RegistrationQueue.create({
            ownerId,
            phone: local,
            phoneMasked: maskPhone(local),
            status: 'queued',
            otpStatus: 'pending',
            sequence: await nextSequence(ownerId)
        });
        // Attach the password to this row (in memory only).
        setSecret(row._id, { password, deviceId: null });
        added.push(toPublic(row));
    }

    if (added.length > 0) {
        await audit.record({
            actor: { id: ownerId, username: null },
            action: 'register.queued',
            targetType: 'registration',
            metadata: { count: added.length, skipped: skipped.length }
        });
    }
    return { added, skipped };
}

// Start the next enabled, unfinished account. If an account is already in a
// mid-flow state (journey_started / awaiting_otp / verifying_otp) it is
// returned instead of starting a new one, enforcing strict sequential
// processing: never two accounts at once.
async function startNext(ownerId) {
    const active = await RegistrationQueue.findOne({
        ownerId,
        enabled: true,
        status: { $in: ['journey_started', 'awaiting_otp', 'verifying_otp'] }
    }).sort({ sequence: 1 });
    if (active) return { row: active, alreadyActive: true };

    const next = await RegistrationQueue.findOneAndUpdate(
        {
            ownerId,
            enabled: true,
            status: 'queued'
        },
        { $set: { status: 'journey_started', startedAt: new Date() } },
        { sort: { sequence: 1 }, new: true }
    );
    return { row: next, alreadyActive: false };
}

// Start registration for a row: generate a fresh device id, obtain the journey
// ticket, send the OTP, and park the row at awaiting_otp. The final register
// call happens only after the user supplies the OTP.
async function start(ownerId) {
    const { row, alreadyActive } = await startNext(ownerId);
    if (!row) throw conflict('No queued account to start');

    // If already mid-flow, don't re-send the OTP; return the current state.
    if (alreadyActive && row.status === 'awaiting_otp') {
        return toPublic(row);
    }

    const secret = getSecret(row._id);
    if (!secret) {
        await RegistrationQueue.findByIdAndUpdate(row._id, {
            status: 'failed',
            otpStatus: 'pending',
            error: 'Registration password expired. Re-queue the number.',
            completedAt: new Date()
        });
        clearSecret(row._id);
        return toPublic(await RegistrationQueue.findById(row._id));
    }

    const deviceId = secret.deviceId || generateDeviceId();
    const ticket = await getJourneyTicket(deviceId);
    setSecret(row._id, { deviceId, ticket });

    const local = row.phone;
    const apiPhone = local.startsWith(CONFIG.countryCode) ? local : CONFIG.countryCode + local.replace(/^0+/, '');
    const sendResult = await sendCode(apiPhone, deviceId);

    if (sendResult.code !== undefined && sendResult.code !== 0) {
        // OTP delivery failed (or the upstream returned an error). Keep the
        // account active but record the delivery problem so the user can retry.
        await RegistrationQueue.findByIdAndUpdate(row._id, {
            status: 'awaiting_otp',
            otpStatus: 'pending',
            error: sendResult.msg ? `OTP delivery issue: ${sendResult.msg}` : null
        });
    } else {
        await RegistrationQueue.findByIdAndUpdate(row._id, {
            status: 'awaiting_otp',
            otpStatus: 'delivered',
            error: null
        });
    }
    return toPublic(await RegistrationQueue.findById(row._id));
}

// The user supplies the OTP for the account currently awaiting verification.
// This performs the actual register.js step-4 submission, waits for the real
// upstream result, and only then advances to the next account.
async function submitOtp(ownerId, queueId, otp) {
    const row = await RegistrationQueue.findOne({ _id: queueId, ownerId });
    if (!row) throw notFound('Registration not found');
    if (row.status !== 'awaiting_otp') {
        throw conflict(`Registration is ${row.status} and is not awaiting an OTP`);
    }
    if (row.otpAttemptCount >= MAX_OTP_ATTEMPTS) {
        await RegistrationQueue.findByIdAndUpdate(queueId, {
            status: 'failed',
            otpStatus: 'too_many_attempts',
            error: `Too many OTP attempts (max ${MAX_OTP_ATTEMPTS}). Re-queue the number.`,
            completedAt: new Date()
        });
        clearSecret(queueId);
        return toPublic(await RegistrationQueue.findById(queueId));
    }

    const secret = getSecret(queueId);
    if (!secret || !secret.password || !secret.deviceId) {
        await RegistrationQueue.findByIdAndUpdate(queueId, {
            status: 'failed',
            otpStatus: 'expired',
            error: 'Registration session expired. Re-start this number.',
            completedAt: new Date()
        });
        return toPublic(await RegistrationQueue.findById(queueId));
    }

    // Mark verifying and prevent a second concurrent submit via a guarded
    // status transition.
    const claimed = await RegistrationQueue.updateOne(
        { _id: queueId, status: 'awaiting_otp' },
        { $set: { status: 'verifying_otp' }, $inc: { otpAttemptCount: 1 } }
    );
    if (claimed.modifiedCount === 0) throw conflict('This OTP is already being verified');

    let outcome;
    try {
        const local = row.phone;
        const apiPhone = local.startsWith(CONFIG.countryCode) ? local : CONFIG.countryCode + local.replace(/^0+/, '');
        const ticket = secret.ticket || '';
        outcome = await submitRegistration(apiPhone, local, secret.password, otp, secret.deviceId, ticket);
        if (outcome.success) {
            appendToAccountsFile(local);
            await persistRegisteredAccount({ ownerId, localPhone: local, password: secret.password });
        }
    } catch (error) {
        // A network/timeout error does not mean the account was NOT created: the
        // request may have reached the upstream service. Mark it unknown so we
        // never blindly retry and risk a duplicate. The user can verify the
        // outcome (e.g. via a login) before deciding to re-run.
        await RegistrationQueue.findByIdAndUpdate(queueId, {
            status: 'unknown',
            otpStatus: 'pending',
            error: `Uncertain result: ${error.message || 'network error'}. Verify whether the account was created before re-running.`,
            completedAt: new Date()
        });
        clearSecret(queueId);
        return toPublic(await RegistrationQueue.findById(queueId));
    }

    // Do not log the OTP. On failure, expose the upstream error message only.
    if (outcome.success) {
        await RegistrationQueue.findByIdAndUpdate(queueId, {
            status: 'success',
            otpStatus: 'not_required',
            result: 'Successfully Created',
            error: null,
            completedAt: new Date()
        });
    } else {
        const msg = String(outcome.error || 'Registration failed').toLowerCase();
        let otpStatus = 'pending';
        if (msg.includes('invalid') || msg.includes('wrong') || msg.includes('code')) otpStatus = 'invalid';
        else if (msg.includes('expired') || msg.includes('expire')) otpStatus = 'expired';
        else if (msg.includes('attempt') || msg.includes('many') || msg.includes('frequent')) otpStatus = 'too_many_attempts';
        await RegistrationQueue.findByIdAndUpdate(queueId, {
            status: 'awaiting_otp',
            otpStatus,
            error: outcome.error,
            result: null
        });
    }
    clearSecret(queueId);
    return toPublic(await RegistrationQueue.findById(queueId));
}

// --- Listing / controls ---------------------------------------------------
async function listForOwner(ownerId) {
    const rows = await RegistrationQueue.find({ ownerId })
        .sort({ sequence: 1 });
    return rows.map(toPublic);
}

async function removeForOwner(ownerId, queueId) {
    const row = await RegistrationQueue.findOne({ _id: queueId, ownerId });
    if (!row) throw notFound('Registration not found');
    if (isActive(row.status)) {
        throw conflict('This account is mid-registration. Cancel it first.');
    }
    clearSecret(queueId);
    await RegistrationQueue.deleteOne({ _id: queueId, ownerId });
    return { ok: true };
}

async function cancelForOwner(ownerId, queueId) {
    const row = await RegistrationQueue.findOne({ _id: queueId, ownerId });
    if (!row) throw notFound('Registration not found');
    if (isTerminal(row.status)) throw conflict('This registration has already finished');
    await RegistrationQueue.findByIdAndUpdate(queueId, {
        status: 'cancelled',
        result: null,
        error: 'Cancelled by user',
        completedAt: new Date()
    });
    clearSecret(queueId);
    return toPublic(await RegistrationQueue.findById(queueId));
}

async function pauseAll(ownerId) {
    await RegistrationQueue.updateMany(
        { ownerId, status: { $in: ['queued', 'journey_started'] }, enabled: true },
        { $set: { enabled: false } }
    );
    return { ok: true };
}

async function resumeAll(ownerId) {
    await RegistrationQueue.updateMany(
        { ownerId, enabled: false },
        { $set: { enabled: true } }
    );
    return { ok: true };
}

async function clearForOwner(ownerId) {
    const rows = await RegistrationQueue.find({ ownerId, status: { $in: ['queued', 'journey_started'] } });
    for (const row of rows) clearSecret(row._id);
    const result = await RegistrationQueue.deleteMany({
        ownerId,
        status: { $in: ['queued', 'journey_started'] }
    });
    return { deleted: result.deletedCount };
}

// Re-queue a failed/cancelled/unknown number so it can be attempted again.
async function requeueForOwner(ownerId, queueId) {
    const row = await RegistrationQueue.findOne({ _id: queueId, ownerId });
    if (!row) throw notFound('Registration not found');
    if (isActive(row.status)) throw conflict('This account is currently active');
    await RegistrationQueue.findByIdAndUpdate(queueId, {
        status: 'queued',
        otpStatus: 'pending',
        otpAttemptCount: 0,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null
    });
    clearSecret(queueId);
    return toPublic(await RegistrationQueue.findById(queueId));
}

module.exports = {
    enqueue,
    start,
    submitOtp,
    listForOwner,
    removeForOwner,
    cancelForOwner,
    pauseAll,
    resumeAll,
    clearForOwner,
    requeueForOwner,
    toPublic
};