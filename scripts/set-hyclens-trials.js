// Set hyclens's trials to 3 for testing
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');

async function main() {
    console.log('[SET] Setting hyclens trials to 3 for testing...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[SET] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find and update user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[SET] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[SET] Current trials: ${JSON.stringify(user.trials)}`);

    // Update trials
    await User.findByIdAndUpdate(user._id, {
        'trials.claim_daily_reward': 3,
        'trials.check_balance': 3
    });

    console.log(`[SET] Updated trials to 3 each`);

    // Verify
    const updated = await User.findById(user._id);
    console.log(`[SET] Verified trials: ${JSON.stringify(updated.trials)}`);
    console.log('\n[SET] ✓ Trials successfully set');
}

main()
    .then(() => {
        console.log('\n[SET] Completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[SET] Failed:', error);
        process.exit(1);
    });
