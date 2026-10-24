// Register Account page: sequential TablePH VIP registration workflow.
//
// Adapts the root-level `register.js` CLI workflow for the web console:
//   1) Journey ticket  2) Send OTP  3) User enters OTP  4) Register
//
// Registrations are strictly sequential (one account at a time). The backend
// only advances to the next number after the current account reaches a
// terminal state (success / failed / cancelled / unknown). Queue state is
// persisted in MongoDB so a page refresh never erases the outcome.
//
// Two input methods share the same persisted queue and do not discard numbers
// silently: manual entry (one number at a time) and TXT import (preview then
// confirm). Both supply a shared password (register.js line 1) applied to every
// number in the batch. The OTP step pauses the queue and requires manual entry.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Upload, Phone, Trash2, Play, Pause, RotateCcw, X, Eye, EyeOff,
    AlertTriangle, CheckCircle2, XCircle, Clock, Loader2, ShieldCheck,
    HelpCircle, FileText, Plus, RefreshCw
} from 'lucide-react';
import { registerApi } from '../lib/api';
import { addToast } from '../lib/toast';
import { cn } from '../styles/utils';

// --- Helpers --------------------------------------------------------------
function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function normalizeLocalPhone(raw) {
    if (typeof raw !== 'string') return '';
    const cleaned = raw.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) return '';
    return cleaned;
}

function parsePhoneLines(rawText) {
    const lines = String(rawText).split(/\r?\n/);
    const valid = [];
    const invalid = [];
    const seen = new Set();
    let duplicates = 0;
    lines.forEach((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) return;
        const phone = normalizeLocalPhone(line);
        if (!phone) {
            invalid.push({ line: idx + 1, raw: rawLine.trim(), reason: 'Invalid phone number' });
            return;
        }
        if (seen.has(phone)) {
            duplicates += 1;
            return;
        }
        seen.add(phone);
        valid.push({ phone, line: idx + 1 });
    });
    return { valid, invalid, duplicates, total: valid.length + invalid.length + duplicates };
}

const STATUS_META = {
    queued: { label: 'Queued', cls: 'badge-neutral' },
    journey_started: { label: 'Registering', cls: 'badge-warning' },
    awaiting_otp: { label: 'Awaiting OTP', cls: 'badge-warning' },
    verifying_otp: { label: 'Verifying OTP', cls: 'badge-warning' },
    success: { label: 'Successfully Created', cls: 'badge-success' },
    failed: { label: 'Failed', cls: 'badge-danger' },
    cancelled: { label: 'Cancelled', cls: 'badge-neutral' },
    unknown: { label: 'Status Unknown — Verification Required', cls: 'badge-warning' }
};

const OTP_META = {
    pending: 'Pending',
    delivered: 'Delivered',
    invalid: 'Invalid',
    expired: 'Expired',
    too_many_attempts: 'Too many attempts',
    not_required: '—'
};

function StatusBadge({ status }) {
    const meta = STATUS_META[status] || { label: String(status).replace(/_/g, ' '), cls: 'badge-neutral' };
    return <span className={meta.cls}>{meta.label}</span>;
}

// --- Component ------------------------------------------------------------
export default function RegisterPage() {
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Input method state
    const [inputTab, setInputTab] = useState('manual'); // 'manual' | 'txt'
    const [manualPhone, setManualPhone] = useState('');
    const [manualError, setManualError] = useState('');
    const [sharedPassword, setSharedPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // TXT import state (preview before enqueue)
    const [txtRaw, setTxtRaw] = useState('');
    const [txtPreview, setTxtPreview] = useState(null);
    const [txtFile, setTxtFile] = useState(null);
    const [dropActive, setDropActive] = useState(false);
    const fileInputRef = useRef(null);

    // OTP state
    const [otpInput, setOtpInput] = useState('');
    const [otpError, setOtpError] = useState('');
    const [submittingOtp, setSubmittingOtp] = useState(false);
    const [starting, setStarting] = useState(false);
    const [actionBusy, setActionBusy] = useState('');

    const loadQueue = useCallback(async () => {
        try {
            const { data } = await registerApi.list();
            setQueue(Array.isArray(data.items) ? data.items : []);
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load registration queue');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadQueue();
        const id = setInterval(loadQueue, 3000);
        return () => clearInterval(id);
    }, [loadQueue]);

    // Derived stats
    const stats = useMemo(() => {
        const total = queue.length;
        const processing = queue.filter(r => ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(r.status)).length;
        const success = queue.filter(r => r.status === 'success').length;
        const failed = queue.filter(r => r.status === 'failed').length;
        const unknown = queue.filter(r => r.status === 'unknown').length;
        const cancelled = queue.filter(r => r.status === 'cancelled').length;
        const remaining = queue.filter(r => r.status === 'queued').length;
        const queued = remaining;
        return { total, processing, success, failed, unknown, cancelled, remaining: remaining + processing, queued };
    }, [queue]);

    const activeRow = useMemo(() => {
        return queue.find(r => ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(r.status)) || null;
    }, [queue]);

    const awaitingOtpRow = useMemo(() => {
        return queue.find(r => r.status === 'awaiting_otp') || null;
    }, [queue]);

    const isQueueFinished = useMemo(() => {
        if (queue.length === 0) return false;
        return queue.every(r => ['success', 'failed', 'cancelled', 'unknown'].includes(r.status));
    }, [queue]);

    // --- Manual entry ------------------------------------------------------
    const handleManualAdd = async () => {
        setManualError('');
        const phone = normalizeLocalPhone(manualPhone);
        if (!phone) {
            setManualError('Enter a valid phone number (at least 10 digits)');
            return;
        }
        if (!sharedPassword) {
            setManualError('Enter the shared registration password first');
            return;
        }
        // Client-side duplicate guard against current queue
        const dup = queue.find(r => {
            // queue stores masked, so compare by checking if raw would mask the same - instead check via API skipped
            return false;
        });
        void dup;
        setActionBusy('manual');
        try {
            const { data } = await registerApi.enqueue({ phones: [phone], password: sharedPassword });
            if (data.skipped && data.skipped.length > 0) {
                setManualError(data.skipped[0].reason || 'Duplicate or invalid');
            } else {
                setManualPhone('');
                addToast('Added to registration queue', 'success');
            }
            await loadQueue();
        } catch (err) {
            setManualError(err.message || 'Could not add number');
        } finally {
            setActionBusy('');
        }
    };

    // --- TXT import --------------------------------------------------------
    const handleTxtFiles = useCallback((files) => {
        const chosen = files && files[0];
        if (!chosen) return;
        if (!/\.txt$/i.test(chosen.name)) {
            addToast('Only .txt files are supported', 'error');
            return;
        }
        setTxtFile(chosen);
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result || '');
            setTxtRaw(text);
            setTxtPreview(parsePhoneLines(text));
        };
        reader.onerror = () => addToast('Could not read that file', 'error');
        reader.readAsText(chosen);
    }, []);

    const onTxtDrop = (e) => {
        e.preventDefault();
        setDropActive(false);
        handleTxtFiles(e.dataTransfer.files);
    };

    const handleTxtTextChange = (value) => {
        setTxtRaw(value);
        if (value.trim()) setTxtPreview(parsePhoneLines(value));
        else setTxtPreview(null);
    };

    const handleTxtEnqueue = async () => {
        if (!txtPreview || txtPreview.valid.length === 0) return;
        if (!sharedPassword) {
            addToast('Enter the shared registration password first', 'error');
            return;
        }
        setActionBusy('txt');
        try {
            const phones = txtPreview.valid.map(v => v.phone);
            const { data } = await registerApi.enqueue({ phones, password: sharedPassword });
            const added = data.added ? data.added.length : 0;
            const skipped = data.skipped ? data.skipped.length : 0;
            if (added > 0) addToast(`Added ${added} number${added === 1 ? '' : 's'} to queue${skipped ? ` (${skipped} skipped)` : ''}`, 'success');
            else addToast('No numbers were added (duplicates or invalid)', 'warning');
            setTxtPreview(null);
            setTxtRaw('');
            setTxtFile(null);
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not enqueue numbers', 'error');
        } finally {
            setActionBusy('');
        }
    };

    // --- Queue controls ----------------------------------------------------
    const handleStart = async () => {
        if (starting) return;
        if (activeRow && activeRow.status !== 'queued') {
            addToast('An account is already being registered. Finish or cancel it first.', 'warning');
            return;
        }
        setStarting(true);
        setError('');
        try {
            await registerApi.start();
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not start registration', 'error');
        } finally {
            setStarting(false);
        }
    };

    const handleSubmitOtp = async () => {
        if (!awaitingOtpRow) return;
        if (submittingOtp) return;
        const otp = otpInput.trim();
        if (!otp) {
            setOtpError('Enter the OTP sent to the phone');
            return;
        }
        setOtpError('');
        setSubmittingOtp(true);
        try {
            await registerApi.submitOtp(awaitingOtpRow.id, otp);
            setOtpInput('');
            await loadQueue();
        } catch (err) {
            setOtpError(err.message || 'Could not verify OTP');
        } finally {
            setSubmittingOtp(false);
        }
    };

    const handleCancelActive = async () => {
        if (!activeRow) return;
        if (!window.confirm('Cancel registration for this account?')) return;
        try {
            await registerApi.cancel(activeRow.id);
            setOtpInput('');
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not cancel', 'error');
        }
    };

    const handleRemove = async (id) => {
        if (!window.confirm('Remove this queued number?')) return;
        try {
            await registerApi.remove(id);
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not remove', 'error');
        }
    };

    const handleRequeue = async (id) => {
        try {
            await registerApi.requeue(id);
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not re-queue', 'error');
        }
    };

    const handleClearQueued = async () => {
        if (!window.confirm('Remove all queued (not yet started) numbers? Finished results are kept.')) return;
        try {
            await registerApi.clear();
            await loadQueue();
        } catch (err) {
            addToast(err.message || 'Could not clear queue', 'error');
        }
    };

    return (
        <div className='page'>
            {/* Header */}
            <div className='flex flex-col gap-1'>
                <h1 className='page-title'>Register Account</h1>
                <p className='page-description'>
                    Register TablePH VIP accounts sequentially using the same workflow as <span className='font-mono text-xs'>register.js</span>.
                    Each account is verified before the next begins. OTPs are entered manually when requested.
                </p>
            </div>

            <div className='divider' />

            {/* Stats bar */}
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-5'>
                <div className='card p-3'>
                    <p className='stat-label'>Total queued</p>
                    <p className='stat-value'>{stats.total}</p>
                </div>
                <div className='card p-3'>
                    <p className='stat-label'>Currently processing</p>
                    <p className='stat-value text-yellow-300'>{stats.processing}</p>
                </div>
                <div className='card p-3'>
                    <p className='stat-label'>Successfully created</p>
                    <p className='stat-value text-accent'>{stats.success}</p>
                </div>
                <div className='card p-3'>
                    <p className='stat-label'>Failed</p>
                    <p className='stat-value text-red-300'>{stats.failed + stats.unknown}</p>
                </div>
                <div className='card p-3'>
                    <p className='stat-label'>Remaining</p>
                    <p className='stat-value'>{stats.remaining}</p>
                </div>
            </div>

            {/* Shared password */}
            <div className='card p-4'>
                <label className='label' htmlFor='reg-password'>Shared registration password</label>
                <p className='mb-2 text-xs text-light/50'>Applied to every number in this queue (matches the first line of <span className='font-mono'>register.txt</span> in register.js).</p>
                <div className='flex items-center gap-2 max-w-md'>
                    <input
                        id='reg-password'
                        className='input'
                        type={showPassword ? 'text' : 'password'}
                        autoComplete='new-password'
                        value={sharedPassword}
                        onChange={e => setSharedPassword(e.target.value)}
                        placeholder='Registration password'
                    />
                    <button className='btn-ghost shrink-0' onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                    </button>
                </div>
            </div>

            {/* Input methods */}
            <div className='card overflow-hidden'>
                <div className='flex border-b border-light/10'>
                    <button
                        className={cn('flex-1 px-4 py-3 text-sm font-medium transition-colors', inputTab === 'manual' ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-light/60 hover:text-light')}
                        onClick={() => setInputTab('manual')}
                    >
                        <Phone className='inline h-4 w-4 mr-2' />Manual Entry
                    </button>
                    <button
                        className={cn('flex-1 px-4 py-3 text-sm font-medium transition-colors', inputTab === 'txt' ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-light/60 hover:text-light')}
                        onClick={() => setInputTab('txt')}
                    >
                        <FileText className='inline h-4 w-4 mr-2' />Import TXT
                    </button>
                </div>

                <div className='p-4 sm:p-5'>
                    {inputTab === 'manual' && (
                        <div className='space-y-3'>
                            <div>
                                <label className='label' htmlFor='manual-phone'>Phone number</label>
                                <div className='flex gap-2'>
                                    <input
                                        id='manual-phone'
                                        className='input flex-1'
                                        placeholder='e.g. 09171234567'
                                        value={manualPhone}
                                        onChange={e => setManualPhone(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleManualAdd(); }}
                                    />
                                    <button className='btn btn-primary shrink-0' onClick={handleManualAdd} disabled={actionBusy === 'manual'}>
                                        {actionBusy === 'manual' ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />} Add to queue
                                    </button>
                                </div>
                                {manualError && <p className='mt-1 text-xs text-red-300'>{manualError}</p>}
                                <p className='mt-1 text-xs text-light/40'>Duplicates in the queue are rejected. At least 10 digits required.</p>
                            </div>
                        </div>
                    )}

                    {inputTab === 'txt' && (
                        <div className='space-y-4'>
                            <div
                                className={cn('rounded-md border border-dashed p-6 text-center transition-colors', dropActive ? 'border-accent bg-accent/5' : 'border-light/15')}
                                onDragOver={e => { e.preventDefault(); setDropActive(true); }}
                                onDragLeave={() => setDropActive(false)}
                                onDrop={onTxtDrop}
                            >
                                <Upload className='mx-auto h-6 w-6 text-light/40' />
                                <p className='mt-2 text-sm text-light/70'>Drag and drop a .txt file here</p>
                                <p className='text-xs text-light/40'>One phone number per line. # comments and blank lines are ignored.</p>
                                <button className='btn-ghost mt-3' onClick={() => fileInputRef.current?.click()}>or choose a file</button>
                                <input ref={fileInputRef} type='file' accept='.txt,text/plain' className='hidden' onChange={e => handleTxtFiles(e.target.files)} />
                                {txtFile && <p className='mt-2 text-xs text-light/60'>Selected: {txtFile.name}</p>}
                            </div>

                            <div>
                                <label className='label' htmlFor='txt-raw'>Phone numbers (one per line)</label>
                                <textarea
                                    id='txt-raw'
                                    className='input h-32 resize-y font-mono text-xs'
                                    spellCheck='false'
                                    value={txtRaw}
                                    onChange={e => handleTxtTextChange(e.target.value)}
                                    placeholder={'09171234567\n09998887777\n# comments ignored'}
                                />
                            </div>

                            {txtPreview && (
                                <div className='space-y-3'>
                                    <div className='grid grid-cols-3 gap-3'>
                                        <div className='card p-3 text-center'>
                                            <p className='stat-label'>Valid</p>
                                            <p className='stat-value text-accent text-lg'>{txtPreview.valid.length}</p>
                                        </div>
                                        <div className='card p-3 text-center'>
                                            <p className='stat-label'>Invalid</p>
                                            <p className='stat-value text-yellow-300 text-lg'>{txtPreview.invalid.length}</p>
                                        </div>
                                        <div className='card p-3 text-center'>
                                            <p className='stat-label'>Duplicates in file</p>
                                            <p className='stat-value text-red-300 text-lg'>{txtPreview.duplicates}</p>
                                        </div>
                                    </div>

                                    {txtPreview.valid.length > 0 && (
                                        <div className='max-h-40 overflow-y-auto rounded-md border border-light/10 p-3'>
                                            <p className='stat-label'>Ready to queue ({txtPreview.valid.length})</p>
                                            <ul className='mt-2 space-y-1 font-mono text-xs text-light/70'>
                                                {txtPreview.valid.slice(0, 100).map(v => <li key={v.phone}>{v.phone}</li>)}
                                                {txtPreview.valid.length > 100 && <li className='text-light/40'>…and {txtPreview.valid.length - 100} more</li>}
                                            </ul>
                                        </div>
                                    )}
                                    {txtPreview.invalid.length > 0 && (
                                        <div className='max-h-32 overflow-y-auto rounded-md border border-yellow-500/20 p-3'>
                                            <p className='stat-label text-yellow-300'>Invalid lines</p>
                                            <ul className='mt-2 space-y-1 text-xs text-yellow-200/70'>
                                                {txtPreview.invalid.slice(0, 50).map((r, i) => <li key={i}>Line {r.line}: {r.raw} — {r.reason}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {txtPreview.valid.length === 0 && (
                                        <div className='flex items-start gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-light/60'>
                                            <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-yellow-300' />
                                            <p>Nothing valid to queue — every line was invalid or a duplicate.</p>
                                        </div>
                                    )}

                                    <div className='flex justify-end gap-2'>
                                        <button className='btn-ghost' onClick={() => { setTxtPreview(null); setTxtRaw(''); setTxtFile(null); }}>Clear</button>
                                        <button className='btn btn-primary' disabled={txtPreview.valid.length === 0 || actionBusy === 'txt'} onClick={handleTxtEnqueue}>
                                            {actionBusy === 'txt' ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                                            Add {txtPreview.valid.length} to queue
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* OTP panel (when an account is awaiting verification) */}
            {awaitingOtpRow && (
                <div className='card border-accent/30 bg-accent/5 p-4 sm:p-5'>
                    <div className='flex items-start gap-3'>
                        <ShieldCheck className='h-5 w-5 shrink-0 text-accent mt-0.5' />
                        <div className='flex-1 min-w-0'>
                            <h3 className='text-sm font-semibold text-light'>OTP verification required</h3>
                            <p className='mt-1 text-xs text-light/60'>
                                An SMS code was sent to <span className='font-mono text-light'>{awaitingOtpRow.phoneMasked}</span>.
                                Enter the code you received on that phone. The queue is paused until this is resolved.
                            </p>
                            {awaitingOtpRow.error && (
                                <p className='mt-2 text-xs text-yellow-300'>{awaitingOtpRow.error}</p>
                            )}
                            {awaitingOtpRow.otpStatus !== 'pending' && awaitingOtpRow.otpStatus !== 'delivered' && (
                                <p className='mt-1 text-xs text-red-300'>OTP status: {OTP_META[awaitingOtpRow.otpStatus] || awaitingOtpRow.otpStatus} — try again or cancel.</p>
                            )}
                            <div className='mt-3 flex flex-wrap items-end gap-2'>
                                <div className='flex-1 min-w-[160px] max-w-xs'>
                                    <label className='label' htmlFor='otp-input'>OTP code</label>
                                    <input
                                        id='otp-input'
                                        className='input font-mono tracking-widest'
                                        placeholder='Enter OTP'
                                        autoComplete='one-time-code'
                                        value={otpInput}
                                        onChange={e => setOtpInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSubmitOtp(); }}
                                        disabled={submittingOtp}
                                    />
                                </div>
                                <button className='btn btn-primary' onClick={handleSubmitOtp} disabled={submittingOtp || !otpInput.trim()}>
                                    {submittingOtp ? <Loader2 className='h-4 w-4 animate-spin' /> : <ShieldCheck className='h-4 w-4' />} Submit OTP
                                </button>
                                <button className='btn-ghost' onClick={handleCancelActive} disabled={submittingOtp}>Cancel</button>
                            </div>
                            {otpError && <p className='mt-2 text-xs text-red-300'>{otpError}</p>}
                            <p className='mt-2 text-xs text-light/40'>Attempt {awaitingOtpRow.otpAttemptCount + 1} of 5. Do not share OTPs.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Verifying indicator */}
            {activeRow && activeRow.status === 'verifying_otp' && (
                <div className='card border-yellow-500/20 bg-yellow-500/5 p-4 flex items-center gap-3'>
                    <Loader2 className='h-5 w-5 animate-spin text-yellow-300' />
                    <p className='text-sm text-light/80'>Verifying OTP for <span className='font-mono'>{activeRow.phoneMasked}</span>…</p>
                </div>
            )}
            {activeRow && activeRow.status === 'journey_started' && (
                <div className='card border-light/10 p-4 flex items-center gap-3'>
                    <Loader2 className='h-5 w-5 animate-spin text-light/40' />
                    <p className='text-sm text-light/60'>Starting registration for <span className='font-mono text-light'>{activeRow.phoneMasked}</span>… sending OTP</p>
                </div>
            )}

            {error && <p className='text-xs text-red-300'>{error}</p>}

            {/* Queue table */}
            <div className='card overflow-hidden'>
                <div className='flex flex-wrap items-center justify-between gap-2 p-3 border-b border-light/10'>
                    <h2 className='text-sm font-semibold text-light'>Registration queue</h2>
                    <div className='flex flex-wrap items-center gap-2'>
                        <button className='btn btn-primary' onClick={handleStart} disabled={starting || !!activeRow || queue.filter(r => r.status === 'queued').length === 0}>
                            {starting ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Play className='h-3.5 w-3.5' />} Start
                        </button>
                        <button className='btn-ghost' onClick={loadQueue} title='Refresh'>
                            <RefreshCw className='h-3.5 w-3.5' /> Refresh
                        </button>
                        {queue.some(r => r.status === 'queued') && (
                            <button className='btn-ghost text-xs' onClick={handleClearQueued}>Clear queued</button>
                        )}
                    </div>
                </div>

                <div className='overflow-x-auto'>
                    <table className='table'>
                        <thead>
                            <tr>
                                <th>Phone Number</th>
                                <th>Registration Status</th>
                                <th>OTP Status</th>
                                <th>Started At</th>
                                <th>Completed At</th>
                                <th>Result</th>
                                <th className='text-right'>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className='py-10 text-center text-light/40'>Loading…</td></tr>
                            )}
                            {!loading && queue.length === 0 && (
                                <tr>
                                    <td colSpan={7} className='py-12 text-center'>
                                        <p className='text-sm text-light/60'>No numbers queued yet.</p>
                                        <p className='mt-1 text-xs text-light/40'>Add phone numbers above to build the queue. Registration runs one account at a time.</p>
                                    </td>
                                </tr>
                            )}
                            {!loading && queue.map((row) => {
                                const isActive = ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(row.status);
                                return (
                                    <tr key={row.id} className={isActive ? 'bg-accent/10' : ''}>
                                        <td className='font-mono text-light'>
                                            {row.phoneMasked}
                                            {isActive && <span className='ml-2 inline-flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse' aria-hidden />}
                                        </td>
                                        <td><StatusBadge status={row.status} /></td>
                                        <td className='text-xs capitalize'>{OTP_META[row.otpStatus] || row.otpStatus}</td>
                                        <td className='text-light/60 text-xs'>{formatDate(row.startedAt)}</td>
                                        <td className='text-light/60 text-xs'>{formatDate(row.completedAt)}</td>
                                        <td className='max-w-[14rem] truncate text-xs' title={row.result || row.error || ''}>
                                            {row.status === 'success' && <span className='text-accent flex items-center gap-1'><CheckCircle2 className='h-3.5 w-3.5' />{row.result}</span>}
                                            {row.status === 'failed' && <span className='text-red-300 flex items-center gap-1'><XCircle className='h-3.5 w-3.5' />{row.error || 'Failed'}</span>}
                                            {row.status === 'unknown' && <span className='text-yellow-300 flex items-center gap-1'><HelpCircle className='h-3.5 w-3.5' />{row.error || 'Unknown'}</span>}
                                            {row.status === 'cancelled' && <span className='text-light/50'>{row.error || 'Cancelled'}</span>}
                                            {['queued', 'journey_started', 'awaiting_otp', 'verifying_otp'].includes(row.status) && <span className='text-light/40'>—</span>}
                                        </td>
                                        <td className='text-right'>
                                            <div className='flex items-center justify-end gap-1'>
                                                {row.status === 'queued' && (
                                                    <button className='btn-ghost px-2 py-1 text-xs' onClick={() => handleRemove(row.id)} title='Remove from queue'>
                                                        <Trash2 className='h-3.5 w-3.5' />
                                                    </button>
                                                )}
                                                {['failed', 'cancelled', 'unknown'].includes(row.status) && (
                                                    <button className='btn-ghost px-2 py-1 text-xs' onClick={() => handleRequeue(row.id)} title='Re-queue'>
                                                        <RotateCcw className='h-3.5 w-3.5' />
                                                    </button>
                                                )}
                                                {isActive && (
                                                    <button className='btn-ghost px-2 py-1 text-xs text-red-300' onClick={handleCancelActive} title='Cancel registration'>
                                                        <X className='h-3.5 w-3.5' />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Final summary */}
            {isQueueFinished && queue.length > 0 && (
                <div className='card border-accent/20 bg-accent/5 p-4'>
                    <h3 className='text-sm font-semibold text-light flex items-center gap-2'><CheckCircle2 className='h-4 w-4 text-accent' /> Queue complete</h3>
                    <p className='mt-1 text-xs text-light/60'>
                        {stats.success} account{stats.success === 1 ? '' : 's'} successfully created
                        {stats.failed > 0 ? `, ${stats.failed} failed` : ''}
                        {stats.unknown > 0 ? `, ${stats.unknown} require verification` : ''}
                        {stats.cancelled > 0 ? `, ${stats.cancelled} cancelled` : ''}.
                        {stats.success > 0 ? ' Successful registrations were appended to accounts.txt.' : ''}
                    </p>
                    {stats.unknown > 0 && (
                        <p className='mt-2 text-xs text-yellow-300'>Some results are uncertain (network timeout after the request may have succeeded). Verify those accounts with a login before re-running.</p>
                    )}
                </div>
            )}

            <p className='text-xs text-light/30'>
                Workflow mirrors <span className='font-mono'>register.js</span>: journey ticket → send OTP → manual OTP → register. Sensitive values never leave the backend.
            </p>
        </div>
    );
}