import { extractReceiptFields } from './receipt-fields.js';

const assetRoot = '/receipt-assets/v1/';
let tesseract;
let pdfLibrary;

function loadOcr() {
  if (!tesseract) tesseract = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetRoot + 'tesseract.min.js';
    script.onload = () => globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('OCR unavailable.'));
    script.onerror = () => reject(new Error('OCR unavailable.'));
    document.head.append(script);
  }).catch(error => { tesseract = undefined; throw error; });
  return tesseract;
}

async function receiptImageCanvas(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2300 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function pdfText(file, recognize) {
  pdfLibrary ||= import('/receipt-assets/v1/pdf.min.mjs');
  const pdf = await pdfLibrary;
  pdf.GlobalWorkerOptions.workerSrc = assetRoot + 'pdf.worker.min.mjs';
  const loading = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
    useSystemFonts: true, disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
  let text = '';
  try {
    const documentPdf = await loading.promise;
    for (let index = 1; index <= Math.min(5, documentPdf.numPages); index++) {
      const page = await documentPdf.getPage(index);
      const { items } = await page.getTextContent();
      let y;
      let pageText = '';
      for (const item of items.filter(item => typeof item.str === 'string')) {
        const nextY = item.transform[5];
        if (y != null && Math.abs(y - nextY) > 2) pageText += '\n';
        pageText += item.str + (item.hasEOL ? '\n' : ' ');
        y = nextY;
      }
      if (pageText.trim().length < 25 && index <= 3) {
        const standard = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.25, 2300 / Math.max(standard.width, standard.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pageText = await recognize(canvas);
      }
      text += pageText + '\n';
      page.cleanup();
    }
    return text;
  } finally {
    await loading.destroy();
  }
}

export async function readReceipt(file, progress = () => {}) {
  let worker;
  let pendingWorker;
  let timer;
  let stopped = false;
  const recognize = async canvas => {
    if (stopped) throw new Error('Receipt reading timed out.');
    if (!worker) {
      progress('Loading receipt reader…');
      const library = await loadOcr();
      if (stopped) throw new Error('Receipt reading timed out.');
      pendingWorker = library.createWorker('eng', 1, {
        workerPath: assetRoot + 'worker.min.js', workerBlobURL: false,
        corePath: assetRoot + 'tesseract-core-lstm.wasm.js', langPath: assetRoot, cacheMethod: 'none'
      });
      worker = await pendingWorker;
      if (stopped) throw new Error('Receipt reading timed out.');
    }
    progress('Reading receipt text…');
    const result = await worker.recognize(canvas);
    return result.data.text;
  };
  try {
    const task = (async () => {
      const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
      const text = signature === '%PDF-' ? await pdfText(file, recognize) : await recognize(await receiptImageCanvas(file));
      return extractReceiptFields(text);
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Receipt reading took too long. You can still attach it and enter the details.')), 60000);
    });
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
    stopped = true;
    if (worker) await worker.terminate().catch(() => {});
    else pendingWorker?.then(late => late.terminate()).catch(() => {});
  }
}
