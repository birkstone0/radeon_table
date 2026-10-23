// Common utilities for styles, formatting, and responsive behavior
export function cn(...classes) {
    return classes.filter(Boolean).join(' ');
}

export function formatPhone(phone) {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) {
        return digits.replace(/^(0\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
    }
    if (digits.length === 11 && digits.startsWith('63')) {
        return digits.replace(/^(63\d{3})(\d{3})(\d{4})$/, '+$1-$2-$3');
    }
    return phone;
}

export function getStatusColor(status) {
    const statusMap = {
        valid: 'bg-green-900/30 text-green-300 border-green-700',
        invalid: 'bg-red-900/30 text-red-300 border-red-700',
        needs_attention: 'bg-yellow-900/30 text-yellow-300 border-yellow-700'
    };
    return statusMap[status] || 'bg-gray-800/30 text-gray-400 border-gray-700';
}

export function getProcessingStatusColor(status) {
    const statusMap = {
        pending: 'bg-gray-800/30 text-gray-400 border-gray-700',
        queued: 'bg-blue-900/30 text-blue-300 border-blue-700',
        processing: 'bg-purple-900/30 text-purple-300 border-purple-700',
        claimed: 'bg-green-900/30 text-green-300 border-green-700',
        balance_checked: 'bg-cyan-900/30 text-cyan-300 border-cyan-700',
        failed: 'bg-red-900/30 text-red-300 border-red-700',
        needs_attention: 'bg-orange-900/30 text-orange-300 border-orange-700'
    };
    return statusMap[status] || 'bg-gray-800/30 text-gray-400 border-gray-700';
}

export function getOperationStatusColor(status) {
    const statusMap = {
        queued: 'bg-gray-800/30 text-gray-400 border-gray-700',
        processing: 'bg-blue-900/30 text-blue-300 border-blue-700',
        success: 'bg-green-900/30 text-green-300 border-green-700',
        failed: 'bg-red-900/30 text-red-700 border-red-800',
        cancelled: 'bg-yellow-900/30 text-yellow-400 border-yellow-800'
    };
    return statusMap[status] || 'bg-gray-800/30 text-gray-400 border-gray-700';
}

export function maskPhone(phone) {
    if (!phone) return '****';
    const digits = phone.replace(/\s/g, '');
    if (digits.length <= 6) return digits.slice(0, 2) + '*'.repeat(Math.max(digits.length - 2, 0));
    return digits.slice(0, 4) + '****' + digits.slice(-4);
}
