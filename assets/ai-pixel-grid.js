/** 伪像素规整 — 网格检测主流程（detect / detect_with_user_grid 移植） */
(function (global) {
  "use strict";
  var M = global.AiPixelMath;
  var Sig = global.AiPixelSignal;
  var Fft = global.AiPixelFft;
  var Band = global.AiPixelBand;
  var Vote = global.AiPixelVote;
  var Cross = global.AiPixelCross;
  var Refine = global.AiPixelRefine;
  var Comb = global.AiPixelComb;
  var Ph = global.AiPixelPhase;
  var Squares = global.AiPixelSquares;
  var Bfs = global.AiPixelBfs;
  var Expand = global.AiPixelExpand;
  var Ar = global.AiPixelAr;

  function directionProtectionOk(edgeMap, h, w, smaller, larger, axis, integral) {
    if (!edgeMap || smaller <= 0 || larger <= 0) return true;
    var eS = Band.edgeBandStrength(edgeMap, h, w, smaller, axis, null, integral);
    var eL = Band.edgeBandStrength(edgeMap, h, w, larger, axis, null, integral);
    if (eL <= 1e-12) return true;
    return eS >= 0.7 * eL;
  }

  function hasPixelGrid(gray, h, w, minP, maxP, snrThreshold, edgeMap, preNormalized, edgeIntegral, sigX, sigY) {
    var g = gray;
    if (!preNormalized) g = Sig.localContrastNormalize(gray, h, w, 33);
    if (!sigX) {
      sigX = new Float32Array(w - 1);
      for (var y = 0; y < h; y++) for (var x = 1; x < w; x++) sigX[x - 1] += Math.abs(g[y * w + x] - g[y * w + x - 1]);
    }
    if (!sigY) {
      sigY = new Float32Array(h - 1);
      for (var y2 = 1; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) sigY[y2 - 1] += Math.abs(g[y2 * w + x2] - g[(y2 - 1) * w + x2]);
    }
    var fx = Fft.fftBandSnr(sigX, minP, maxP);
    var periodX = fx.period, snrX = fx.snr;
    var acfX = Fft.acfPeriod(sigX, minP, maxP);
    if (acfX.peaks.length) {
      var baseX = Fft.harmonicInterpret(acfX.peaks);
      if (baseX > 0 && periodX > 0) {
        var ratio = periodX / baseX, near = Math.round(ratio);
        if (near >= 2 && Math.abs(ratio - near) / near < 0.15) {
          if (!edgeMap || directionProtectionOk(edgeMap, h, w, baseX, periodX, 1, edgeIntegral)) periodX = baseX;
        }
      }
    }
    var fy = Fft.fftBandSnr(sigY, minP, maxP);
    var periodY = fy.period, snrY = fy.snr;
    var acfY = Fft.acfPeriod(sigY, minP, maxP);
    if (acfY.peaks.length) {
      var baseY = Fft.harmonicInterpret(acfY.peaks);
      if (baseY > 0 && periodY > 0) {
        var ratio2 = periodY / baseY, near2 = Math.round(ratio2);
        if (near2 >= 2 && Math.abs(ratio2 - near2) / near2 < 0.15) {
          if (!edgeMap || directionProtectionOk(edgeMap, h, w, baseY, periodY, 0, edgeIntegral)) periodY = baseY;
        }
      }
    }
    var snr, period;
    if (snrX >= snrY) { snr = snrX; period = periodX; } else { snr = snrY; period = periodY; }
    return { has: snr >= snrThreshold, snr: snr, period: period, periodX: periodX, periodY: periodY, snrX: snrX, snrY: snrY };
  }

  function detect(rgb, h, w, o) {
    o = o || {};
    var minP = o.minP || 3, maxP = o.maxP || 40, step = o.step || 0.1, snrThreshold = o.snrThreshold || 8;
    var edgeTol = o.edgeTol || 3, subpixel = o.subpixel !== false, smoothStrength = o.smoothStrength === undefined ? 0.5 : o.smoothStrength;
    var outlierReject = o.outlierReject === undefined ? 0.5 : o.outlierReject;
    var combWeight = o.combWeight || 0, useCombPrefilter = !!o.useCombPrefilter;
    var enableRuns = o.enableRuns !== false, enableGate = o.enableGate !== false;
    var signal = o.signal || "gray";
    var peakLattice = o.peakLattice !== false, combEnergy = o.combEnergy !== false, jpegGuard = !!o.jpegGuard;
    var interiorClean = !!o.interiorClean;
    var guardTol = o.aspectGuardTol === undefined ? 0.12 : o.aspectGuardTol;

    var useOklab = signal === "oklab" && rgb.length === h * w * 3;
    var sigX, sigY, edgeMap, grayArr, normGray;
    if (useOklab) {
      var os = Sig.oklabSignal(rgb, h, w);
      sigX = os.sigX; sigY = os.sigY; edgeMap = os.edgeMap; grayArr = os.gray; normGray = grayArr;
    } else {
      grayArr = new Float32Array(h * w);
      for (var i = 0; i < h * w; i++) grayArr[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
      edgeMap = Sig.computeEdgeMap(rgb, h, w, 3);
      normGray = Sig.localContrastNormalize(grayArr, h, w, 33);
      sigX = new Float32Array(w - 1);
      for (var y = 0; y < h; y++) for (var x = 1; x < w; x++) sigX[x - 1] += Math.abs(normGray[y * w + x] - normGray[y * w + x - 1]);
      sigY = new Float32Array(h - 1);
      for (var y2 = 1; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) sigY[y2 - 1] += Math.abs(normGray[y2 * w + x2] - normGray[(y2 - 1) * w + x2]);
    }
    var IEdge = M.integralImage(edgeMap, h, w);
    var IGray = M.integralImage(grayArr, h, w);
    var g2 = new Float32Array(h * w);
    for (var gi = 0; gi < g2.length; gi++) g2[gi] = grayArr[gi] * grayArr[gi];
    var IGraySq = M.integralImage(g2, h, w);

    var jpegInfo = [], jpegPenalty = false;
    if (jpegGuard) {
      var jr = Cross.detectJpegGrid(grayArr, h, w);
      jpegInfo = [jr.significant, jr.phase, jr.strength];
      jpegPenalty = jr.significant;
    }

    function phaseSearch(px, py) {
      if (useOklab) return Ph.findPhaseEdge(edgeMap, h, w, px, py, step);
      return Ph.findPhase(grayArr, h, w, px, py, step);
    }

    var hp = hasPixelGrid(normGray, h, w, minP, maxP, snrThreshold, edgeMap, true, IEdge, sigX, sigY);
    var hasFft = hp.has;
    var periodX = hp.periodX, periodY = hp.periodY, snrX = hp.snrX, snrY = hp.snrY, snr = hp.snr, period = hp.period;
    if (!hp.has) {
      var gg = Sig.estimateGridGradient(grayArr, h, w);
      if (gg.px <= 0 || gg.py <= 0) throw new Error("未检测到像素网格周期，输入可能不是 AI 生成的伪像素图");
      periodX = gg.px; periodY = gg.py; period = (gg.px + gg.py) / 2; snr = 0; snrX = 0; snrY = 0;
    }

    var vx = Vote.votePeriod(grayArr, h, w, sigX, minP, maxP, 1, edgeMap, combWeight, useCombPrefilter, IEdge, IGray, IGraySq, jpegPenalty, interiorClean);
    var vy = Vote.votePeriod(grayArr, h, w, sigY, minP, maxP, 0, edgeMap, combWeight, useCombPrefilter, IEdge, IGray, IGraySq, jpegPenalty, interiorClean);
    var votePx = vx.period, confX = vx.confidence, votePy = vy.period, confY = vy.confidence;
    if (votePx > 0) {
      var eVote = Band.edgeBandStrength(edgeMap, h, w, votePx, 1, null, IEdge);
      var eFft = periodX > 0 ? Band.edgeBandStrength(edgeMap, h, w, periodX, 1, null, IEdge) : 0;
      if (confX > 0.3 || (eVote > 1e-12 && eFft > 1e-12 && eVote > 1.2 * eFft)) periodX = votePx;
    }
    if (votePy > 0) {
      var eVote2 = Band.edgeBandStrength(edgeMap, h, w, votePy, 0, null, IEdge);
      var eFft2 = periodY > 0 ? Band.edgeBandStrength(edgeMap, h, w, periodY, 0, null, IEdge) : 0;
      if (confY > 0.3 || (eVote2 > 1e-12 && eFft2 > 1e-12 && eVote2 > 1.2 * eFft2)) periodY = votePy;
    }
    var voteConf = (confX + confY) / 2;

    if (enableRuns) {
      var rs = Cross.detectIntegerScale(grayArr, h, w, minP, maxP);
      if (rs.sx > 0 && rs.sy > 0 && rs.sx === rs.sy && rs.hitRate >= 0.7) {
        var runsScale = rs.sx;
        periodX = Cross.runsCorrectPeriod(periodX, votePx, runsScale, edgeMap, h, w, 1, minP, maxP, IEdge);
        periodY = Cross.runsCorrectPeriod(periodY, votePy, runsScale, edgeMap, h, w, 0, minP, maxP, IEdge);
      }
    }

    if (peakLattice) {
      var origPx = periodX, origPy = periodY;
      if (periodX > 0) periodX = Refine.refinePeriodPeakLattice(sigX, periodX, minP, maxP);
      if (periodY > 0) periodY = Refine.refinePeriodPeakLattice(sigY, periodY, minP, maxP);
      if (origPx > 0 && origPy > 0) {
        var origDiff = Math.abs(origPx - origPy) / Math.max(origPx, origPy);
        var refDiff = Math.abs(periodX - periodY) / Math.max(periodX, periodY);
        if (origDiff <= 0.05 && refDiff > 0.02) { periodX = origPx; periodY = origPy; }
      }
    }

    var combConfX = 0, combConfY = 0;
    if (combEnergy) {
      var cbx = Comb.combBestPeriod(sigX, minP, maxP);
      combConfX = cbx.confidence;
      if (cbx.confidence >= 0.35 && cbx.pitch > 0) periodX = cbx.pitch;
      var cby = Comb.combBestPeriod(sigY, minP, maxP);
      combConfY = cby.confidence;
      if (cby.confidence >= 0.35 && cby.pitch > 0) periodY = cby.pitch;
    }

    var px, py;
    if (periodX <= 0 && periodY <= 0) px = py = period;
    else if (periodX <= 0) px = py = periodY;
    else if (periodY <= 0) px = py = periodX;
    else {
      var relDiff = Math.abs(periodX - periodY) / Math.max(periodX, periodY);
      if (relDiff < 0.15) {
        var tsnr = snrX + snrY;
        px = py = tsnr > 0 ? (periodX * snrX + periodY * snrY) / tsnr : (periodX + periodY) / 2;
      } else {
        px = periodX; py = periodY;
        var phT = phaseSearch(px, py);
        var wLT = Math.round((w - phT.phaseX) / px), hLT = Math.round((h - phT.phaseY) / py);
        if (wLT > 0 && hLT > 0) {
          var ratioOut = wLT / hLT, ratioOrig = w / h;
          var ratioDiff = Math.abs(ratioOut - ratioOrig) / ratioOrig;
          if (ratioDiff > guardTol) {
            var joint = Ar.arJointResearch(sigX, sigY, w, h, px, py, edgeMap, h, w, minP, maxP, IEdge, votePx, votePy);
            if (joint) { px = joint[0]; py = joint[1]; }
            else {
              var eX = Band.edgeBandStrength(edgeMap, h, w, px, 1, null, IEdge);
              var eY = Band.edgeBandStrength(edgeMap, h, w, py, 0, null, IEdge);
              if (eX >= eY) px = py = periodX; else px = py = periodY;
            }
          }
        }
      }
    }

    if (enableGate) {
      if (Math.abs(px - py) <= 0.15 * Math.max(px, py)) {
        var gx2 = Cross.plausibilityGateAxis(px, edgeMap, h, w, 1, minP, maxP, IEdge);
        var gy2 = Cross.plausibilityGateAxis(py, edgeMap, h, w, 0, minP, maxP, IEdge);
        if (gx2 >= gy2) px = py = gx2; else px = py = gy2;
      } else {
        px = Cross.plausibilityGateAxis(px, edgeMap, h, w, 1, minP, maxP, IEdge);
        py = Cross.plausibilityGateAxis(py, edgeMap, h, w, 0, minP, maxP, IEdge);
      }
    }

    var ph = phaseSearch(px, py);
    var phaseX = ph.phaseX, phaseY = ph.phaseY, conf = Math.min(1, Math.max(ph.conf, voteConf));

    function countBlocks(length, period, phase) {
      var n = Math.round((length - phase) / period);
      if (n > 1 && phase + n * period > length + 0.02 * period) n -= 1;
      return n;
    }
    var wLogicPhase = Math.min(Math.max(1, countBlocks(w, px, phaseX)), w);
    var hLogicPhase = Math.min(Math.max(1, countBlocks(h, py, phaseY)), h);

    var squares = Squares.detectSquares(edgeMap, h, w, px, py, subpixel);
    var bf = Bfs.assignGridBfs(squares, px, py, w, h);
    var cellYs, cellXs, wLogic, hLogic;
    if (Object.keys(bf.placed).length) {
      var ex = Expand.expandGridEdgeGuided(edgeMap, h, w, bf.placed, bf.bounds, px, py, edgeTol, subpixel, smoothStrength, outlierReject);
      cellYs = ex.cellYs; cellXs = ex.cellXs;
      var bw = bf.bounds.maxGx - bf.bounds.minGx + 1;
      var rawH = bf.bounds.maxGy - bf.bounds.minGy + 1;
      wLogic = Math.max(1, Math.min(bw, wLogicPhase));
      hLogic = Math.max(1, Math.min(rawH, hLogicPhase));
      var newYs = new Float32Array((hLogic + 1) * (wLogic + 1));
      var newXs = new Float32Array((hLogic + 1) * (wLogic + 1));
      for (var jj = 0; jj <= hLogic; jj++) for (var ii = 0; ii <= wLogic; ii++) {
        newYs[jj * (wLogic + 1) + ii] = cellYs[jj * (bw + 1) + ii];
        newXs[jj * (wLogic + 1) + ii] = cellXs[jj * (bw + 1) + ii];
      }
      cellYs = newYs; cellXs = newXs;
    } else {
      wLogic = wLogicPhase; hLogic = hLogicPhase;
      var eq = Ph.equidistantCellGrid(phaseX, phaseY, px, py, wLogic, hLogic);
      cellYs = eq.cellYs; cellXs = eq.cellXs;
    }

    if (conf < 0.05 && !hasFft) throw new Error("网格检测置信度低，建议人工指定逻辑分辨率");
    var combScore = 0;
    if (px > 0) combScore = Math.max(Fft.spectralCombScore(sigX, Math.round(px)), Fft.spectralCombScore(sigY, Math.round(py)));

    return {
      wLogic: wLogic, hLogic: hLogic, px: px, py: py, phaseX: phaseX, phaseY: phaseY,
      conf: conf, cellYs: cellYs, cellXs: cellXs, lowConfidence: conf < 0.4,
      combScore: combScore, combEnergyConf: (combConfX + combConfY) / 2, jpegGrid: jpegInfo
    };
  }

  function detectWithUserGrid(rgb, h, w, uw, uh, step) {
    var gray = new Float32Array(h * w);
    for (var i = 0; i < h * w; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    if (uw <= 0 || uh <= 0) throw new Error("逻辑分辨率必须为正整数");
    if (uw > w || uh > h) throw new Error("逻辑分辨率不能超过图像尺寸");
    var px = w / uw, py = h / uh;
    var ph = Ph.findPhase(gray, h, w, px, py, step || 0.1);
    var eq = Ph.equidistantCellGrid(ph.phaseX, ph.phaseY, px, py, uw, uh);
    return { wLogic: uw, hLogic: uh, px: px, py: py, phaseX: ph.phaseX, phaseY: ph.phaseY, conf: ph.conf, cellYs: eq.cellYs, cellXs: eq.cellXs, lowConfidence: ph.conf < 0.4 };
  }

  global.AiPixelGrid = { detect: detect, detectWithUserGrid: detectWithUserGrid };
})(typeof window !== "undefined" ? window : this);
