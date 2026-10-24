// RegisterAccountModal — sequential TablePH VIP registration workflow.
// Lives inside the Accounts page (not a standalone route). Adapts
// register.js 1:1: journey ticket → send OTP → manual OTP → register.
// One account at a time; next only after the current reaches success/failed/
// cancelled/unknown. Successful registrations are persisted to the Account
// collection and appear in the Accounts table; queue retains its per-row result.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Upload, Phone, Trash2, Play, RotateCcw, X, Eye, EyeOff,
    AlertTriangle, CheckCircle2, XCircle, Loader2, ShieldCheck, HelpCircle, FileText, Plus, RefreshCw, Pause
} from 'lucide-react';
import { registerApi } from '../lib/api';
import { addToast } from '../lib/toast';
import { cn } from '../styles/utils';

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
        if (seen.has(phone)) { duplicates += 1; return; }
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
const OTP_META = { pending: 'Pending', delivered: 'Delivered', invalid: 'Invalid', expired: 'Expired', too_many_attempts: 'Too many attempts', not_required: '—' };
function StatusBadge({ status }) {
    const meta = STATUS_META[status] || { label: String(status).replace(/_/g, ' '), cls: 'badge-neutral' };
    return <span className={meta.cls}>{meta.label}</span>;
}

export default function RegisterAccountModal({ open, onClose, onRegistered }) {
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [inputTab, setInputTab] = useState('manual');
    const [manualPhone, setManualPhone] = useState('');
    const [manualError, setManualError] = useState('');
    const [sharedPassword, setSharedPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [txtRaw, setTxtRaw] = useState('');
    const [txtPreview, setTxtPreview] = useState(null);
    const [txtFile, setTxtFile] = useState(null);
    const [dropActive, setDropActive] = useState(false);
    const fileInputRef = useRef(null);
    const [otpInput, setOtpInput] = useState('');
    const [otpError, setOtpError] = useState('');
    const [submittingOtp, setSubmittingOtp] = useState(false);
    const [starting, setStarting] = useState(false);
    const [actionBusy, setActionBusy] = useState('');
    const [paused, setPaused] = useState(false);

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
        if (!open) return;
        loadQueue();
        const id = setInterval(loadQueue, 3000);
        return () => clearInterval(id);
    }, [open, loadQueue]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const stats = useMemo(() => {
        const total = queue.length;
        const processing = queue.filter(r => ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(r.status)).length;
        const success = queue.filter(r => r.status === 'success').length;
        const failed = queue.filter(r => r.status === 'failed').length;
        const unknown = queue.filter(r => r.status === 'unknown').length;
        const cancelled = queue.filter(r => r.status === 'cancelled').length;
        const queued = queue.filter(r => r.status === 'queued').length;
        return { total, processing, success, failed, unknown, cancelled, queued, remaining: queued + processing };
    }, [queue]);

    const activeRow = useMemo(() => queue.find(r => ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(r.status)) || null, [queue]);
    const awaitingOtpRow = useMemo(() => queue.find(r => r.status === 'awaiting_otp') || null, [queue]);
    const isQueueFinished = useMemo(() => queue.length > 0 && queue.every(r => ['success', 'failed', 'cancelled', 'unknown'].includes(r.status)), [queue]);
    const prevSuccessRef = useRef(0);
    useEffect(() => {
        if (stats.success > prevSuccessRef.current) {
            const delta = stats.success - prevSuccessRef.current;
            if (onRegistered) onRegistered(delta);
        }
        prevSuccessRef.current = stats.success;
    }, [stats.success, onRegistered]);

    const handleManualAdd = async () => {
        setManualError('');
        const phone = normalizeLocalPhone(manualPhone);
        if (!phone) { setManualError('Enter a valid phone number (at least 10 digits)'); return; }
        if (!sharedPassword) { setManualError('Enter the shared registration password first'); return; }
        setActionBusy('manual');
        try {
            const { data } = await registerApi.enqueue({ phones: [phone], password: sharedPassword });
            if (data.skipped && data.skipped.length > 0) setManualError(data.skipped[0].reason || 'Duplicate or invalid');
            else { setManualPhone(''); addToast('Added to registration queue', 'success'); }
            await loadQueue();
        } catch (err) { setManualError(err.message || 'Could not add number'); }
        finally { setActionBusy(''); }
    };

    const handleTxtFiles = useCallback((files) => {
        const chosen = files && files[0];
        if (!chosen) return;
        if (!/\.txt$/i.test(chosen.name)) { addToast('Only .txt files are supported', 'error'); return; }
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
    const onTxtDrop = (e) => { e.preventDefault(); setDropActive(false); handleTxtFiles(e.dataTransfer.files); };
    const handleTxtTextChange = (value) => {
        setTxtRaw(value);
        if (value.trim()) setTxtPreview(parsePhoneLines(value));
        else setTxtPreview(null);
    };
    const handleTxtEnqueue = async () => {
        if (!txtPreview || txtPreview.valid.length === 0) return;
        if (!sharedPassword) { addToast('Enter the shared registration password first', 'error'); return; }
        setActionBusy('txt');
        try {
            const phones = txtPreview.valid.map(v => v.phone);
            const { data } = await registerApi.enqueue({ phones, password: sharedPassword });
            const added = data.added ? data.added.length : 0;
            const skipped = data.skipped ? data.skipped.length : 0;
            if (added > 0) addToast(`Added ${added} number${added === 1 ? '' : 's'} to queue${skipped ? ` (${skipped} skipped)` : ''}`, 'success');
            else addToast('No numbers were added (duplicates or invalid)', 'warning');
            setTxtPreview(null); setTxtRaw(''); setTxtFile(null);
            await loadQueue();
        } catch (err) { addToast(err.message || 'Could not enqueue numbers', 'error'); }
        finally { setActionBusy(''); }
    };

    const handleStart = async () => {
        if (starting) return;
        if (paused) { addToast('Queue is paused. Resume first.', 'warning'); return; }
        if (activeRow) { addToast('An account is already being registered. Finish or cancel it first.', 'warning'); return; }
        setStarting(true); setError('');
        try { await registerApi.start(); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not start registration', 'error'); }
        finally { setStarting(false); }
    };
    const handleSubmitOtp = async () => {
        if (!awaitingOtpRow) return;
        if (submittingOtp) return;
        const otp = otpInput.trim();
        if (!otp) { setOtpError('Enter the OTP sent to the phone'); return; }
        setOtpError(''); setSubmittingOtp(true);
        try { await registerApi.submitOtp(awaitingOtpRow.id, otp); setOtpInput(''); await loadQueue(); }
        catch (err) { setOtpError(err.message || 'Could not verify OTP'); }
        finally { setSubmittingOtp(false); }
    };
    const handleCancelActive = async () => {
        if (!activeRow) return;
        if (!window.confirm('Cancel registration for this account?')) return;
        try { await registerApi.cancel(activeRow.id); setOtpInput(''); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not cancel', 'error'); }
    };
    const handleRemove = async (id) => {
        if (!window.confirm('Remove this queued number?')) return;
        try { await registerApi.remove(id); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not remove', 'error'); }
    };
    const handleRequeue = async (id) => {
        try { await registerApi.requeue(id); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not re-queue', 'error'); }
    };
    const handleClearQueued = async () => {
        if (!window.confirm('Remove all queued (not yet started) numbers? Finished results are kept.')) return;
        try { await registerApi.clear(); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not clear queue', 'error'); }
    };
    const handlePause = async () => {
        try { await registerApi.pause(); setPaused(true); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not pause', 'error'); }
    };
    const handleResume = async () => {
        try { await registerApi.resume(); setPaused(false); await loadQueue(); }
        catch (err) { addToast(err.message || 'Could not resume', 'error'); }
    };

    if (!open) return null;

    return (
        <div className='modal-overlay' role='dialog' aria-modal='true' aria-labelledby='register-modal-title' onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className='modal-panel max-w-3xl'>
                <div className='modal-header'>
                    <div className='min-w-0'>
                        <h2 id='register-modal-title' className='page-title'>Register Account</h2>
                        <p className='page-description'>Sequential registration — one account at a time. Next begins only after the current is successfully created, failed, or verified.</p>
                    </div>
                    <button className='btn-ghost shrink-0' onClick={onClose} aria-label='Close register account dialog'><X className='h-3.5 w-3.5' /></button>
                </div>

                <div className='modal-body'>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                        <div className='card p-2 text-center'><p className='stat-label'>Total</p><p className='stat-value text-base'>{stats.total}</p></div>
                        <div className='card p-2 text-center'><p className='stat-label'>Processing</p><p className='stat-value text-base text-yellow-300'>{stats.processing}</p></div>
                        <div className='card p-2 text-center'><p className='stat-label'>Created</p><p className='stat-value text-base text-accent'>{stats.success}</p></div>
                        <div className='card p-2 text-center'><p className='stat-label'>Failed</p><p className='stat-value text-base text-red-300'>{stats.failed + stats.unknown}</p></div>
                        <div className='card p-2 text-center'><p className='stat-label'>Remaining</p><p className='stat-value text-base'>{stats.remaining}</p></div>
                    </div>

                    <div>
                        <label className='label' htmlFor='reg-password'>Shared registration password</label>
                        <p className='mb-1 text-xs text-light/50'>Same value for every number (register.js line 1).</p>
                        <div className='flex items-center gap-2 max-w-md'>
                            <input id='reg-password' className='input' type={showPassword ? 'text' : 'password'} autoComplete='new-password' value={sharedPassword} onChange={e => setSharedPassword(e.target.value)} placeholder='Registration password' />
                            <button className='btn-ghost shrink-0' onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide' : 'Show'}>
                                {showPassword ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                            </button>
                        </div>
                    </div>

                    <div className='card overflow-hidden'>
                        <div className='flex border-b border-light/10'>
                            <button className={cn('flex-1 px-4 py-2.5 text-sm font-medium transition-colors', inputTab === 'manual' ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-light/60 hover:text-light')} onClick={() => setInputTab('manual')}>
                                <Phone className='inline h-4 w-4 mr-2' />Manual Entry
                            </button>
                            <button className={cn('flex-1 px-4 py-2.5 text-sm font-medium transition-colors', inputTab === 'txt' ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-light/60 hover:text-light')} onClick={() => setInputTab('txt')}>
                                <FileText className='inline h-4 w-4 mr-2' />Import TXT
                            </button>
                        </div>
                        <div className='p-4'>
                            {inputTab === 'manual' && (
                                <div className='space-y-2'>
                                    <label className='label' htmlFor='manual-phone'>Phone number</label>
                                    <div className='flex gap-2'>
                                        <input id='manual-phone' className='input flex-1' placeholder='e.g. 09171234567' value={manualPhone} onChange={e => setManualPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleManualAdd(); }} />
                                        <button className='btn btn-primary shrink-0' onClick={handleManualAdd} disabled={actionBusy === 'manual'}>
                                            {actionBusy === 'manual' ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />} Add
                                        </button>
                                    </div>
                                    {manualError && <p className='mt-1 text-xs text-red-300'>{manualError}</p>}
                                    <p className='text-xs text-light/40'>Switching tabs preserves the queued numbers.</p>
                                </div>
                            )}
                            {inputTab === 'txt' && (
                                <div className='space-y-3'>
                                    <div className={cn('rounded-md border border-dashed p-5 text-center transition-colors', dropActive ? 'border-accent bg-accent/5' : 'border-light/15')} onDragOver={e => { e.preventDefault(); setDropActive(true); }} onDragLeave={() => setDropActive(false)} onDrop={onTxtDrop}>
                                        <Upload className='mx-auto h-6 w-6 text-light/40' />
                                        <p className='mt-2 text-sm text-light/70'>Drag and drop a .txt file here</p>
                                        <p className='text-xs text-light/40'>One phone number per line. # comments and blank lines are ignored.</p>
                                        <button className='btn-ghost mt-3' onClick={() => fileInputRef.current?.click()}>or choose a file</button>
                                        <input ref={fileInputRef} type='file' accept='.txt,text/plain' className='hidden' onChange={e => handleTxtFiles(e.target.files)} />
                                        {txtFile && <p className='mt-2 text-xs text-light/60'>Selected: {txtFile.name}</p>}
                                    </div>
                                    <div>
                                        <label className='label' htmlFor='txt-raw'>Phone numbers (one per line)</label>
                                        <textarea id='txt-raw' className='input h-28 resize-y font-mono text-xs' spellCheck='false' value={txtRaw} onChange={e => handleTxtTextChange(e.target.value)} placeholder={'09171234567\n09998887777\n# comments ignored'} />
                                    </div>
                                    {txtPreview && (
                                        <div className='space-y-2'>
                                            <div className='grid grid-cols-3 gap-2'>
                                                <div className='card p-2 text-center'><p className='stat-label'>Valid</p><p className='stat-value text-accent text-base'>{txtPreview.valid.length}</p></div>
                                                <div className='card p-2 text-center'><p className='stat-label'>Invalid</p><p className='stat-value text-yellow-300 text-base'>{txtPreview.invalid.length}</p></div>
                                                <div className='card p-2 text-center'><p className='stat-label'>Duplicates</p><p className='stat-value text-red-300 text-base'>{txtPreview.duplicates}</p></div>
                                            </div>
                                            {txtPreview.valid.length > 0 && (
                                                <div className='max-h-32 overflow-y-auto rounded-md border border-light/10 p-3'>
                                                    <p className='stat-label'>Ready to queue ({txtPreview.valid.length})</p>
                                                    <ul className='mt-2 space-y-1 font-mono text-xs text-light/70'>
                                                        {txtPreview.valid.slice(0, 100).map(v => <li key={v.phone}>{v.phone}</li>)}
                                                        {txtPreview.valid.length > 100 && <li className='text-light/40'>…and {txtPreview.valid.length - 100} more</li>}
                                                    </ul>
                                                </div>
                                            )}
                                            {txtPreview.invalid.length > 0 && (
                                                <div className='max-h-24 overflow-y-auto rounded-md border border-yellow-500/20 p-3'>
                                                    <p className='stat-label text-yellow-300'>Invalid lines</p>
                                                    <ul className='mt-2 space-y-1 text-xs text-yellow-200/70'>
                                                        {txtPreview.invalid.slice(0, 50).map((r, i) => <li key={i}>Line {r.line}: {r.raw} — {r.reason}</li>)}
                                                    </ul>
                                                </div>
                                            )}
                                            {txtPreview.valid.length === 0 && (
                                                <div className='flex items-start gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-light/60'>
                                                    <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-yellow-300' /> Nothing valid to queue.
                                                </div>
                                            )}
                                            <div className='flex justify-end gap-2'>
                                                <button className='btn-ghost' onClick={() => { setTxtPreview(null); setTxtRaw(''); setTxtFile(null); }}>Clear</button>
                                                <button className='btn btn-primary' disabled={txtPreview.valid.length === 0 || actionBusy === 'txt'} onClick={handleTxtEnqueue}>
                                                    {actionBusy === 'txt' ? <Loader2 className='h-4 w-4 animate-spin' /> : null} Add {txtPreview.valid.length} to queue
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {awaitingOtpRow && (
                        <div className='card border-accent/30 bg-accent/5 p-4'>
                            <div className='flex items-start gap-3'>
                                <ShieldCheck className='h-5 w-5 shrink-0 text-accent mt-0.5' />
                                <div className='flex-1 min-w-0'>
                                    <h3 className='text-sm font-semibold text-light'>OTP verification required</h3>
                                    <p className='mt-1 text-xs text-light/60'>SMS sent to <span className='font-mono text-light'>{awaitingOtpRow.phoneMasked}</span>. Enter the code from that phone.</p>
                                    {awaitingOtpRow.error && <p className='mt-2 text-xs text-yellow-300'>{awaitingOtpRow.error}</p>}
                                    {awaitingOtpRow.otpStatus !== 'pending' && awaitingOtpRow.otpStatus !== 'delivered' && (
                                        <p className='mt-1 text-xs text-red-300'>OTP status: {OTP_META[awaitingOtpRow.otpStatus] || awaitingOtpRow.otpStatus} — retry or cancel.</p>
                                    )}
                                    <div className='mt-3 flex flex-wrap items-end gap-2'>
                                        <div className='flex-1 min-w-[160px] max-w-xs'>
                                            <label className='label' htmlFor='otp-input'>OTP code</label>
                                            <input id='otp-input' className='input font-mono tracking-widest' placeholder='Enter OTP' autoComplete='one-time-code' value={otpInput} onChange={e => setOtpInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSubmitOtp(); }} disabled={submittingOtp} />
                                        </div>
                                        <button className='btn btn-primary' onClick={handleSubmitOtp} disabled={submittingOtp || !otpInput.trim()}>
                                            {submittingOtp ? <Loader2 className='h-4 w-4 animate-spin' /> : <ShieldCheck className='h-4 w-4' />} Submit OTP
                                        </button>
                                        <button className='btn-ghost' onClick={handleCancelActive} disabled={submittingOtp}>Cancel</button>
                                    </div>
                                    {otpError && <p className='mt-2 text-xs text-red-300'>{otpError}</p>}
                                    <p className='mt-2 text-xs text-light/40'>Attempt {awaitingOtpRow.otpAttemptCount + 1} of 5.</p>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeRow && activeRow.status === 'verifying_otp' && (
                        <div className='card border-yellow-500/20 bg-yellow-500/5 p-3 flex items-center gap-3'><Loader2 className='h-5 w-5 animate-spin text-yellow-300' /><p className='text-sm text-light/80'>Verifying OTP for <span className='font-mono'>{activeRow.phoneMasked}</span>…</p></div>
                    )}
                    {activeRow && activeRow.status === 'journey_started' && (
                        <div className='card border-light/10 p-3 flex items-center gap-3'><Loader2 className='h-5 w-5 animate-spin text-light/40' /><p className='text-sm text-light/60'>Starting <span className='font-mono text-light'>{activeRow.phoneMasked}</span>… sending OTP</p></div>
                    )}
                    {error && <p className='text-xs text-red-300'>{error}</p>}

                    <div className='card overflow-hidden'>
                        <div className='flex flex-wrap items-center justify-between gap-2 p-3 border-b border-light/10'>
                            <h3 className='text-sm font-semibold text-light'>Registration queue</h3>
                            <div className='flex flex-wrap items-center gap-2'>
                                <button className='btn btn-primary' onClick={handleStart} disabled={starting || !!activeRow || stats.queued === 0 || paused}>
                                    {starting ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Play className='h-3.5 w-3.5' />} Start
                                </button>
                                <button className='btn-ghost' onClick={paused ? handleResume : handlePause} title={paused ? 'Resume' : 'Pause'}>
                                    {paused ? <Play className='h-3.5 w-3.5' /> : <Pause className='h-3.5 w-3.5' />}{paused ? ' Resume' : ' Pause'}
                                </button>
                                <button className='btn-ghost' onClick={loadQueue} title='Refresh'><RefreshCw className='h-3.5 w-3.5' /></button>
                                {stats.queued > 0 && <button className='btn-ghost text-xs' onClick={handleClearQueued}>Clear queued</button>}
                            </div>
                        </div>
                        <div className='overflow-x-auto'>
                            <table className='table'>
                                <thead><tr><th>Phone Number</th><th>Registration Status</th><th>OTP Status</th><th>Started At</th><th>Completed At</th><th>Result</th><th className='text-right'>Actions</th></tr></thead>
                                <tbody>
                                    {loading && <tr><td colSpan={7} className='py-8 text-center text-light/40'>Loading…</td></tr>}
                                    {!loading && queue.length === 0 && <tr><td colSpan={7} className='py-8 text-center text-light/60 text-sm'>No numbers queued yet. Switch tabs to add numbers without losing the queue.</td></tr>}
                                    {!loading && queue.map((row) => {
                                        const isActive = ['journey_started', 'awaiting_otp', 'verifying_otp'].includes(row.status);
                                        return (
                                            <tr key={row.id} className={isActive ? 'bg-accent/10' : ''}>
                                                <td className='font-mono text-light'>{row.phoneMasked}{isActive && <span className='ml-2 inline-flex h-1.5 w-1.5 rounded-full bg-accent animate-pulse' aria-hidden />}</td>
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
                                                        {row.status === 'queued' && <button className='btn-ghost px-2 py-1 text-xs' onClick={() => handleRemove(row.id)} title='Remove'><Trash2 className='h-3.5 w-3.5' /></button>}
                                                        {['failed', 'cancelled', 'unknown'].includes(row.status) && <button className='btn-ghost px-2 py-1 text-xs' onClick={() => handleRequeue(row.id)} title='Re-queue'><RotateCcw className='h-3.5 w-3.5' /></button>}
                                                        {isActive && <button className='btn-ghost px-2 py-1 text-xs text-red-300' onClick={handleCancelActive} title='Cancel'><X className='h-3.5 w-3.5' /></button>}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {isQueueFinished && queue.length > 0 && (
                        <div className='card border-accent/20 bg-accent/5 p-3'>
                            <h3 className='text-sm font-semibold text-light flex items-center gap-2'><CheckCircle2 className='h-4 w-4 text-accent' /> Queue complete</h3>
                            <p className='mt-1 text-xs text-light/60'>{stats.success} account{stats.success === 1 ? '' : 's'} successfully created{stats.failed > 0 ? `, ${stats.failed} failed` : ''}{stats.unknown > 0 ? `, ${stats.unknown} require verification` : ''}{stats.cancelled > 0 ? `, ${stats.cancelled} cancelled` : ''}.{stats.success > 0 ? ' Created accounts appear in the Accounts table.' : ''}</p>
                            {stats.unknown > 0 && <p className='mt-2 text-xs text-yellow-300'>Uncertain results: verify those accounts with a login before re-running.</p>}
                        </div>
                    )}
                </div>

                <div className='modal-footer'>
                    <button className='btn-ghost' onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}