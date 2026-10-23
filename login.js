// language: JavaScript, file: login.js
const axios = require('axios');
const CryptoJS = require('crypto-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
    baseURL: 'https://www.tablephvip.com',
    loginEndpoint: '/lobby/api/user/login',
    claimEndpoints: [
        '/lobby/api/continuous_check_in/claim',
        '/lobby/api/continuous_check_in/action',
        '/lobby/api/continuous_check_in/sign'
    ],
    walletEndpoint: '/lobby/api/wallet?reserve=1',
    accountsFile: 'accounts.txt',
    tokensFile: 'tokens.json',
    countryCode: '+63',
    rsaPublicKey: `-----BEGIN RSA PUBLIC KEY-----
MEgCQQDma8beoM2DXKLKZnJypL3byVzsXj5nOblDdN5gFQT5UiDoROCfIXaXlf0H
POcbd3KpVmEIucQjBB03up6IqK7PAgMBAAE=
-----END RSA PUBLIC KEY-----`,
    appVersion: '1.0.2',
    channelId: 2,
    gameVersion: 21,
    hmacSecret: 'UrgHp*co13a8',
    systemKey: 'UrgHp*co13a8',
    passwordSalt: 'd41d8cd98f00b204e9800998ecf8427e' 
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// --- Crypto Helpers ---
function rsaEncrypt(text, publicKey) {
    return crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text)).toString('base64');
}
function base64Encode(str) { return Buffer.from(str).toString('base64'); }
function hmacSha256(text, secret) { return CryptoJS.HmacSHA256(text, secret).toString(CryptoJS.enc.Base64); }

function generateSecurityHeader(url, method, params, data) {
    const time = Math.floor(Date.now() / 1000);
    const dataStr = method.toUpperCase() === 'GET' ? '' : (typeof data === 'string' ? data : JSON.stringify(data || {}));
    const dataHash = CryptoJS.MD5(dataStr).toString();
    const signUrl = params ? `${url}?${params}` : url;
    const signPayload = [time.toString(), method.toUpperCase(), signUrl, '', dataHash].join('\n');
    const signature = hmacSha256(signPayload, CONFIG.hmacSecret);
    const rsaPayload = ['type=0', `key=${base64Encode(CONFIG.systemKey)}`, `time=${time}`].join(';');
    const secret = rsaEncrypt(rsaPayload, CONFIG.rsaPublicKey);
    return `key=${CONFIG.systemKey};secret=${secret};signature=${signature}`;
}

function generateDeviceId() {
    const ua = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
    return Buffer.from(ua).toString('base64').substring(0, 20) + String(Math.random() * 10000000).slice(0, 5) + String(Date.now()).slice(-5);
}

function generateJunkFields(targetObj, min, max) {
    const count = Math.floor(Math.random() * (max - min + 1)) + min;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < count; i++) {
        const len = Math.floor(Math.random() * 3) + 3; 
        let key = '';
        for (let j = 0; j < len; j++) key += chars.charAt(Math.floor(Math.random() * chars.length));
        if (Math.random() > 0.5) {
            targetObj[key] = Math.floor(Math.random() * 10);
        } else {
            targetObj[key] = chars.charAt(Math.floor(Math.random() * 26)).repeat(Math.floor(Math.random() * 32) + 1);
        }
    }
}

function getBaseHeaders(token, deviceId, securityHeader) {
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-ChannelID': CONFIG.channelId.toString(),
        'Accept-DeviceID': deviceId,
        'Accept-PlatformID': '3',
        'Accept-Version': CONFIG.appVersion,
        'Accept-SubChannelID': '0',
        'Accept-Language': 'en',
        'Origin': CONFIG.baseURL,
        'Referer': CONFIG.baseURL + '/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
        'x-content-security': securityHeader,
        'Authorization': token
    };
}

// --- Account Parsing Helpers ---

function normalizePhone(phone) {
    if (typeof phone !== 'string') return '';
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) return '';
    return cleaned;
}

function parseAccountLine(line) {
    if (typeof line !== 'string') return { ok: false, error: 'Invalid line' };
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return { ok: false, error: 'Empty or comment line' };
    
    const parts = trimmed.split(':');
    if (parts.length < 2) return { ok: false, error: 'Invalid format (expected phone:password)' };
    
    const phone = normalizePhone(parts[0]);
    if (!phone) return { ok: false, error: 'Invalid phone number' };
    
    const password = parts.slice(1).join(':').trim();
    if (!password) return { ok: false, error: 'Password is required' };
    
    return { ok: true, phone, password };
}

// --- Core Logic ---

async function loginAccount(localPhone, password) {
    const apiPhone = localPhone.startsWith(CONFIG.countryCode) ? localPhone : CONFIG.countryCode + localPhone.replace(/^0+/, '');
    const deviceId = generateDeviceId();
    const passwordB64 = base64Encode(password + CONFIG.passwordSalt);

    const payload = {
        mobile: apiPhone, password: passwordB64, client_type: 1, device_id: deviceId, client_id: deviceId,
        device_detail: "Android Pixel 10", device_model: "H5", os_version: "Chrome",
        app_version: CONFIG.appVersion, game_version: CONFIG.gameVersion, ticket: "",
        login_finger: "551787c1f915d8736807ad438e94816e",
    };

    generateJunkFields(payload, 2, 10);
    const securityHeader = generateSecurityHeader(CONFIG.loginEndpoint, 'POST', '', payload);
    const headers = getBaseHeaders('', deviceId, securityHeader);
    delete headers['Authorization'];

    try {
        const response = await axios.post(CONFIG.baseURL + CONFIG.loginEndpoint, payload, { headers });
        if (response.data && response.data.code === 0) {
            return { success: true, data: response.data.data, deviceId };
        }
        return { success: false, error: response.data.msg || 'Login failed' };
    } catch (error) {
        return { success: false, error: error.response?.data?.msg || error.message };
    }
}

async function claimDailyReward(token, deviceId) {
    const payload = {}; 
    
    for (const endpoint of CONFIG.claimEndpoints) {
        const securityHeader = generateSecurityHeader(endpoint, 'POST', '', payload);
        const headers = getBaseHeaders(token, deviceId, securityHeader);

        try {
            const response = await axios.post(CONFIG.baseURL + endpoint, payload, { headers });
            
            if (response.data && response.data.code === 0) {
                let rewardStr = "Claimed successfully!";
                if (response.data.data) {
                    if (response.data.data.amount) rewardStr = `₱${(response.data.data.amount / 10000).toFixed(2)}`;
                    else if (response.data.data.reward_amount) rewardStr = `₱${(response.data.data.reward_amount / 10000).toFixed(2)}`;
                    else if (response.data.data.reward !== undefined) rewardStr = `₱${(response.data.data.reward / 10000).toFixed(2)}`;
                }
                return { success: true, msg: rewardStr };
            } else {
                const msg = response.data.msg || '';
                if (msg.includes('already been handled') || msg.includes('already claimed')) {
                    return { success: true, msg: "Already claimed today" };
                }
                return { success: false, msg: msg || 'Claim rejected' };
            }
        } catch (error) {
            if (error.response && error.response.status === 404) continue;
            
            const msg = error.response?.data?.msg || error.message;
            if (msg.includes('already been handled') || msg.includes('already claimed')) {
                 return { success: true, msg: "Already claimed today" };
            }
            return { success: false, msg: msg };
        }
    }
    return { success: false, msg: "All claim endpoints returned 404." };
}

async function getBalance(token, deviceId) {
    const urlParts = CONFIG.walletEndpoint.split('?');
    const path = urlParts[0];
    const params = urlParts[1] || '';
    
    const securityHeader = generateSecurityHeader(path, 'GET', params, {});
    const headers = getBaseHeaders(token, deviceId, securityHeader);

    try {
        const response = await axios.get(CONFIG.baseURL + CONFIG.walletEndpoint, { headers });
        if (response.data && response.data.code === 0) {
            const data = response.data.data;
            const cash = data.money / 10000;
            const bonus = data.coin / 10000;
            const total = (cash + bonus).toFixed(2);
            
            return { success: true, total: total };
        } else {
            return { success: false, error: response.data.msg };
        }
    } catch (error) {
        return { success: false, error: error.response?.data?.msg || error.message };
    }
}

// --- Runner ---

async function processAccounts(mode) {
    const accountsPath = path.join(__dirname, CONFIG.accountsFile);
    const tokensPath = path.join(__dirname, CONFIG.tokensFile);
    
    if (!fs.existsSync(accountsPath)) {
        console.error(`[ERROR] ${CONFIG.accountsFile} not found.`);
        return;
    }
    
    const lines = fs.readFileSync(accountsPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    let tokensDB = {};
    if (fs.existsSync(tokensPath)) {
        try { tokensDB = JSON.parse(fs.readFileSync(tokensPath, 'utf8')); } catch (e) {}
    }

    for (const line of lines) {
        const [phone, ...passwordParts] = line.split(':');
        const password = passwordParts.join(':').trim();
        if (!phone || !password) continue;

        const loginResult = await loginAccount(phone, password);
        
        if (loginResult.success) {
            tokensDB[phone] = loginResult.data;
            fs.writeFileSync(tokensPath, JSON.stringify(tokensDB, null, 2));

            if (mode === '1') {
                const claimResult = await claimDailyReward(loginResult.data.accessToken, loginResult.deviceId);
                if (claimResult.success) {
                    console.log(`[DAILY_REWARD]:  ${claimResult.msg}`);
                } else {
                    console.log(`[DAILY_REWARD]:  Failed (${claimResult.msg})`);
                }
            }

            const balanceResult = await getBalance(loginResult.data.accessToken, loginResult.deviceId);
            
            // Output format: Phone : BALANCE: ₱Total
            if (balanceResult.success) {
                console.log(`${phone} : BALANCE: ₱${balanceResult.total}`);
            } else {
                console.log(`${phone} : BALANCE: Failed to fetch`);
            }

        } else {
            if (mode === '1') {
                console.error(`${phone} : LOGIN FAILED`);
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

function showMenu() {
    console.log('\n--- Menu ---');
    console.log('1. Login and Claim');
    console.log('2. Login and Check Balance');
    console.log('3. Exit');
    
    rl.question('\nSelect an option (1-3): ', (answer) => {
        switch(answer.trim()) {
            case '1':
                processAccounts('1').then(() => rl.close());
                break;
            case '2':
                processAccounts('2').then(() => rl.close());
                break;
            case '3':
                console.log('Exiting...');
                rl.close();
                break;
            default:
                console.log('Invalid option. Please try again.');
                showMenu();
        }
    });
}

// Only run the menu if this file is executed directly (not imported)
if (require.main === module) {
    showMenu();
}

// Export functions for use by the Express backend
module.exports = {
    loginAccount,
    claimDailyReward,
    getBalance,
    parseAccountLine,
    normalizePhone
};