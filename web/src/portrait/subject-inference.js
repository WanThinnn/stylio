import { inferDepth, canFallbackDepthToCpu } from "./ai-inference.js";

export async function refinePortraitSubject(
  matte,
  rgb,
  width,
  height,
  orientation,
  { signal, provider = "webgpu", onProgress = () => {}, workerFactory } = {},
) {
  if (
    !(matte?.confidence instanceof Uint8Array) ||
    matte.confidence.length !== width * height
  )
    throw Error("Invalid subject matte");
  const run = (chosen) =>
    inferDepth(
      rgb.slice(),
      { width, height },
      {
        signal,
        provider: chosen,
        onProgress,
        guidance: {
          matte: { ...matte, confidence: matte.confidence.slice() },
          orientation,
        },
        ...(workerFactory
          ? { workerFactory }
          : {
              workerFactory: () =>
                new Worker(
                  new URL("./subject-inference-worker.js", import.meta.url),
                  { type: "module" },
                ),
            }),
      },
    );
  try {
    return await run(provider);
  } catch (error) {
    signal?.throwIfAborted();
    if (
      provider === "webgpu" &&
      (canFallbackDepthToCpu(error, provider) ||
        /webgpu|unsupported.*(operator|kernel)/i.test(error.message))
    ) {
      onProgress("qualityFallback");
      return run("wasm");
    }
    throw error;
  }
}
