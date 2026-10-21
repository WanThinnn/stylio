const CACHE_PREFIX = "photographic-style-port-";
const CACHE_NAME = `${CACHE_PREFIX}v244`;
// Filled by the static release builder. Also refresh older, unversioned clients.
const RELEASE_ID = "development";
// Immutable dependency identity, independent of UI/service-worker releases.
const DEPTH_ASSET_CACHE = 'photographic-style-depth-assets-4472b736-ort-1.22.0';

// Warm the complete offline converter after startup. Only BOOT_SHELL below
// gates installation, so first visits do not wait for the whole module graph.
const APP_SHELL = [
  "./styles/foundations/tokens.css",
  "./styles/foundations/base.css",
  "./styles/layout/app-shell.css",
  "./styles/layout/workspace.css",
  "./styles/components/controls.css",
  "./styles/components/materials.css",
  "./styles/components/sheets.css",
  "./styles/components/release-notes.css",
  "./src/ui/release-notes.js",
  "./src/app/version.js",
  "./VERSION",
  "./release-notes/v1.1.0.md",
  "./styles/components/results.css",
  "./styles/components/portrait-editor.css",
  "./src/ui/shell/app-shell.js",
  "./src/ui/shell/dock-viewport.js",
  "./src/ui/shell/sheet-gestures.js",
  "./src/ui/shell/sheet-frame.js",
  "./src/ui/processing-preferences.js",
  "./src/ui/screen-awake.js",
  "./src/app/processing/task-queue.js",
  "./src/app/processing/isolated-processor.js",
  "./src/app/processing/lane-runtime.js",
  "./processing-lane.html",
  "./src/ui/shell/tab-glass.js",
  "./styles/components/navigation-effects.css",
  "./src/ui/results/result-view.js",
  "./src/ui/confirm-dialog.js",
  "./src/ui/history-store.js",
  "./src/app/processing/portrait-controller.js",
  "./src/app/processing/photo-analysis.js",
  "./src/app/processing/profiles.js",
  "./src/media/live-photo-session.js",
  "./src/app/processing/file-processor.js",
  "./src/app/application.js",
  "./src/core/gain-map.js",
  "./src/styles/hdr-compatibility.js",
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./LICENSE.txt",
  "./THIRD_PARTY_NOTICES.txt",
  "./src/ui/page-bootstrap.js",
  "./src/ui/processing-scheduler.js",
  "./src/ui/ai-strings.js",
  "./src/ui/ai-feature-controls.js",
  "./src/detail/detail-processing.js",
  "./src/detail/detail-models.js",
  "./src/detail/detail-inference.js",
  "./src/detail/detail-worker.js",
  "./src/detail/detail-raster.js",
  "./src/detail/detail-native-heic.js",
  "./src/recommend/style-selection.js",
  "./src/recommend/style-quality.js",
  "./src/recommend/style-reference-bank.js",
  "./src/recommend/style-analysis.js",
  "./src/recommend/style-prototypes.js",
  "./src/recommend/style-semantic-axes.js",
  "./src/recommend/style-profile-matrix.js",
  "./src/recommend/style-scene-decision.js",
  "./src/recommend/style-recommender.js",
  "./src/recommend/style-display-render.js",
  "./src/recommend/style-display-heic.js",
  "./src/recommend/style-model.js",
  "./src/recommend/style-preprocess.js",
  "./src/recommend/style-inference.js",
  "./src/recommend/style-inference-worker.js",
  "./src/recommend/style-runtime.js",
  "./vendor/ai-style/style-prototypes-lite.json",
  "./vendor/ai-style/style-prototypes-standard.json",
  "./vendor/ai-style/style-prototypes-pro.json",
  "./src/portrait/ai-portrait.js",
  "./src/portrait/ai-inference.js",
  "./src/portrait/ai-inference-worker.js",
  "./src/portrait/depth-models.js",
  "./src/core/cache-cleanup.js",
  "./src/portrait/ai-depth-refinement.js",
  "./src/portrait/person-depth-guidance.js",
  "./src/portrait/subject-depth-guidance.js",
  "./src/portrait/subject-mask.js",
  "./src/portrait/subject-inference.js",
  "./src/portrait/subject-inference-worker.js",
  "./src/portrait/foreground-matte.js",
  "./src/portrait/foreground-matte-model.js",
  "./src/portrait/foreground-matte-inference.js",
  "./src/portrait/foreground-matte-worker.js",
  "./src/media/auxiliary-image.js",
  "./src/portrait/ai-portrait-assembler.js",
  "./src/portrait/ai-portrait-export-worker.js",
  "./src/codecs/libheif-lifecycle.js",
  "./src/portrait/ai-portrait-container.js",
  "./src/portrait/native-portrait-contract.js",
  "./src/portrait/native-base-analysis.js",
  "./src/portrait/apple-depth-metadata.js",
  "./src/portrait/ai-portrait-export.js",
  "./src/portrait/portrait-hdr-calibration.js",
  "./src/portrait/portrait-geometry.js",
  "./src/portrait/portrait-blur-response.js",
  "./src/portrait/portrait-scene-response.js",
  "./src/portrait/ai-portrait-preview.js",
  "./src/portrait/portrait-template.json",
  "./src/portrait/ai-portrait-ui.js",
  "./src/portrait/ai-portrait-blur.js",
  "./src/portrait/ai-portrait-source.js",
  "./src/portrait/ai-bokeh.js",
  "./src/dng/dng-import.js",
  "./src/dng/dng-tiff.js",
  "./src/dng/dng-tiles.js",
  "./src/dng/dng-worker.js",
  "./src/dng/dng-decode.js",
  "./src/dng/dng-assets.js",
  "./src/dng/dng-inspection.js",
  "./src/dng/model-download.js",
  "./manifest.webmanifest",
  "./icons/photographic-styles.svg",
  "./icons/photographic-styles-dark.svg",
  "./icons/icon-180.png",
  "./icons/apple-touch-icon.png",
  "./icons/apple-touch-icon-v2.png",
  "./icons/icon-192.png",
  "./icons/icon-192-v2.png",
  "./icons/icon-512.png",
  "./icons/icon-512-v2.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-512-maskable-v2.png",
  "./profiles/index.json",
  "./profiles/45-15.zip",
  "./profiles/48-12.zip",
  "./src/core/box.js",
  "./src/core/bplist.js",
  "./src/media/decode.js",
  "./src/core/exif.js",
  "./src/styles/style-preservation.js",
  "./src/styles/style-capabilities.js",
  "./src/compatibility/versions.js",
  "./src/compatibility/contract-registry.js",
  "./src/compatibility/errors.js",
  "./src/compatibility/graph-policy.js",
  "./src/compatibility/contract-fingerprint.js",
  "./src/compatibility/contract-signature.js",
  "./src/compatibility/contract-classifier.js",
  "./src/compatibility/target-registry.js",
  "./src/compatibility/recovery-preflight.js",
  "./src/compatibility/conversion-plan.js",
  "./src/compatibility/mutation-budget.js",
  "./src/compatibility/semantic-diff.js",
  "./src/compatibility/output-verifier.js",
  "./src/compatibility/adapters/index.js",
  "./src/compatibility/legacy-sanitize.js",
  "./src/compatibility/legacy-export.js",
  "./src/ui/startup.js",
  "./src/media/heic-worker.js",
  "./src/media/heic-processing.js",
  "./src/ui/result-metadata.js",
  "./src/codecs/ffmpeg-assets.js",
  "./src/codecs/ffmpeg-hevc.js",
  "./src/codecs/ffmpeg-worker.js",
  "./src/styles/graft.js",
  "./src/core/heif.js",
  "./src/codecs/hevc-linear-tags.js",
  "./src/ui/i18n.js",
  "./src/media/image-format.js",
  "./src/codecs/linear-thumbnail.js",
  "./src/media/live-photo.js",
  "./src/core/model-download.js",
  "./src/styles/port.js",
  "./src/media/photo-date.js",
  "./src/styles/styles.js",
  "./src/styles/texture.js",
  "./src/styles/texture-compatibility.js",
  "./src/styles/generated-style-metadata.js",
  "./src/styles/soft-skin.js",
  "./src/styles/soft-skin-container.js",
  "./src/vision/face-mattes.js",
  "./src/vision/face-refinement.js",
  "./src/vision/face-canonical.js",
  "./src/vision/matte-encoder.js",
  "./src/vision/source.js",
  "./src/vision/model-download.js",
  "./src/vision/ort-assets.js",
  "./src/vision/ort-vision.js",
  "./src/vision/ort-vision-math.js",
  "./src/vision/ort-inference-worker.js",
  "./src/raster/box.js",
  "./src/raster/bplist.js",
  "./src/raster/exif.js",
  "./src/raster/ffmpeg-assets.js",
  "./src/raster/ffmpeg-hevc.js",
  "./src/raster/ffmpeg-worker.js",
  "./src/raster/generated-profile.js",
  "./src/raster/heif.js",
  "./src/raster/hevc-color.js",
  "./src/raster/hevc-encoder.js",
  "./src/raster/hevc-linear-tags.js",
  "./src/raster/linear-thumbnail.js",
  "./src/raster/model-download.js",
  "./src/raster/native-empty-texture.js",
  "./src/raster/portrait-matte.js",
  "./src/raster/raster-color.js",
  "./src/raster/raster-import.js",
  "./src/raster/jpeg-hdr.js",
  "./src/raster/hdr-scalar-pair.js",
  "./src/raster/hdr-scalar-export.js",
  "./src/raster/heic-grid-sample.js",
  "./src/raster/hdr-linear-thumbnail.js",
  "./src/raster/editable-hdr-pair.js",
  "./src/raster/hagc.js",
  "./src/raster/pq-hagc-icc.js",
  "./src/raster/styles.js",
  "./src/raster/synthetic-hevc.js",
  "./src/raster/texture.js",
  "./src/raster/zip.js",
  "./src/core/zip.js"
];

// Only the initial screen gates activation. Preloading the whole converter
// here left first visits waiting for every rarely-used processing module.
const BOOT_SHELL=['./','./index.html','./styles.css',"./styles/foundations/tokens.css","./styles/foundations/base.css","./styles/layout/app-shell.css","./styles/layout/workspace.css","./styles/components/controls.css","./styles/components/sheets.css","./styles/components/results.css","./styles/components/portrait-editor.css","./src/ui/shell/app-shell.js",'./src/ui/page-bootstrap.js','./src/ui/i18n.js','./src/ui/ai-strings.js','./icons/photographic-styles.svg','./styles/components/materials.css','./THIRD_PARTY_NOTICES.txt','./src/ui/shell/dock-viewport.js','./src/ui/shell/tab-glass.js','./styles/components/navigation-effects.css','./styles/components/release-notes.css'];
BOOT_SHELL.push('./src/ui/processing-preferences.js','./src/ui/shell/sheet-gestures.js','./src/ui/shell/sheet-frame.js');
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache)=>Promise.allSettled(BOOT_SHELL.map(path=>cache.addAll([path]))))
      .catch(error => console.warn('Offline cache unavailable:', error))
      .then(() => self.skipWaiting())
  );
});

let warming;
self.addEventListener('message',event=>{
  if(event.data?.type!=='WARM_CACHE')return;
  warming??=(async()=>{
    const cache=await caches.open(CACHE_NAME),pending=APP_SHELL.slice();
    const warmOne=async path=>{
      if(await cache.match(path))return;
      let lastError;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const response=await fetch(path,{cache:attempt?'reload':'no-cache'});
          if(response.ok){await cache.put(path,response);return;}
          lastError=Error(`HTTP ${response.status} warming ${path}`);
        }catch(error){lastError=error;}
      }
      console.warn('Offline asset unavailable:',path,lastError);
    };
    // A single stale/missing deployment asset must not abort the rest of the cache.
    await Promise.all(Array.from({length:4},async()=>{
      while(pending.length)await warmOne(pending.shift());
    }));
  })().catch(error=>{warming=null;console.warn('Offline preparation unavailable:',error);});
  event.waitUntil(warming);
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      // Remove temporary photo copies made by the retired download experiment.
      .then(() => caches.delete('psport-local-downloads-v1'))
      .catch(error => console.warn('Cache cleanup unavailable:', error))
      .then(() => self.clients.claim())
  );
});

function isolated(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}


async function networkFirst(request) {
  let cache;
  try { cache = await caches.open(CACHE_NAME); } catch {}
  try {
    // Revalidate instead of trusting the HTTP cache (GitHub Pages allows 10 minutes), so a
    // freshly deployed page never runs with stale scripts or copy. Unchanged files cost a 304.
    // A navigation Request cannot be re-initialised, so it is refetched by URL.
    const releaseUrl = new URL(request.url);
    if(RELEASE_ID !== "development")releaseUrl.searchParams.set('release', RELEASE_ID);
    const source = request.mode === "navigate" ? releaseUrl.href
      : RELEASE_ID === "development" ? request : new Request(releaseUrl.href, request);
    const response = await fetch(source,
                                 { cache: "no-cache" });
    if(response.ok){
      if(cache)try{await cache.put(request,response.clone());}catch{}
      return isolated(response);
    }
    // Rolling deploys can briefly expose a 404 for one module while the previous
    // complete app is still cached. Prefer that known-good copy instead of failing boot.
    let cached;
    try{cached=await cache?.match(request,{ignoreSearch:true});}catch{}
    return isolated(cached||response);
  } catch (error) {
    let cached;
    try { cached = await cache?.match(request, { ignoreSearch: true }); } catch {}
    if (cached) return isolated(cached);
    throw error;
  }
}

// A service-worker release owns a complete versioned app cache. Reopening that
// release must not await the network for HTML or every imported module. Browser
// SW update checks replace the release cache when sw.js changes.
async function cachedApp(request,{navigation=false}={}){
  try{
    const cache=await caches.open(CACHE_NAME);
    const hit=await cache.match(request,{ignoreSearch:true})
      ||(navigation&&await cache.match('./index.html'));
    if(hit)return isolated(hit);
  }catch{}
  return networkFirst(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Third-party requests (the optional decoder and anonymous visit counter)
  // retain their existing failure behavior and are never persisted here.
  if (url.origin !== self.location.origin) return;

  if(url.pathname.includes('/vendor/ai-style/')){
    // Large Suggested Styles ONNX files belong exclusively to the verified
    // model downloader cache. Keep the small manifest/semantic axes/reference
    // diagnostics on the normal versioned app cache so offline re-use does not duplicate weights.
    if(/\.onnx$/.test(url.pathname)){
      event.respondWith(fetch(request).then(isolated));
    }else event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/vendor/ai-portrait/')) {
    // Opt-in assets are immutable for this app version. Cache once, and tolerate
    // storage quota/private-mode failures instead of discarding a valid response.
    event.respondWith((async () => {
      let cache;
      // The model downloader owns complete, SHA-verified model storage. Avoid
      // retaining a second 100 MB copy here. Small runtime assets share a
      // revision cache; the manifest revalidates when deployment changes.
      if(/\.onnx(?:_data)?$/.test(url.pathname))return isolated(await fetch(request));
      if(/\/(?:assets|foreground-assets)\.json$/.test(url.pathname))return networkFirst(request);
      try {cache=await caches.open(DEPTH_ASSET_CACHE);const hit=await cache.match(request);if(hit)return isolated(hit);} catch {}
      const response=await fetch(request);
      if(response.ok&&cache)try{await cache.put(request,response.clone());}catch{}
      return isolated(response);
    })());
    return;
  }


  if (request.mode === "navigate") {
    event.respondWith(
      cachedApp(request,{navigation:request.destination!=='iframe'}).catch(async () => {
        if(request.destination==='iframe')
          return isolated(new Response('Processing runtime unavailable offline. Reconnect and retry.',{status:503}));
        let cached;
        try { cached = await caches.match("./index.html"); } catch {}
        return isolated(cached || new Response('Offline. Please reconnect and retry.', {status:503}));
      })
    );
    return;
  }

  event.respondWith(cachedApp(request));
});
