// Per-account operation progress modal.
//
// - Never auto-closes once all operations finish; results are preserved until
//   the user explicitly dismisses the panel (X or Close).
// - Closing or minimizing does NOT cancel backend processing.
// - Polls the real backend /operations/batch-status endpoint for live statuses.
// - Renders a compact progress bar and per-account rows with queued/processing/
//   success/failed states plus the actual result or error text.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { operationsApi } from '../lib/api';
import { cn } from '../styles/utils';
import {
    CheckCircle2,
    XCircle,
    Clock,
    Loader2,
    LogIn,
    Wallet,
    Gift,
    Minimize2,
    X as XIcon,
    ChevronsUp
} from 'lucide-react';

const STATUS_META = {
    queued: { icon: Clock, label: 'Queued', color: 'text-light/60', row: 'bg-white/5 border-light/10' },
    processing: { icon: Loader2, label: 'Processing', color: 'text-accent', row: 'bg-accent/5 border-accent/25' },
    retrying: { icon: Loader2, label: 'Retrying', color: 'text-yellow-300', row: 'bg-yellow-500/10 border-yellow-500/25' },
    success: { icon: CheckCircle2, label: 'Success', color: 'text-accent', row: 'bg-accent/10 border-accent/25' },
    failed: { icon: XCircle, label: 'Failed', color: 'text-red-300', row: 'bg-red-500/10 border-red-500/25' },
    cancelled: { icon: XCircle, label: 'Cancelled', color: 'text-light/60', row: 'bg-white/5 border-light/10' },
    already_claimed: { icon: CheckCircle2, label: 'Already Claimed', color: 'text-yellow-300', row: 'bg-yellow-500/10 border-yellow-500/25' }
};

function stepIcon(step, type) {
    if (step === 'Logging in') return <LogIn className='w-3.5 h-3.5' />;
    if (step === 'Claiming reward') return <Gift className='w-3.5 h-3.5' />;
    if (step === 'Checking balance') return <Wallet className='w-3.5 h-3.5' />;
    return <Loader2 className='w-3.5 h-3.5 animate-spin' />;
}

function OperationProgressModal({ operationIds, operationType, minimized, onMinimize, onClose }) {
    console.log('[OperationProgressModal] Rendered with props:', { operationIds, operationType, minimized });
    const [operations, setOperations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const intervalRef = useRef(null);

    const pollStatus = useCallback(async () => {
        try {
            const { data } = await operationsApi.batchStatus(operationIds);
            setOperations(data.items || []);
            setError(null);
        } catch (err) {
            console.error('Failed to poll operation status:', err);
            setError(err.message || 'Failed to fetch operation status');
        } finally {
            setLoading(false);
        }
    }, [operationIds]);

    useEffect(() => {
        setLoading(true);
        pollStatus();
        intervalRef.current = setInterval(() => pollStatus(), 1200);
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [pollStatus]);

    const total = operations.length;
    const completed = operations.filter((op) => ['success', 'failed', 'cancelled', 'already_claimed'].includes(op.status)).length;
    const successes = operations.filter((op) => op.status === 'success' || op.status === 'already_claimed').length;
    const failures = operations.filter((op) => op.status === 'failed').length;
    const cancelled = operations.filter((op) => op.status === 'cancelled').length;
    const retrying = operations.filter((op) => op.status === 'retrying').length;
    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (minimized) {
        return (
            <div className='fixed bottom-4 right-4 z-50'>
                <div className='card p-4 shadow-lg border border-accent/30 bg-base/95'>
                    <div className='flex items-center gap-3'>
                        <Loader2 className='w-4 h-4 text-accent animate-spin' />
                        <span className='text-sm text-light'>
                            {completed} of {total} accounts completed
                        </span>
                        <button
                            onClick={onMinimize}
                            className='p-1 text-light/60 hover:text-light'
                        >
                            <ChevronsUp className='w-4 h-4' />
                        </button>
                        <button onClick={onClose} className='p-1 text-light/60 hover:text-light'>
                            <XIcon className='w-4 h-4' />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6'>
            <div className='card w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden shadow-xl border border-light/15 bg-base'>
                <div className='flex items-center justify-between gap-3 border-b border-light/10 px-5 py-4 sm:px-6'>
                    <div className='min-w-0'>
                        <h2 className='text-base font-semibold text-light truncate'>
                            {operationType === 'claim_daily_reward' ? 'Claiming Daily Rewards' : 'Checking Balances'}
                        </h2>
                        <p className='text-xs text-light/50'>
                            {completed} of {total} accounts completed · {successes} succeeded
                            {failures > 0 ? `, ${failures} failed` : ''}
                            {cancelled > 0 ? `, ${cancelled} cancelled` : ''}
                            {retrying > 0 ? `, ${retrying} retrying` : ''}
                        </p>
                    </div>
                    <div className='flex items-center gap-1.5 shrink-0'>
                        <button
                            onClick={onMinimize}
                            className='p-2 text-light/60 hover:text-light rounded hover:bg-white/10'
                            title='Minimize (processing continues)'
                        >
                            <Minimize2 className='w-4 h-4' />
                        </button>
                        <button
                            onClick={onClose}
                            className='p-2 text-light/60 hover:text-light rounded hover:bg-white/10'
                            title='Close (processing continues)'
                        >
                            <XIcon className='w-4 h-4' />
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                <div className='border-b border-light/10 px-5 py-3 sm:px-6'>
                    <div className='h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
                        <div
                            className='h-full rounded-full bg-accent transition-all duration-300'
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                </div>

                <div className='flex-1 overflow-y-auto px-5 py-4 sm:px-6'>
                    {loading && operations.length === 0 ? (
                        <div className='flex items-center justify-center py-10'>
                            <Loader2 className='w-5 h-5 text-light/40 animate-spin' />
                        </div>
                    ) : error && operations.length === 0 ? (
                        <div className='text-red-300 text-sm py-10 text-center'>{error}</div>
                    ) : operations.length === 0 ? (
                        <div className='text-light/40 text-sm py-10 text-center'>No operations to display</div>
                    ) : (
                        <div className='space-y-2'>
                            {operations.map((op) => {
                                const meta = STATUS_META[op.status] || STATUS_META.queued;
                                const Icon = meta.icon;
                                return (
                                    <div
                                        key={op.id}
                                        className={cn('flex items-start gap-3 rounded-lg border p-3', meta.row)}
                                    >
                                        <Icon
                                            className={cn(
                                                'w-5 h-5 mt-0.5 shrink-0',
                                                meta.color,
                                                op.status === 'processing' ? 'animate-spin' : ''
                                            )}
                                        />
                                        <div className='flex-1 min-w-0'>
                                            <div className='flex items-center gap-2'>
                                                <span className='text-sm font-medium text-light'>{op.phoneMasked}</span>
                                                <span className='text-[10px] uppercase tracking-wide text-light/40'>
                                                    {meta.label}
                                                </span>
                                            </div>
                                            {op.status === 'processing' && op.currentStep && (
                                                <div className='mt-1 flex items-center gap-1.5 text-xs text-accent'>
                                                    {stepIcon(op.currentStep, op.operationType)}
                                                    <span>{op.currentStep}</span>
                                                </div>
                                            )}
                                            {op.status === 'retrying' && (
                                                <div className='mt-1 flex items-center gap-1.5 text-xs text-yellow-300'>
                                                    {stepIcon(op.currentStep, op.operationType)}
                                                    <span>
                                                        {op.currentStep || 'Retrying'}
                                                        {typeof op.attemptCount === 'number' && op.attemptCount > 1 ? ` (attempt ${op.attemptCount})` : ''}
                                                    </span>
                                                </div>
                                            )}
                                            {op.status === 'success' && op.resultSummary && (
                                                <div className='mt-1 text-xs text-accent'>{op.resultSummary}</div>
                                            )}
                                            {op.status === 'already_claimed' && op.resultSummary && (
                                                <div className='mt-1 text-xs text-yellow-300'>{op.resultSummary}</div>
                                            )}
                                            {op.status === 'failed' && op.error && (
                                                <div className='mt-1 text-xs text-red-300'>{op.error}</div>
                                            )}
                                            {op.durationMs ? (
                                                <div className='mt-1 text-[11px] text-light/40'>
                                                    {(op.durationMs / 1000).toFixed(1)}s
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className='flex items-center justify-between gap-3 border-t border-light/10 px-5 py-3 sm:px-6'>
                    <div className='flex items-center gap-3 text-xs text-light/60'>
                        <span className='text-accent'>{successes} successful</span>
                        {failures > 0 && <span className='text-red-300'>{failures} failed</span>}
                        {retrying > 0 && <span className='text-yellow-300'>{retrying} retrying</span>}
                        {completed < total && <span className='text-light/40'>{total - completed} remaining</span>}
                    </div>
                    <button onClick={onClose} className='btn btn-primary'>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OperationProgressModal;