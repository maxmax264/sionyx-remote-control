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

const fs = require('fs');
const path = require('path');

const publicHost = process.env.PUBLIC_HOSTNAME || process.env.RENDER_EXTERNAL_HOSTNAME || 'sionyx-remote-control.onrender.com';
const dataDir = path.join(__dirname, 'meshcentral-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// --- Certificate persistence via MongoDB --------------------------------
// Render's filesystem is ephemeral: meshcentral-data (including the
// server's generated certificates) is wiped on every deploy/restart
// unless a paid persistent disk is attached. Since we already have a
// MongoDB instance (MONGO_URL) that IS persistent, we use it to back up
// and restore the certificate files instead of paying for a disk.
// Generic by design: it backs up/restores every *.crt and *.key file in
// meshcentral-data, so it doesn't depend on exact filenames that could
// change between MeshCentral versions.
const CERT_BACKUP_COLLECTION = 'sionyxCertBackup';
const CERT_BACKUP_DOC_ID = 'certs';

function listCertFiles() {
  return fs.readdirSync(dataDir).filter((f) => /\.(crt|key)$/i.test(f));
}

async function restoreCertsFromMongo() {
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (e) {
    console.error('[sionyx-remote-control] mongodb driver not available, skipping cert restore:', e.message);
    return;
  }
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db();
    const doc = await db.collection(CERT_BACKUP_COLLECTION).findOne({ _id: CERT_BACKUP_DOC_ID });
    if (doc && doc.files) {
      const names = Object.keys(doc.files);
      for (const name of names) {
        fs.writeFileSync(path.join(dataDir, name), Buffer.from(doc.files[name], 'base64'));
      }
      console.log('[sionyx-remote-control] Restored ' + names.length + ' certificate file(s) from MongoDB backup.');
    } else {
      console.log('[sionyx-remote-control] No certificate backup found in MongoDB yet (first run) - MeshCentral will generate new certs.');
    }
  } catch (e) {
    console.error('[sionyx-remote-control] Cert restore from MongoDB failed (continuing without it):', e.message);
  } finally {
    await client.close().catch(() => {});
  }
}

async function backupCertsToMongo() {
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (e) {
    console.error('[sionyx-remote-control] mongodb driver not available, skipping cert backup:', e.message);
    return;
  }
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  try {
    const names = listCertFiles();
    if (names.length === 0) {
      console.log('[sionyx-remote-control] No cert files found to back up yet.');
      return;
    }
    const files = {};
    for (const name of names) {
      files[name] = fs.readFileSync(path.join(dataDir, name)).toString('base64');
    }
    await client.connect();
    const db = client.db();
    await db.collection(CERT_BACKUP_COLLECTION).updateOne(
      { _id: CERT_BACKUP_DOC_ID },
      { $set: { files, updatedAt: new Date() } },
      { upsert: true }
    );
    console.log('[sionyx-remote-control] Backed up ' + names.length + ' certificate file(s) to MongoDB.');
  } catch (e) {
    console.error('[sionyx-remote-control] Cert backup to MongoDB failed:', e.message);
  } finally {
    await client.close().catch(() => {});
  }
}
// -------------------------------------------------------------------------

async function main() {
  await restoreCertsFromMongo();

  // certUrl fix: --tlsoffload alone doesn't tell MeshCentral what the real
  // public-facing certificate looks like (needed so agents' pinned cert
  // hash matches what they actually see through Cloudflare/Render). There
  // is no CLI flag for certUrl, so it must go in config.json.
  const configPath = path.join(dataDir, 'config.json');
  const config = {
    settings: {
      cert: publicHost,
      aliasPort: 443
    },
    domains: {
      '': {
        certUrl: 'https://' + publicHost + ':443/'
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('[sionyx-remote-control] Wrote ' + configPath + ' with certUrl for ' + publicHost);

  const port = process.env.PORT || '443';
  const args = [
    '--port', port,
    '--mongodb', process.env.MONGO_URL,
    '--tlsoffload',
    '--datapath', dataDir,
    '--launch', String(process.pid),
  ];
  process.argv = [process.argv[0], process.argv[1], ...args];
  console.log('[sionyx-remote-control] Starting MeshCentral on port ' + port + ' (pid ' + process.pid + ')...');
  require('meshcentral').mainStart();

  // Give MeshCentral time to generate certs on a first run, then back them
  // up to MongoDB so the next deploy/restart can restore them instead of
  // generating (and thus invalidating) new ones.
  setTimeout(() => {
    backupCertsToMongo();
  }, 60000);
}

main();
