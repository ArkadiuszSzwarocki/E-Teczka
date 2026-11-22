const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeLocalTls } = require('../services/localTls');

test('PKIX validates the server against the paired CA and rejects another CA', t => {
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : (process.platform === 'win32' ? 'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe' : 'java');
  if (path.isAbsolute(java) && !fs.existsSync(java)) return t.skip('Java runtime not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-pkix-'));
  try {
    const paired = makeLocalTls(path.join(dir, 'one'), ['127.0.0.1']);
    const other = makeLocalTls(path.join(dir, 'two'), ['127.0.0.1']);
    for (const [name, value] of [['leaf.pem', paired.cert], ['ca.pem', paired.caPem], ['other.pem', other.caPem]]) fs.writeFileSync(path.join(dir, name), value);
    const source = `import java.io.*; import java.security.cert.*; import java.util.*;
class Verify { public static void main(String[] a) throws Exception {
 CertificateFactory f=CertificateFactory.getInstance("X.509");
 X509Certificate leaf=(X509Certificate)f.generateCertificate(new FileInputStream(a[0]));
 X509Certificate ca=(X509Certificate)f.generateCertificate(new FileInputStream(a[1]));
 PKIXParameters p=new PKIXParameters(Set.of(new TrustAnchor(ca,null))); p.setRevocationEnabled(false);
 try { CertPathValidator.getInstance("PKIX").validate(f.generateCertPath(List.of(leaf)),p); System.out.println("valid"); }
 catch (CertPathValidatorException e) { System.out.println("rejected"); }
 } }`;
    const file = path.join(dir, 'Verify.java'); fs.writeFileSync(file, source);
    const check = ca => spawnSync(java, [file, path.join(dir, 'leaf.pem'), path.join(dir, ca)], { encoding: 'utf8', timeout: 30000 });
    const valid = check('ca.pem'); assert.equal(valid.status, 0, valid.stderr); assert.equal(valid.stdout.trim(), 'valid');
    const invalid = check('other.pem'); assert.equal(invalid.status, 0, invalid.stderr); assert.equal(invalid.stdout.trim(), 'rejected');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
