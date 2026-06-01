/**
 * Perfect Pixel core algorithm — ported from perfectPixel web demo
 * https://github.com/theamusing/perfectPixel
 * https://github.com/theamusing/perfectPixel_webdemo
 */
(function (global) {
  var PP = global.PerfectPixelNdArray;
  var createNdArray = PP.createNdArray;
  var ops = PP.ops;
  var fft2d = PP.fft2d;

  function nextPow2(n, maxVal) {
    return Math.min(Math.pow(2, Math.ceil(Math.log2(n))), maxVal);
  }

  function rgbToGray(imageRgb) {
    var h = imageRgb.shape[0];
    var w = imageRgb.shape[1];
    var c = imageRgb.shape[2];
    var grayData = new Float32Array(h * w);
    var gray = createNdArray(grayData, [h, w]);
    for (var i = 0; i < h; i++) {
      for (var j = 0; j < w; j++) {
        if (c >= 3) {
          var r = imageRgb.get(i, j, 0);
          var g = imageRgb.get(i, j, 1);
          var b = imageRgb.get(i, j, 2);
          gray.set(i, j, 0.299 * r + 0.587 * g + 0.114 * b);
        } else {
          gray.set(i, j, imageRgb.get(i, j, 0));
        }
      }
    }
    return gray;
  }

  function normalizeMinMax(x, a, b) {
    if (a === undefined) a = 0;
    if (b === undefined) b = 1;
    var size = x.size;
    var data = x.data;
    var mn = Infinity;
    var mx = -Infinity;
    for (var i = 0; i < size; i++) {
      if (data[i] < mn) mn = data[i];
      if (data[i] > mx) mx = data[i];
    }
    var out = createNdArray(new Float32Array(size), x.shape);
    var diff = mx - mn;
    if (diff < 1e-8) {
      ops.assigns(out, a);
      return out;
    }
    for (var j = 0; j < size; j++) {
      out.data[j] = a + (b - a) * (data[j] - mn) / diff;
    }
    return out;
  }

  function conv2dSame(image, kernel) {
    var ih = image.shape[0];
    var iw = image.shape[1];
    var kh = kernel.shape[0];
    var kw = kernel.shape[1];
    var ph = Math.floor(kh / 2);
    var pw = Math.floor(kw / 2);
    var out = createNdArray(new Float32Array(ih * iw), [ih, iw]);
    for (var i = 0; i < ih; i++) {
      for (var j = 0; j < iw; j++) {
        var sum = 0;
        for (var ky = 0; ky < kh; ky++) {
          for (var kx = 0; kx < kw; kx++) {
            var py = Math.min(Math.max(i + ky - ph, 0), ih - 1);
            var px = Math.min(Math.max(j + kx - pw, 0), iw - 1);
            sum += image.get(py, px) * kernel.get(ky, kx);
          }
        }
        out.set(i, j, sum);
      }
    }
    return out;
  }

  function sobelXy(gray, ksize) {
    if (ksize === undefined) ksize = 3;
    var kx, ky;
    if (ksize === 3) {
      kx = createNdArray(new Float32Array([-1, 0, 1, -2, 0, 2, -1, 0, 1]), [3, 3]);
      ky = createNdArray(new Float32Array([-1, -2, -1, 0, 0, 0, 1, 2, 1]), [3, 3]);
    } else if (ksize === 5) {
      kx = createNdArray(new Float32Array([
        -5, -4, 0, 4, 5,
        -8, -10, 0, 10, 8,
        -10, -20, 0, 20, 10,
        -8, -10, 0, 10, 8,
        -5, -4, 0, 4, 5
      ]), [5, 5]);
      ky = createNdArray(new Float32Array(25), [5, 5]);
      for (var r = 0; r < 5; r++) {
        for (var c = 0; c < 5; c++) ky.set(c, r, kx.get(r, c));
      }
    } else {
      throw new Error("ksize must be 3 or 5");
    }
    return { gx: conv2dSame(gray, kx), gy: conv2dSame(gray, ky) };
  }

  function resolveMaxFftDim(options) {
    var cfg = (typeof global !== "undefined" && global.PerfectPixelConfig) || {};
    var cap = (options && options.maxFftDim != null)
      ? options.maxFftDim
      : (cfg.maxFftDim != null ? cfg.maxFftDim : 8192);
    return cap > 0 ? cap : 8192;
  }

  function resolveMaxPixelSize(W, H, options) {
    if (options && options.maxPixelSize != null && options.maxPixelSize > 0) {
      return options.maxPixelSize;
    }
    var cfg = (typeof global !== "undefined" && global.PerfectPixelConfig) || {};
    if (cfg.maxPixelSize != null && cfg.maxPixelSize > 0) {
      return cfg.maxPixelSize;
    }
    return Math.max(20, Math.max(W, H));
  }

  function computeFftMagnitude(grayImage, maxFftDim) {
    var h = grayImage.shape[0];
    var w = grayImage.shape[1];
    var ph = nextPow2(h, maxFftDim);
    var pw = nextPow2(w, maxFftDim);
    var real = createNdArray(new Float32Array(ph * pw), [ph, pw]);
    var imag = createNdArray(new Float32Array(ph * pw), [ph, pw]);
    ops.assigns(real, 0);
    ops.assigns(imag, 0);
    for (var i = 0; i < Math.min(h, ph); i++) {
      for (var j = 0; j < Math.min(w, pw); j++) {
        real.set(i, j, grayImage.get(i, j));
      }
    }
    fft2d(1, real, imag);
    var mag = createNdArray(new Float32Array(ph * pw), [ph, pw]);
    var halfH = Math.floor(ph / 2);
    var halfW = Math.floor(pw / 2);
    for (var i2 = 0; i2 < ph; i2++) {
      for (var j2 = 0; j2 < pw; j2++) {
        var ni = (i2 + halfH) % ph;
        var nj = (j2 + halfW) % pw;
        var rv = real.get(ni, nj);
        var im = imag.get(ni, nj);
        mag.set(i2, j2, 1.0 - Math.log1p(Math.sqrt(rv * rv + im * im)));
      }
    }
    return normalizeMinMax(mag, 0.0, 1.0);
  }

  function smooth1d(v, k) {
    if (k === undefined) k = 17;
    if (k < 3) return new Float32Array(v);
    if (k % 2 === 0) k += 1;
    var sigma = k / 6.0;
    var center = Math.floor(k / 2);
    var kernel = new Float32Array(k);
    var kernelSum = 0;
    for (var i = 0; i < k; i++) {
      var x = i - center;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernelSum += kernel[i];
    }
    var normSum = kernelSum + 1e-8;
    var out = new Float32Array(v.length);
    for (var i2 = 0; i2 < v.length; i2++) {
      var acc = 0;
      for (var j = 0; j < k; j++) {
        var idx = i2 + j - center;
        if (idx >= 0 && idx < v.length) acc += v[idx] * (kernel[j] / normSum);
      }
      out[i2] = acc;
    }
    return out;
  }

  function detectPeak(proj, relThr, minDist) {
    if (relThr === undefined) relThr = 0.35;
    if (minDist === undefined) minDist = 6;
    var center = Math.floor(proj.length / 2);
    var mx = 0;
    for (var i = 0; i < proj.length; i++) if (proj[i] > mx) mx = proj[i];
    if (mx < 1e-6) return null;
    var thr = mx * relThr;
    var peakWidth = 6;
    var candidates = [];
    for (var i2 = 1; i2 < proj.length - 1; i2++) {
      var isPeak = true;
      for (var j2 = 1; j2 < peakWidth; j2++) {
        if (i2 - j2 < 0 || i2 + j2 >= proj.length) continue;
        if (proj[i2 - j2 + 1] < proj[i2 - j2] || proj[i2 + j2 - 1] < proj[i2 + j2]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak && proj[i2] >= thr) {
        var leftClimb = 0;
        for (var k = i2; k > 0; k--) {
          if (proj[k] > proj[k - 1]) leftClimb = Math.abs(proj[i2] - proj[k - 1]);
          else break;
        }
        var rightFall = 0;
        for (var k2 = i2; k2 < proj.length - 1; k2++) {
          if (proj[k2] > proj[k2 + 1]) rightFall = Math.abs(proj[i2] - proj[k2 + 1]);
          else break;
        }
        candidates.push({ index: i2, score: Math.max(leftClimb, rightFall) });
      }
    }
    var left = candidates.filter(function (c) {
      return c.index < center - minDist && c.index > center * 0.15;
    }).sort(function (a, b) { return b.score - a.score; });
    var right = candidates.filter(function (c) {
      return c.index > center + minDist && c.index < center * 1.85;
    }).sort(function (a, b) { return b.score - a.score; });
    if (left.length === 0 || right.length === 0) return null;
    return {
      period: Math.abs(right[0].index - left[0].index) / 2,
      left: left[0].index,
      right: right[0].index
    };
  }

  function findBestGrid(origin, rangeMin, rangeMax, gradMag, thr) {
    if (thr === undefined) thr = 0;
    var best = Math.round(origin);
    var peaks = [];
    var mx = 0;
    for (var i = 0; i < gradMag.length; i++) if (gradMag[i] > mx) mx = gradMag[i];
    if (mx < 1e-6) return best;
    var relThr = mx * thr;
    var lo = -Math.round(rangeMin);
    var hi = Math.round(rangeMax);
    for (var i2 = lo; i2 <= hi; i2++) {
      var candidate = Math.round(origin + i2);
      if (candidate <= 0 || candidate >= gradMag.length - 1) continue;
      if (gradMag[candidate] > gradMag[candidate - 1] &&
          gradMag[candidate] > gradMag[candidate + 1] &&
          gradMag[candidate] >= relThr) {
        peaks.push({ val: gradMag[candidate], idx: candidate });
      }
    }
    if (peaks.length === 0) return best;
    peaks.sort(function (a, b) { return b.val - a.val; });
    return peaks[0].idx;
  }

  function sampleCenter(image, xCoords, yCoords) {
    var nx = xCoords.length - 1;
    var ny = yCoords.length - 1;
    var C = image.shape[2];
    var out = createNdArray(new Float32Array(ny * nx * C), [ny, nx, C]);
    for (var j = 0; j < ny; j++) {
      var cy = Math.floor((yCoords[j] + yCoords[j + 1]) * 0.5);
      for (var i = 0; i < nx; i++) {
        var cx = Math.floor((xCoords[i] + xCoords[i + 1]) * 0.5);
        for (var k = 0; k < C; k++) out.set(j, i, k, image.get(cy, cx, k));
      }
    }
    return out;
  }

  function sampleMajority(image, xCoords, yCoords, maxSamples, iters, seed) {
    if (maxSamples === undefined) maxSamples = 256;
    if (iters === undefined) iters = 6;
    if (seed === undefined) seed = 0;
    var H = image.shape[0];
    var W = image.shape[1];
    var C = image.shape[2];
    var nx = xCoords.length - 1;
    var ny = yCoords.length - 1;
    var out = createNdArray(new Float32Array(ny * nx * C), [ny, nx, C]);
    var seedVal = seed;
    function lcg() {
      seedVal = (1103515245 * seedVal + 12345) & 0x7fffffff;
      return seedVal / 0x7fffffff;
    }
    for (var j = 0; j < ny; j++) {
      var y0 = Math.max(0, Math.min(H, Math.floor(yCoords[j])));
      var y1 = Math.max(0, Math.min(H, Math.floor(yCoords[j + 1])));
      if (y1 <= y0) y1 = Math.min(y0 + 1, H);
      for (var i = 0; i < nx; i++) {
        var x0 = Math.max(0, Math.min(W, Math.floor(xCoords[i])));
        var x1 = Math.max(0, Math.min(W, Math.floor(xCoords[i + 1])));
        if (x1 <= x0) x1 = Math.min(x0 + 1, W);
        var cellPixels = [];
        for (var py = y0; py < y1; py++) {
          for (var px = x0; px < x1; px++) {
            var p = new Float32Array(C);
            for (var k = 0; k < C; k++) p[k] = image.get(py, px, k);
            cellPixels.push(p);
          }
        }
        if (cellPixels.length === 0) {
          for (var k2 = 0; k2 < C; k2++) out.set(j, i, k2, 0);
          continue;
        }
        var samples = cellPixels;
        if (cellPixels.length > maxSamples) {
          samples = [];
          for (var s = 0; s < maxSamples; s++) {
            samples.push(cellPixels[Math.floor(lcg() * cellPixels.length)]);
          }
        }
        var c0 = new Float32Array(samples[0]);
        var c1 = new Float32Array(samples[0]);
        var maxDist = -1;
        for (var si = 0; si < samples.length; si++) {
          var d = 0;
          for (var k3 = 0; k3 < C; k3++) d += Math.pow(samples[si][k3] - c0[k3], 2);
          if (d > maxDist) { maxDist = d; c1 = new Float32Array(samples[si]); }
        }
        var finalC = c0;
        for (var it = 0; it < iters; it++) {
          var sum0 = new Float32Array(C);
          var count0 = 0;
          var sum1 = new Float32Array(C);
          var count1 = 0;
          for (var sj = 0; sj < samples.length; sj++) {
            var d0 = 0, d1 = 0;
            for (var k4 = 0; k4 < C; k4++) {
              d0 += Math.pow(samples[sj][k4] - c0[k4], 2);
              d1 += Math.pow(samples[sj][k4] - c1[k4], 2);
            }
            if (d1 < d0) {
              for (var k5 = 0; k5 < C; k5++) sum1[k5] += samples[sj][k5];
              count1++;
            } else {
              for (var k6 = 0; k6 < C; k6++) sum0[k6] += samples[sj][k6];
              count0++;
            }
          }
          if (count0 > 0) for (var k7 = 0; k7 < C; k7++) c0[k7] = sum0[k7] / count0;
          if (count1 > 0) for (var k8 = 0; k8 < C; k8++) c1[k8] = sum1[k8] / count1;
          finalC = (count1 >= count0) ? c1 : c0;
        }
        for (var k9 = 0; k9 < C; k9++) out.set(j, i, k9, finalC[k9]);
      }
    }
    return out;
  }

  function refineGrids(image, gridX, gridY) {
    var H = image.shape[0];
    var W = image.shape[1];
    var cellW = W / gridX;
    var cellH = H / gridY;
    var gray = rgbToGray(image);
    var sob = sobelXy(gray, 3);
    var gradXSum = new Float32Array(W);
    var gradYSum = new Float32Array(H);
    for (var i = 0; i < H; i++) {
      for (var j = 0; j < W; j++) {
        gradXSum[j] += Math.abs(sob.gx.get(i, j));
        gradYSum[i] += Math.abs(sob.gy.get(i, j));
      }
    }
    var xCoords = [];
    var yCoords = [];
    var x = findBestGrid(W / 2, cellW, cellW, gradXSum);
    while (x < W + cellW / 2) {
      x = findBestGrid(x, cellW / 3, cellW / 3, gradXSum);
      xCoords.push(x);
      x += cellW;
    }
    x = findBestGrid(W / 2, cellW, cellW, gradXSum) - cellW;
    while (x > -cellW / 2 && xCoords.length <= W / cellW) {
      x = findBestGrid(x, cellW / 3, cellW / 3, gradXSum);
      xCoords.push(x);
      x -= cellW;
    }
    var y = findBestGrid(H / 2, cellH, cellH, gradYSum);
    while (y < H + cellH / 2) {
      y = findBestGrid(y, cellH / 3, cellH / 3, gradYSum);
      yCoords.push(y);
      y += cellH;
    }
    y = findBestGrid(H / 2, cellH, cellH, gradYSum) - cellH;
    while (y > -cellH / 2 && yCoords.length <= H / cellH) {
      y = findBestGrid(y, cellH / 3, cellH / 3, gradYSum);
      yCoords.push(y);
      y -= cellH;
    }
    if (Math.abs(xCoords.length - yCoords.length) < 2) {
      if (xCoords.length % 2 === 0) {
        if (xCoords.length > yCoords.length) xCoords.pop();
        else if (xCoords.length < yCoords.length) xCoords.push(0);
        else { xCoords.push(0); yCoords.push(0); }
      } else {
        if (xCoords.length > yCoords.length) yCoords.push(0);
        else if (xCoords.length < yCoords.length) yCoords.pop();
      }
    }
    return {
      xCoords: xCoords.sort(function (a, b) { return a - b; }),
      yCoords: yCoords.sort(function (a, b) { return a - b; })
    };
  }

  function getMedian(arr) {
    if (arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function estimateGridGradient(image, relThr) {
    if (relThr === undefined) relThr = 0.2;
    var gray = rgbToGray(image);
    var H = gray.shape[0];
    var W = gray.shape[1];
    var sob = sobelXy(gray, 3);
    var gXSum = new Float32Array(W);
    var gYSum = new Float32Array(H);
    for (var i = 0; i < H; i++) {
      for (var j = 0; j < W; j++) {
        gXSum[j] += Math.abs(sob.gx.get(i, j));
        gYSum[i] += Math.abs(sob.gy.get(i, j));
      }
    }
    function findPeaks(arr, thr) {
      var p = [];
      for (var i2 = 1; i2 < arr.length - 1; i2++) {
        if (arr[i2] > arr[i2 - 1] && arr[i2] > arr[i2 + 1] && arr[i2] >= thr) {
          if (p.length === 0 || i2 - p[p.length - 1] >= 4) p.push(i2);
        }
      }
      return p;
    }
    var mxX = 0;
    for (var i3 = 0; i3 < gXSum.length; i3++) if (gXSum[i3] > mxX) mxX = gXSum[i3];
    var mxY = 0;
    for (var i4 = 0; i4 < gYSum.length; i4++) if (gYSum[i4] > mxY) mxY = gYSum[i4];
    var pX = findPeaks(gXSum, mxX * relThr);
    var pY = findPeaks(gYSum, mxY * relThr);
    if (pX.length < 4 || pY.length < 4) return null;
    function getIntv(p) {
      var d = [];
      for (var i5 = 1; i5 < p.length; i5++) d.push(p[i5] - p[i5 - 1]);
      return getMedian(d);
    }
    return { scaleCol: W / getIntv(pX), scaleRow: H / getIntv(pY) };
  }

  function estimateGridFft(image, maxFftDim) {
    var gray = rgbToGray(image);
    var mag = computeFftMagnitude(gray, maxFftDim);
    var PH = mag.shape[0];
    var PW = mag.shape[1];
    var bandRow = Math.floor(PW / 2);
    var bandCol = Math.floor(PH / 2);
    var rowSum = new Float32Array(PH);
    var colSum = new Float32Array(PW);
    for (var i = 0; i < PH; i++) {
      for (var j = Math.floor(PW / 2 - bandRow); j < Math.floor(PW / 2 + bandRow); j++) {
        if (j >= 0 && j < PW) rowSum[i] += mag.get(i, j);
      }
    }
    for (var j2 = 0; j2 < PW; j2++) {
      for (var i2 = Math.floor(PH / 2 - bandCol); i2 < Math.floor(PH / 2 + bandCol); i2++) {
        if (i2 >= 0 && i2 < PH) colSum[j2] += mag.get(i2, j2);
      }
    }
    var normRow = normalizeMinMax(createNdArray(rowSum, [PH])).data;
    var normCol = normalizeMinMax(createNdArray(colSum, [PW])).data;
    var smoothRow = smooth1d(normRow, 17);
    var smoothCol = smooth1d(normCol, 17);
    var rowResult = detectPeak(smoothRow);
    var colResult = detectPeak(smoothCol);
    var H = image.shape[0];
    var W = image.shape[1];
    var scaleRow = rowResult ? (rowResult.period * H / PH) : null;
    var scaleCol = colResult ? (colResult.period * W / PW) : null;
    return {
      scaleCol: scaleCol,
      scaleRow: scaleRow,
      peaksRow: rowResult ? [rowResult.left, rowResult.right] : null,
      peaksCol: colResult ? [colResult.left, colResult.right] : null,
      smoothRow: smoothRow,
      smoothCol: smoothCol,
      mag: mag
    };
  }

  function getPerfectPixel(image, options) {
    options = options || {};
    var sampleMethod = options.sampleMethod || "center";
    var gridSize = options.gridSize || null;
    var cfg = (typeof global !== "undefined" && global.PerfectPixelConfig) || {};
    var minSize = options.minSize !== undefined ? options.minSize : (cfg.minPixelSize != null ? cfg.minPixelSize : 4.0);
    var maxFftDim = resolveMaxFftDim(options);
    var H = image.shape[0];
    var W = image.shape[1];
    var maxPixelSize = resolveMaxPixelSize(W, H, options);
    var scaleCol = null;
    var scaleRow = null;
    var debugData;

    if (gridSize) {
      scaleCol = gridSize[0];
      scaleRow = gridSize[1];
    } else {
      var est = estimateGridFft(image, maxFftDim);
      debugData = {
        smoothRow: est.smoothRow,
        smoothCol: est.smoothCol,
        peakRow: est.scaleRow,
        peakCol: est.scaleCol,
        peaksRow: est.peaksRow,
        peaksCol: est.peaksCol,
        magData: est.mag.data,
        magShape: est.mag.shape
      };
      var fftSuccess = est.scaleCol !== null && est.scaleRow !== null && est.scaleCol > 0 && est.scaleRow > 0;
      if (fftSuccess) {
        var psx = W / est.scaleCol;
        var psy = H / est.scaleRow;
        var maxRatio = 1.5;
        var ratio = psx / psy;
        if (Math.min(psx, psy) < minSize || Math.max(psx, psy) > maxPixelSize ||
            ratio > maxRatio || (1.0 / ratio) > maxRatio) {
          fftSuccess = false;
        } else {
          scaleCol = est.scaleCol;
          scaleRow = est.scaleRow;
        }
      }
      if (!fftSuccess) {
        var est2 = estimateGridGradient(image);
        if (est2) {
          scaleCol = est2.scaleCol;
          scaleRow = est2.scaleRow;
        } else {
          var pixelSize = 8.0;
          scaleCol = W / pixelSize;
          scaleRow = H / pixelSize;
        }
      }
      if (scaleCol !== null && scaleRow !== null) {
        var psx2 = W / scaleCol;
        var psy2 = H / scaleRow;
        var maxRatio2 = 1.5;
        var finalPixelSize;
        var ratio2 = psx2 / psy2;
        if (ratio2 > maxRatio2 || (1.0 / ratio2) > maxRatio2) {
          finalPixelSize = Math.min(psx2, psy2);
        } else {
          finalPixelSize = (psx2 + psy2) / 2.0;
        }
        scaleCol = Math.round(W / finalPixelSize);
        scaleRow = Math.round(H / finalPixelSize);
      }
    }

    if (scaleCol === null || scaleRow === null || scaleCol <= 0 || scaleRow <= 0) {
      return { refinedW: null, refinedH: null, scaled: image, debugData: debugData };
    }

    var grids = refineGrids(image, scaleCol, scaleRow);
    var refinedW = grids.xCoords.length - 1;
    var refinedH = grids.yCoords.length - 1;
    if (refinedW <= 0 || refinedH <= 0) {
      return { refinedW: null, refinedH: null, scaled: image, debugData: debugData };
    }

    var scaled = (sampleMethod === "majority")
      ? sampleMajority(image, grids.xCoords, grids.yCoords)
      : sampleCenter(image, grids.xCoords, grids.yCoords);

    return { refinedW: refinedW, refinedH: refinedH, scaled: scaled, debugData: debugData };
  }

  global.getPerfectPixel = getPerfectPixel;
  global.PerfectPixelCore = { createNdArray: createNdArray };
})(typeof window !== "undefined" ? window : this);
