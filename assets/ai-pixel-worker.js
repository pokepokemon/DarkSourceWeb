/** 伪像素规整 — Web Worker 入口（后台跑流水线，避免主线程卡死） */
importScripts(
  "ai-pixel-math.js",
  "ai-pixel-color.js",
  "ai-pixel-denoise.js",
  "ai-pixel-clahe.js",
  "ai-pixel-aa.js",
  "ai-pixel-grid-signal.js",
  "ai-pixel-grid-fft.js",
  "ai-pixel-grid-band.js",
  "ai-pixel-grid-cross.js",
  "ai-pixel-grid-vote.js",
  "ai-pixel-grid-refine.js",
  "ai-pixel-grid-comb.js",
  "ai-pixel-grid-phase.js",
  "ai-pixel-grid-squares.js",
  "ai-pixel-grid-bfs.js",
  "ai-pixel-grid-expand.js",
  "ai-pixel-grid-ar.js",
  "ai-pixel-grid.js",
  "ai-pixel-extract.js",
  "ai-pixel-pipeline.js"
);

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type !== "run") return;
  var rgb = new Float32Array(msg.rgb);
  var alpha = new Float32Array(msg.alpha);
  try {
    var result = AiPixelPipeline.runPipeline(rgb, alpha, msg.h, msg.w, msg.params, function (stage, frac) {
      self.postMessage({ type: "progress", stage: stage, frac: frac });
    });
    self.postMessage({
      type: "result",
      rgb: result.rgb, alpha: result.alpha,
      wLogic: result.wLogic, hLogic: result.hLogic,
      grid: result.grid, uniqueColors: result.uniqueColors
    }, [result.rgb.buffer, result.alpha.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: err && err.message ? err.message : "处理失败" });
  }
};
