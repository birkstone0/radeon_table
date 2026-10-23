// Script to update password hashes for initial accounts
const bcrypt = require('bcryptjs');
const db = require('../server/db');

const BCRYPT_ROUNDS = 10;

function hashPasswordSync(password) {
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function main() {
    const now = new Date().toISOString();
    
    // Update hoshex password to holyshit12
    const hoshexHash = hashPasswordSync('holyshit12');
    db.run('UPDATE users SET password_hash = :hash, updated_at = :now WHERE username = :username', { hash: hoshexHash, now, username: 'hoshex' });
    console.log('Updated hoshex password hash');
    
    // Update stewie password to @stew12
    const stewieHash = hashPasswordSync('@stew12');
    db.run('UPDATE users SET password_hash = :hash, updated_at = :now WHERE username = :username', { hash: stewieHash, now, username: 'stewie' });
    console.log('Updated stewie password hash');
    
    // Verify the updates
    const users = db.all('SELECT id, username, role, status FROM users');
    console.log('\nCurrent users:');
    users.forEach(u => {
        console.log(`  ${u.id}: ${u.username} (${u.role}, ${u.status})`);
    });
    
    console.log('\nPassword hashes updated successfully');
}

main();
