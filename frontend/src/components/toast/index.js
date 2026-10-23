// Notification / Toast components for user feedback
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { cn } from '../styles/utils';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info', duration = 5000) => {
        const id = Math.random().toString(36).substr(2, 9);
        setToasts((prev) => [...prev, { id, message, type, duration }]);
        if (duration > 0) {
            setTimeout(() => removeToast(id), duration);
        }
        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const value = { addToast };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

function ToastContainer({ toasts, removeToast }) {
    return (
        <div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2'>
            {toasts.map((toast) => (
                <Toast key={toast.id} {...toast} onRemove={removeToast} />
            ))}
        </div>
    );
}

function Toast({ id, message, type, onRemove }) {
    const icons = {
        success: <CheckCircle className='w-5 h-5 text-green-400' />,
        error: <AlertCircle className='w-5 h-5 text-red-400' />,
        warning: <AlertCircle className='w-5 h-5 text-yellow-400' />,
        info: <Info className='w-5 h-5 text-blue-400' />
    };

    const bgColors = {
        success: 'bg-green-900/90 border-green-700',
        error: 'bg-red-900/90 border-red-700',
        warning: 'bg-yellow-900/90 border-yellow-700',
        info: 'bg-blue-900/90 border-blue-700'
    };

    useEffect(() => {
        const timer = setTimeout(() => onRemove(id), 5000);
        return () => clearTimeout(timer);
    }, [id, onRemove]);

    return (
        <div className={cn('flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg', bgColors[type])}>
            {icons[type]}
            <p className='text-sm text-gray-200'>{message}</p>
            <button onClick={() => onRemove(id)} className='text-gray-400 hover:text-gray-200'>
                <X className='w-4 h-4' />
            </button>
        </div>
    );
}

export { ToastProvider, useToast };
export { default as ToastContainer } from './ToastContainer';
