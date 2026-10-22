import { RIMFIT_V3_MODULE_URL } from './recover.mjs';

/**
 * One native browser worker for RimFit v3. The Blob imports the already
 * resolved core-module URL, so it works when the page itself was booted from
 * a Blob module by the local demo loader. No server, Python process, or
 * network service participates in this calculation.
 */
export function createRimFitWorkerClient() {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw Error('Native RimFit worker support is unavailable in this browser.');
  }
  const source = `import { recoverRimEllipseV3 } from ${JSON.stringify(RIMFIT_V3_MODULE_URL)};
self.onmessage = ({data}) => {
  const {id,image,options} = data;
  try {
    const result = recoverRimEllipseV3({width:image.width,height:image.height,data:new Uint8ClampedArray(image.buffer)},options ?? {});
    self.postMessage({id,result});
  } catch (error) {
    self.postMessage({id,error:String(error?.stack ?? error)});
  }
};`;
  const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  const worker = new Worker(url, {type:'module', name:'rimfit-v3'});
  // Module workers fetch their entry asynchronously. Keep this Blob URL alive
  // until a fatal termination; revoking it immediately can reject the module
  // before it imports the already-resolved native core graph.
  let serial = 0;
  let fatal = null;
  const pending = new Map();
  const failAll = error => {
    fatal = error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  worker.onmessage = ({data}) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = event => {
    failAll(Error(event.message || 'Native RimFit worker failed.'));
  };
  return Object.freeze({
    execution:'browser-native-js-worker',
    recover(image, options = {}) {
      if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || !image.data || image.data.length !== image.width * image.height * 4) throw Error('Native RimFit worker needs RGBA image pixels.');
      if (fatal) return Promise.reject(fatal);
      // The PxC PhotoRaster keeps its own immutable buffer; only this copy is
      // transferred, so inspection and crop mapping retain the exact input.
      const pixels = new Uint8ClampedArray(image.data);
      const id = ++serial;
      return new Promise((resolve, reject) => {
        const timer=setTimeout(() => failAll(Error('Native RimFit worker timed out.')), 20_000);
        pending.set(id, {resolve,reject,timer});
        try { worker.postMessage({id,image:{width:image.width,height:image.height,buffer:pixels.buffer},options}, [pixels.buffer]); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
  });
}
