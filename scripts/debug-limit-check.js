// Debug script to trace the limit enforcement
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');

async function main() {
    console.log('[DEBUG] Checking limit enforcement...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[DEBUG] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[DEBUG] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[DEBUG] User: ${user.username}`);
    console.log(`[DEBUG] Role: ${user.role}`);
    console.log(`[DEBUG] maxAccountsPerBatch: ${user.maxAccountsPerBatch}`);
    console.log(`[DEBUG] Type of maxAccountsPerBatch: ${typeof user.maxAccountsPerBatch}`);

    // Simulate the check
    const maxAccounts = user.maxAccountsPerBatch || 50;
    console.log(`[DEBUG] Computed maxAccounts: ${maxAccounts}`);

    const testSizes = [1, 2, 3, 5, 10];
    console.log('\n[DEBUG] Testing different batch sizes:');
    for (const size of testSizes) {
        const wouldReject = size > maxAccounts;
        console.log(`[DEBUG] Batch size ${size}: ${wouldReject ? 'REJECT' : 'ACCEPT'} (limit: ${maxAccounts})`);
    }
}

main()
    .then(() => {
        console.log('\n[DEBUG] Completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[DEBUG] Failed:', error);
        process.exit(1);
    });
