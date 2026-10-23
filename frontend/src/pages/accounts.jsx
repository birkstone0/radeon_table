// Accounts page: TXT import (phone:password), shared-password import, preview
// with confirmation, record table with search/filter, and operation triggers.
//
// Passwords never reach this layer twice: the TXT/shared preview response only
// carries masked numbers, and confirming an import sends only the phone plus the
// password the user just supplied in the browser.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileText, Phone, Trash2, Play, Search, Eye, EyeOff, AlertTriangle, X, CheckSquare, Square, XCircle } from 'lucide-react';
import { accountsApi, operationsApi, selectionApi } from '../lib/api';
import { addToast } from '../lib/toast';
import { cn } from '../styles/utils';
import { openProgress, hasActiveOperation } from '../lib/operationProgress';
import { useAuth } from '../state/auth';
import { MAX_IMPORT_RECORDS, MAX_RECORDS_PER_OPERATION } from '../config/limits';

// Client-side parse of "phone:password" lines. This keeps the exact line
// numbering the backend preview uses so the confirmed records can be matched
// to their passwords without ever sending them in the preview round-trip.
function parsePairLines(rawText) {
    const records = {};
    const lines = String(rawText).split(/\r?\n/);
    let lineNumber = 0;
    for (const rawLine of lines) {
        lineNumber += 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([^:\s]+)\s*:\s*(.+)$/);
        if (!match) continue;
        records[lineNumber] = { phone: match[1], password: match[2] };
    }
    return records;
}

const OPERATION_LABELS = {
    claim_daily_reward: 'Claim Daily Reward',
    check_balance: 'Check Balance'
};

function StatusBadge({ status }) {
    const cls = {
        pending: 'badge-neutral',
        queued: 'badge-warning',
        processing: 'badge-warning',
        claimed: 'badge-success',
        balance_checked: 'badge-success',
        failed: 'badge-danger',
        needs_attention: 'badge-warning'
    }[status] || 'badge-neutral';
    return <span className={cls}>{String(status).replace(/_/g, ' ')}</span>;
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function AccountsPage() {
    const auth = useAuth();
    const [accounts, setAccounts] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit] = useState(25);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionError, setActionError] = useState('');

    const isAdmin = Boolean(auth.user && auth.user.role === 'admin');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const [selectedIds, setSelectedIds] = useState([]);
    const [selection, setSelection] = useState('');
    const [dropActive, setDropActive] = useState(false);
    const [file, setFile] = useState(null);

    // Global selection state
    const [selectionToken, setSelectionToken] = useState(null);
    const [selectedCount, setSelectedCount] = useState(0);
    const [selectAllMode, setSelectAllMode] = useState('none'); // 'none' | 'page' | 'all'

    // Import wizard state
    const [importMethod, setImportMethod] = useState(''); // '', 'txt', 'shared_password'
    const [showImport, setShowImport] = useState(false);
    const [importText, setImportText] = useState('');
    const [sharedPassword, setSharedPassword] = useState('');
    const [showSharedPassword, setShowSharedPassword] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [importing, setImporting] = useState(false);

    const [running, setRunning] = useState(false);
    const fileInputRef = useRef(null);

    const loadAccounts = useCallback(
        async (overrides = {}) => {
            setLoading(true);
            setError('');
            const params = {
                page: overrides.page === undefined ? page : overrides.page,
                limit
            };
            if (search) params.search = search;
            if (statusFilter) params.status = statusFilter;
            try {
                const { data } = await accountsApi.list(params);
                setAccounts(data.items);
                setTotal(data.total);
                if (overrides.page !== undefined) setPage(overrides.page);
            } catch (err) {
                setError(err.message || 'Failed to load accounts');
            } finally {
                setLoading(false);
            }
        },
        [page, limit, search, statusFilter]
    );

    useEffect(() => {
        loadAccounts({ page: 1 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, statusFilter]);

    const visibleIds = useMemo(() => accounts.map((account) => account.id), [accounts]);

    // Global selection functions
    const selectAllPage = () => {
        const pageIds = accounts.map(acc => acc.id);
        setSelectedIds(pageIds);
        setSelectAllMode('page');
        setSelectedCount(pageIds.length);
    };

    const selectAllRecords = async () => {
        try {
            const filters = {
                search: search || null,
                status: statusFilter || null
            };
            const { data } = await selectionApi.createAccountsToken(filters);
            const count = Math.min(data.count, MAX_RECORDS_PER_OPERATION);
            setSelectionToken(data.token);
            setSelectedCount(count);
            setSelectAllMode('all');
            setSelectedIds([]);
            const message = data.count > MAX_RECORDS_PER_OPERATION
                ? `Selected ${count} records (maximum reached). ${data.count - count} additional records remain unselected.`
                : `Selected all ${data.count} records matching current filters`;
            addToast(message, data.count > MAX_RECORDS_PER_OPERATION ? 'warning' : 'success');
        } catch (err) {
            addToast(err.message || 'Failed to select all records', 'error');
        }
    };

    const clearSelection = async () => {
        if (selectionToken) {
            try {
                await selectionApi.clearAccountsToken(selectionToken);
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
                selectionApi.excludeAccountsIds(selectionToken, [id]).then(({ data }) => {
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
    }, [search, statusFilter]);

    const applyFilter = (event) => {
        event.preventDefault();
        loadAccounts({ page: 1 });
    };

    // --- Import: file picker / drag and drop ---
    const handleFiles = useCallback((files) => {
        const chosen = files && files[0];
        if (!chosen) return;
        if (!/\.txt$/i.test(chosen.name)) {
            addToast('Only .txt files are supported', 'error');
            return;
        }
        setFile(chosen);
        const reader = new FileReader();
        reader.onload = () => {
            setImportText(String(reader.result || ''));
            setImportMethod('txt');
            setShowImport(true);
            setPreview(null);
        };
        reader.onerror = () => addToast('Could not read that file', 'error');
        reader.readAsText(chosen);
    }, []);

    const onDrop = (event) => {
        event.preventDefault();
        setDropActive(false);
        handleFiles(event.dataTransfer.files);
    };

    const startTxtImport = () => {
        setFile(null);
        setImportText('');
        setSharedPassword('');
        setPreview(null);
        setImportMethod('txt');
        setShowImport(true);
    };

    const startSharedImport = () => {
        setFile(null);
        setImportText('');
        setSharedPassword('');
        setShowSharedPassword(false);
        setPreview(null);
        setImportMethod('shared_password');
        setShowImport(true);
    };

    const runPreview = async () => {
        setPreviewing(true);
        setActionError('');
        try {
            const payload = { method: importMethod, text: importText };
            if (importMethod === 'shared_password') {
                if (!sharedPassword) throw new Error('A shared password is required');
                payload.sharedPassword = sharedPassword;
            }
            // Client-side validation for import limit
            const lines = importText.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
            if (lines.length > MAX_IMPORT_RECORDS) {
                throw new Error(`Maximum ${MAX_IMPORT_RECORDS} records per import. Found ${lines.length} records. Please split into multiple imports.`);
            }
            const { data } = await accountsApi.previewImport(payload);
            setPreview(data);
        } catch (err) {
            setActionError(err.message || 'Preview failed');
        } finally {
            setPreviewing(false);
        }
    };

    const commitImport = async () => {
        if (!preview || preview.summary.valid === 0) return;
        setImporting(true);
        setActionError('');
        try {
            // Only the records the user confirmed are sent, with the password
            // supplied in this browser session. TXT imports read the file the
            // user selected from `importText`, which never leaves the browser
            // except through this confirmed payload.
            const lines = importMethod === 'txt' ? parsePairLines(importText) : null;
            const records = preview.valid.map((record, index) => {
                const line = lines ? lines[record.line] : importMethod === 'shared_password' ? { password: sharedPassword } : null;
                return {
                    phone: record.phone,
                    password: line && line.password ? line.password : ''
                };
            }).filter((record) => record.password);

            if (records.length === 0) {
                setActionError('Could not match the previewed records to their credentials. Please start the import again.');
                return;
            }

            const { data } = await accountsApi.commitImport({ method: importMethod, records });
            addToast(`Imported ${data.inserted.length} account${data.inserted.length === 1 ? '' : 's'}`, 'success');
            setShowImport(false);
            setPreview(null);
            setImportText('');
            setSharedPassword('');
            setFile(null);
            await loadAccounts({ page: 1 });
        } catch (err) {
            setActionError(err.message || 'Import failed');
        } finally {
            setImporting(false);
        }
    };

    const removeAccount = async (accountId) => {
        if (!window.confirm('Remove this account record? This cannot be undone.')) return;
        try {
            await accountsApi.remove(accountId);
            addToast('Record removed', 'success');
            await loadAccounts();
        } catch (err) {
            setActionError(err.message || 'Could not remove record');
        }
    };

    const clearRecords = async () => {
        if (!window.confirm('Clear all of your imported records? Operations already recorded stay in history.')) return;
        try {
            const { data } = await accountsApi.clear();
            addToast(`Cleared ${data.deleted} record${data.deleted === 1 ? '' : 's'}`, 'success');
            setSelectedIds([]);
            await loadAccounts({ page: 1 });
        } catch (err) {
            setActionError(err.message || 'Could not clear records');
        }
    };

    const runOperation = async (operationType) => {
        if (selectedCount === 0) return;
        if (running) {
            addToast('An operation is already in progress', 'error');
            return;
        }
        if (hasActiveOperation(operationType)) {
            addToast('This operation is already active. Wait for it to finish or close it.', 'error');
            return;
        }
        // Regular users: block the action client-side too when access has expired,
        // though the server enforces it regardless.
        if (!auth.isAdmin && auth.user && auth.user.accessExpired) {
            addToast('Account Access Expired. Contact an administrator.', 'error');
            setRunning(false);
            return;
        }
        // Client-side validation for operation limit
        if (selectedCount > MAX_RECORDS_PER_OPERATION) {
            addToast(`Maximum ${MAX_RECORDS_PER_OPERATION} records per operation. Selected: ${selectedCount}. Please process in smaller batches.`, 'error');
            return;
        }
        setSelection('');
        setError('');
        setRunning(true);
        try {
            let payload;
            if (selectAllMode === 'all' && selectionToken) {
                // Use selection token for global selection
                payload = { operationType, selectionToken };
            } else {
                // Use direct account IDs for page selection
                payload = { operationType, accountIds: selectedIds };
            }

            const { data } = await operationsApi.run(payload);
            if (!data.operationIds || data.operationIds.length === 0) {
                addToast('No operations were queued. Check your trials and account status.', 'error');
                setRunning(false);
                return;
            }
            openProgress(data.operationIds, operationType);
            clearSelection();
            setRunning(false);
        } catch (err) {
            setError(err.message || 'Could not start the operation');
            setRunning(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className='page'>
            <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
                <div className='min-w-0'>
                    <h1 className='page-title'>Accounts</h1>
                    <p className='page-description'>Import accounts, review validation status, and run login-supported operations.</p>
                </div>
                <div className='accounts-toolbar'>
                    <button className='btn btn-primary' onClick={startTxtImport}>
                        <FileText className='h-4 w-4 shrink-0' /> Import TXT
                    </button>
                    <button className='btn btn-accent' onClick={startSharedImport}>
                        <Phone className='h-4 w-4 shrink-0' /> Shared Password
                    </button>
                    {accounts.length > 0 && (
                        <button className='btn btn-danger' onClick={clearRecords}>
                            <Trash2 className='h-4 w-4 shrink-0' /> Clear Records
                        </button>
                    )}
                </div>
            </div>

            <div className='divider' />

            {/* Filters */}
            <form className='flex flex-wrap items-end gap-3' onSubmit={applyFilter}>
                <div className='min-w-[220px] flex-1'>
                    <label className='label' htmlFor='account-search'>Search phone</label>
                    <input
                        id='account-search'
                        className='input'
                        placeholder='e.g. 0917'
                        value={search}
                        onChange={(event) => setSearch(event.target.value.replace(/[^0-9]/g, ''))}
                    />
                </div>
                <div className='min-w-[160px]'>
                    <label className='label' htmlFor='account-status'>Status</label>
                    <select id='account-status' className='input' value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                        <option value=''>All statuses</option>
                        <option value='pending'>Pending</option>
                        <option value='queued'>Queued</option>
                        <option value='processing'>Processing</option>
                        <option value='claimed'>Claimed</option>
                        <option value='balance_checked'>Balance checked</option>
                        <option value='needs_attention'>Needs attention</option>
                        <option value='failed'>Failed</option>
                    </select>
                </div>
                <button className='btn-ghost' type='submit'><Search className='h-3.5 w-3.5' /> Apply</button>
            </form>

            <div className='divider' />

            {/* Selection controls */}
            {total > 0 && (
                <div className='flex flex-wrap items-center gap-2 mb-4 p-3 bg-light/5 rounded-lg'>
                    <span className='text-sm text-light/80'>
                        {selectedCount > 0
                            ? (selectAllMode === 'all'
                                ? `${selectedCount} selected of matching records${selectedCount >= MAX_RECORDS_PER_OPERATION ? ' (maximum reached)' : ''}`
                                : `${selectedCount} of ${total} selected`)
                            : `${total} records`}
                    </span>
                    <div className='flex gap-2 ml-auto'>
                        {selectAllMode === 'none' && (
                            <>
                                <button
                                    type='button'
                                    onClick={selectAllPage}
                                    className='btn btn-ghost text-xs'
                                >
                                    <CheckSquare className='w-4 h-4 mr-1' /> Select Current Page
                                </button>
                                <button
                                    type='button'
                                    onClick={selectAllRecords}
                                    className='btn btn-ghost text-xs'
                                >
                                    <CheckSquare className='w-4 h-4 mr-1' /> Select All Matching (up to {MAX_RECORDS_PER_OPERATION})
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

            {/* Bulk actions */}
            <div className='card flex flex-wrap items-center justify-between gap-3 p-3'>
                <div className='flex items-center gap-3 text-xs text-light/60'>
                    <span>{selectedCount} selected</span>
                    <span className='hidden sm:inline'>of {total} record{total === 1 ? '' : 's'}</span>
                </div>
                <div className='flex items-center gap-2'>
                    <button className='btn-ghost whitespace-nowrap' disabled={selectedCount === 0 || running} onClick={() => runOperation('claim_daily_reward')}>
                        <Play className='h-3.5 w-3.5' /> Login &amp; claim
                    </button>
                    <button className='btn-ghost whitespace-nowrap' disabled={selectedCount === 0 || running} onClick={() => runOperation('check_balance')}>
                        <Play className='h-3.5 w-3.5' /> Login &amp; check balance
                    </button>
                </div>
            </div>

            <div className='divider' />

            {error && <p className='text-xs text-red-300'>{error}</p>}

            {/* Table */}
            <div className='card overflow-hidden'>
                <div className='overflow-x-auto'>
                    <table className='table'>
                        <thead>
                            <tr>
                                <th className='w-10'>
                                    {selectAllMode === 'all' ? (
                                        <button onClick={clearSelection} className='text-accent hover:text-accent/80' title={`All ${selectedCount} records selected`}>
                                            <CheckSquare className='w-4 h-4' />
                                        </button>
                                    ) : selectAllMode === 'page' && selectedIds.length === accounts.length ? (
                                        <button onClick={clearSelection} className='text-accent hover:text-accent/80' title={`${selectedIds.length} records on this page selected`}>
                                            <CheckSquare className='w-4 h-4' />
                                        </button>
                                    ) : (
                                        <button onClick={selectAllPage} className='text-light/60 hover:text-light' title='Select this page'>
                                            <Square className='w-4 h-4' />
                                        </button>
                                    )}
                                </th>
                                <th>Phone</th>
                                <th>Validation</th>
                                <th>Processing</th>
                                <th>Last result</th>
                                <th>Imported</th>
                                <th className='text-right'>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={7} className='py-10 text-center text-light/40'>Loading…</td></tr>
                            )}
                            {!loading && accounts.length === 0 && (
                                <tr>
                                    <td colSpan={7} className='py-12 text-center'>
                                        <p className='text-sm text-light/60'>No accounts yet.</p>
                                        <p className='mt-1 text-xs text-light/40'>Import a TXT file or phone numbers with a shared password to get started.</p>
                                        <div className='mt-4 flex justify-center gap-2'>
                                            <button className='btn-primary' onClick={startTxtImport}>Import TXT</button>
                                            <button className='btn-accent' onClick={startSharedImport}>Shared password</button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {!loading && accounts.map((account) => {
                                const isSelected = selectAllMode === 'all' ? true : selectedIds.includes(account.id);
                                return (
                                <tr key={account.id} className={isSelected ? 'bg-accent/10' : ''}>
                                    <td>
                                        <button
                                            onClick={() => toggleSelect(account.id)}
                                            className='text-light/60 hover:text-accent'
                                        >
                                            {isSelected ? (
                                                <CheckSquare className='w-4 h-4 text-accent' />
                                            ) : (
                                                <Square className='w-4 h-4' />
                                            )}
                                        </button>
                                    </td>
                                    <td className='font-mono text-light'>{account.phoneMasked}</td>
                                    <td>
                                        {account.validationStatus === 'valid'
                                            ? <span className='badge-success'>valid</span>
                                            : <span className='badge-warning'>{String(account.validationStatus).replace(/_/g, ' ')}</span>}
                                    </td>
                                    <td><StatusBadge status={account.processingStatus} /></td>
                                    <td className='max-w-[16rem] truncate text-light/70' title={account.lastResult || account.lastError || ''}>
                                        {account.lastResult || account.lastError || '—'}
                                    </td>
                                    <td className='text-light/60'>{formatDate(account.createdAt)}</td>
                                    <td className='text-right'>
                                        <button className='btn-danger' onClick={() => removeAccount(account.id)}>
                                            <Trash2 className='h-3.5 w-3.5' /> Remove
                                        </button>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination */}
            {total > limit && (
                <div className='flex items-center justify-between text-xs text-light/50'>
                    <span>Page {page} of {totalPages}</span>
                    <div className='flex gap-2'>
                        <button className='btn-ghost' disabled={page <= 1} onClick={() => loadAccounts({ page: page - 1 })}>Previous</button>
                        <button className='btn-ghost' disabled={page >= totalPages} onClick={() => loadAccounts({ page: page + 1 })}>Next</button>
                    </div>
                </div>
            )}

            {/* Import modal */}
            {showImport && (
                <div className='modal-overlay' role='dialog' aria-modal='true' aria-labelledby='import-modal-title'>
                    <div className='modal-panel'>
                        <div className='modal-header'>
                            <div className='min-w-0'>
                                <h2 id='import-modal-title' className='page-title'>
                                    {importMethod === 'txt' ? 'Import accounts (TXT)' : 'Import accounts (shared password)'}
                                </h2>
                                <p className='page-description'>
                                    {importMethod === 'txt'
                                        ? 'Upload a .txt file with one phone:password pair per line. Blank lines and # comments are skipped.'
                                        : 'Paste phone numbers one per line, or upload a phone-only .txt file, and apply one shared password.'}
                                </p>
                            </div>
                            <button className='btn-ghost shrink-0' onClick={() => { setShowImport(false); setPreview(null); }} aria-label='Close import dialog'>
                                <X className='h-3.5 w-3.5' />
                            </button>
                        </div>

                        {!preview && (
                            <div className='modal-body'>
                                <div
                                    className={cn(
                                        'rounded-md border border-dashed p-6 text-center transition-colors',
                                        dropActive ? 'border-accent bg-accent/5' : 'border-light/15'
                                    )}
                                    onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
                                    onDragLeave={() => setDropActive(false)}
                                    onDrop={onDrop}
                                >
                                    <Upload className='mx-auto h-6 w-6 text-light/40' />
                                    <p className='mt-2 text-sm text-light/70'>Drag and drop a .txt file here</p>
                                    <button className='btn-ghost mt-3' onClick={() => fileInputRef.current?.click()}>{ 'or choose a file' }</button>
                                    <input
                                        ref={fileInputRef}
                                        type='file'
                                        accept='.txt,text/plain'
                                        className='hidden'
                                        onChange={(event) => handleFiles(event.target.files)}
                                    />
                                </div>

                                {importMethod === 'shared_password' && (
                                    <div>
                                        <label className='label' htmlFor='shared-password'>Shared password</label>
                                        <div className='flex items-center gap-2'>
                                            <input
                                                id='shared-password'
                                                className='input'
                                                type={showSharedPassword ? 'text' : 'password'}
                                                autoComplete='new-password'
                                                value={sharedPassword}
                                                onChange={(event) => setSharedPassword(event.target.value)}
                                                placeholder='Applied to every valid number'
                                            />
                                            <button
                                                className='btn-ghost shrink-0'
                                                aria-label={showSharedPassword ? 'Hide shared password' : 'Show shared password'}
                                                onClick={() => setShowSharedPassword((value) => !value)}
                                            >
                                                {showSharedPassword ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className='label' htmlFor='import-text'>
                                        {importMethod === 'txt' ? 'Account lines (or use the drop zone above)' : 'Phone numbers, one per line'}
                                    </label>
                                    <textarea
                                        id='import-text'
                                        className='input h-40 resize-y font-mono text-xs'
                                        spellCheck='false'
                                        value={importText}
                                        onChange={(event) => setImportText(event.target.value)}
                                        placeholder={importMethod === 'txt' ? '09171234567:password123\n# comment lines are ignored' : '09171234567\n09998887777'}
                                    />
                                </div>

                                {actionError && <p className='text-xs text-red-300'>{actionError}</p>}
                            </div>
                        )}

                        {preview && (
                            <div className='modal-body'>
                                <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                                    <div>
                                        <p className='stat-label'>Total</p>
                                        <p className='stat-value'>{preview.summary.total}</p>
                                    </div>
                                    <div>
                                        <p className='stat-label'>Valid</p>
                                        <p className='stat-value text-accent'>{preview.summary.valid}</p>
                                    </div>
                                    <div>
                                        <p className='stat-label'>Invalid</p>
                                        <p className='stat-value text-yellow-300'>{preview.summary.invalid}</p>
                                    </div>
                                    <div>
                                        <p className='stat-label'>Duplicates</p>
                                        <p className='stat-value text-red-300'>{preview.summary.duplicates}</p>
                                    </div>
                                </div>

                                <div className='divider my-2' />

                                {preview.valid.length > 0 && (
                                    <div className='max-h-48 overflow-y-auto rounded-md border border-light/10 p-3'>
                                        <p className='stat-label'>Ready to import</p>
                                        <ul className='mt-2 space-y-1 font-mono text-xs text-light/80'>
                                            {preview.valid.map((record) => (
                                                <li key={`${record.line}-${record.phoneMasked}`}>{record.phoneMasked}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {preview.invalid.length > 0 && (
                                    <div className='max-h-32 overflow-y-auto rounded-md border border-yellow-500/20 p-3'>
                                        <p className='stat-label text-yellow-300'>Skipped (malformed)</p>
                                        <ul className='mt-2 space-y-1 text-xs text-yellow-200/80'>
                                            {preview.invalid.map((record, index) => (
                                                <li key={index}>Line {record.line}: {record.reason}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {preview.duplicates.length > 0 && (
                                    <div className='max-h-32 overflow-y-auto rounded-md border border-red-500/20 p-3'>
                                        <p className='stat-label text-red-300'>Already on file</p>
                                        <ul className='mt-2 space-y-1 font-mono text-xs text-red-200/80'>
                                            {preview.duplicates.map((r, index) => (
                                                <li key={index}>{r.phone}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {preview.summary.valid === 0 && (
                                    <div className='flex items-start gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-light/70'>
                                        <AlertTriangle className='h-3.5 w-3.5 shrink-0 text-yellow-300' />
                                        <p>Nothing to import — every submitted line was malformed or already on file.</p>
                                    </div>
                                )}

                                {actionError && <p className='text-xs text-red-300'>{actionError}</p>}
                            </div>
                        )}

                        <div className='modal-footer'>
                            {!preview ? (
                                <>
                                    <button className='btn-ghost' onClick={() => { setShowImport(false); setPreview(null); }}>Cancel</button>
                                    <button className='btn-primary' disabled={previewing || !importText.trim()} onClick={runPreview}>
                                        {previewing ? 'Validating…' : 'Preview import'}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button className='btn-ghost' onClick={() => setPreview(null)}>Back</button>
                                    <button className='btn-primary' disabled={importing || preview.summary.valid === 0} onClick={commitImport}>
                                        {importing ? 'Importing…' : `Import ${preview.summary.valid} record${preview.summary.valid === 1 ? '' : 's'}`}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AccountsPage;
