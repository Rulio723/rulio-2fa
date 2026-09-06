export async function readQrFile(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('请选择 PNG、JPG 或 WebP 等图片文件。');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10 MB。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('无法打开这张图片，请换用 PNG 或 JPG 格式。'); }
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('图片尺寸过大，请裁剪到二维码区域后重试。');
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      const worker = new Worker('/js/qr-reader.js');
      const cleanup = () => { clearTimeout(timer); worker.terminate(); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('识别超时，请裁剪到二维码区域后重试。')); }, 15000);
      worker.onmessage = ({ data }) => {
        cleanup();
        if (data.error) reject(new Error(data.error));
        else if (!data.payload) reject(new Error('未识别到二维码，请选择清晰、完整的二维码图片。'));
        else resolve(data.payload);
      };
      worker.onerror = () => { cleanup(); reject(new Error('二维码识别失败，请刷新页面后重试。')); };
      worker.postMessage({ pixels: image.data.buffer, width: image.width, height: image.height }, [image.data.buffer]);
    });
  } finally {
    bitmap.close();
  }
}
