// Loader components with different sizes and variants
import React from 'react';
import { cn } from '../styles/utils';

function Spinner({ size = 'md', className }) {
    const sizeMap = {
        sm: 'w-4 h-4 border-2',
        md: 'w-6 h-6 border-2',
        lg: 'w-8 h-8 border-2',
        xl: 'w-12 h-12 border-3'
    };
    return <div className={cn('animate-spin rounded-full border-t-transparent border-green-400', sizeMap[size], className)} />;
}

function CircleSpinner({ size = 'md', className }) {
    const sizeMap = {
        sm: 'w-4 h-4',
        md: 'w-6 h-6',
        lg: 'w-8 h-8',
        xl: 'w-12 h-12'
    };
    return <Spinner size={size} classId={cn(sizeMap[size], 'border-green-400')} />;
}

function Dots({ size = 'md', className }) {
    const sizeMap = {
        sm: 'w-1.5 h-1.5',
        md: 'w-2 h-2',
        lg: 'w-2.5 h-2.5',
        xl: 'w-3 h-3'
    };
    return (
        <div className={cn('flex gap-1', className)}>
            {[1, 2, 3].map((i) => (
                <div
                    key={i}
                    className={cn('rounded-full bg-green-400 animate-pulse', sizeMap[size])}
                    style={{ animationDelay: `${i * 0.2}s` }}
                />
            ))}
        </div>
    );
}

function Pulse({ size = 'md', className }) {
    const sizeMap = {
        sm: 'w-2 h-2',
        md: 'w-3 h-3',
        lg: 'w-4 h-4',
        xl: 'w-6 h-6'
    };
    return (
        <div className={cn('rounded-full bg-green-400', sizeMap[size], className)}>
            <div className={cn('rounded-full bg-green-400 animate-ping absolute inset-0', sizeMap[size])} />
        </div>
    );
}

export { Spinner, CircleSpinner, Dots, Pulse };
