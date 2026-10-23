// Development launcher: starts the Express API and the Vite dev server
// together without adding a new runtime dependency. Both processes stop when
// either one exits or on Ctrl+C. Skips the web server automatically when the
// frontend dependencies have not been installed yet (`npm run setup:web`).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nodeCmd = process.execPath;
const viteBin = path.join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
const apiEntry = path.join(root, 'server', 'index.js');

const children = [];

function run(name, command, args, cwd, env) {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
    children.push(child);
    child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            console.log(`[dev] ${name} exited with code ${code}; stopping the other process.`);
        }
        shutdown(code === null ? 0 : code);
    });
    return child;
}

function shutdown(code) {
    while (children.length) {
        const child = children.pop();
        try {
            child.kill();
        } catch {
            // Already gone.
        }
    }
    process.exit(code || 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', nodeCmd, [apiEntry], root, {});
if (fs.existsSync(viteBin)) {
    run('web', nodeCmd, [viteBin], path.join(root, 'frontend'), {});
} else {
    console.log('[dev] frontend dependencies missing; run "npm run setup:web" to enable the Vite dev server.');
}
