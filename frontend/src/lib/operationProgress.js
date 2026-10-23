// Module-level operation progress store.
//
// A single active operation panel is rendered globally (in AppLayout) so it
// survives route changes and can be reopened from Activity. This store holds
// the latest submitted operation identity and lets any page open or re-open it.
let state = {
    operationIds: [],
    operationType: null,
    active: false,
    minimized: false
};

const listeners = new Set();

function emit() {
    for (const listener of listeners) listener(state);
}

export function openProgress(operationIds, operationType) {
    console.log('[operationProgress] openProgress called:', { operationIds, operationType });
    state = {
        operationIds: operationIds || [],
        operationType: operationType || null,
        active: true,
        minimized: false
    };
    console.log('[operationProgress] New state:', state);
    emit();
}

export function setProgressMinimized(minimized) {
    state = { ...state, minimized };
    emit();
}

export function closeProgress() {
    state = { ...state, active: false };
    emit();
}

export function getProgressState() {
    return state;
}

export function subscribeProgress(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// True when an operation of the same type is currently being watched, used to
// prevent duplicate submissions for the same operation. Updated to allow
// different operation types to run simultaneously (e.g., claim and balance check).
export function hasActiveOperation(operationType) {
    // Only block if the exact same operation type is already active
    // This allows claim_daily_reward and check_balance to run concurrently
    return state.active && !state.minimized && state.operationType === operationType;
}