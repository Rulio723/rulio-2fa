import * as OTPAuth from 'otpauth';

export function normalizeSecret(value) {
  const secret = value.replace(/\s/g, '').toUpperCase();
  if (!secret) throw new Error('请输入双重验证密钥。');
  if (secret.length > 512 || !/^[A-Z2-7]+={0,6}$/.test(secret)) {
    throw new Error('密钥格式不正确，请输入 Base32 密钥（字母 A-Z 和数字 2-7）。');
  }
  const bare = secret.replace(/=+$/, '');
  const remainder = bare.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder)) throw new Error('密钥长度不正确，请检查是否复制完整。');
  const padding = (8 - remainder) % 8;
  if (secret.includes('=') && secret.length - bare.length !== padding) throw new Error('密钥末尾的填充符不正确。');
  const decoded = OTPAuth.Secret.fromBase32(bare);
  if (decoded.base32 !== bare) throw new Error('密钥编码不正确，请检查最后一个字符。');
  return bare;
}

export function validateOptions({ digits = 6, period = 30, algorithm = 'SHA1' } = {}) {
  digits = Number(digits);
  period = Number(period);
  algorithm = String(algorithm).toUpperCase();
  if (![6, 7, 8].includes(digits)) throw new Error('验证码位数仅支持 6、7 或 8 位。');
  if (!Number.isInteger(period) || period < 5 || period > 300) throw new Error('刷新周期必须为 5 至 300 秒的整数。');
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) throw new Error('不支持此哈希算法。');
  return { digits, period, algorithm };
}

export function makeTotp(secret, options = {}, issuer = '', label = '') {
  return new OTPAuth.TOTP({
    ...validateOptions(options),
    secret: OTPAuth.Secret.fromBase32(normalizeSecret(secret)),
    issuer: issuer.trim(),
    label: label.trim() || '2FA',
  });
}

export function timeRemaining(timestamp, period) {
  return period - Math.floor(timestamp / 1000) % period;
}

export function parseLink(href) {
  const url = new URL(href);
  const params = url.searchParams;
  let secret = params.get('key') || '';
  if (url.pathname.startsWith('/2fa/')) secret = decodeURIComponent(url.pathname.slice(5).replace(/\/$/, ''));
  if (url.hash.startsWith('#/')) secret = decodeURIComponent(url.hash.slice(2));
  else if (url.hash.startsWith('#secret=')) secret = new URLSearchParams(url.hash.slice(1)).get('secret') || '';
  return {
    secret,
    options: validateOptions({
      digits: params.get('digits') ?? 6,
      period: params.get('period') ?? 30,
      algorithm: params.get('algorithm') ?? 'SHA1',
    }),
  };
}

export function makeLink(href, secret, options) {
  const url = new URL(href);
  if (url.pathname.startsWith('/2fa/')) url.pathname = '/';
  url.search = '';
  const settings = validateOptions(options);
  if (settings.digits !== 6) url.searchParams.set('digits', settings.digits);
  if (settings.period !== 30) url.searchParams.set('period', settings.period);
  if (settings.algorithm !== 'SHA1') url.searchParams.set('algorithm', settings.algorithm);
  url.hash = '/' + normalizeSecret(secret);
  return url.href;
}

export function makeDirectLink(href, secret, options) {
  const url = new URL(makeLink(href, secret, options));
  url.pathname = '/2fa/' + normalizeSecret(secret);
  url.hash = '';
  return url.href;
}

export function parseQr(payload) {
  const text = payload.trim();
  if (/^otpauth-migration:/i.test(text)) throw new Error('暂不支持 Google Authenticator 批量迁移二维码，请使用单个账号的绑定二维码。');
  if (/^otpauth:/i.test(text)) {
    let parsed;
    try { parsed = OTPAuth.URI.parse(text); }
    catch { throw new Error('验证器二维码内容无效，请检查密钥和参数。'); }
    if (!(parsed instanceof OTPAuth.TOTP)) throw new Error('此二维码为 HOTP 计数验证码，当前仅支持 TOTP 时间验证码。');
    return {
      secret: normalizeSecret(parsed.secret.base32),
      options: validateOptions(parsed),
      issuer: parsed.issuer || '',
      account: parsed.label || '',
    };
  }
  if (/^https?:/i.test(text)) {
    const link = parseLink(text);
    if (!link.secret) throw new Error('图片是普通网址二维码，不包含可识别的验证密钥。');
    return { ...link, secret: normalizeSecret(link.secret), issuer: '', account: '' };
  }
  try {
    return { secret: normalizeSecret(text), options: validateOptions(), issuer: '', account: '' };
  } catch {
    throw new Error('二维码中未找到验证密钥，请选择验证器绑定二维码。');
  }
}
