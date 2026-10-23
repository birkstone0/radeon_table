// Modal components with overlay and customizable content
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../styles/utils';
import { X } from 'lucide-react';

function Modal({ isOpen, onClose, title, children, size = 'md', className }) {
    const overlayRef = useRef();

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizeMap = {
        sm: 'max-w-md',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl'
    };

    return createPortal(
        <div ref={overlayRef} className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
            <div
                className={cn('w-full rounded-lg border border-green-800/50 bg-green-950/90 p-6 shadow-xl', sizeMap[size], className)}
                onClick={(e) => e.stopPropagation()}
            >
                <div className='flex items-center justify-between mb-4'>
                    <h2 className='text-xl font-semibold text-gray-100'>{title}</h2>
                    <button onClick={onClose} className='text-gray-400 hover:text-gray-200 transition-colors'>
                        <X className='w-5 h-5' />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
}

export { Modal };
