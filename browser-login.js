// language: JavaScript, file: browser-login.js
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // 1. Get the first account from accounts.txt
    const content = fs.readFileSync('accounts.txt', 'utf8');
    const firstLine = content.split('\n').find(l => l.trim());
    if (!firstLine) return console.error('No accounts in accounts.txt');
    const phone = firstLine.split(':')[0].trim();

    // 2. Load the token we got from the API
    if (!fs.existsSync('tokens.json')) {
        return console.error('[ERROR] tokens.json not found. Run "npm start" first to get the token.');
    }
    const tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
    const userToken = tokens[phone]?.accessToken;
    const userInfo = tokens[phone]?.userInfo;

    if (!userToken) {
        return console.error(`[ERROR] No token found for ${phone} in tokens.json. Did the API login succeed?`);
    }

    console.log(`[BROWSER] Launching Incognito Chrome... Injecting token for ${phone}`);

    const browser = await puppeteer.launch({ 
        headless: false, 
        defaultViewport: null,
        args: ['--start-maximized', '--incognito']
    });
    
    const pages = await browser.pages();
    const page = pages[pages.length - 1];

    // 3. Go to the site to set the domain context
    await page.goto('https://www.tablephvip.com/', { waitUntil: 'domcontentloaded' });

    // 4. Inject the token and user info into localStorage
    await page.evaluate((token, info) => {
        // The site uses 'userToken' and a pinia store 'authStore'
        localStorage.setItem('userToken', token);
        
        // Setup the authStore pinia state
        if (info) {
            const authStore = {
                moneyType: 1, // CAPITAL
                isApp: false,
                userInfo: info,
                token: token
            };
            localStorage.setItem('authStore', JSON.stringify(authStore));
        }

        // Also set the cookie just in case
        document.cookie = `userToken=${token}; path=/; max-age=86400; SameSite=Lax`;
        
        console.log('[BROWSER] Token injected into localStorage.');
    }, userToken, userInfo);

    // 5. Reload the page to let the Vue app pick up the token
    console.log('[BROWSER] Reloading page...');
    await page.reload({ waitUntil: 'networkidle2' });

    // Wait 10 seconds so you can visually verify the lobby is loaded
    await new Promise(r => setTimeout(r, 10000));
})();