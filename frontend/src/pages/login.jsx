// Login page for authentication. Minimalist dark-green console theme using the
// established palette (#191A19, #1E5128, #4E9F3D, #D8E9A8) and Poppins typeface.
import React, { useState } from 'react';
import { useAuth } from '../state/auth';
import { PasswordInput, Label } from '../components/forms/index.jsx';
import { useNavigate } from 'react-router-dom';

function LoginPage() {
    const auth = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await auth.login(username, password);
            const { user } = auth;
            if (user && user.role === 'admin') {
                navigate('/admin/users');
            } else {
                navigate('/');
            }
        } catch (err) {
            setError(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='flex min-h-screen items-center justify-center bg-base px-4 py-10 sm:px-6'>
            <div className='w-full max-w-sm rounded-xl border border-light/10 bg-white/[0.02] p-8 shadow-2xl shadow-black/40 sm:p-10'>
                <div className='mb-9 text-center'>
                    <div className='mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30 ring-1 ring-light/20'>
                        <span className='text-xl font-bold leading-none text-light'>T</span>
                    </div>
                    <h1 className='text-2xl font-semibold tracking-tight text-light'>TablePH VIP Console</h1>
                    <p className='mt-2 text-sm text-light/50'>Sign in to your account</p>
                </div>

                <form onSubmit={handleSubmit} className='space-y-5'>
                    <div className='space-y-1.5'>
                        <Label className='text-light/60'>Username</Label>
                        <input
                            type='text'
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            autoComplete='username'
                            autoCapitalize='none'
                            autoCorrect='off'
                            className='w-full rounded-md border border-light/15 bg-base px-3.5 py-2.5 text-sm text-light placeholder-light/30 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40'
                            placeholder='Enter your username'
                        />
                    </div>

                    <div className='space-y-1.5'>
                        <Label className='text-light/60'>Password</Label>
                        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete='current-password' placeholder='Enter password' />
                    </div>

                    {error && (
                        <div className='rounded-md border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200'>
                            {error}
                        </div>
                    )}

                    <button
                        type='submit'
                        disabled={loading}
                        className='flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-light shadow-lg shadow-primary/20 transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base disabled:cursor-not-allowed disabled:opacity-50'
                    >
                        {loading ? 'Signing in…' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default LoginPage;
