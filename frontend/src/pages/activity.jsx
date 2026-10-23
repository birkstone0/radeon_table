// Activity page: displays operation history (login attempts, claims, balance checks)
// with filtering and status indicators, and lets users re-open a completed
// operation's progress panel from the module-level progress store.
import React, { useCallback, useEffect, useState } from 'react';
import { operationsApi, selectionApi } from '../lib/api';
import { addToast } from '../lib/toast';
import { cn, getOperationStatusColor } from '../styles/utils';
import { openProgress } from '../lib/operationProgress';
import { CheckCircle2, AlertTriangle, Clock, Search, RefreshCw, Eye, Trash2, X, Ban, CheckSquare, Square, XCircle } from 'lucide-react';

function ActivityPage() {
    const [operations, setOperations] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(25);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [operationTypeFilter, setOperationTypeFilter] = useState('');

    // Clear Activity confirmation + in-flight guard
    const [confirmingClear, setConfirmingClear] = useState(false);
    const [clearing, setClearing] = useState(false);

    // Global selection state
    const [selectionToken, setSelectionToken] = useState(null);
    const [selectedCount, setSelectedCount] = useState(0);
    const [selectAllMode, setSelectAllMode] = useState(false); // 'none' | 'page' | 'all'
    const [selectedIds, setSelectedIds] = useState([]);

    const loadOperations = useCallback(
        async (overrides = {}) => {
            setLoading(true);
            setError('');
            const params = {
                page: overrides.page === undefined ? page : overrides.page,
                limit,
                ...(search ? { phone: search } : {}),
                ...(statusFilter ? { status: statusFilter } : {}),
                ...(operationTypeFilter ? { operationType: operationTypeFilter } : {})
            };
            try {
                const { data } = await operationsApi.list(params);
                setOperations(data.items);
                setTotal(data.total);
                if (overrides.page !== undefined) setPage(overrides.page);
            } catch (err) {
                setError(err.message || 'Failed to load operations');
            } finally {
                setLoading(false);
            }
        },
        [page, limit, search, statusFilter, operationTypeFilter]
    );

    useEffect(() => {
        loadOperations({ page: 1 });
    }, [search, statusFilter, operationTypeFilter]);

    useEffect(() => {
        const handleOperationsCompleted = () => {
            loadOperations({ page: 1 });
        };
        window.addEventListener('operationsCompleted', handleOperationsCompleted);
        return () => window.removeEventListener('operationsCompleted', handleOperationsCompleted);
    }, [loadOperations]);

    const applyFilter = (event) => {
        event.preventDefault();
        loadOperations({ page: 1 });
    };

    const clearActivity = async () => {
        if (clearing) return;
        setClearing(true);
        setError('');
        try {
            const { data } = await operationsApi.clear();
            addToast(data.message || 'Activity cleared', 'success');
            setConfirmingClear(false);
            // Refresh the list and let the dashboard stats refresh via the
            // existing operationsCompleted event.
            window.dispatchEvent(new Event('operationsCompleted'));
            await loadOperations({ page: 1 });
        } catch (err) {
            addToast(err.message || 'Could not clear activity', 'error');
        } finally {
            setClearing(false);
        }
    };

    const cancelOperation = async (operationId) => {
        try {
            await operationsApi.cancel(operationId);
            addToast('Operation cancelled', 'success');
            window.dispatchEvent(new Event('operationsCompleted'));
            await loadOperations({ page: 1 });
        } catch (err) {
            addToast(err.message || 'Could not cancel operation', 'error');
        }
    };

    // Global selection functions
    const selectAllPage = () => {
        const pageIds = operations.map(op => op.id);
        setSelectedIds(pageIds);
        setSelectAllMode('page');
        setSelectedCount(pageIds.length);
    };

    const selectAllRecords = async () => {
        try {
            const filters = {
                operationType: operationTypeFilter || null,
                status: statusFilter || null,
                phone: search || null
            };
            const { data } = await selectionApi.createOperationsToken(filters);
            setSelectionToken(data.token);
            setSelectedCount(data.count);
            setSelectAllMode('all');
            setSelectedIds([]);
            addToast(`Selected all ${data.count} records matching current filters`, 'success');
        } catch (err) {
            addToast(err.message || 'Failed to select all records', 'error');
        }
    };

    const clearSelection = async () => {
        if (selectionToken) {
            try {
                await selectionApi.clearToken(selectionToken);
            } catch (err) {
                // Ignore error on clear
            }
        }
        setSelectionToken(null);
        setSelectedCount(0);
        setSelectAllMode('none');
        setSelectedIds([]);
    };

    const toggleSelect = (id) => {
        if (selectAllMode === 'all') {
            // In global select mode, deselect means exclude from selection
            if (selectionToken) {
                selectionApi.excludeOperationsIds(selectionToken, [id]).then(({ data }) => {
                    setSelectedCount(data.remainingCount);
                }).catch(err => {
                    addToast(err.message || 'Failed to update selection', 'error');
                });
            }
        } else {
            // Page selection mode
            setSelectedIds(current => {
                if (current.includes(id)) {
                    return current.filter(value => value !== id);
                } else {
                    return [...current, id];
                }
            });
            setSelectedCount(selectedIds.includes(id) ? selectedIds.length - 1 : selectedIds.length + 1);
        }
    };

    // Clear selection when filters change
    useEffect(() => {
        clearSelection();
    }, [search, statusFilter, operationTypeFilter]);

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function StatusIcon({ status }) {
        if (status === 'success' || status === 'claimed' || status === 'balance_checked' || status === 'already_claimed') {
            return <CheckCircle2 className='w-4 h-4 text-green-400' />;
        }
        if (status === 'failed') {
            return <AlertTriangle className='w-4 h-4 text-red-400' />;
        }
        if (status === 'cancelled') {
            return <Ban className='w-4 h-4 text-gray-400' />;
        }
        return <Clock className='w-4 h-4 text-gray-400' />;
    }

    return (
        <div className='page'>
            <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                <div className='min-w-0'>
                    <h1 className='page-title'>Activity</h1>
                    <p className='page-description'>Operation history for your accounts including logins, claims, and balance checks.</p>
                </div>
                {total > 0 && (
                    <button className='btn btn-danger w-full sm:w-auto text-sm py-2 px-4' onClick={() => setConfirmingClear(true)}>
                        <Trash2 className='h-4 w-4 shrink-0 mr-2' /> Clear Activity
                    </button>
                )}
            </div>

            <div className='divider' />

            <form onSubmit={applyFilter} className='flex flex-wrap gap-3 mb-4'>
                <div className='flex-1 min-w-[200px]'>
                    <input
                        type='text'
                        placeholder='Search by phone...'
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className='input'
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className='input w-auto'
                >
                    <option value=''>All statuses</option>
                    <option value='success'>Success</option>
                    <option value='failed'>Failed</option>
                    <option value='queued'>Queued</option>
                    <option value='processing'>Processing</option>
                    <option value='cancelled'>Cancelled</option>
                </select>
                <select
                    value={operationTypeFilter}
                    onChange={(e) => setOperationTypeFilter(e.target.value)}
                    className='input w-auto'
                >
                    <option value=''>All operations</option>
                    <option value='claim_daily_reward'>Claim Daily Reward</option>
                    <option value='check_balance'>Check Balance</option>
                </select>
                <button type='submit' className='btn btn-ghost'>
                    <Search className='w-4 h-4' />
                </button>
            </form>

            {/* Selection controls */}
            {total > 0 && (
                <div className='flex flex-wrap items-center gap-2 mb-4 p-3 bg-light/5 rounded-lg'>
                    <span className='text-sm text-light/80'>
                        {selectedCount > 0 ? `${selectedCount} of ${total} selected` : `${total} records`}
                    </span>
                    <div className='flex gap-2 ml-auto'>
                        {selectAllMode === 'none' && (
                            <>
                                <button
                                    type='button'
                                    onClick={selectAllPage}
                                    className='btn btn-ghost text-xs'
                                >
                                    <CheckSquare className='w-4 h-4 mr-1' /> Select page
                                </button>
                                <button
                                    type='button'
                                    onClick={selectAllRecords}
                                    className='btn btn-ghost text-xs'
                                >
                                    <CheckSquare className='w-4 h-4 mr-1' /> Select all records
                                </button>
                            </>
                        )}
                        {selectedCount > 0 && (
                            <button
                                type='button'
                                onClick={clearSelection}
                                className='btn btn-ghost text-xs text-red-400 hover:text-red-300'
                            >
                                <XCircle className='w-4 h-4 mr-1' /> Clear selection
                            </button>
                        )}
                    </div>
                </div>
            )}

            {loading ? (
                <div className='flex items-center justify-center py-12'>
                    <RefreshCw className='w-6 h-6 text-light/40 animate-spin' />
                </div>
            ) : error ? (
                <div className='text-red-400 text-sm py-8'>{error}</div>
            ) : operations.length === 0 ? (
                <div className='text-light/40 text-sm py-8'>No operations found</div>
            ) : (
                <>
                    <div className='overflow-x-auto'>
                        <table className='table'>
                            <thead>
                                <tr>
                                    <th className='w-10'>
                                        {selectAllMode === 'page' && selectedIds.length === operations.length ? (
                                            <button onClick={clearSelection} className='text-accent hover:text-accent/80'>
                                                <CheckSquare className='w-4 h-4' />
                                            </button>
                                        ) : (
                                            <button onClick={selectAllPage} className='text-light/60 hover:text-light'>
                                                <Square className='w-4 h-4' />
                                            </button>
                                        )}
                                    </th>
                                    <th>Phone</th>
                                    <th>Operation</th>
                                    <th>Status</th>
                                    <th>Result</th>
                                    <th>Started</th>
                                    <th>Duration</th>
                                    <th className='text-right'>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {operations.map((op) => {
                                    const isSelected = selectAllMode === 'all' ? true : selectedIds.includes(op.id);
                                    return (
                                        <tr key={op.id} className={isSelected ? 'bg-accent/10' : ''}>
                                            <td>
                                                <button
                                                    onClick={() => toggleSelect(op.id)}
                                                    className='text-light/60 hover:text-accent'
                                                >
                                                    {isSelected ? (
                                                        <CheckSquare className='w-4 h-4 text-accent' />
                                                    ) : (
                                                        <Square className='w-4 h-4' />
                                                    )}
                                                </button>
                                            </td>
                                            <td className='font-mono text-xs'>{op.phoneMasked || '—'}</td>
                                        <td>
                                            <span className='capitalize text-light/80'>
                                                {op.operationType?.replace(/_/g, ' ') || '—'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className='flex items-center gap-2'>
                                                <StatusIcon status={op.status} />
                                                <span className={cn('badge', getOperationStatusColor(op.status))}>
                                                    {String(op.status).replace(/_/g, ' ')}
                                                </span>
                                            </div>
                                        </td>
                                        <td className='text-light/60'>{op.resultSummary || op.error || '—'}</td>
                                        <td className='text-light/60'>{formatDate(op.startedAt)}</td>
                                        <td className='text-light/60'>
                                            {op.durationMs ? `${op.durationMs}ms` : '—'}
                                        </td>
                                        <td className='text-right'>
                                            <div className='flex items-center justify-end gap-2'>
                                                {(op.status === 'queued' || op.status === 'processing' || op.status === 'retrying') && (
                                                    <button
                                                        onClick={() => cancelOperation(op.id)}
                                                        className='btn btn-ghost text-xs'
                                                        title='Cancel this operation'
                                                    >
                                                        <Ban className='w-3.5 h-3.5' /> Cancel
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => openProgress([op.id], op.operationType)}
                                                    className='btn btn-ghost text-xs'
                                                    title='Reopen progress panel'
                                                >
                                                    <Eye className='w-3.5 h-3.5' /> View
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
                        <div className='text-xs text-light/40'>
                            Showing {operations.length} of {total} operations
                        </div>
                        <div className='flex gap-2'>
                            <button
                                onClick={() => loadOperations({ page: page - 1 })}
                                disabled={page === 1}
                                className='btn btn-ghost disabled:opacity-50'
                            >
                                Previous
                            </button>
                            <button
                                onClick={() => loadOperations({ page: page + 1 })}
                                disabled={page * limit >= total}
                                className='btn btn-ghost disabled:opacity-50'
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </>
            )}

            {confirmingClear && (
                <div className='modal-overlay' role='dialog' aria-modal='true' aria-labelledby='clear-activity-title'>
                    <div className='modal-panel'>
                        <div className='modal-header'>
                            <div className='min-w-0'>
                                <h2 id='clear-activity-title' className='page-title'>Clear Activity</h2>
                                <p className='page-description'>Remove your visible operation history.</p>
                            </div>
                            <button className='btn-ghost shrink-0' onClick={() => setConfirmingClear(false)} aria-label='Cancel clear activity'>
                                <X className='h-3.5 w-3.5' />
                            </button>
                        </div>
                        <div className='modal-body'>
                            <p className='text-sm text-light/80'>
                                This removes <strong>{total}</strong> finished history record{total === 1 ? '' : 's'} from your
                                Activity view. Running operations are not cancelled and your accounts are not affected.
                            </p>
                        </div>
                        <div className='modal-footer'>
                            <button className='btn-ghost' onClick={() => setConfirmingClear(false)}>Cancel</button>
                            <button className='btn-danger' disabled={clearing} onClick={clearActivity}>
                                {clearing ? 'Clearing…' : 'Clear Activity'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function getOperationStatusClass(status) {
    const map = {
        success: 'badge-success',
        claimed: 'badge-success',
        balance_checked: 'badge-success',
        failed: 'badge-danger',
        queued: 'badge-neutral',
        processing: 'badge-warning'
    };
    return map[status] || 'badge-neutral';
}

export default ActivityPage;
