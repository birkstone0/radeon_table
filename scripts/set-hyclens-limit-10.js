// Set hyclens's maxAccountsPerBatch to 10 for testing
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');

async function main() {
    console.log('[SET] Setting hyclens maxAccountsPerBatch to 10 for testing...\n');

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

    console.log(`[SET] Current maxAccountsPerBatch: ${user.maxAccountsPerBatch}`);

    // Update the limit
    await User.findByIdAndUpdate(user._id, { maxAccountsPerBatch: 10 });

    console.log(`[SET] Updated maxAccountsPerBatch to 10`);

    // Verify
    const updated = await User.findById(user._id);
    console.log(`[SET] Verified maxAccountsPerBatch: ${updated.maxAccountsPerBatch}`);
    console.log('\n[SET] ✓ Limit successfully set to 10');
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
