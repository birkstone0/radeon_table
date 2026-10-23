// Seed script to create user 'hyclens' with secure password hashing.
// This script is idempotent: it checks for existing users and will not
// overwrite passwords or create duplicates.
const path = require('path');
const { getConnection } = require('../server/db/mongodb');
const users = require('../server/lib/users');

async function main() {
    console.log('[SEED] Starting user creation for hyclens...');

    // Connect to MongoDB
    await getConnection();
    console.log('[SEED] Connected to MongoDB');

    const username = 'hyclens';
    const password = 'hyclens12';
    const role = 'user';

    // Check if user already exists
    const existing = await users.findByUsername(username);
    if (existing) {
        console.log(`[SEED] User '${username}' already exists (id: ${existing._id}). Skipping creation.`);
        console.log(`[SEED] User role: ${existing.role}, status: ${existing.status}`);
        return;
    }

    // Create user with secure password hashing
    const user = await users.createUser({
        username,
        password,
        role,
        createdBy: null, // System-created, not by another user
        mustChangePassword: false,
        trials: { claim_daily_reward: 0, check_balance: 0 } // Regular-user defaults
    });

    console.log(`[SEED] User '${username}' created successfully (id: ${user._id})`);
    console.log(`[SEED] Role: ${user.role}, Status: ${user.status}`);
    console.log(`[SEED] Trials: claim_daily_reward=${user.trials.claim_daily_reward}, check_balance=${user.trials.check_balance}`);
    console.log(`[SEED] Access expiry: ${user.accessExpiresAt || 'None (unlimited)'}`);
}

main()
    .then(() => {
        console.log('[SEED] Seed completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[SEED] Seed failed:', error);
        process.exit(1);
    });
