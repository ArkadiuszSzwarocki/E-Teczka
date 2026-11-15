const test = require('node:test');
const assert = require('node:assert/strict');
const { createProxyGate } = require('./proxyGate');
test('NAS gate trusts only the configured proxy with HTTPS and the expected public host', () => {
  assert.throws(() => createProxyGate('invalid', 'https://konto.arecki.pl'));
  assert.throws(() => createProxyGate('172.29.23.250', 'http://konto.arecki.pl'));
  const gate = createProxyGate('172.29.23.250','https://konto.arecki.pl');let calls=0,denied=0;
  const res={locals:{},status(code){assert.equal(code,403);denied++;return this},json(){return this}};
  function run(peer,headers={}){const h={'x-real-ip':'203.0.113.2','x-forwarded-proto':'https',host:'konto.arecki.pl',...headers};gate({socket:{remoteAddress:peer},get:key=>h[key]},res,()=>{calls++})}
  run('172.29.23.1');run('172.29.23.250',{'x-real-ip':'203.0.113.1, 10.0.0.1'});run('172.29.23.250',{'x-forwarded-proto':'http'});run('172.29.23.250',{host:'other.arecki.pl'});run('::ffff:172.29.23.250');
  assert.equal(denied,4);assert.equal(calls,1);assert.equal(res.locals.verifiedClientIp,'203.0.113.2');
});
