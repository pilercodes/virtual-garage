// Pinned browser builds. SHA-256 values are from the matching npm tarballs.
const receiptAssets = {
  'tesseract.min.js': ['tesseract.js@6.0.1/dist/tesseract.min.js', '10fff78484067759c43028a02a72d76d0b90eb17302bb23b58a9ec5410bc928b'],
  'worker.min.js': ['tesseract.js@6.0.1/dist/worker.min.js', '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842'],
  'tesseract-core-lstm.wasm.js': ['tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js', '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687'],
  'eng.traineddata.gz': ['@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91'],
  'pdf.min.mjs': ['pdfjs-dist@4.10.38/build/pdf.min.mjs', '27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c'],
  'pdf.worker.min.mjs': ['pdfjs-dist@4.10.38/build/pdf.worker.min.mjs', '1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36']
};

export async function handleReceiptAsset(request, env, path, headers) {
  const asset = path.slice('/receipt-assets/v1/'.length);
  if (request.method !== 'GET' || !Object.hasOwn(receiptAssets, asset)) return new Response('Not found', { status: 404, headers });
  const [packagePath, hash] = receiptAssets[asset];
  try {
    const getAsset = env.RECEIPT_ASSET_FETCH || fetch;
    const upstream = await getAsset('https://cdn.jsdelivr.net/npm/' + packagePath, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!upstream.ok) throw new Error('Dependency unavailable');
    const bytes = await upstream.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== hash) throw new Error('Dependency integrity check failed');
    const responseHeaders = { ...headers, 'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': asset.endsWith('.gz') ? 'application/octet-stream' : 'text/javascript; charset=utf-8' };
    return new Response(bytes, { headers: responseHeaders });
  } catch {
    return new Response('Receipt reading assets are temporarily unavailable.', { status: 502, headers });
  }
}
