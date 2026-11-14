"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingReturnBase = billingReturnBase;
const node_net_1 = require("node:net");
function billingReturnBase(localAddress) {
    const address = (localAddress || '').replace(/^::ffff:/, '');
    if (address === '::1' || address === '127.0.0.1')
        return 'http://127.0.0.1:3000';
    if ((0, node_net_1.isIP)(address) !== 4)
        return 'http://127.0.0.1:3000';
    const [first, second] = address.split('.').map(Number);
    const privateNetwork = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    return privateNetwork ? `http://${address}:3000` : 'http://127.0.0.1:3000';
}
