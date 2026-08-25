// Startup wrapper for running MeshCentral as a Render web service with aggressive memory optimization.

const requiredEnvVars = ['MONGO_URL'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error('[sionyx-remote-control] Missing required environment variable(s): ' + missing.join(', '));
  console.error('[sionyx-remote-control] Set these in the Render dashboard under Environment, then redeploy.');
  process.exit(1);
}

// Aggressive memory cleanup loop during startup to stay under Render's 512MB limit
if (global.gc) {
  const gcInterval = setInterval(() => {
    try {
      global.gc();
    } catch (e) {}
  }, 5000);
  // Stop the aggressive loop after 2 minutes once stable
  setTimeout(() => clearInterval(gcInterval), 120000);
}

const port = process.env.PORT || '443';

const args = [
  '--port', port,
  '--mongodb', process.env.MONGO_URL,
  '--tlsoffload',
];

process.argv = [process.argv[0], process.argv[1], ...args];

console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' with memory-optimized MongoDB storage...');

require('meshcentral').mainStart();