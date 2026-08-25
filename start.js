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
// Wrap process.exit to capture WHERE it's being called from - MeshCentral
// (or one of its dependencies) is calling process.exit() with no code and
// no preceding log message at all, even with --debug all enabled. A stack
// trace captured at the moment of the call is the only way left to find
// the exact file/line responsible, instead of guessing further.
const realExit = process.exit.bind(process);
process.exit = function (code) {
  console.error('[sionyx-remote-control] process.exit(' + code + ') called - flushing logs before exit...');
  console.error('[sionyx-remote-control] Stack trace at exit call:');
  console.error(new Error().stack);
  setTimeout(() => realExit(code), 500);
};
const port = process.env.PORT || '443';
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
