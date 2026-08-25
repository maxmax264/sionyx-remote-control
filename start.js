// Startup wrapper for running MeshCentral as a Render web service.
//
// IMPORTANT: this deliberately does NOT set aggressive V8 memory flags
// (--optimize-for-size was removed from V8 years ago and does nothing
// useful on modern Node; --max-old-space-size below 512 can make Node
// crash on legitimate allocations MeshCentral needs during first-time
// setup, which is worse than not setting it at all). If MeshCentral
// genuinely needs more than Render Free's 512MB to complete its
// first-run setup (cert generation, DB indexing, agent binary
// preparation), no amount of GC tuning fixes that - we need to see the
// REAL error MeshCentral is hitting, not just "process died".

const requiredEnvVars = ['MONGO_URL'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error('[sionyx-remote-control] Missing required environment variable(s): ' + missing.join(', '));
  console.error('[sionyx-remote-control] Set these in the Render dashboard under Environment, then redeploy.');
  process.exit(1);
}

// Surface anything that would otherwise crash the process silently -
// MeshCentral has been observed to self-relaunch as a child process
// during first-time setup; if that child hits an error we want it in
// the Render log, not swallowed.
process.on('uncaughtException', (err) => {
  console.error('[sionyx-remote-control] UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sionyx-remote-control] UNHANDLED REJECTION:', reason);
});

// Render assigns the port to listen on via process.env.PORT - MeshCentral
// must bind to exactly this port for Render's health checks to succeed.
const port = process.env.PORT || '443';

// Render terminates HTTPS at its own edge and proxies plain HTTP to us, so
// MeshCentral must NOT try to manage its own TLS certificate.
// --tlsoffload tells MeshCentral to trust the proxy and treat the
// connection as already secure.
const args = [
  '--port', port,
  '--mongodb', process.env.MONGO_URL,
  '--tlsoffload',
];

process.argv = [process.argv[0], process.argv[1], ...args];

console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' (pid ' + process.pid + ')...');

require('meshcentral').mainStart();
