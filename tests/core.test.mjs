import test from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { normalizeSecret, validateOptions, makeTotp, parseLink, makeLink, timeRemaining, parseQr } from '../src/core.mjs';
import { makeDirectLink } from '../src/core.mjs';
import { readHistory, rememberHistory, updateHistoryDetails, historyId, HISTORY_LIMIT } from '../src/history.mjs';

const secret = 'JBSWY3DPEHPK3PXP';
// RFC 6238 Appendix B reference vectors, not production credentials.
const vectors = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];
const seeds = ['12345678901234567890', '12345678901234567890123456789012', '1234567890123456789012345678901234567890123456789012345678901234'];
for (const [index, algorithm] of ['SHA1', 'SHA256', 'SHA512'].entries()) {
  test(`RFC 6238 all timestamps / ${algorithm}`, () => {
    const key = OTPAuth.Secret.fromUTF8(seeds[index]).base32;
    const totp = makeTotp(key, { digits: 8, algorithm });
    for (const vector of vectors) assert.equal(totp.generate({ timestamp: vector[0] * 1000 }), vector[index + 1]);
  });
}
test('normalization, padding and invalid inputs', () => {
  assert.equal(normalizeSecret(' jbsw y3dp\nehpk3pxp '), secret);
  assert.equal(normalizeSecret('MY======'), 'MY');
  for (const value of ['', 'A', 'MZ', 'MY=', 'MY=======', 'A0I1', '💡', 'A'.repeat(513)]) {
    assert.throws(() => normalizeSecret(value), undefined, value);
  }
});
test('all link entry formats and precedence', () => {
  for (const suffix of [`/#/${secret}`, `/?key=${secret}`, `/2fa/${secret}`, `/2fa/${secret}/`, `/#secret=${secret}`]) {
    assert.equal(parseLink('https://example.test' + suffix).secret, secret);
  }
  assert.equal(parseLink(`https://example.test/?key=OTHER#/${secret}`).secret, secret);
  assert.throws(() => parseLink('https://example.test/#/%GG'));
  assert.equal(parseLink('https://example.test/').secret, '');
});
test('custom parameters roundtrip; copied link removes path and query secrets', () => {
  const options = { digits: 8, period: 60, algorithm: 'SHA256' };
  const link = makeLink(`https://example.test/2fa/${secret}?key=OLD&tracking=123`, secret, options);
  const url = new URL(link);
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.has('key'), false);
  assert.equal(url.searchParams.has('tracking'), false);
  assert.deepEqual(parseLink(link), { secret, options });
});
test('invalid parameters fail instead of producing unexpected codes', () => {
  for (const options of [{ digits: 0 }, { digits: 9 }, { period: 0 }, { period: 301 }, { period: 30.5 }, { algorithm: 'MD5' }]) {
    assert.throws(() => validateOptions(options));
  }
});
test('countdown floors time and resets exactly on boundary', () => {
  assert.equal(timeRemaining(0, 30), 30);
  assert.equal(timeRemaining(29499, 30), 1);
  assert.equal(timeRemaining(29999, 30), 1);
  assert.equal(timeRemaining(30000, 30), 30);
});
test('generated PNG decodes to provisioning URI and same TOTP', async () => {
  const original = makeTotp(secret, { digits: 8, period: 60, algorithm: 'SHA256' }, '测试 & GitHub', 'name+测试@example.com');
  const uri = original.toString();
  const png = PNG.sync.read(await QRCode.toBuffer(uri, { width: 640, margin: 4, errorCorrectionLevel: 'M' }));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded.data, uri);
  const imported = OTPAuth.URI.parse(decoded.data);
  assert.equal(imported.issuer, '测试 & GitHub');
  assert.equal(imported.label, 'name+测试@example.com');
  assert.equal(imported.secret.base32, secret);
  assert.equal(imported.generate({ timestamp: 1234567890000 }), original.generate({ timestamp: 1234567890000 }));
});
test('QR import accepts TOTP, raw secret and link; rejects unrelated QR and migration', () => {
  const options = { digits: 8, period: 60, algorithm: 'SHA512' };
  const uri = makeTotp(secret, options, 'GitHub', 'test@example.com').toString();
  assert.deepEqual(parseQr(uri), { secret, options, issuer: 'GitHub', account: 'test@example.com' });
  assert.equal(parseQr(secret.toLowerCase()).secret, secret);
  assert.equal(parseQr(`https://example.test/#/${secret}`).secret, secret);
  for (const payload of ['https://example.test/', 'hello!', 'otpauth-migration://offline?data=test', `otpauth://hotp/test?secret=${secret}&counter=0`]) {
    assert.throws(() => parseQr(payload));
  }
});
test('direct link retains custom options and path secret', () => {
  const options = { digits: 8, period: 60, algorithm: 'SHA256' };
  const link = makeDirectLink('https://example.test/#/OLD', secret, options);
  assert.equal(new URL(link).pathname, '/2fa/' + secret);
  assert.equal(new URL(link).hash, '');
  assert.deepEqual(parseLink(link), { secret, options });
});
test('history deduplicates settings, preserves names, orders and limits', () => {
  let entries = rememberHistory([], { secret, issuer: 'GitHub', account: 'demo' }, 1);
  entries = rememberHistory(entries, { secret }, 2);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].issuer, 'GitHub');
  assert.equal(entries[0].usedAt, 2);
  entries = rememberHistory(entries, { secret, period: 60 }, 3);
  assert.equal(entries.length, 2);
  for (let period = 5; period < 70; period++) entries = rememberHistory(entries, { secret, period }, period);
  assert.equal(entries.length, HISTORY_LIMIT);
  assert.equal(entries[0].period, 69);
});
test('history validates untrusted storage, skips bad records and rejects corrupt JSON', () => {
  const entries = rememberHistory([], { secret }, 1);
  const storage = { getItem: () => JSON.stringify([null, {}, { ...entries[0], period: 0 }, ...entries, ...entries]) };
  assert.deepEqual(readHistory(storage), entries);
  assert.throws(() => readHistory({ getItem: () => '{' }));
  assert.throws(() => readHistory({ getItem: () => { throw new Error('Denied'); } }));
});
test('notes survive reuse and old history records remain readable', () => {
  const entries = rememberHistory([], { secret }, 1);
  entries[0].note = 'GitHub 主账号';
  assert.equal(rememberHistory(entries, { secret }, 2)[0].note, 'GitHub 主账号');
  const legacy = { ...entries[0] };
  delete legacy.note;
  assert.equal(readHistory({ getItem: () => JSON.stringify([legacy]) })[0].note, '');
  entries[0].note = 'x'.repeat(300);
  assert.equal(readHistory({ getItem: () => JSON.stringify(entries) })[0].note.length, 200);
});
test('history details can be edited without changing the key or OTP settings', () => {
  const entries = rememberHistory([], { secret, issuer: 'Old', account: '1', digits: 8, period: 60, algorithm: 'SHA256' }, 1);
  const updated = updateHistoryDetails(entries, historyId(entries[0]), {
    issuer: '  Tencent Cloud Services  ', account: ' 100023184316 ', note: ' 主账号 ',
  });
  assert.deepEqual(updated[0], {
    ...entries[0], issuer: 'Tencent Cloud Services', account: '100023184316', note: '主账号',
  });
  assert.equal(updateHistoryDetails(entries, 'missing', {}), null);
  const limited = updateHistoryDetails(entries, historyId(entries[0]), { issuer: 'i'.repeat(80), account: 'a'.repeat(80), note: 'n'.repeat(220) });
  assert.equal(limited[0].issuer.length, 64);
  assert.equal(limited[0].account.length, 64);
  assert.equal(limited[0].note.length, 200);
});
