// Shared shell with all pages. Mirrors the existing static sidebar design: compact,
// dark, using the TablePH VIP color palette, and active-green indicators.
import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth';
import { cn } from '../styles/utils';
import { Home, Users, ActivitySquare, LogOut, Settings, UserCog, Menu, X, ChevronLeft } from 'lucide-react';
import OperationProgressModal from '../components/OperationProgressModal';
import { subscribeProgress, setProgressMinimized, closeProgress } from '../lib/operationProgress';

const navItemClass = 'flex items-center gap-3 px-4 py-3 rounded-md text-sm transition-colors';
const activeClass = 'bg-green-900/40 text-green-300 border-l-4 border-green-400';
const inactiveClass = 'text-gray-400 hover:bg-green-900/20 hover:text-green-200';

function AppLayout() {
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [progress, setProgress] = useState(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const unsubscribe = subscribeProgress((next) => {
            setProgress(next);
        });
        return unsubscribe;
    }, []);

    // Close mobile menu on route change
    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);

    // Close mobile menu on escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && mobileMenuOpen) {
                setMobileMenuOpen(false);
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [mobileMenuOpen]);

    const handleLogout = async () => {
        await auth.logout();
        navigate('/login');
    };

    const toggleSidebar = () => {
        setSidebarCollapsed(!sidebarCollapsed);
    };

    const toggleMobileMenu = () => {
        setMobileMenuOpen(!mobileMenuOpen);
    };

    if (auth.loading) {
        return <div className='min-h-screen bg-base flex items-center justify-center'><div className='text-gray-400'>Loading...</div></div>;
    }

    if (!auth.user) {
        navigate('/login');
        return null;
    }

    const isAdmin = auth.isAdmin;

    const regularNav = [
        { to: '/', label: 'Dashboard', icon: Home },
        { to: '/accounts', label: 'Accounts', icon: Users },
        { to: '/activity', label: 'Activity', icon: ActivitySquare }
    ];

    const adminNav = [
        { to: '/admin/users', label: 'User Management', icon: UserCog },
        { to: '/admin/settings', label: 'System Settings', icon: Settings }
    ];

    const commonNav = [
        { to: '/logout', label: 'Logout', icon: LogOut }
    ];

    const navItems = isAdmin ? [...regularNav, ...adminNav, ...commonNav] : [...regularNav, ...commonNav];

    return (
        <div className='min-h-screen bg-base text-gray-100 flex'>
            {/* Mobile menu overlay */}
            {mobileMenuOpen && (
                <div
                    className='fixed inset-0 z-50 bg-black/60 lg:hidden'
                    onClick={toggleMobileMenu}
                    aria-hidden='true'
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    'fixed lg:static inset-y-0 left-0 z-50 bg-green-950/80 border-r border-green-900/40 flex flex-col transition-all duration-300',
                    mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
                    sidebarCollapsed ? 'lg:w-16' : 'lg:w-64',
                    'w-64'
                )}
            >
                {/* Logo and collapse toggle */}
                <div className={cn('p-4 flex items-center justify-between', sidebarCollapsed && 'lg:justify-center')}>
                    <div className={cn('flex items-center gap-2', sidebarCollapsed && 'lg:justify-center lg:w-full')}>
                        <div className='w-8 h-8 bg-primary rounded flex items-center justify-center shrink-0'>
                            <span className='text-white font-bold'>T</span>
                        </div>
                        <h1 className={cn('text-xl font-bold text-green-300 transition-opacity duration-200', sidebarCollapsed && 'lg:hidden')}>TablePH VIP</h1>
                    </div>
                    {/* Collapse toggle button (desktop only) */}
                    <button
                        onClick={toggleSidebar}
                        className={cn('hidden lg:flex p-2 text-light/60 hover:text-light rounded hover:bg-white/10', sidebarCollapsed && 'rotate-180')}
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        <ChevronLeft className='w-4 h-4' />
                    </button>
                    {/* Close button (mobile only) */}
                    <button
                        onClick={toggleMobileMenu}
                        className='lg:hidden p-2 text-light/60 hover:text-light rounded hover:bg-white/10'
                        title='Close menu'
                    >
                        <X className='w-5 h-5' />
                    </button>
                </div>

                {/* Navigation */}
                <nav className={cn('flex-1 overflow-y-auto px-2 space-y-1', sidebarCollapsed && 'lg:px-1')}>
                    {navItems.map((item) => (
                        item.to === '/logout' ? (
                            <button
                                key={item.to}
                                onClick={handleLogout}
                                className={cn(
                                    navItemClass,
                                    inactiveClass,
                                    'w-full text-left',
                                    sidebarCollapsed && 'lg:justify-center lg:px-3'
                                )}
                                title={sidebarCollapsed ? item.label : undefined}
                            >
                                <item.icon className={cn('w-5 h-5 shrink-0', sidebarCollapsed && 'lg:w-6 lg:h-6')} />
                                <span className={cn('transition-opacity duration-200', sidebarCollapsed && 'lg:hidden')}>{item.label}</span>
                            </button>
                        ) : (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={() => setMobileMenuOpen(false)}
                                className={({ isActive }) => cn(
                                    navItemClass,
                                    isActive ? activeClass : inactiveClass,
                                    sidebarCollapsed && 'lg:justify-center lg:px-3'
                                )}
                                end={item.to === '/'}
                                title={sidebarCollapsed ? item.label : undefined}
                            >
                                <item.icon className={cn('w-5 h-5 shrink-0', sidebarCollapsed && 'lg:w-6 lg:h-6')} />
                                <span className={cn('transition-opacity duration-200', sidebarCollapsed && 'lg:hidden')}>{item.label}</span>
                            </NavLink>
                        )
                    ))}
                </nav>

                {/* User profile section */}
                <div className={cn('p-4 border-t border-green-900/40', sidebarCollapsed && 'lg:px-2')}>
                    <div className={cn('flex items-center gap-3 px-2 py-3', sidebarCollapsed && 'lg:justify-center lg:px-0')}>
                        <div className='w-9 h-9 bg-accent rounded-full flex items-center justify-center shrink-0'>
                            <span className='text-white font-semibold text-sm'>{(auth.user.username || '?').charAt(0).toUpperCase()}</span>
                        </div>
                        <div className={cn('flex-1 min-w-0 transition-opacity duration-200', sidebarCollapsed && 'lg:hidden')}>
                            <div className='text-sm font-medium text-gray-200 truncate'>{auth.user.username}</div>
                            <div className='text-xs text-gray-500 capitalize'>{auth.user.role}</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className='flex-1 overflow-auto'>
                {/* Mobile header with hamburger menu */}
                <div className='lg:hidden flex items-center justify-between p-4 border-b border-green-900/40 bg-green-950/80'>
                    <div className='flex items-center gap-2'>
                        <div className='w-8 h-8 bg-primary rounded flex items-center justify-center'>
                            <span className='text-white font-bold'>T</span>
                        </div>
                        <h1 className='text-lg font-bold text-green-300'>TablePH VIP</h1>
                    </div>
                    <button
                        onClick={toggleMobileMenu}
                        className='p-2 text-light/60 hover:text-light rounded hover:bg-white/10'
                        aria-label='Open menu'
                    >
                        <Menu className='w-6 h-6' />
                    </button>
                </div>

                {/* Page content */}
                <div className='p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto'>
                    <Outlet />
                </div>
            </main>

            {/* Operation progress modal */}
            {progress && progress.active && (
                <OperationProgressModal
                    operationIds={progress.operationIds}
                    operationType={progress.operationType}
                    minimized={progress.minimized}
                    onMinimize={() => setProgressMinimized(true)}
                    onClose={closeProgress}
                />
            )}
        </div>
    );
}

export default AppLayout;
