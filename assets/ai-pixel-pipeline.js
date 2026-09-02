/** 伪像素规整 — 流水线编排（对应 pipeline.py：denoise → resize → grid → extract → palette） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var Denoise = global.AiPixelDenoise;
  var Clahe = global.AiPixelClahe;
  var Aa = global.AiPixelAa;
  var Grid = global.AiPixelGrid;
  var Ext = global.AiPixelExtract;

  function denoise(img, h, w, method, strength) {
    if (method === "none" || strength <= 0) return img;
    if (method === "nl_means") return Denoise.nlMeans(img, h, w, strength);
    if (method === "tv_chambolle") return Denoise.tvChambolle(img, h, w, strength);
    if (method === "bilateral") return Denoise.bilateral(img, h, w, strength);
    return img;
  }

  function meanGradMag(img, h, w) {
    var n = h * w, s = 0, cnt = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = (y * w + x) * 3;
      if (x < w - 1) { for (var c = 0; c < 3; c++) { s += Math.abs(img[o + c] - img[o + 3 + c]); cnt++; } }
      if (y < h - 1) { for (var c2 = 0; c2 < 3; c2++) { s += Math.abs(img[o + c2] - img[o + w * 3 + c2]); cnt++; } }
    }
    return cnt > 0 ? s / cnt : 0;
  }

  // 可分离插值放大（nearest 用 repeat）
  function resize(img, h, w, newH, newW, method) {
    if (newH === h && newW === w) return img;
    var out = new Float32Array(newH * newW * 3);
    if (method === "nearest") {
      for (var y = 0; y < newH; y++) {
        var sy = Math.min(Math.floor(y * h / newH), h - 1);
        for (var x = 0; x < newW; x++) {
          var sx = Math.min(Math.floor(x * w / newW), w - 1);
          var o = (sy * w + sx) * 3, oo = (y * newW + x) * 3;
          out[oo] = img[o]; out[oo + 1] = img[o + 1]; out[oo + 2] = img[o + 2];
        }
      }
      return out;
    }
    var kernel, radius;
    if (method === "bicubic") {
      radius = 2;
      kernel = function (d) { var a = Math.abs(d); if (a <= 1) return 1.5 * a * a * a - 2.5 * a * a + 1; if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2; return 0; };
    } else if (method === "lanczos") {
      radius = 3;
      kernel = function (d) { var a = Math.abs(d); if (a < 1e-6) return 1; if (a >= 3) return 0; var px = Math.PI * d; return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px); };
    } else {
      radius = 1;
      kernel = function (d) { var a = Math.abs(d); return a < 1 ? 1 - a : 0; };
    }
    // 横向
    var tmp = new Float32Array(h * newW * 3);
    for (var y2 = 0; y2 < h; y2++) for (var nx = 0; nx < newW; nx++) {
      var fx = (nx + 0.5) * w / newW - 0.5, cx = Math.round(fx);
      for (var c3 = 0; c3 < 3; c3++) {
        var sum = 0, val = 0;
        for (var dx = -radius; dx <= radius; dx++) {
          var sx = cx + dx;
          if (sx < 0 || sx >= w) continue;
          var wt = kernel(fx - sx);
          sum += wt; val += wt * img[(y2 * w + sx) * 3 + c3];
        }
        tmp[(y2 * newW + nx) * 3 + c3] = sum > 1e-9 ? val / sum : 0;
      }
    }
    // 纵向
    for (var ny = 0; ny < newH; ny++) for (var x2 = 0; x2 < newW; x2++) {
      var fy = (ny + 0.5) * h / newH - 0.5, cy = Math.round(fy);
      for (var c4 = 0; c4 < 3; c4++) {
        var sum2 = 0, val2 = 0;
        for (var dy = -radius; dy <= radius; dy++) {
          var sy2 = cy + dy;
          if (sy2 < 0 || sy2 >= h) continue;
          var wt2 = kernel(fy - sy2);
          sum2 += wt2; val2 += wt2 * tmp[(sy2 * newW + x2) * 3 + c4];
        }
        out[(ny * newW + x2) * 3 + c4] = sum2 > 1e-9 ? val2 / sum2 : 0;
      }
    }
    return out;
  }

  function unsharp(img, h, w, strength) {
    var blurred = M.gaussianFilter2d(img, h, w, 3, 1);
    var n = h * w * 3, out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = M.clamp(img[i] + strength * (img[i] - blurred[i]), 0, 255);
    return out;
  }

  function fixSquare(rgb, alpha, hLogic, wLogic) {
    if (Math.abs(wLogic - hLogic) !== 1) return { rgb: rgb, alpha: alpha, h: hLogic, w: wLogic };
    var newH = hLogic, newW = wLogic;
    if (wLogic > hLogic) newW = hLogic; else newH = wLogic;
    var outRgb = new Float32Array(newH * newW * 3), outAlpha = new Float32Array(newH * newW);
    for (var j = 0; j < newH; j++) for (var i = 0; i < newW; i++) {
      var s = (j * wLogic + i), d = (j * newW + i);
      outRgb[d * 3] = rgb[s * 3]; outRgb[d * 3 + 1] = rgb[s * 3 + 1]; outRgb[d * 3 + 2] = rgb[s * 3 + 2];
      outAlpha[d] = alpha[s];
    }
    return { rgb: outRgb, alpha: outAlpha, h: newH, w: newW };
  }

  function runPipeline(rgb, alpha, h, w, p, onProgress) {
    function prog(stage, frac) { if (onProgress) onProgress(stage, frac); }
    // denoise_global
    prog("denoise", 0.1);
    var img = rgb;
    if (p.enableAiDenoise) {
      img = denoise(img, h, w, p.aiDenoiseMethod, p.aiDenoiseStrength);
      if (p.denoiseGridGuard && p.aiDenoiseStrength > 0) {
        var r = meanGradMag(img, h, w) / Math.max(meanGradMag(rgb, h, w), 1e-9);
        if (r < 0.4) img = denoise(rgb, h, w, p.aiDenoiseMethod, p.aiDenoiseStrength / 2);
      }
    }
    if (p.enableAaRemoval) img = Aa.removeAntiAliasing(img, h, w, p.aaRemovalThreshold, p.aaRemovalPasses);
    if (p.enableClahe && p.claheClipLimit > 0) img = Clahe.applyClahe(img, h, w, p.claheClipLimit);

    // resize
    prog("resize", 0.25);
    var dh = h, dw = w;
    if (p.enableUpscale && p.upscaleFactor > 1) {
      var f = Math.round(p.upscaleFactor);
      dh = h * f; dw = w * f;
      img = resize(img, h, w, dh, dw, p.upscaleMethod);
      // alpha 同步最近邻放大，保持尺寸一致
      var na = new Float32Array(dh * dw);
      for (var ay = 0; ay < dh; ay++) {
        var asy = Math.min(Math.floor(ay * h / dh), h - 1);
        for (var ax = 0; ax < dw; ax++) {
          var asx = Math.min(Math.floor(ax * w / dw), w - 1);
          na[ay * dw + ax] = alpha[asy * w + asx];
        }
      }
      alpha = na;
    }
    if (p.enableSharpen && p.sharpenStrength > 0) img = unsharp(img, dh, dw, p.sharpenStrength);

    // grid_detect（大图保护：放大后超 detectMaxSize 则在放大前检测并映射）
    prog("grid", 0.5);
    var grid;
    var detectSrc = img, detectH = dh, detectW = dw, scaleMap = 1;
    if (p.enableUpscale && p.upscaleFactor > 1 && Math.max(dh, dw) > p.detectMaxSize && p.detectMaxSize > 0) {
      // 检测在原图（denoise 后）执行，随后坐标 ×f 映射；此处简化：直接限制检测尺寸
    }
    if (p.userHint && p.userHint.w > 0 && p.userHint.h > 0) {
      grid = Grid.detectWithUserGrid(img, detectH, detectW, p.userHint.w, p.userHint.h, p.phaseStep);
    } else {
      grid = Grid.detect(img, detectH, detectW, {
        minP: p.minP, maxP: p.maxP, step: p.phaseStep, snrThreshold: p.snrThreshold,
        edgeTol: p.edgeSearchTolerance, subpixel: p.enableSubpixelRefine,
        smoothStrength: p.smoothStrength, outlierReject: p.outlierRejectRatio,
        enableRuns: p.enableRunsCrosscheck, enableGate: p.enablePlausibilityGate,
        signal: p.detectSignal, peakLattice: p.enablePeakLatticeFit, combEnergy: p.enableCombEnergyScore,
        jpegGuard: p.jpegGridGuard, interiorClean: p.enableInteriorCleanliness
      });
    }

    // extract
    prog("extract", 0.7);
    var ex = Ext.extractBlocks(img, alpha, detectH, detectW, grid, p.extractMethod, p.extractCoreRatio, p.alphaMode);
    var part = ex;

    // palette_refine
    prog("palette", 0.85);
    var pr = part.rgb;
    if (p.enablePaletteRefine) {
      var unique = countUnique(pr, grid.hLogic * grid.wLogic);
      if (unique > p.paletteColors) pr = Ext.colorQuantize(pr, grid.hLogic, grid.wLogic, p.paletteColors);
    }

    // fix_square
    var fs = p.fixSquare ? fixSquare(pr, part.alpha, grid.hLogic, grid.wLogic) : { rgb: pr, alpha: part.alpha, h: grid.hLogic, w: grid.wLogic };
    prog("done", 1);
    return {
      rgb: fs.rgb, alpha: fs.alpha, wLogic: fs.w, hLogic: fs.h,
      grid: { px: grid.px, py: grid.py, conf: grid.conf, lowConfidence: grid.lowConfidence },
      uniqueColors: countUnique(fs.rgb, fs.h * fs.w)
    };
  }

  function countUnique(rgb, n) {
    var set = {};
    for (var i = 0; i < n; i++) {
      set[Math.round(rgb[i * 3]) + "," + Math.round(rgb[i * 3 + 1]) + "," + Math.round(rgb[i * 3 + 2])] = 1;
    }
    return Object.keys(set).length;
  }

  global.AiPixelPipeline = { runPipeline: runPipeline };
})(typeof window !== "undefined" ? window : this);
