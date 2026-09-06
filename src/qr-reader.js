import jsQR from 'jsqr';

self.onmessage = ({ data: { pixels, width, height } }) => {
  try {
    const result = jsQR(new Uint8ClampedArray(pixels), width, height, { inversionAttempts: 'attemptBoth' });
    self.postMessage({ payload: result?.data || '' });
  } catch {
    self.postMessage({ error: '二维码识别失败，请换一张清晰图片。' });
  }
};
