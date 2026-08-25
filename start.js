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
process.on('uncaughtException', (err) => {
  console.error('[sionyx-remote-control] UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[sionyx-remote-control] UNHANDLED REJECTION:', reason);
});
const realExit = process.exit.bind(process);
process.exit = function (code) {
  console.error('[sionyx-remote-control] process.exit(' + code + ') called - flushing logs before exit...');
  setTimeout(() => realExit(code), 500);
};
const port = process.env.PORT || '443';
// NOTE: --launch takes any truthy value (checked with a simple `if
// (obj.args.launch)` in MeshCentral's own source) - it just tells
// MeshCentral to run directly instead of spawning + supervising a
// child copy of itself. It is NOT a restart counter, our earlier
// theory about that was wrong. The actual problem is that something
// inside MeshCentral's StartEx() calls process.exit() with no code
// and no error message within ~1.6 seconds - too fast for a normal
// Mongo connection timeout, and silent even with our uncaughtException
// handler above (meaning it's an intentional, not thrown, exit deep
// inside MeshCentral). --debug all forces MeshCentral to print its
// internal diagnostic trace so we can see what it's doing right before
// that exit call, instead of guessing further.
const args = [
  '--port', port,
  '--mongodb', process.env.MONGO_URL,
  '--tlsoffload',
  '--launch', String(process.pid),
  '--debug', 'all',
];
process.argv = [process.argv[0], process.argv[1], ...args];
console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' (pid ' + process.pid + ')...');
require('meshcentral').mainStart();
