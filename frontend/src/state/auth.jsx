import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [mustChangePassword, setMustChangePassword] = useState(false);

    useEffect(() => {
        let active = true;
        authApi
            .session()
            .then(({ data }) => {
                if (!active) return;
                setUser(data.user);
                setMustChangePassword(Boolean(data.user && data.user.mustChangePassword));
            })
            .catch(() => {
                if (active) setUser(null);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const login = useCallback(async (username, password) => {
        const { data } = await authApi.login(username, password);
        setUser(data.user);
        setMustChangePassword(Boolean(data.user && data.user.mustChangePassword));
        return data;
    }, []);

    // Refresh the current user from the session so trial/access fields stay
    // current (e.g. when the admin edits access, or access expires).
    const refreshUser = useCallback(async () => {
        try {
            const { data } = await authApi.session();
            setUser(data.user);
            setMustChangePassword(Boolean(data.user && data.user.mustChangePassword));
            return data.user;
        } catch {
            return null;
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            await authApi.logout();
        } finally {
            setUser(null);
            setMustChangePassword(false);
        }
    }, []);

    const changePassword = useCallback(async (payload) => {
        const { data } = await authApi.changePassword(payload);
        setUser(data.user);
        setMustChangePassword(false);
        return data;
    }, []);

    const value = {
        user,
        loading,
        mustChangePassword,
        isAdmin: Boolean(user && user.role === 'admin'),
        login,
        logout,
        changePassword,
        refreshUser
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
