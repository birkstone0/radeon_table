// Add 10 accounts for hyclens to test per-account trial charging
const { getConnection } = require('../server/db/mongodb');
const User = require('../server/models/User');
const Account = require('../server/models/Account');

async function main() {
    console.log('[ADD] Adding 10 accounts for hyclens...\n');

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

    // Get an existing account to copy structure
    const existingAccount = await Account.findOne({ ownerId: user._id });
    if (!existingAccount) {
        console.log('[ADD] No existing accounts to copy');
        process.exit(1);
    }

    // Clear existing accounts first
    await Account.deleteMany({ ownerId: user._id });
    console.log('[ADD] Cleared existing accounts');

    // Add 10 new accounts
    for (let i = 0; i < 10; i++) {
        const phone = `0917${String(i).padStart(8, '0')}`;
        const phoneMasked = `0917****${String(i).padStart(4, '0')}`;
        await Account.create({
            ownerId: user._id,
            phone: phone,
            phoneMasked: phoneMasked,
            credRef: `test_cred_ref_${Date.now()}_${i}`,
            source: existingAccount.source,
            importBatchId: existingAccount.importBatchId,
            validationStatus: 'valid',
            processingStatus: 'pending'
        });
        console.log(`[ADD] Created account ${i + 1}: ${phoneMasked}`);
    }

    // Verify
    const newCount = await Account.countDocuments({ ownerId: user._id });
    console.log(`[ADD] New account count: ${newCount}`);
    console.log('\n[ADD] ✓ 10 accounts successfully added');
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
