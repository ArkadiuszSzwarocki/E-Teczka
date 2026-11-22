const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors><certificates src="system"/></trust-anchors>
  </base-config>
</network-security-config>\n`;
module.exports = function withLocalTls(config) {
  config = withAndroidManifest(config, config => {
    config.modResults.manifest.application[0].$['android:networkSecurityConfig'] = '@xml/mojateczka_network_security';
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(directory, { recursive: true });
    const kotlinDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', 'pl', 'arecki', 'mojateczka');
    fs.mkdirSync(kotlinDir, { recursive: true });
    fs.copyFileSync(path.join(config.modRequest.projectRoot, 'plugins', 'local-tls', 'LocalTls.kt'), path.join(kotlinDir, 'LocalTls.kt'));
    const main = path.join(kotlinDir, 'MainApplication.kt');
    if (!fs.existsSync(main)) throw new Error('Brak MainApplication.kt dla LocalTls.');
    {
      let source = fs.readFileSync(main, 'utf8');
      if (!source.includes('add(LocalTlsPackage())')) source = source.replace('// add(MyReactNativePackage())', 'add(LocalTlsPackage())');
      if (!source.includes('LocalTls.init(this)')) source = source.replace('    super.onCreate()', '    super.onCreate()\n    LocalTls.init(this)');
      if (!source.includes('add(LocalTlsPackage())') || !source.includes('LocalTls.init(this)')) throw new Error('Nie udało się skonfigurować LocalTls w MainApplication.kt');
      fs.writeFileSync(main, source);
    }
    fs.writeFileSync(path.join(directory, 'mojateczka_network_security.xml'), xml);
    return config;
  }]);
};
