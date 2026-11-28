'use strict'
// macOS keeps Screen Recording (and other privacy) permissions per code signature. An ad-hoc signature
// is a hash of the build itself, so every rebuild looks like a new app and the permission is lost.
// A local self-signed certificate gives every build the same identity: allow it once, keep it.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const IDENTITY_NAME = 'Claude Ojousama Local Signing'
const APP_ID = 'com.claude-ojousama.app'

function sh(exe, args, options = {}) {
  return spawnSync(exe, args, { encoding: 'utf8', ...options })
}

/** The SHA-1 of the named code-signing identity in `security find-identity` output (trusted or not), or null. */
function parseIdentity(output, name = IDENTITY_NAME) {
  for (const line of String(output || '').split('\n')) {
    const m = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/)
    if (m && m[2] === name) return m[1]
  }
  return null
}

/** The local signing identity, if it has been set up (CLAUDE_PET_SIGN_IDENTITY picks another one). */
function findIdentity(name = process.env.CLAUDE_PET_SIGN_IDENTITY || IDENTITY_NAME) {
  if (process.platform !== 'darwin') return null
  const r = sh('security', ['find-identity', '-p', 'codesigning'])
  const hash = r.status === 0 ? parseIdentity(r.stdout, name) : null
  return hash ? { name, hash } : null
}

function isMachO(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(4)
    if (fs.readSync(fd, b, 0, 4, 0) < 4) return false
    return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(b.toString('hex'))
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Executables shipped as plain files (the screen helper): codesign --deep only covers nested bundles. */
function looseBinaries(dir) {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && (fs.statSync(p).mode & 0o111) && isMachO(p)) out.push(p)
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}

function run(exe, args) {
  const r = spawnSync(exe, args, { stdio: 'inherit' })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${exe} ${args[0]} exited with ${r.status}`)
}

/** Re-sign a built app with the local identity. False (nothing done) when there is none. */
function signApp(app, identity = findIdentity()) {
  if (!identity) return false
  const entitlements = path.join(ROOT, 'build', 'entitlements.mac.plist')
  for (const bin of looseBinaries(path.join(app, 'Contents', 'Resources'))) {
    run('codesign', ['--force', '--options', 'runtime', '--timestamp=none', '--sign', identity.hash, bin])
  }
  run('codesign', ['--force', '--deep', '--options', 'runtime', '--timestamp=none', '--entitlements', entitlements, '--sign', identity.hash, app])
  run('codesign', ['--verify', '--deep', '--strict', app])
  console.log(`Signed with "${identity.name}" (${identity.hash.slice(0, 8)}…): macOS permissions now survive rebuilds.`)
  return true
}

/** "Authority=…" of an installed app's signature ('' when ad-hoc or unsigned). */
function signer(app) {
  const r = sh('codesign', ['-dvv', app])
  const m = String(r.stderr || '').match(/^Authority=(.+)$/m)
  return m ? m[1].trim() : ''
}

/** Create the self-signed code-signing certificate in the login keychain (once). */
function setup() {
  if (process.platform !== 'darwin') {
    console.log('Only needed on macOS.')
    return
  }
  const existing = findIdentity(IDENTITY_NAME)
  if (existing) {
    console.log(`Already set up: "${IDENTITY_NAME}" (${existing.hash.slice(0, 8)}…). Run npm run install-app.`)
    return
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ojousama-signing-'))
  try {
    const cnf = path.join(tmp, 'cert.cnf')
    fs.writeFileSync(cnf, [
      '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no',
      '[dn]', `CN = ${IDENTITY_NAME}`,
      '[ext]', 'basicConstraints = critical, CA:false', 'keyUsage = critical, digitalSignature', 'extendedKeyUsage = critical, codeSigning',
      '',
    ].join('\n'))
    const key = path.join(tmp, 'key.pem')
    const crt = path.join(tmp, 'cert.pem')
    const p12 = path.join(tmp, 'cert.p12')
    const pass = 'ojousama-' + process.pid
    const openssl = fs.existsSync('/usr/bin/openssl') ? '/usr/bin/openssl' : 'openssl'
    run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-config', cnf, '-keyout', key, '-out', crt])
    const keychain = (sh('security', ['login-keychain']).stdout || '').trim().replace(/^"|"$/g, '') || path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db')
    const imported = (legacy) => {
      const exp = sh(openssl, ['pkcs12', '-export', ...(legacy ? ['-legacy'] : []), '-inkey', key, '-in', crt, '-name', IDENTITY_NAME, '-out', p12, '-passout', `pass:${pass}`])
      if (exp.status !== 0) return false
      return sh('security', ['import', p12, '-k', keychain, '-P', pass, '-f', 'pkcs12', '-T', '/usr/bin/codesign']).status === 0
    }
    // macOS's LibreSSL writes a PKCS#12 the keychain reads; OpenSSL 3 needs -legacy for that.
    if (!imported(false) && !imported(true)) throw new Error('Could not import the certificate into the login keychain.')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  const made = findIdentity(IDENTITY_NAME)
  if (!made) throw new Error('The certificate was imported but codesign cannot see it. Look for it in Keychain Access → login → My Certificates.')
  console.log(`Created "${IDENTITY_NAME}" in your login keychain.`)
  console.log('Next: npm run install-app. The first time, macOS may ask to let codesign use the key: enter your login password and choose "Always Allow".')
  console.log('Then allow Claude Ojousama once more under System Settings → Privacy & Security → Screen & System Audio Recording; after that rebuilds keep it.')
}

if (require.main === module) {
  try {
    setup()
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

module.exports = { IDENTITY_NAME, APP_ID, parseIdentity, findIdentity, isMachO, looseBinaries, signApp, signer, setup }
