const CryptoJS = require('crypto-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
    baseURL: 'https://www.tablephvip.com',
    registerEndpoint: '/lobby/api/user/register',
    sendCodeEndpoint: '/lobby/api/user/sendCode',
    journeyEndpoint: '/lobby/api/journey/',
    accountsFile: 'accounts.txt',
    registerFile: 'register.txt',
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

process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

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

async function registerAccount(phone, password) {
    const apiPhone = phone.startsWith(CONFIG.countryCode) ? phone : CONFIG.countryCode + phone.replace(/^0+/, '');
    const deviceId = generateDeviceId();
    const localPhone = apiPhone.replace('+63', '');

    console.log(`[1/4] Journey Ticket for ${apiPhone}...`);
    const journeyUrl = CONFIG.journeyEndpoint + deviceId;
    const journeyPayload = { key: "v1.NkiqG3WIjjhg9Uh-e5c0cEMlCk2PnBl0DKZbFzgs8aHKG_edvtkiLQDnNIVkPML5XjQYfo1MR7kBoAbSYPTmZm3CgftagImNZwSNXdTdX9grkKNM5JA6sr7q0APxo8Py_ZJAKTlljAcOpF4" };
    const journeyHeader = generateSecurityHeader(journeyUrl, 'POST', '', journeyPayload);
    const journeyHeaders = getBaseHeaders('', deviceId, journeyHeader);
    delete journeyHeaders['Authorization'];

    let ticket = "";
    try {
        const res = await fetch(CONFIG.baseURL + journeyUrl, {
            method: 'POST',
            headers: journeyHeaders,
            body: JSON.stringify(journeyPayload)
        });
        const data = await res.json();
        if (data.code === 0 && data.data.ticket) ticket = data.data.ticket;
    } catch (e) {}

    console.log(`[2/4] Sending OTP to ${apiPhone}...`);
    const sendCodeUrl = CONFIG.sendCodeEndpoint;
    const sendCodePayload = { mobile_or_email: apiPhone, token: "", type: 1 };
    const sendCodeHeader = generateSecurityHeader(sendCodeUrl, 'POST', '', sendCodePayload);
    const sendCodeHeaders = getBaseHeaders('', deviceId, sendCodeHeader);
    delete sendCodeHeaders['Authorization'];

    try {
        await fetch(CONFIG.baseURL + sendCodeUrl, {
            method: 'POST',
            headers: sendCodeHeaders,
            body: JSON.stringify(sendCodePayload)
        });
    } catch (e) {}

    const otp = await askQuestion(`[3/4] Enter OTP for ${apiPhone}: `);

    console.log(`[4/4] Registering...`);
    const registerUrl = CONFIG.registerEndpoint;
    const passwordB64 = base64Encode(password + CONFIG.passwordSalt);
    
    const registerPayload = {
        mobile: apiPhone, email: "", username: localPhone, password: passwordB64, verify_code: otp,
        client_type: 1, device_id: deviceId, client_id: deviceId, device_detail: "Android Pixel 10",
        device_model: "H5", os_version: "Chrome", app_version: CONFIG.appVersion, game_version: CONFIG.gameVersion,
        channel_id: CONFIG.channelId, invitation_code: "", ticket: ticket, 
        regist_finger: "551787c1f915d8736807ad438e94816e", login_finger: "551787c1f915d8736807ad438e94816e"
    };

    generateJunkFields(registerPayload, 2, 10);
    const registerHeader = generateSecurityHeader(registerUrl, 'POST', '', registerPayload);
    const registerHeaders = getBaseHeaders('', deviceId, registerHeader);
    delete registerHeaders['Authorization'];

    try {
        const res = await fetch(CONFIG.baseURL + registerUrl, {
            method: 'POST',
            headers: registerHeaders,
            body: JSON.stringify(registerPayload)
        });
        const data = await res.json();
        
        if (data && data.code === 0) {
            console.log(`[SUCCESS] Registered ${apiPhone}`);
            fs.appendFileSync(CONFIG.accountsFile, `\n${localPhone}`);
            return { success: true };
        } else {
            console.log(`[FAILED] ${data.msg}`);
            return { success: false };
        }
    } catch (error) {
        console.log(`[FAILED] ${error.message}`);
        return { success: false };
    }
}

async function run() {
    const registerPath = path.join(__dirname, CONFIG.registerFile);
    if (!fs.existsSync(registerPath)) {
        console.error(`[ERROR] ${CONFIG.registerFile} not found.`);
        rl.close();
        return;
    }

    const rawLines = fs.readFileSync(registerPath, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (rawLines.length < 2) {
        console.error(`[ERROR] register.txt must have the password on the first line and phone numbers on the rest.`);
        rl.close();
        return;
    }

    const password = rawLines[0];
    const phones = rawLines.slice(1).map(p => p.replace(/\D/g, ''));

    console.log(`Loaded ${phones.length} accounts to register.\n`);

    for (let i = 0; i < phones.length; i++) {
        console.log(`--- Registering ${phones[i]} ---`);
        await registerAccount(phones[i], password);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\nFinished registering all accounts.');
    rl.close();
}

run();