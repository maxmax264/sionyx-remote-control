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

// Node.js gotcha: when stdout is a pipe (not a real TTY - exactly the case
// inside a Render container), console.log() writes are non-blocking. If
// code calls process.exit() right after logging an error (which
// MeshCentral's db.js does on a failed Mongo connection - see
// "Unable to connect to database: " + err), the process can die before
// that write actually reaches the log stream, so the real error is lost
// and all we see is a silent "Application exited early". Intercepting
// process.exit() everywhere (including deep inside MeshCentral's own
// code, not just ours) and giving stdout/stderr a brief moment to flush
// before actually exiting reveals the real reason instead.
const realExit = process.exit.bind(process);
process.exit = function (code) {
  console.error('[sionyx-remote-control] process.exit(' + code + ') called - flushing logs before exit...');
  setTimeout(() => realExit(code), 500);
};

// Render assigns the port to listen on via process.env.PORT - MeshCentral
// must bind to exactly this port for Render's health checks to succeed.
const port = process.env.PORT || '443';

// Render terminates HTTPS at its own edge and proxies plain HTTP to us, so
// MeshCentral must NOT try to manage its own TLS certificate.
// --tlsoffload tells MeshCentral to trust the proxy and treat the
// connection as already secure.
// MeshCentral's default behavior is to spawn a SECOND child Node process
// and monitor it from this one (its own self-update/crash-restart
// supervisor pattern) - found by reading meshcentral.js directly: without
// --launch, this process just re-execs itself as a child and watches it.
// On Render, that's redundant (Render already restarts the service on
// crash) and doubles memory usage for no benefit - worse, if the child
// crashes on startup, the error happens in a separate OS process that our
// uncaughtException handler above can never see, so the real cause stays
// invisible while the parent just keeps respawning it forever. Passing
// --launch skips the child-spawn step entirely and runs the server
// directly in this process, so real startup errors surface right here.
const args = [
  '--port', port,
  '--mongodb', process.env.MONGO_URL,
  '--tlsoffload',
  '--launch', String(process.pid),
];

process.argv = [process.argv[0], process.argv[1], ...args];

console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' (pid ' + process.pid + ')...');

require('meshcentral').mainStart();
