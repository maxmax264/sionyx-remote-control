// Startup wrapper for running MeshCentral as a Render web service.
const requiredEnvVars = ['MONGO_URL'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error('[sionyx-remote-control] Missing required environment variable(s): ' + missing.join(', '));
  console.error('[sionyx-remote-control] Set these in the Render dashboard under Environment, then redeploy.');
  process.exit(1);
}
process.on('uncaughtException', (err) => {
  console.error('[sionyx-remote-control] UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sionyx-remote-control] UNHANDLED REJECTION:', reason);
});
const realExit = process.exit.bind(process);
process.exit = function (code) {
  console.error('[sionyx-remote-control] process.exit(' + code + ') called - flushing logs before exit...');
  console.error('[sionyx-remote-control] Stack trace at exit call:');
  console.error(new Error().stack);
  setTimeout(() => realExit(code), 500);
};
// FOUND IT: stack trace showed the exit is triggered by meshcentral.js
// line 4487, inside a ReadStream 'end' listener - this is MeshCentral's
// interactive console feature, which listens for process.stdin to end
// (e.g. Ctrl-D at a real terminal) as a signal to shut down. On Render,
// stdin is not an interactive terminal - it's closed/EOF almost
// immediately after the process starts, firing that 'end' event right
// away and shutting the whole server down before it can finish starting.
// This explains every prior crash: it was never about Node version,
// Mongo, or --launch. Since we don't need an interactive console in
// this deployment, replace process.stdin with a stub that MeshCentral
// can attach listeners to but that never emits 'end'.
const { EventEmitter } = require('events');
const stdinStub = new EventEmitter();
stdinStub.isTTY = false;
stdinStub.setEncoding = function () { return stdinStub; };
stdinStub.resume = function () { return stdinStub; };
stdinStub.pause = function () { return stdinStub; };
stdinStub.read = function () { return null; };
stdinStub.pipe = function () { return stdinStub; };
Object.defineProperty(process, 'stdin', { value: stdinStub, configurable: true });

// --- TLS / certificate-pinning fix -----------------------------------
// --tlsoffload alone tells MeshCentral "don't do TLS yourself, a proxy
// (Cloudflare/Render) handles it" - but it does NOT tell MeshCentral
// what the *real* public-facing certificate looks like. Agents pin the
// hash of that real certificate on first connect; without certUrl,
// MeshCentral computes the hash from its own self-signed cert instead
// of the one clients actually see, so the agent connection gets stuck
// in "holding" state. certUrl can only be set via config.json (there's
// no CLI flag for it), so we generate that file here before MeshCentral
// starts, instead of committing a static one to the repo.
const fs = require('fs');
const path = require('path');

const publicHost = process.env.PUBLIC_HOSTNAME || process.env.RENDER_EXTERNAL_HOSTNAME || 'sionyx-remote-control.onrender.com';

const dataDir = path.join(__dirname, 'meshcentral-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const configPath = path.join(dataDir, 'config.json');
const config = {
  settings: {
    cert: publicHost
  },
  domains: {
    '': {
      certUrl: 'https://' + publicHost + ':443/'
    }
  }
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('[sionyx-remote-control] Wrote ' + configPath + ' with certUrl for ' + publicHost);
// -----------------------------------------------------------------------

const port = process.env.PORT || '443';
const args = [
  '--port', port,
  '--mongodb', process.env.MONGO_URL,
  '--tlsoffload',
  '--datadir', dataDir,
  '--launch', String(process.pid),
];
process.argv = [process.argv[0], process.argv[1], ...args];
console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' (pid ' + process.pid + ')...');
require('meshcentral').mainStart();
