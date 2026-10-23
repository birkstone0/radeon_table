import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './state/auth.jsx';
import { subscribeToast } from './lib/toast';
import { cn } from './styles/utils';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import './styles.css';

function ToastManager() {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const unsubscribe = subscribeToast((toast) => {
            if (toast.dismiss) {
                setToasts((prev) => prev.filter((t) => t.id !== toast.id));
            } else {
                setToasts((prev) => [...prev, toast]);
            }
        });
        return unsubscribe;
    }, []);

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

    return (
        <div className='fixed bottom-4 right-4 z-50 flex flex-col gap-2'>
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={cn('flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg', bgColors[toast.variant])}
                >
                    {icons[toast.variant]}
                    <p className='text-sm text-gray-200'>{toast.message}</p>
                    <button
                        onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                        className='text-gray-400 hover:text-gray-200'
                    >
                        <X className='w-4 h-4' />
                    </button>
                </div>
            ))}
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter>
            <AuthProvider>
                <App />
                <ToastManager />
            </AuthProvider>
        </BrowserRouter>
    </React.StrictMode>
);
