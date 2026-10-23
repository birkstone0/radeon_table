// Minimal toast notifications (no extra dependency).
let seq = 0;
const listeners = new Set();

function emit(toast) {
    for (const listener of listeners) listener(toast);
}

export function addToast(message, variant = 'info') {
    seq += 1;
    const toast = { id: seq, message, variant };
    emit(toast);
    setTimeout(() => emit({ id: toast.id, dismiss: true }), 5000);
    return toast.id;
}

export function subscribeToast(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
