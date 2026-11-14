import CryptoJS from 'crypto-js';

/** Store encrypted binary chunks in Base64, without encoding the source twice. */
export function createOfflineChunkCodec(getKey: () => Promise<CryptoJS.lib.WordArray>, randomBytes: (length: number) => Promise<Uint8Array>) {
  const macKey = (key: CryptoJS.lib.WordArray) => CryptoJS.HmacSHA256('eteczka-offline-chunk-v3', key);
  return {
    async encryptChunk(base64: string): Promise<string> {
      const key = await getKey();
      const ivHex = Array.from(await randomBytes(16)).map(value => value.toString(16).padStart(2, '0')).join('');
      const iv = CryptoJS.enc.Hex.parse(ivHex);
      const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Base64.parse(base64), key, { iv }).ciphertext.toString(CryptoJS.enc.Base64);
      const message = `v3:${ivHex}:${encrypted}`;
      return `${message}:${CryptoJS.HmacSHA256(message, macKey(key)).toString()}`;
    },
    async decryptChunk(value: string): Promise<string> {
      const parts = value.split(':');
      if (parts.length !== 4 || parts[0] !== 'v3' || !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) throw new Error('Nieprawidłowy format kopii offline.');
      const key = await getKey(); const message = parts.slice(0, 3).join(':');
      const expected = CryptoJS.HmacSHA256(message, macKey(key)).toString();
      let mismatch = 0; for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ parts[3].charCodeAt(i);
      if (mismatch !== 0) throw new Error('Kopia offline jest uszkodzona.');
      const ciphertext = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(parts[2]) });
      const plain = CryptoJS.AES.decrypt(ciphertext, key, { iv: CryptoJS.enc.Hex.parse(parts[1]) });
      if (plain.sigBytes < 0) throw new Error('Nie można odczytać kopii offline.');
      return plain.toString(CryptoJS.enc.Base64);
    },
  };
}
