import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

function EmptyState({ title, description, action }) {
    return (
        <div className='rounded-lg border border-green-900/40 bg-green-950/40 p-12 text-center'>
            <div className='mx-auto max-w-md'>
                <h3 className='text-lg font-semibold text-gray-200 mb-2'>{title}</h3>
                <p className='text-gray-400 mb-6'>{description}</p>
                {action}
            </div>
        </div>
    );
}

function Welcome() {
    return <EmptyState title='Welcome to TablePH VIP Console' description='Select a navigation item to get started' action={null} />;
}

function NotFound() {
    return <EmptyState title='Page not found' description='The requested page does not exist' action={<Link to='/' className='inline-block px-4 py-2 bg-primary text-white rounded hover:bg-green-700 transition-colors'>Go to Dashboard</Link>} />;
}

export { EmptyState, Welcome, NotFound };
