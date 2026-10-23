// Check hyclens's accounts
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');
const Account = require('../server/models/Account');

async function main() {
    console.log('[CHECK] Fetching hyclens accounts...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[CHECK] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[CHECK] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[CHECK] User: ${user.username} (ID: ${user._id})`);

    // Find accounts
    const accounts = await Account.find({ ownerId: user._id });
    console.log(`[CHECK] Account count: ${accounts.length}`);

    if (accounts.length > 0) {
        console.log('[CHECK] Account IDs:');
        accounts.forEach((acc, i) => {
            console.log(`  ${i + 1}. ID: ${acc._id}, Phone: ${acc.phoneMasked}`);
        });
    } else {
        console.log('[CHECK] No accounts found for hyclens');
    }
}

main()
    .then(() => {
        console.log('\n[CHECK] Completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[CHECK] Failed:', error);
        process.exit(1);
    });
