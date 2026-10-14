'use strict';
// electron-builder 26 custom Windows sign hook (win.signtoolOptions.sign).
// Signs through a cloud key service so no private key file exists on the runner:
//   CHAUSAR_WIN_SIGNER=digicert-keylocker  -> DigiCert KeyLocker `smctl sign`
//     needs SM_HOST, SM_API_KEY, SM_CLIENT_CERT_FILE, SM_CLIENT_CERT_PASSWORD, SM_KEYPAIR_ALIAS (optional SMCTL_PATH)
//   CHAUSAR_WIN_SIGNER=sslcom-esigner      -> SSL.com eSigner `CodeSignTool sign`
//     needs ES_USERNAME, ES_PASSWORD, ES_CREDENTIAL_ID, ES_TOTP_SECRET, CODESIGNTOOL_PATH (an .exe or the tool's .jar)
// Secrets are never logged: tool output is discarded and errors carry fixed codes only.
// Files under resources/runtime-binaries are pre-signed by the release workflow before
// their integrity manifests are written, so the hook leaves them byte-for-byte unchanged.
const { spawn } = require('node:child_process');
const { isAbsolute, sep, resolve } = require('node:path');

const signers = {
  'digicert-keylocker': ['SM_HOST', 'SM_API_KEY', 'SM_CLIENT_CERT_FILE', 'SM_CLIENT_CERT_PASSWORD', 'SM_KEYPAIR_ALIAS'],
  'sslcom-esigner': ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET', 'CODESIGNTOOL_PATH'],
};

function refuse(code, message) { return Object.assign(new Error(message), { code }); }
function present(environment, name) { return typeof environment[name] === 'string' && environment[name].trim().length > 0; }

/** Throws WINDOWS_SIGNING_UNCONFIGURED unless one supported signer and all its secrets are set. Never returns secret values. */
function signingConfiguration(environment = process.env) {
  const signer = environment.CHAUSAR_WIN_SIGNER;
  if (!Object.hasOwn(signers, signer ?? '')) throw refuse('WINDOWS_SIGNING_UNCONFIGURED', 'Set CHAUSAR_WIN_SIGNER to digicert-keylocker or sslcom-esigner.');
  const missing = signers[signer].filter(name => !present(environment, name));
  if (missing.length) throw refuse('WINDOWS_SIGNING_UNCONFIGURED', `The ${signer} signing settings are incomplete: ${missing.join(', ')}.`);
  return { signer };
}

function bundledRuntime(file) {
  return resolve(file).toLowerCase().includes(`${sep}resources${sep}runtime-binaries${sep}`.toLowerCase());
}

function command(signer, file, environment) {
  if (signer === 'digicert-keylocker') {
    return { executable: environment.SMCTL_PATH || 'smctl', args: ['sign', `--keypair-alias=${environment.SM_KEYPAIR_ALIAS}`, `--input=${file}`] };
  }
  const tool = environment.CODESIGNTOOL_PATH;
  if (!isAbsolute(tool) || /\.(?:bat|cmd)$/i.test(tool)) throw refuse('WINDOWS_SIGNING_UNCONFIGURED', 'CODESIGNTOOL_PATH must be an absolute path to the eSigner .exe or .jar, not a batch file.');
  const args = ['sign', `-username=${environment.ES_USERNAME}`, `-password=${environment.ES_PASSWORD}`,
    `-credential_id=${environment.ES_CREDENTIAL_ID}`, `-totp_secret=${environment.ES_TOTP_SECRET}`, `-input_file_path=${file}`, '-override=true'];
  return /\.jar$/i.test(tool) ? { executable: 'java', args: ['-jar', tool, ...args] } : { executable: tool, args };
}

function run(executable, args, environment, spawnProcess = spawn) {
  return new Promise((accept, reject) => {
    const child = spawnProcess(executable, args, { shell: false, windowsHide: true, env: environment, stdio: ['ignore', 'ignore', 'ignore'] });
    const deadline = setTimeout(() => { try { child.kill(); } catch {} reject(refuse('WINDOWS_SIGNING_FAILED', 'The cloud signing tool did not finish in time.')); }, 10 * 60_000);
    child.once('error', () => { clearTimeout(deadline); reject(refuse('WINDOWS_SIGNING_FAILED', 'The cloud signing tool could not start.')); });
    child.once('close', code => { clearTimeout(deadline); code === 0 ? accept() : reject(refuse('WINDOWS_SIGNING_FAILED', `The cloud signing tool failed with exit code ${code}.`)); });
  });
}

/** Sign one file explicitly (used by the workflow to pre-sign bundled helpers). */
async function signFile(file, environment = process.env, spawnProcess = spawn) {
  if (typeof file !== 'string' || !isAbsolute(file) || /[\x00-\x1f\x7f"]/.test(file)) throw refuse('WINDOWS_SIGNING_INVALID', 'The file to sign must be an absolute path.');
  const { signer } = signingConfiguration(environment);
  const { executable, args } = command(signer, file, environment);
  await run(executable, args, environment, spawnProcess);
}

/** electron-builder hook: (configuration, packager). The third argument exists for tests only. */
async function sign(configuration, packager, environment = process.env) {
  const file = configuration && configuration.path;
  if (typeof file !== 'string') throw refuse('WINDOWS_SIGNING_INVALID', 'electron-builder did not provide a file to sign.');
  // Refuse before anything else so an unconfigured release can never ship unsigned silently.
  signingConfiguration(environment);
  if (configuration.isNest || bundledRuntime(file)) return;
  await signFile(file, environment);
}

module.exports = sign;
module.exports.sign = sign;
module.exports.signFile = signFile;
module.exports.signingConfiguration = signingConfiguration;

if (require.main === module) {
  (async () => {
    const files = process.argv.slice(2);
    if (!files.length) throw refuse('WINDOWS_SIGNING_INVALID', 'usage: node scripts/release/windows-sign.cjs <absolute file>...');
    for (const file of files) await signFile(resolve(file));
    console.log(`Signed ${files.length} file(s) with ${process.env.CHAUSAR_WIN_SIGNER}.`);
  })().catch(error => { console.error(`${error.code || 'WINDOWS_SIGNING_FAILED'}: ${error.message}`); process.exitCode = 1; });
}
