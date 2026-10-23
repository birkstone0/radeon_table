// Dashboard: concise overview with a small number of meaningful metrics and a
// next-steps section. Every number comes from the real backend workspace.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Phone, ListChecks, ArrowRight, Clock, Shield } from 'lucide-react';
import { accountsApi } from '../lib/api';
import { useAuth } from '../state/auth';

function formatRemaining(expiresAt) {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h left`;
}

function DashboardPage() {
    const auth = useAuth();
    const [summary, setSummary] = useState(null);

    const isAdmin = Boolean(auth.user && auth.user.role === 'admin');

    useEffect(() => {
        let active = true;
        accountsApi
            .summary()
            .then(({ data }) => {
                if (!active) return;
                setSummary(data);
            })
            .catch(() => {
                if (active) setSummary(null);
            });
        return () => {
            active = false;
        };
    }, []);

    const hasAccounts = Boolean(summary && summary.total > 0);
    const u = auth.user;
    const remaining = u && !isAdmin ? formatRemaining(u.accessExpiresAt) : null;

    return (
        <div className='page'>
            <h1 className='page-title'>Dashboard</h1>
            <p className='page-description'>Overview of your imported accounts and the operations run against them.</p>

            <div className='divider' />

            {u && (
                <div className='mb-5 flex flex-wrap items-center gap-2'>
                    {isAdmin ? (
                        <>
                            <span className='badge badge-success'>
                                <Shield className='w-3 h-3 mr-1' /> Administrator — unlimited access
                            </span>
                            <span className='badge badge-success'>Claim trials: Unlimited</span>
                            <span className='badge badge-success'>Balance trials: Unlimited</span>
                        </>
                    ) : (
                        <>
                            {u.accessExpired ? (
                                <span className='badge badge-danger'>
                                    <Clock className='w-3 h-3 mr-1' /> Account Access Expired — contact an administrator
                                </span>
                            ) : remaining ? (
                                <span className='badge badge-success'>
                                    <Clock className='w-3 h-3 mr-1' /> Access {remaining}
                                </span>
                            ) : (
                                <span className='badge badge-neutral'>
                                    <Clock className='w-3 h-3 mr-1' /> No timed access set
                                </span>
                            )}
                            {(u.trials?.claim_daily_reward ?? 0) > 0 || (u.trials?.check_balance ?? 0) > 0 ? (
                                <>
                                    <span className='badge badge-neutral'>Claim trials: {u.trials?.claim_daily_reward ?? 0}</span>
                                    <span className='badge badge-neutral'>Balance trials: {u.trials?.check_balance ?? 0}</span>
                                </>
                            ) : null}
                        </>
                    )}
                </div>
            )}

            <div className='grid grid-cols-1 gap-6 sm:grid-cols-3'>
                <div>
                    <p className='stat-label'>Total accounts</p>
                    <p className='stat-value'>{summary ? summary.total : '—'}</p>
                    <p className='stat-hint'>Imported records on file</p>
                </div>
                <div>
                    <p className='stat-label'>Needs attention</p>
                    <p className='stat-value'>{summary ? summary.needsAttention : '—'}</p>
                    <p className='stat-hint'>Pending, failed or flagged</p>
                </div>
                <div>
                    <p className='stat-label'>Completed operations</p>
                    <p className='stat-value'>{summary ? summary.completed : '—'}</p>
                    <p className='stat-hint'>Successful logins and claims</p>
                </div>
            </div>

            <div className='divider' />

            <h2 className='page-title'>Next steps</h2>
            <p className='page-description'>Import accounts, review the records, then follow up in activity.</p>

            <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3'>
                <Link className='card group flex flex-col gap-2 p-4 no-underline transition-colors hover:border-accent/40' to='/accounts'>
                    <FileText className='h-4 w-4 text-accent' />
                    <span className='text-sm font-medium text-light'>Manage accounts</span>
                    <span className='text-xs text-light/50'>Review validation and processing status for every record.</span>
                    <span className='mt-auto inline-flex items-center gap-1 text-xs text-accent'>
                        Open accounts <ArrowRight className='h-3 w-3' />
                    </span>
                </Link>
                <Link className='card group flex flex-col gap-2 p-4 no-underline transition-colors hover:border-accent/40' to='/accounts'>
                    <Phone className='h-4 w-4 text-accent' />
                    <span className='text-sm font-medium text-light'>Import accounts</span>
                    <span className='text-xs text-light/50'>Add phone:password lines or phone numbers with a shared password.</span>
                    <span className='mt-auto inline-flex items-center gap-1 text-xs text-accent'>
                        Start an import <ArrowRight className='h-3 w-3' />
                    </span>
                </Link>
                <Link className='card group flex flex-col gap-2 p-4 no-underline transition-colors hover:border-accent/40' to='/activity'>
                    <ListChecks className='h-4 w-4 text-accent' />
                    <span className='text-sm font-medium text-light'>View results</span>
                    <span className='text-xs text-light/50'>See actual outcomes from logins, claims and balance checks.</span>
                    <span className='mt-auto inline-flex items-center gap-1 text-xs text-accent'>
                        Open activity <ArrowRight className='h-3 w-3' />
                    </span>
                </Link>
            </div>

            {!hasAccounts && (
                <>
                    <div className='divider' />
                    <p className='text-xs text-light/40'>No accounts imported yet — start with a TXT or shared-password import.</p>
                </>
            )}
        </div>
    );
}

export default DashboardPage;
