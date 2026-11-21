// Pinned browser builds. SHA-256 values are from the matching npm tarballs.
const receiptAssets = {
  'tesseract.min.js': ['tesseract.js@6.0.1/dist/tesseract.min.js', '10fff78484067759c43028a02a72d76d0b90eb17302bb23b58a9ec5410bc928b'],
  'worker.min.js': ['tesseract.js@6.0.1/dist/worker.min.js', '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842'],
  'tesseract-core-lstm.wasm.js': ['tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js', '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687'],
  'eng.traineddata.gz': ['@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz', '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91'],
  'pdf.min.mjs': ['pdfjs-dist@4.10.38/build/pdf.min.mjs', '27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c'],
  'pdf.worker.min.mjs': ['pdfjs-dist@4.10.38/build/pdf.worker.min.mjs', '1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36']
};

async function receiptAssetDigest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function receiptAssetBytes(stream) {
  const reader = stream?.getReader();
  if (!reader) throw new Error('Asset body missing');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Asset too large');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function handleReceiptAsset(request, env, path, headers) {
  const asset = path.slice('/receipt-assets/v1/'.length);
  const notFound = () => new Response('Not found', { status: 404, headers });
  if (!Object.hasOwn(receiptAssets, asset)) return notFound();
  const [packagePath, hash] = receiptAssets[asset];
  const bucketKey = 'system/receipt-assets/' + hash;
  const responseHeaders = { ...headers, 'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': asset.endsWith('.gz') ? 'application/octet-stream' : 'text/javascript; charset=utf-8' };
  if (request.method === 'PUT') {
    const token = env.RECEIPT_ASSET_SETUP_TOKEN;
    if (!env.BUCKET || typeof token !== 'string' || token.length < 40 ||
        request.headers.get('authorization') !== 'Bearer ' + token) return notFound();
    try {
      const bytes = await receiptAssetBytes(request.body);
      if (await receiptAssetDigest(bytes) !== hash) return new Response('Invalid dependency bytes', { status: 400, headers });
      await env.BUCKET.put(bucketKey, bytes);
      return new Response(null, { status: 204, headers });
    } catch {
      return new Response('Could not store dependency', { status: 400, headers });
    }
  }
  if (request.method !== 'GET') return notFound();
  try {
    const stored = await env.BUCKET?.get(bucketKey);
    if (stored) return new Response(stored.body, { headers: responseHeaders });
    const getAsset = env.RECEIPT_ASSET_FETCH || fetch;
    const upstream = await getAsset('https://cdn.jsdelivr.net/npm/' + packagePath, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!upstream.ok) throw new Error('Dependency unavailable');
    const bytes = await receiptAssetBytes(upstream.body);
    if (await receiptAssetDigest(bytes) !== hash) throw new Error('Dependency integrity check failed');
    return new Response(bytes, { headers: responseHeaders });
  } catch {
    return new Response('Receipt reading assets are temporarily unavailable.', { status: 502, headers });
  }
}
