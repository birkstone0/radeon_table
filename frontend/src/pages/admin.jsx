// User Management page: administrator-only interface for managing users,
// roles, timed access, and trial operation quotas.
import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { cn } from '../styles/utils';
import {
    UserPlus, Shield, Ban, RefreshCw, Search, CheckCircle2, XCircle, AlertTriangle,
    Pencil, KeyRound, Trash2, Clock
} from 'lucide-react';

const DURATION_OPTIONS = [
    { value: '20m', label: '20 minutes' },
    { value: '1h', label: '1 hour' },
    { value: '1d', label: '1 day' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'custom', label: 'Custom duration…' }
];

const UNLIMITED_DURATION_OPTIONS = [
    { value: '1d', label: '1 day' },
    { value: '3d', label: '3 days' },
    { value: '7d', label: '7 days' },
    { value: '14d', label: '14 days' },
    { value: '30d', label: '30 days' },
    { value: 'custom', label: 'Custom duration…' },
    { value: 'none', label: 'No expiration' }
];

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatExpiry(value) {
    if (!value) return '—';
    const date = new Date(value);
    const ms = date.getTime() - Date.now();
    const label = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (ms <= 0) return `${label} (expired)`;
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${label} · ${mins}m`;
    if (mins < 24 * 60) return `${label} · ${Math.floor(mins / 60)}h`;
    return `${label} · ${Math.floor(mins / (24 * 60))}d`;
}

function formatDurationLabel(value) {
    if (typeof value !== 'number') return String(value || '—');
    const mins = Math.round(value / 60000);
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / (24 * 60))}d`;
}

function userStatusLabel(user) {
    if (user.status === 'deactivated') return { label: 'Suspended', cls: 'badge-danger' };
    if (user.status === 'revoked') return { label: 'Revoked', cls: 'badge-warning' };
    if (user.role !== 'user') return { label: 'Active', cls: 'badge-success' };
    if (user.accessType === 'unlimited') {
        if (user.unlimitedAccessExpired) return { label: 'Unlimited Expired', cls: 'badge-danger' };
        if (!user.unlimitedAccessExpiresAt) return { label: 'Unlimited', cls: 'badge-success' };
        return { label: 'Unlimited', cls: 'badge-success' };
    }
    if (user.accessExpired) return { label: 'Expired', cls: 'badge-danger' };
    if (user.accessExpiresAt) return { label: 'Trial', cls: 'badge-success' };
    return { label: 'Active', cls: 'badge-neutral' };
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }) {
    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
            <div className='card w-full max-w-sm overflow-hidden bg-base'>
                <div className='px-5 py-4'>
                    <h3 className='text-sm font-semibold text-light'>{title}</h3>
                    <p className='mt-2 text-sm text-light/60'>{message}</p>
                </div>
                <div className='flex justify-end gap-2 border-t border-light/10 px-5 py-3'>
                    <button className='btn btn-ghost' onClick={onCancel}>Cancel</button>
                    <button className='btn btn-danger' onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    );
}

function EditAccessModal({ user, onClose, onSaved, onError }) {
    const isAdminUser = user.role === 'admin';
    const [accessType, setAccessType] = useState(user.accessType || 'limited'); // 'limited' | 'unlimited'
    const [durationMode, setDurationMode] = useState('none'); // 'none', 'preset', 'days'
    const [durationPreset, setDurationPreset] = useState('');
    const [customMinutes, setCustomMinutes] = useState('');
    const [days, setDays] = useState('');
    const [extend, setExtend] = useState(false);
    const [unlimitedDurationMode, setUnlimitedDurationMode] = useState('none'); // 'none', 'preset', 'days'
    const [unlimitedDurationPreset, setUnlimitedDurationPreset] = useState('');
    const [unlimitedCustomMinutes, setUnlimitedCustomMinutes] = useState('');
    const [unlimitedDays, setUnlimitedDays] = useState('');
    const [unlimitedExtend, setUnlimitedExtend] = useState(false);
    const [updateClaimTrials, setUpdateClaimTrials] = useState(false);
    const [claimTrials, setClaimTrials] = useState(user.trials?.claim_daily_reward ?? 0);
    const [updateBalanceTrials, setUpdateBalanceTrials] = useState(false);
    const [balanceTrials, setBalanceTrials] = useState(user.trials?.check_balance ?? 0);
    const [updateMaxAccounts, setUpdateMaxAccounts] = useState(false);
    const [maxAccounts, setMaxAccounts] = useState(user.maxAccountsPerBatch ?? 50);
    const [status, setStatus] = useState(user.status || 'active');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [confirmingNoExpiration, setConfirmingNoExpiration] = useState(false);

    // Calculate preview expiry for limited access
    const previewExpiry = () => {
        if (durationMode === 'none') return user.accessExpiresAt ? formatExpiry(user.accessExpiresAt) : '—';

        let ms = 0;
        if (durationMode === 'days') {
            const daysNum = Number(days);
            if (!Number.isFinite(daysNum) || daysNum < 0) return 'Invalid days';
            ms = Math.round(daysNum * 24 * 60 * 60 * 1000);
        } else if (durationMode === 'preset') {
            if (durationPreset === 'custom') {
                const mins = Number(customMinutes);
                if (!Number.isFinite(mins) || mins <= 0) return 'Invalid duration';
                ms = Math.round(mins * 60000);
            } else {
                const DURATION_MS = {
                    '20m': 20 * 60 * 1000,
                    '1h': 60 * 60 * 1000,
                    '1d': 24 * 60 * 60 * 1000,
                    '7d': 7 * 24 * 60 * 60 * 1000,
                    '30d': 30 * 24 * 60 * 60 * 1000
                };
                ms = DURATION_MS[durationPreset] || 0;
            }
        }

        if (ms === 0) return 'Expires now';

        const base = extend && user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() > Date.now()
            ? new Date(user.accessExpiresAt).getTime()
            : Date.now();
        const newExpiry = new Date(base + ms);
        return formatExpiry(newExpiry);
    };

    // Calculate preview expiry for unlimited access
    const previewUnlimitedExpiry = () => {
        if (unlimitedDurationMode === 'none') return user.unlimitedAccessExpiresAt ? formatExpiry(user.unlimitedAccessExpiresAt) : 'No expiration';

        if (unlimitedDurationPreset === 'none') return 'No expiration';

        let ms = 0;
        if (unlimitedDurationMode === 'days') {
            const daysNum = Number(unlimitedDays);
            if (!Number.isFinite(daysNum) || daysNum < 0) return 'Invalid days';
            ms = Math.round(daysNum * 24 * 60 * 60 * 1000);
        } else if (unlimitedDurationMode === 'preset') {
            if (unlimitedDurationPreset === 'custom') {
                const mins = Number(unlimitedCustomMinutes);
                if (!Number.isFinite(mins) || mins <= 0) return 'Invalid duration';
                ms = Math.round(mins * 60000);
            } else {
                const DURATION_MS = {
                    '1d': 24 * 60 * 60 * 1000,
                    '3d': 3 * 24 * 60 * 60 * 1000,
                    '7d': 7 * 24 * 60 * 60 * 1000,
                    '14d': 14 * 24 * 60 * 60 * 1000,
                    '30d': 30 * 24 * 60 * 60 * 1000
                };
                ms = DURATION_MS[unlimitedDurationPreset] || 0;
            }
        }

        if (ms === 0) return 'Expires now';

        const base = unlimitedExtend && user.unlimitedAccessExpiresAt && new Date(user.unlimitedAccessExpiresAt).getTime() > Date.now()
            ? new Date(user.unlimitedAccessExpiresAt).getTime()
            : Date.now();
        const newExpiry = new Date(base + ms);
        return formatExpiry(newExpiry);
    };

    const save = async () => {
        setSaving(true);
        setError('');
        try {
            const payload = { status };

            // Handle access type change
            if (accessType !== (user.accessType || 'limited')) {
                payload.accessType = accessType;
            }

            // Handle unlimited access duration
            if (accessType === 'unlimited' && unlimitedDurationMode !== 'none') {
                if (unlimitedDurationPreset === 'none') {
                    // No expiration
                    payload.unlimitedDuration = null;
                    payload.unlimitedExtend = false;
                } else {
                    let durationMs = null;
                    if (unlimitedDurationMode === 'days') {
                        const daysNum = Number(unlimitedDays);
                        if (!Number.isFinite(daysNum) || daysNum < 0) throw new Error('Enter a valid number of days (0 or more)');
                        durationMs = Math.round(daysNum * 24 * 60 * 60 * 1000);
                    } else if (unlimitedDurationMode === 'preset') {
                        if (unlimitedDurationPreset === 'custom') {
                            const mins = Number(unlimitedCustomMinutes);
                            if (!Number.isFinite(mins) || mins <= 0) throw new Error('Enter a valid custom duration in minutes');
                            durationMs = Math.round(mins * 60000);
                        } else {
                            const DURATION_MS = {
                                '1d': 24 * 60 * 60 * 1000,
                                '3d': 3 * 24 * 60 * 60 * 1000,
                                '7d': 7 * 24 * 60 * 60 * 1000,
                                '14d': 14 * 24 * 60 * 60 * 1000,
                                '30d': 30 * 24 * 60 * 60 * 1000
                            };
                            durationMs = DURATION_MS[unlimitedDurationPreset] || 0;
                        }
                    }
                    payload.unlimitedDuration = durationMs;
                    payload.unlimitedExtend = unlimitedExtend;
                }
            }

            // Handle limited access duration (only for limited access type)
            if (accessType === 'limited' && durationMode !== 'none') {
                if (durationMode === 'days') {
                    const daysNum = Number(days);
                    if (!Number.isFinite(daysNum) || daysNum < 0) throw new Error('Enter a valid number of days (0 or more)');
                    const durationMs = Math.round(daysNum * 24 * 60 * 60 * 1000);
                    payload.duration = durationMs;
                    payload.extend = extend;
                } else if (durationMode === 'preset' && durationPreset) {
                    let durationMs = null;
                    if (durationPreset === 'custom') {
                        const mins = Number(customMinutes);
                        if (!Number.isFinite(mins) || mins <= 0) throw new Error('Enter a valid custom duration in minutes');
                        durationMs = Math.round(mins * 60000);
                    } else {
                        durationMs = durationPreset;
                    }
                    payload.duration = durationMs;
                    payload.extend = extend;
                }
            }

            // Only include trials for selected checkboxes
            const trials = {};
            if (updateClaimTrials) {
                trials.claim_daily_reward = Number(claimTrials) || 0;
            }
            if (updateBalanceTrials) {
                trials.check_balance = Number(balanceTrials) || 0;
            }
            if (Object.keys(trials).length > 0) {
                payload.trials = trials;
            }

            // Only include max accounts if checkbox is selected
            if (updateMaxAccounts) {
                const maxNum = Number(maxAccounts);
                if (!Number.isFinite(maxNum) || maxNum < 1 || maxNum > 10000) {
                    throw new Error('Max accounts per batch must be between 1 and 10000');
                }
                payload.maxAccountsPerBatch = maxNum;
            }

            // Require at least one change
            const hasAccessTypeChange = accessType !== (user.accessType || 'limited');
            const hasDurationChange = (accessType === 'limited' && durationMode !== 'none') ||
                                     (accessType === 'unlimited' && unlimitedDurationMode !== 'none');
            if (!hasAccessTypeChange && !hasDurationChange && Object.keys(trials).length === 0 && !updateMaxAccounts && status === user.status) {
                throw new Error('Make at least one change to save');
            }

            await adminApi.updateAccess(user.id, payload);
            onSaved();
        } catch (err) {
            setError(err.message || 'Failed to update access');
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        setSaving(true);
        setError('');
        try {
            await adminApi.updateAccess(user.id, { revokeAccess: true });
            onSaved();
        } catch (err) {
            setError(err.message || 'Failed to revoke access');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6'>
            <div className='card flex max-h-full w-full max-w-md flex-col overflow-hidden bg-base'>
                <div className='flex items-center justify-between border-b border-light/10 px-5 py-4'>
                    <div>
                        <h2 className='text-base font-semibold text-light'>Edit Access — {user.username}</h2>
                        <p className='text-xs text-light/50'>Manage timed access and trial operation quotas.</p>
                    </div>
                    <button onClick={onClose} className='p-2 text-light/60 hover:text-light rounded hover:bg-white/10'>
                        <XCircle className='w-4 h-4' />
                    </button>
                </div>

                <div className='flex-1 space-y-4 overflow-y-auto px-5 py-4'>
                    {/* Current state */}
                    <div className='grid grid-cols-2 gap-3'>
                        <div>
                            <p className='label'>Status</p>
                            <select value={status} onChange={(e) => setStatus(e.target.value)} className='input'>
                                <option value='active'>Active</option>
                                <option value='deactivated'>Suspended</option>
                                <option value='revoked'>Revoked</option>
                            </select>
                        </div>
                        <div>
                            <p className='label'>Access expires</p>
                            <p className='text-sm text-light'>{formatExpiry(user.accessExpiresAt)}</p>
                        </div>
                        <div>
                            <p className='label'>Activated</p>
                            <p className='text-sm text-light/70'>{formatDate(user.accessActivatedAt)}</p>
                        </div>
                        <div>
                            <p className='label'>Role</p>
                            <p className='text-sm capitalize text-light'>{user.role}</p>
                        </div>
                    </div>

                    <div className='divider my-1' />

                    {/* Access Type */}
                    {!isAdminUser && (
                        <div>
                            <p className='label'>Access Type</p>
                            <div className='grid grid-cols-2 gap-2'>
                                <button
                                    type='button'
                                    onClick={() => {
                                        setAccessType('limited');
                                        setUnlimitedDurationMode('none');
                                        setUnlimitedDurationPreset('');
                                    }}
                                    className={cn(
                                        'btn btn-ghost text-xs',
                                        accessType === 'limited' ? 'btn-primary' : ''
                                    )}
                                >
                                    Limited Access
                                </button>
                                <button
                                    type='button'
                                    onClick={() => {
                                        setAccessType('unlimited');
                                        setDurationMode('none');
                                        setDurationPreset('');
                                    }}
                                    className={cn(
                                        'btn btn-ghost text-xs',
                                        accessType === 'unlimited' ? 'btn-primary' : ''
                                    )}
                                >
                                    Unlimited Access
                                </button>
                            </div>
                            {accessType === 'unlimited' && (
                                <p className='mt-2 text-xs text-light/60'>
                                    User can perform unlimited operations without trial quota deductions.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Unlimited Access Duration */}
                    {accessType === 'unlimited' && !isAdminUser && (
                        <div>
                            <p className='label'>Unlimited Access Duration</p>
                            <div className='space-y-3'>
                                <div className='grid grid-cols-3 gap-2'>
                                    <button
                                        type='button'
                                        onClick={() => { setUnlimitedDurationMode('none'); setUnlimitedDurationPreset(''); setUnlimitedDays(''); }}
                                        className={cn(
                                            'btn btn-ghost text-xs',
                                            unlimitedDurationMode === 'none' ? 'btn-primary' : ''
                                        )}
                                    >
                                        No change
                                    </button>
                                    <button
                                        type='button'
                                        onClick={() => { setUnlimitedDurationMode('days'); setUnlimitedDurationPreset(''); }}
                                        className={cn(
                                            'btn btn-ghost text-xs',
                                            unlimitedDurationMode === 'days' ? 'btn-primary' : ''
                                        )}
                                    >
                                        Exact days
                                    </button>
                                    <button
                                        type='button'
                                        onClick={() => { setUnlimitedDurationMode('preset'); setUnlimitedDays(''); }}
                                        className={cn(
                                            'btn btn-ghost text-xs',
                                            unlimitedDurationMode === 'preset' ? 'btn-primary' : ''
                                        )}
                                    >
                                        Preset
                                    </button>
                                </div>

                                {unlimitedDurationMode === 'days' && (
                                    <div className='grid grid-cols-2 gap-2'>
                                        <input
                                            type='number'
                                            min='0'
                                            step='1'
                                            placeholder='Days (e.g., 7, 14, 0)'
                                            value={unlimitedDays}
                                            onChange={(e) => setUnlimitedDays(e.target.value)}
                                            className='input'
                                        />
                                        <label className='mt-2 flex items-center gap-2 text-xs text-light/70'>
                                            <input
                                                type='checkbox'
                                                checked={unlimitedExtend}
                                                onChange={(e) => setUnlimitedExtend(e.target.checked)}
                                                className='accent-accent'
                                            />
                                            Extend from current expiry
                                        </label>
                                    </div>
                                )}

                                {unlimitedDurationMode === 'preset' && (
                                    <div className='grid grid-cols-2 gap-2'>
                                        <select value={unlimitedDurationPreset} onChange={(e) => setUnlimitedDurationPreset(e.target.value)} className='input'>
                                            <option value=''>Select preset…</option>
                                            {UNLIMITED_DURATION_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                        {unlimitedDurationPreset === 'custom' && (
                                            <input
                                                type='number'
                                                min='1'
                                                placeholder='Minutes'
                                                value={unlimitedCustomMinutes}
                                                onChange={(e) => setUnlimitedCustomMinutes(e.target.value)}
                                                className='input'
                                            />
                                        )}
                                        {unlimitedDurationPreset && (
                                            <label className='mt-2 flex items-center gap-2 text-xs text-light/70 col-span-2'>
                                                <input
                                                    type='checkbox'
                                                    checked={unlimitedExtend}
                                                    onChange={(e) => setUnlimitedExtend(e.target.checked)}
                                                    className='accent-accent'
                                                />
                                                Extend from current expiry (don't reset)
                                            </label>
                                        )}
                                    </div>
                                )}

                                {(unlimitedDurationMode === 'days' || (unlimitedDurationMode === 'preset' && unlimitedDurationPreset)) && (
                                    <>
                                        <p className='text-xs text-accent'>
                                            Current expiry: {user.unlimitedAccessExpiresAt ? formatExpiry(user.unlimitedAccessExpiresAt) : 'No expiration'}
                                        </p>
                                        <p className='text-xs text-accent'>
                                            Resulting expiry: {previewUnlimitedExpiry()}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div className='divider my-1' />

                    {/* Access Duration */}
                    {accessType === 'limited' && (
                        <div>
                        <p className='label'>Access Duration</p>
                        <div className='space-y-3'>
                            {/* Duration mode selector */}
                            <div className='grid grid-cols-3 gap-2'>
                                <button
                                    type='button'
                                    onClick={() => { setDurationMode('none'); setDurationPreset(''); setDays(''); }}
                                    className={cn(
                                        'btn btn-ghost text-xs',
                                        durationMode === 'none' ? 'btn-primary' : ''
                                    )}
                                >
                                    No change
                                </button>
                                <button
                                    type='button'
                                    onClick={() => { setDurationMode('days'); setDurationPreset(''); }}
                                    className={cn(
                                        'btn btn-ghost text-xs',
                                        durationMode === 'days' ? 'btn-primary' : ''
                                    )}
                                >
                                    Exact days
                                </button>
                                <button
                                    type='button'
                                    onClick={() => { setDurationMode('preset'); setDays(''); }}
                                    className={cn(
                                        'btn btn-ghost text-xs',
                                        durationMode === 'preset' ? 'btn-primary' : ''
                                    )}
                                >
                                    Preset
                                </button>
                            </div>

                            {/* Days input */}
                            {durationMode === 'days' && (
                                <div className='grid grid-cols-2 gap-2'>
                                    <input
                                        type='number'
                                        min='0'
                                        step='1'
                                        placeholder='Days (e.g., 3, 7, 0)'
                                        value={days}
                                        onChange={(e) => setDays(e.target.value)}
                                        className='input'
                                    />
                                    <label className='mt-2 flex items-center gap-2 text-xs text-light/70'>
                                        <input
                                            type='checkbox'
                                            checked={extend}
                                            onChange={(e) => setExtend(e.target.checked)}
                                            className='accent-accent'
                                        />
                                        Extend from current expiry
                                    </label>
                                </div>
                            )}

                            {/* Preset selector */}
                            {durationMode === 'preset' && (
                                <div className='grid grid-cols-2 gap-2'>
                                    <select value={durationPreset} onChange={(e) => setDurationPreset(e.target.value)} className='input'>
                                        <option value=''>Select preset…</option>
                                        {DURATION_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    {durationPreset === 'custom' && (
                                        <input
                                            type='number'
                                            min='1'
                                            placeholder='Minutes'
                                            value={customMinutes}
                                            onChange={(e) => setCustomMinutes(e.target.value)}
                                            className='input'
                                        />
                                    )}
                                    {durationPreset && (
                                        <label className='mt-2 flex items-center gap-2 text-xs text-light/70 col-span-2'>
                                            <input
                                                type='checkbox'
                                                checked={extend}
                                                onChange={(e) => setExtend(e.target.checked)}
                                                className='accent-accent'
                                            />
                                            Extend from current expiry (don't reset)
                                        </label>
                                    )}
                                </div>
                            )}

                            {/* Preview */}
                            {(durationMode === 'days' || (durationMode === 'preset' && durationPreset)) && (
                                <p className='text-xs text-accent'>
                                    Current expiry: {user.accessExpiresAt ? formatExpiry(user.accessExpiresAt) : 'Not set'}
                                </p>
                            )}
                            {(durationMode === 'days' || (durationMode === 'preset' && durationPreset)) && (
                                <p className='text-xs text-accent'>
                                    Resulting expiry: {previewExpiry()}
                                </p>
                            )}
                        </div>
                    </div>
                    )}

                    <div className='divider my-1' />

                    {/* Trials */}
                    <div>
                        <p className='label'>Trial operation quotas</p>
                        <div className='space-y-3'>
                            <div className='flex items-start gap-3'>
                                <input
                                    type='checkbox'
                                    id='update-claim-trials'
                                    checked={updateClaimTrials}
                                    onChange={(e) => setUpdateClaimTrials(e.target.checked)}
                                    className='accent-accent mt-1'
                                />
                                <div className='flex-1'>
                                    <label htmlFor='update-claim-trials' className='label cursor-pointer'>Claim Daily Reward</label>
                                    <input
                                        type='number'
                                        min='0'
                                        value={claimTrials}
                                        onChange={(e) => setClaimTrials(e.target.value)}
                                        disabled={!updateClaimTrials}
                                        className='input'
                                    />
                                    <p className='text-xs text-light/50 mt-1'>Current: {isAdminUser ? 'Unlimited' : (user.trials?.claim_daily_reward ?? 0)}</p>
                                </div>
                            </div>
                            <div className='flex items-start gap-3'>
                                <input
                                    type='checkbox'
                                    id='update-balance-trials'
                                    checked={updateBalanceTrials}
                                    onChange={(e) => setUpdateBalanceTrials(e.target.checked)}
                                    className='accent-accent mt-1'
                                />
                                <div className='flex-1'>
                                    <label htmlFor='update-balance-trials' className='label cursor-pointer'>Check Balance</label>
                                    <input
                                        type='number'
                                        min='0'
                                        value={balanceTrials}
                                        onChange={(e) => setBalanceTrials(e.target.value)}
                                        disabled={!updateBalanceTrials}
                                        className='input'
                                    />
                                    <p className='text-xs text-light/50 mt-1'>Current: {isAdminUser ? 'Unlimited' : (user.trials?.check_balance ?? 0)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && <p className='text-xs text-red-300'>{error}</p>}
                </div>

                <div className='flex flex-wrap items-center justify-between gap-2 border-t border-light/10 px-5 py-3'>
                    <button onClick={revoke} disabled={saving} className='btn btn-danger'>
                        Revoke now
                    </button>
                    <div className='flex gap-2'>
                        <button onClick={onClose} className='btn btn-ghost'>Cancel</button>
                        <button onClick={save} disabled={saving} className='btn btn-primary'>
                            {saving ? <RefreshCw className='w-4 h-4 animate-spin' /> : 'Save'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function UserManagementPage() {
    const [users, setUsers] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(25);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [roleFilter, setRoleFilter] = useState('');

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ username: '', password: '', role: 'user', temporaryPassword: true });
    const [creating, setCreating] = useState(false);

    const [editTarget, setEditTarget] = useState(null);

    const [confirm, setConfirm] = useState(null); // { title, message, confirmLabel, action }

    const loadUsers = useCallback(
        async (overrides = {}) => {
            setLoading(true);
            setError('');
            const params = {
                page: overrides.page === undefined ? page : overrides.page,
                limit,
                ...(search ? { search } : {}),
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(roleFilter ? { role: roleFilter } : {})
            };
            try {
                const { data } = await adminApi.users(params);
                setUsers(data.items);
                setTotal(data.total);
                if (overrides.page !== undefined) setPage(overrides.page);
            } catch (err) {
                setError(err.message || 'Failed to load users');
            } finally {
                setLoading(false);
            }
        },
        [page, limit, search, statusFilter, roleFilter]
    );

    useEffect(() => {
        loadUsers({ page: 1 });
    }, [search, statusFilter, roleFilter]);

    const applyFilter = (event) => {
        event.preventDefault();
        loadUsers({ page: 1 });
    };

    const handleCreate = async (event) => {
        event.preventDefault();
        setCreating(true);
        setError('');
        try {
            await adminApi.createUser(createForm);
            setCreateForm({ username: '', password: '', role: 'user', temporaryPassword: true });
            setShowCreate(false);
            loadUsers({ page: 1 });
        } catch (err) {
            setError(err.message || 'Failed to create user');
        } finally {
            setCreating(false);
        }
    };

    const handleActivate = async (userId) => {
        try {
            await adminApi.activateUser(userId);
            loadUsers({ page });
        } catch (err) {
            setError(err.message || 'Failed to activate user');
        }
    };

    const handleDeactivate = async (userId) => {
        setConfirm({
            title: 'Suspend user',
            message: 'This immediately ends access and logs the user out. Continue?',
            confirmLabel: 'Suspend',
            action: async () => {
                await adminApi.deactivateUser(userId);
                loadUsers({ page });
            }
        });
    };

    const handleRevoke = async (userId) => {
        setConfirm({
            title: 'Revoke user',
            message: 'This permanently revokes access and ends their sessions. Continue?',
            confirmLabel: 'Revoke',
            action: async () => {
                await adminApi.revokeUser(userId);
                loadUsers({ page });
            }
        });
    };

    const handleResetPassword = async (userId) => {
        setConfirm({
            title: 'Reset password',
            message: 'Generate a new temporary password for this user? Their current sessions will end.',
            confirmLabel: 'Reset',
            action: async () => {
                const { data } = await adminApi.resetPassword(userId, {});
                setError(`Temporary password: ${data.temporaryPassword}`);
                loadUsers({ page });
            }
        });
    };

    const handleDelete = async (userId) => {
        setConfirm({
            title: 'Delete user',
            message: 'Permanently delete this user and all their records? This cannot be undone.',
            confirmLabel: 'Delete',
            action: async () => {
                await adminApi.deleteUser(userId);
                loadUsers({ page });
            }
        });
    };

    const runConfirm = async () => {
        if (!confirm) return;
        try {
            await confirm.action();
        } catch (err) {
            setError(err.message || 'Action failed');
        } finally {
            setConfirm(null);
        }
    };

    return (
        <div className='page'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                <div className='min-w-0'>
                    <h1 className='page-title'>User Management</h1>
                    <p className='page-description'>Manage console users, roles, timed access, and trial quotas.</p>
                </div>
                <button onClick={() => setShowCreate(true)} className='btn btn-primary sm:w-auto'>
                    <UserPlus className='w-4 h-4' /> Create User
                </button>
            </div>

            <div className='divider' />

            <form onSubmit={applyFilter} className='flex flex-wrap gap-3 mb-4'>
                <div className='flex-1 min-w-[200px]'>
                    <input
                        type='text'
                        placeholder='Search by username...'
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className='input'
                    />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className='input w-auto'>
                    <option value=''>All statuses</option>
                    <option value='active'>Active</option>
                    <option value='deactivated'>Suspended</option>
                    <option value='revoked'>Revoked</option>
                </select>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className='input w-auto'>
                    <option value=''>All roles</option>
                    <option value='admin'>Admin</option>
                    <option value='user'>User</option>
                </select>
                <button type='submit' className='btn btn-ghost'>
                    <Search className='w-4 h-4' />
                </button>
            </form>

            {showCreate && (
                <div className='card p-4 mb-4'>
                    <h3 className='text-sm font-medium text-light mb-3'>Create New User</h3>
                    <form onSubmit={handleCreate} className='grid grid-cols-1 gap-3 sm:grid-cols-4'>
                        <input
                            type='text'
                            placeholder='Username'
                            value={createForm.username}
                            onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                            className='input'
                            required
                            minLength={3}
                            maxLength={32}
                        />
                        <input
                            type='password'
                            placeholder='Password'
                            value={createForm.password}
                            onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                            className='input'
                            required
                            minLength={8}
                        />
                        <select
                            value={createForm.role}
                            onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                            className='input'
                        >
                            <option value='user'>User</option>
                            <option value='admin'>Admin</option>
                        </select>
                        <div className='flex gap-2'>
                            <button type='submit' disabled={creating} className='btn btn-primary flex-1'>
                                {creating ? <RefreshCw className='w-4 h-4 animate-spin' /> : 'Create'}
                            </button>
                            <button type='button' onClick={() => setShowCreate(false)} className='btn btn-ghost'>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {error && <p className='mb-3 text-xs text-yellow-300'>{error}</p>}

            {loading ? (
                <div className='flex items-center justify-center py-12'>
                    <RefreshCw className='w-6 h-6 text-light/40 animate-spin' />
                </div>
            ) : error && users.length === 0 ? (
                <div className='text-red-400 text-sm py-8'>{error}</div>
            ) : users.length === 0 ? (
                <div className='text-light/40 text-sm py-8'>No users found</div>
            ) : (
                <>
                    <div className='overflow-x-auto'>
                        <table className='table'>
                            <thead>
                                <tr>
                                    <th>Username</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                    <th>Access Expires</th>
                                    <th>Claim Trials</th>
                                    <th>Balance Trials</th>
                                    <th className='text-right'>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => {
                                    const st = userStatusLabel(user);
                                    return (
                                        <tr key={user.id}>
                                            <td className='font-medium text-light'>{user.username}</td>
                                            <td>
                                                <span className={cn('badge', user.role === 'admin' ? 'badge-success' : 'badge-neutral')}>
                                                    {user.role === 'admin' ? <><Shield className='w-3 h-3 mr-1' /> Admin</> : 'User'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={cn('badge', st.cls)}>{st.label}</span>
                                            </td>
                                            <td className='text-light/60 text-xs'>{formatExpiry(user.accessExpiresAt)}</td>
                                            <td className='text-light/60'>
                                                {user.role === 'admin'
                                                    ? 'Unlimited'
                                                    : (user.trials?.claim_daily_reward ?? 0)}
                                            </td>
                                            <td className='text-light/60'>
                                                {user.role === 'admin'
                                                    ? 'Unlimited'
                                                    : (user.trials?.check_balance ?? 0)}
                                            </td>
                                            <td>
                                                <div className='flex justify-end gap-1'>
                                                    <button
                                                        onClick={() => setEditTarget(user)}
                                                        className='btn btn-ghost text-xs'
                                                        title='Edit access'
                                                    >
                                                        <Pencil className='w-3.5 h-3.5' /> Edit Access
                                                    </button>
                                                    {user.status === 'active' ? (
                                                        <>
                                                            <button
                                                                onClick={() => handleDeactivate(user.id)}
                                                                className='btn btn-ghost text-xs'
                                                                title='Suspend'
                                                            >
                                                                <Ban className='w-3 h-3' />
                                                            </button>
                                                            <button
                                                                onClick={() => handleRevoke(user.id)}
                                                                className='btn btn-ghost text-xs text-red-300'
                                                                title='Revoke'
                                                            >
                                                                <XCircle className='w-3 h-3' />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleActivate(user.id)}
                                                            className='btn btn-ghost text-xs'
                                                            title='Activate'
                                                        >
                                                            <CheckCircle2 className='w-3 h-3' />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleResetPassword(user.id)}
                                                        className='btn btn-ghost text-xs'
                                                        title='Reset password'
                                                    >
                                                        <KeyRound className='w-3 h-3' />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(user.id)}
                                                        className='btn btn-ghost text-xs text-red-300'
                                                        title='Delete'
                                                    >
                                                        <Trash2 className='w-3 h-3' />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className='flex items-center justify-between mt-4 pt-4 border-t border-light/10'>
                        <div className='text-xs text-light/40'>Showing {users.length} of {total} users</div>
                        <div className='flex gap-2'>
                            <button onClick={() => loadUsers({ page: page - 1 })} disabled={page === 1} className='btn btn-ghost disabled:opacity-50'>
                                Previous
                            </button>
                            <button onClick={() => loadUsers({ page: page + 1 })} disabled={page * limit >= total} className='btn btn-ghost disabled:opacity-50'>
                                Next
                            </button>
                        </div>
                    </div>
                </>
            )}

            {editTarget && (
                <EditAccessModal
                    user={editTarget}
                    onClose={() => setEditTarget(null)}
                    onError={(msg) => setError(msg)}
                    onSaved={() => {
                        setEditTarget(null);
                        setError('Access updated successfully.');
                        loadUsers({ page });
                    }}
                />
            )}

            {confirm && (
                <ConfirmDialog
                    title={confirm.title}
                    message={confirm.message}
                    confirmLabel={confirm.confirmLabel}
                    onCancel={() => setConfirm(null)}
                    onConfirm={runConfirm}
                />
            )}
        </div>
    );
}

export default UserManagementPage;