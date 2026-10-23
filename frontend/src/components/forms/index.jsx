// Reusable form input components with consistent styling and validation states
import React, { forwardRef } from 'react';
import { cn } from '../../styles/utils';
import { Eye, EyeOff } from 'lucide-react';

function Input({ className, error, ...props }) {
    return (
        <input
            className={cn(
                'w-full rounded-md border border-light/15 bg-base px-3.5 py-2.5 text-sm text-light placeholder-light/30 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40',
                error && 'border-red-500',
                className
            )}
            {...props}
        />
    );
}

function Textarea({ className, error, ...props }) {
    return (
        <textarea
            className={cn(
                'w-full px-3 py-2 bg-green-950/40 border border-green-800/50 rounded-md',
                'text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent',
                'resize-y min-h-[80px]',
                error && 'border-red-500',
                className
            )}
            {...props}
        />
    );
}

function Select({ className, error, children, ...props }) {
    return (
        <select
            className={cn(
                'w-full px-3 py-2 bg-green-950/40 border border-green-800/50 rounded-md',
                'text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500',
                error && 'border-red-500',
                className
            )}
            {...props}
        >
            {children}
        </select>
    );
}

function Label({ className, ...props }) {
    return <label className={cn('block text-xs font-medium text-light/60', className)} {...props} />;
}

function InputGroup({ label, error, children, ...props }) {
    return (
        <div {...props}>
            {label && <Label>{label}</Label>}
            {React.isValidElement(children) ? React.cloneElement(children, { error }) : children}
            {error && <p className='mt-1 text-sm text-red-400'>{error}</p>}
        </div>
    );
}

function PasswordInput({ className, error, value, onChange, ...props }) {
    const [showPassword, setShowPassword] = React.useState(false);
    return (
        <div className='relative'>
            <Input
                type={showPassword ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                className={cn('pr-10', className)}
                error={error}
                {...props}
            />
            <button
                type='button'
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className='absolute right-3 top-1/2 transform -translate-y-1/2 text-light/40 transition-colors hover:text-light focus:outline-none'
            >
                {showPassword ? <EyeOff className='w-4 h-4' /> : <Eye className='w-4 h-4' />}
            </button>
        </div>
    );
}

export { Input, Textarea, Select, Label, InputGroup, PasswordInput };
