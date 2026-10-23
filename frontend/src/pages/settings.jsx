// Settings page: administrator-only interface for system overview and audit logs
import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/api';
import { cn } from '../styles/utils';
import { Shield, Users, Database, Activity, RefreshCw, Search, CheckCircle2, AlertTriangle } from 'lucide-react';

function SettingsPage() {
    const [overview, setOverview] = useState(null);
    const [loadingOverview, setLoadingOverview] = useState(true);

    const [auditLogs, setAuditLogs] = useState([]);
    const [totalAudit, setTotalAudit] = useState(0);
    const [auditPage, setAuditPage] = useState(1);
    const [auditLimit] = useState(25);
    const [loadingAudit, setLoadingAudit] = useState(true);
    const [auditSearch, setAuditSearch] = useState('');

    const loadOverview = useCallback(async () => {
        setLoadingOverview(true);
        try {
            const { data } = await adminApi.overview();
            setOverview(data);
        } catch (err) {
            console.error('Failed to load overview:', err);
        } finally {
            setLoadingOverview(false);
        }
    }, []);

    const loadAuditLogs = useCallback(
        async (overrides = {}) => {
            setLoadingAudit(true);
            const params = {
                page: overrides.page === undefined ? auditPage : overrides.page,
                limit: auditLimit,
                ...(auditSearch ? { search: auditSearch } : {})
            };
            try {
                const { data } = await adminApi.audit(params);
                setAuditLogs(data.items);
                setTotalAudit(data.total);
                if (overrides.page !== undefined) setAuditPage(overrides.page);
            } catch (err) {
                console.error('Failed to load audit logs:', err);
            } finally {
                setLoadingAudit(false);
            }
        },
        [auditPage, auditLimit, auditSearch]
    );

    useEffect(() => {
        loadOverview();
        loadAuditLogs({ page: 1 });
    }, [auditSearch]);

    const handleAuditSearch = (event) => {
        event.preventDefault();
        loadAuditLogs({ page: 1 });
    };

    function formatDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    return (
        <div className='page'>
            <h1 className='page-title'>System Settings</h1>
            <p className='page-description'>System overview and administrative audit logs.</p>

            <div className='divider' />

            {/* System Overview */}
            <h2 className='text-sm font-medium text-light mb-3'>System Overview</h2>
            {loadingOverview ? (
                <div className='flex items-center justify-center py-8'>
                    <RefreshCw className='w-5 h-5 text-light/40 animate-spin' />
                </div>
            ) : overview ? (
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8'>
                    <div className='card p-4'>
                        <div className='flex items-center gap-2 mb-2'>
                            <Users className='w-4 h-4 text-accent' />
                            <span className='text-xs uppercase tracking-wide text-light/40'>Users</span>
                        </div>
                        <div className='space-y-1'>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Total</span>
                                <span className='text-light font-medium'>{overview.users?.total || 0}</span>
                            </div>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Active</span>
                                <span className='text-green-300 font-medium'>{overview.users?.active || 0}</span>
                            </div>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Deactivated</span>
                                <span className='text-red-300 font-medium'>{overview.users?.deactivated || 0}</span>
                            </div>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Revoked</span>
                                <span className='text-yellow-300 font-medium'>{overview.users?.revoked || 0}</span>
                            </div>
                        </div>
                    </div>

                    <div className='card p-4'>
                        <div className='flex items-center gap-2 mb-2'>
                            <Database className='w-4 h-4 text-accent' />
                            <span className='text-xs uppercase tracking-wide text-light/40'>Accounts</span>
                        </div>
                        <div className='mt-2'>
                            <span className='text-2xl font-semibold text-light'>{overview.accounts?.total || 0}</span>
                            <span className='text-xs text-light/40 ml-1'>imported records</span>
                        </div>
                    </div>

                    <div className='card p-4'>
                        <div className='flex items-center gap-2 mb-2'>
                            <Activity className='w-4 h-4 text-accent' />
                            <span className='text-xs uppercase tracking-wide text-light/40'>Operations</span>
                        </div>
                        <div className='space-y-1'>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Total</span>
                                <span className='text-light font-medium'>{overview.operations?.total || 0}</span>
                            </div>
                            <div className='flex justify-between text-sm'>
                                <span className='text-light/60'>Failed</span>
                                <span className='text-red-300 font-medium'>{overview.operations?.failed || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className='text-light/40 text-sm py-8 mb-8'>Unable to load system overview</div>
            )}

            <div className='divider' />

            {/* Audit Logs */}
            <h2 className='text-sm font-medium text-light mb-3'>Audit Log</h2>
            <form onSubmit={handleAuditSearch} className='flex gap-3 mb-4'>
                <div className='flex-1 min-w-[200px]'>
                    <input
                        type='text'
                        placeholder='Search audit logs...'
                        value={auditSearch}
                        onChange={(e) => setAuditSearch(e.target.value)}
                        className='input'
                    />
                </div>
                <button type='submit' className='btn btn-ghost'>
                    <Search className='w-4 h-4' />
                </button>
            </form>

            {loadingAudit ? (
                <div className='flex items-center justify-center py-12'>
                    <RefreshCw className='w-6 h-6 text-light/40 animate-spin' />
                </div>
            ) : auditLogs.length === 0 ? (
                <div className='text-light/40 text-sm py-8'>No audit logs found</div>
            ) : (
                <>
                    <div className='overflow-x-auto'>
                        <table className='table'>
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Actor</th>
                                    <th>Action</th>
                                    <th>Target</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditLogs.map((log) => (
                                    <tr key={log.id}>
                                        <td className='text-light/60'>{formatDate(log.createdAt)}</td>
                                        <td className='font-medium text-light'>{log.actorUsername || '—'}</td>
                                        <td>
                                            <span className='text-light/80'>{log.action || '—'}</span>
                                        </td>
                                        <td className='text-light/60'>
                                            {log.targetType && log.targetId ? `${log.targetType}:${log.targetId}` : '—'}
                                        </td>
                                        <td className='text-light/40 text-xs max-w-xs truncate'>
                                            {log.metadata ? JSON.stringify(log.metadata) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className='flex items-center justify-between mt-4 pt-4 border-t border-light/10'>
                        <div className='text-xs text-light/40'>
                            Showing {auditLogs.length} of {totalAudit} audit entries
                        </div>
                        <div className='flex gap-2'>
                            <button
                                onClick={() => loadAuditLogs({ page: auditPage - 1 })}
                                disabled={auditPage === 1}
                                className='btn btn-ghost disabled:opacity-50'
                            >
                                Previous
                            </button>
                            <button
                                onClick={() => loadAuditLogs({ page: auditPage + 1 })}
                                disabled={auditPage * auditLimit >= totalAudit}
                                className='btn btn-ghost disabled:opacity-50'
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

export default SettingsPage;
