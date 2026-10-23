// Centralized API client. Sessions are HTTP-only cookies, so credentials are
// never stored in browser local storage: requests simply carry the cookie.
import axios from 'axios';

// Base URL comes from the frontend environment (VITE_API_BASE_URL). When it is
// unset, fall back to a same-origin relative path handled by the Vite dev proxy
// (or by Express serving the built app in production).
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({
    baseURL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' }
});

// Session expiry / deactivation surfaces as a 401 here: every consumer can
// react by clearing the cached user and returning to the login screen.
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const payload = {
            status: error.response ? error.response.status : 0,
            message: extractMessage(error),
            details: error.response && error.response.data && error.response.data.error
                ? error.response.data.error.details
                : undefined
        };
        return Promise.reject(payload);
    }
);

function extractMessage(error) {
    const data = error.response && error.response.data;
    if (data && data.error && data.error.message) return data.error.message;
    if (error.message) return error.message;
    // Network errors (CORS, timeout, no internet) without a response
    if (!error.response && error.code === 'ERR_NETWORK') {
        // Distinguish CORS from other network issues
        if (error.config && error.config.withCredentials) {
            return 'Connection error: Unable to reach the server. This may be a CORS configuration issue or the server is unavailable.';
        }
        return 'Network error: Unable to connect to the server. Please check your connection.';
    }
    return 'Unexpected error';
}

// Stable error message helper for UI copy. Never includes passwords.
export function errorMessage(error, fallback = 'Something went wrong.') {
    return error && error.message ? error.message : fallback;
}

export const authApi = {
    session: () => api.get('/auth/session'),
    login: (username, password) => api.post('/auth/login', { username, password }),
    logout: () => api.post('/auth/logout'),
    changePassword: (payload) => api.post('/auth/change-password', payload)
};

export const accountsApi = {
    summary: () => api.get('/accounts/summary'),
    list: (params) => api.get('/accounts', { params }),
    previewImport: (payload) => api.post('/accounts/imports/preview', payload),
    commitImport: (payload) => api.post('/accounts/imports', payload),
    clear: () => api.delete('/accounts/clear', { data: { confirm: true } }),
    remove: (accountId) => api.delete(`/accounts/${accountId}`)
};

export const operationsApi = {
    run: (payload) => api.post('/operations/run', payload),
    list: (params) => api.get('/operations', { params }),
    batchStatus: (operationIds) => api.post('/operations/batch-status', { operationIds }),
    clear: () => api.delete('/operations/clear', { data: { confirm: true } }),
    cancel: (operationId) => api.post(`/operations/${operationId}/cancel`, {})
};

export const adminApi = {
    overview: () => api.get('/admin/overview'),
    users: (params) => api.get('/admin/users', { params }),
    createUser: (payload) => api.post('/admin/users', payload),
    activateUser: (userId) => api.post(`/admin/users/${userId}/activate`, {}),
    deactivateUser: (userId) => api.post(`/admin/users/${userId}/deactivate`, {}),
    revokeUser: (userId) => api.post(`/admin/users/${userId}/revoke`, {}),
    updateAccess: (userId, payload) => api.post(`/admin/users/${userId}/access`, payload),
    resetPassword: (userId, payload) => api.post(`/admin/users/${userId}/reset-password`, payload),
    deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
    userAccounts: (userId, params) => api.get(`/admin/users/${userId}/accounts`, { params }),
    userOperations: (userId, params) => api.get(`/admin/users/${userId}/operations`, { params }),
    operations: (params) => api.get('/admin/operations', { params }),
    audit: (params) => api.get('/admin/audit', { params })
};
