import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import { useAuth } from './state/auth';
import { DashboardPage, AccountsPage, ActivityPage, LoginPage, UserManagementPage, SettingsPage, RegisterPage } from './pages';

function ProtectedRoute({ children, adminOnly = false }) {
    const auth = useAuth();

    if (auth.loading) {
        return (
            <div className='min-h-screen bg-base flex items-center justify-center'>
                <div className='text-gray-400'>Loading...</div>
            </div>
        );
    }

    if (!auth.user) return <Navigate to='/login' replace />;

    // Role is verified server-side on every request; this is navigation only.
    if (adminOnly && !auth.isAdmin) return <Navigate to='/' replace />;

    return children;
}

function App() {
    const auth = useAuth();

    return (
        <Routes>
            <Route
                path='/login'
                element={auth.user ? <Navigate to='/' replace /> : <LoginPage />}
            />
            <Route
                path='/'
                element={
                    <ProtectedRoute>
                        <AppLayout />
                    </ProtectedRoute>
                }
            >
                <Route index element={<DashboardPage />} />
                <Route path='accounts' element={<AccountsPage />} />
                <Route path='register' element={<RegisterPage />} />
                <Route path='activity' element={<ActivityPage />} />
                <Route
                    path='admin/users'
                    element={
                        <ProtectedRoute adminOnly>
                            <UserManagementPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path='admin/settings'
                    element={
                        <ProtectedRoute adminOnly>
                            <SettingsPage />
                        </ProtectedRoute>
                    }
                />
                <Route path='*' element={<Navigate to='/' replace />} />
            </Route>
        </Routes>
    );
}

export default App;
