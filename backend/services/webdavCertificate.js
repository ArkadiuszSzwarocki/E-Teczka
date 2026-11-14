"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestNasHostname = suggestNasHostname;
const promises_1 = __importDefault(require("node:dns/promises"));
const node_net_1 = require("node:net");
const node_tls_1 = __importDefault(require("node:tls"));
// Probe only the certificate, without sending credentials. A suggested hostname
// must resolve to the entered IP and pass normal certificate validation.
function suggestNasHostname(endpoint) {
    return __awaiter(this, void 0, void 0, function* () {
        let url;
        try {
            url = new URL(endpoint);
        }
        catch (_a) {
            return null;
        }
        if (url.protocol !== 'https:' || (0, node_net_1.isIP)(url.hostname) !== 4)
            return null;
        const ip = url.hostname;
        const port = Number(url.port || 443);
        const names = yield new Promise(resolve => {
            const socket = node_tls_1.default.connect({ host: ip, port, rejectUnauthorized: false, timeout: 3000 }, () => {
                const san = socket.getPeerCertificate().subjectaltname || '';
                socket.destroy();
                resolve(san.split(', ').filter(name => name.startsWith('DNS:')).map(name => name.slice(4)).filter(name => !name.includes('*')).slice(0, 10));
            });
            socket.on('error', () => resolve([]));
            socket.on('timeout', () => { socket.destroy(); resolve([]); });
        });
        for (const name of names) {
            const addresses = yield promises_1.default.lookup(name, { all: true }).catch(() => []);
            if (!addresses.some(address => address.address === ip))
                continue;
            const verified = yield new Promise(resolve => {
                const socket = node_tls_1.default.connect({ host: ip, port, servername: name, rejectUnauthorized: true, timeout: 3000 }, () => { socket.destroy(); resolve(true); });
                socket.on('error', () => resolve(false));
                socket.on('timeout', () => { socket.destroy(); resolve(false); });
            });
            if (verified) {
                url.hostname = name;
                return url.toString().replace(/\/$/, '');
            }
        }
        return null;
    });
}
