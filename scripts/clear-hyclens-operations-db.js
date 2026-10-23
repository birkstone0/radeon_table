// Clear hyclens's operations directly from MongoDB
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');
const Operation = require('../server/models/Operation');

async function main() {
    console.log('[CLEAR] Clearing hyclens operations from MongoDB...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[CLEAR] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[CLEAR] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[CLEAR] User: ${user.username} (ID: ${user._id})`);

    // Count operations
    const count = await Operation.countDocuments({ ownerId: user._id });
    console.log(`[CLEAR] Operation count: ${count}`);

    if (count > 0) {
        // Delete all operations
        await Operation.deleteMany({ ownerId: user._id });
        console.log(`[CLEAR] ✓ Deleted ${count} operations`);
    } else {
        console.log('[CLEAR] No operations to clear');
    }
}

main()
    .then(() => {
        console.log('\n[CLEAR] Completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[CLEAR] Failed:', error);
        process.exit(1);
    });
