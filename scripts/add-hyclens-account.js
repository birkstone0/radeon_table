// Add a third account for hyclens to test limit enforcement
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');
const Account = require('../server/models/Account');

async function main() {
    console.log('[ADD] Adding a third account for hyclens...\n');

    // Connect to MongoDB
    await getConnection();
    console.log('[ADD] Connected to MongoDB\n');

    const username = 'hyclens';

    // Find user
    const user = await User.findOne({ usernameKey: username.toLowerCase() });
    if (!user) {
        console.log(`[ADD] User '${username}' not found`);
        process.exit(1);
    }

    console.log(`[ADD] User: ${user.username} (ID: ${user._id})`);

    // Check current account count
    const currentCount = await Account.countDocuments({ ownerId: user._id });
    console.log(`[ADD] Current account count: ${currentCount}`);

    if (currentCount >= 3) {
        console.log('[ADD] Already has 3 or more accounts');
        process.exit(0);
    }

    // Get an existing account to copy its structure
    const existingAccount = await Account.findOne({ ownerId: user._id });
    if (!existingAccount) {
        console.log('[ADD] No existing accounts to copy');
        process.exit(1);
    }

    // Add a third account by copying existing structure
    const newAccount = await Account.create({
        ownerId: user._id,
        phone: '09171234567',
        phoneMasked: '0917****4567',
        credRef: 'test_cred_ref_' + Date.now(),
        source: existingAccount.source,
        importBatchId: existingAccount.importBatchId,
        validationStatus: 'valid',
        processingStatus: 'pending'
    });

    console.log(`[ADD] ✓ Created account: ${newAccount.phoneMasked} (ID: ${newAccount._id})`);

    // Verify
    const newCount = await Account.countDocuments({ ownerId: user._id });
    console.log(`[ADD] New account count: ${newCount}`);
    console.log('\n[ADD] ✓ Account successfully added');
}

main()
    .then(() => {
        console.log('\n[ADD] Completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[ADD] Failed:', error);
        process.exit(1);
    });
