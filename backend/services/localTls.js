"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLocalTls = makeLocalTls;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_forge_1 = __importDefault(require("node-forge"));
function keyPair() {
    const pair = node_crypto_1.default.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    return { privateKey: node_forge_1.default.pki.privateKeyFromPem(pair.privateKey), publicKey: node_forge_1.default.pki.publicKeyFromPem(pair.publicKey), privatePem: pair.privateKey };
}
function serial() { return `01${node_crypto_1.default.randomBytes(15).toString('hex')}`; }
function addresses() {
    return [...new Set(Object.values(node_os_1.default.networkInterfaces()).flat().filter((entry) => Boolean(entry && entry.family === 'IPv4')).map(entry => entry.address))];
}
function makeLocalTls(directory, ips = addresses()) {
    node_fs_1.default.mkdirSync(directory, { recursive: true });
    const keyFile = node_path_1.default.join(directory, 'local-ca-key.pem');
    const certFile = node_path_1.default.join(directory, 'local-ca-cert.pem');
    let caKey;
    let ca;
    if (node_fs_1.default.existsSync(keyFile) || node_fs_1.default.existsSync(certFile)) {
        if (!node_fs_1.default.existsSync(keyFile) || !node_fs_1.default.existsSync(certFile))
            throw new Error('Niekompletny certyfikat lokalnego urzędu E-Teczki.');
        caKey = node_forge_1.default.pki.privateKeyFromPem(node_fs_1.default.readFileSync(keyFile, 'utf8'));
        ca = node_forge_1.default.pki.certificateFromPem(node_fs_1.default.readFileSync(certFile, 'utf8'));
        if (!ca.verify(ca) || ca.validity.notAfter.getTime() <= Date.now() || !ca.publicKey || !('n' in ca.publicKey) || !('n' in caKey) || !ca.publicKey.n.equals(caKey.n))
            throw new Error('Certyfikat lokalnego urzędu jest nieprawidłowy lub wygasł.');
    }
    else {
        const pair = keyPair();
        caKey = pair.privateKey;
        ca = node_forge_1.default.pki.createCertificate();
        ca.publicKey = pair.publicKey;
        ca.serialNumber = serial();
        ca.validity.notBefore = new Date(Date.now() - 86400000);
        ca.validity.notAfter = new Date(Date.now() + 3650 * 86400000);
        ca.setSubject([{ name: 'commonName', value: 'E-Teczka lokalny urzad certyfikacji' }]);
        ca.setIssuer(ca.subject.attributes);
        ca.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]);
        ca.sign(caKey, node_forge_1.default.md.sha256.create());
        node_fs_1.default.writeFileSync(keyFile, pair.privatePem, { mode: 0o600, flag: 'wx' });
        try {
            node_fs_1.default.writeFileSync(certFile, node_forge_1.default.pki.certificateToPem(ca), { mode: 0o600, flag: 'wx' });
        }
        catch (e) {
            node_fs_1.default.unlinkSync(keyFile);
            throw e;
        }
    }
    const leafKeys = keyPair();
    const leaf = node_forge_1.default.pki.createCertificate();
    leaf.publicKey = leafKeys.publicKey;
    leaf.serialNumber = serial();
    leaf.validity.notBefore = new Date(Date.now() - 86400000);
    leaf.validity.notAfter = new Date(Math.min(Date.now() + 365 * 86400000, ca.validity.notAfter.getTime()));
    leaf.setSubject([{ name: 'commonName', value: 'E-Teczka lokalny serwer' }]);
    leaf.setIssuer(ca.subject.attributes);
    leaf.setExtensions([{ name: 'basicConstraints', cA: false, critical: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...[...new Set(['127.0.0.1', ...ips])].map(ip => ({ type: 7, ip }))] }]);
    leaf.sign(caKey, node_forge_1.default.md.sha256.create());
    const caPem = node_forge_1.default.pki.certificateToPem(ca);
    return { key: leafKeys.privatePem, cert: node_forge_1.default.pki.certificateToPem(leaf), caPem, fingerprint: new node_crypto_1.default.X509Certificate(caPem).fingerprint256 };
}
