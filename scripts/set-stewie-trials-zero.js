// Migration script: Set Stewie's trial quotas to 0 and prevent restoration.
// Run once to apply the change to existing database.
const path = require('path');

// Load config from server
const config = require('../server/config');
const mongodb = require('../server/db/mongodb');
const User = require('../server/models/User');

async function setStewieTrialsToZero() {
    try {
        await mongodb.connect();
        console.log('[MIGRATION] Connected to MongoDB');

        const stewieUsername = config.credentials.userUsername || 'stewie';
        
        console.log(`[MIGRATION] Looking for user: ${stewieUsername}`);
        
        const user = await User.findOne({ usernameKey: stewieUsername.toLowerCase() });
        
        if (!user) {
            console.log(`[MIGRATION] User '${stewieUsername}' not found. No changes needed.`);
            return;
        }

        console.log(`[MIGRATION] Found user: ${user.username} (role: ${user.role})`);
        console.log(`[MIGRATION] Current trials:`, user.trials);

        const updateResult = await User.findByIdAndUpdate(user._id, {
            $set: {
                'trials.claim_daily_reward': 0,
                'trials.check_balance': 0
            }
        });

        console.log(`[MIGRATION] Updated trials for ${user.username} to 0`);
        console.log(`[MIGRATION] Claim Daily Reward trials: 0`);
        console.log(`[MIGRATION] Check Balance trials: 0`);
        
        const updatedUser = await User.findById(user._id);
        console.log(`[MIGRATION] Verified trials:`, updatedUser.trials);
        
        console.log('[MIGRATION] Migration completed successfully');
    } catch (error) {
        console.error('[MIGRATION] Error:', error);
        process.exit(1);
    } finally {
        await mongodb.getConnection().then(conn => conn.close()).catch(() => {});
    }
}

if (require.main === module) {
    setStewieTrialsToZero();
}

module.exports = { setStewieTrialsToZero };
