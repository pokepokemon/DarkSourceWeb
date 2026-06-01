/**
 * Perfect Pixel tool UI — based on perfectPixel web demo App.tsx
 */
(function () {
  var imageDataUrl = null;
  var processedDataUrl = null;
  var refinedSize = null;
  var debugData = null;
  var isProcessing = false;

  var fileInput = document.getElementById("file-input");
  var dropZone = document.getElementById("drop-zone");
  var originalImg = document.getElementById("original-img");
  var originalPlaceholder = document.getElementById("original-placeholder");
  var resultImg = document.getElementById("result-img");
  var resultPlaceholder = document.getElementById("result-placeholder");
  var resultError = document.getElementById("result-error");
  var resultMeta = document.getElementById("result-meta");
  var processBtn = document.getElementById("process-btn");
  var downloadBtn = document.getElementById("download-btn");
  var samplingSelect = document.getElementById("sampling-method");
  var scaleSlider = document.getElementById("download-scale");
  var scaleInput = document.getElementById("download-scale-input");
  var scaleLabel = document.getElementById("scale-label");
  var maxProcessSelect = document.getElementById("max-process-dim");
  var debugToggle = document.getElementById("debug-toggle");
  var debugPanel = document.getElementById("debug-panel");
  var magCanvas = document.getElementById("mag-canvas");
  var rowChart = document.getElementById("row-chart");
  var colChart = document.getElementById("col-chart");

  function setOriginalPreview(url) {
    imageDataUrl = url;
    processedDataUrl = null;
    refinedSize = null;
    debugData = null;
    originalImg.src = url;
    originalImg.hidden = false;
    originalPlaceholder.hidden = true;
    resultImg.hidden = true;
    resultPlaceholder.hidden = false;
    resultError.hidden = true;
    resultMeta.hidden = true;
    downloadBtn.disabled = true;
    processBtn.disabled = false;
    debugPanel.hidden = true;
    debugToggle.checked = false;
    updateScaleLabel();
  }

  function loadFile(file) {
    if (!file || !file.type.match(/^image\//)) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      setOriginalPreview(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  function getConfig() {
    return window.PerfectPixelConfig || {};
  }

  function getMaxProcessDim() {
    if (maxProcessSelect) {
      var v = parseInt(maxProcessSelect.value, 10);
      if (!isNaN(v)) return v;
    }
    var cfg = getConfig();
    return cfg.maxProcessDim != null ? cfg.maxProcessDim : 8192;
  }

  function getExportScale() {
    if (scaleInput && scaleInput.value !== "") {
      var n = parseInt(scaleInput.value, 10);
      if (!isNaN(n) && n >= 1) return n;
    }
    return parseInt(scaleSlider.value, 10) || 4;
  }

  function syncScaleControls(fromSlider) {
    var cfg = getConfig();
    var maxSlider = cfg.maxExportScaleSlider != null ? cfg.maxExportScaleSlider : 512;
    var scale = fromSlider
      ? parseInt(scaleSlider.value, 10)
      : getExportScale();
    scale = Math.max(1, Math.min(maxSlider, scale));
    scaleSlider.value = String(scale);
    if (scaleInput) scaleInput.value = String(scale);
  }

  function prepareImage(img) {
    var maxDim = getMaxProcessDim();
    var minThreshold = 64;
    var targetMin = 256;
    var w = img.width;
    var h = img.height;
    var minSide = Math.min(w, h);
    if (minSide < minThreshold) {
      var k = Math.ceil((targetMin + 1) / minSide);
      w *= k;
      h *= k;
    }
    if (maxDim > 0 && Math.max(w, h) > maxDim) {
      var s = maxDim / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    } else {
      w = Math.round(w);
      h = Math.round(h);
    }
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (w > img.width) ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function ndArrayToCanvas(nd) {
    var resH = nd.shape[0];
    var resW = nd.shape[1];
    var resC = nd.shape[2];
    var canvas = document.createElement("canvas");
    canvas.width = resW;
    canvas.height = resH;
    var ctx = canvas.getContext("2d");
    var outImageData = ctx.createImageData(resW, resH);
    for (var y = 0; y < resH; y++) {
      for (var x = 0; x < resW; x++) {
        var outIdx = (y * resW + x) * 4;
        if (resC >= 3) {
          outImageData.data[outIdx] = nd.get(y, x, 0);
          outImageData.data[outIdx + 1] = nd.get(y, x, 1);
          outImageData.data[outIdx + 2] = nd.get(y, x, 2);
          outImageData.data[outIdx + 3] = (resC === 4) ? nd.get(y, x, 3) : 255;
        } else {
          var val = nd.get(y, x, 0);
          outImageData.data[outIdx] = val;
          outImageData.data[outIdx + 1] = val;
          outImageData.data[outIdx + 2] = val;
          outImageData.data[outIdx + 3] = 255;
        }
      }
    }
    ctx.putImageData(outImageData, 0, 0);
    return canvas;
  }

  function drawChart(canvas, data, peaks) {
    if (!canvas || !data) return;
    var ctx = canvas.getContext("2d");
    var cw = 400;
    var ch = 100;
    canvas.width = cw;
    canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = "#6ec5ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = (i / data.length) * cw;
      var y = ch - (data[i] * ch);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (peaks) {
      ctx.strokeStyle = "#ff7aa2";
      ctx.lineWidth = 1;
      peaks.forEach(function (p) {
        var px = (p / data.length) * cw;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, ch);
        ctx.stroke();
      });
    }
  }

  function renderDebug() {
    if (!debugData) return;
    if (magCanvas && debugData.magData && debugData.magShape) {
      var mh = debugData.magShape[0];
      var mw = debugData.magShape[1];
      magCanvas.width = mw;
      magCanvas.height = mh;
      var mctx = magCanvas.getContext("2d");
      var imgData = mctx.createImageData(mw, mh);
      for (var i = 0; i < debugData.magData.length; i++) {
        var val = Math.floor(debugData.magData[i] * 255);
        var idx = i * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
      mctx.putImageData(imgData, 0, 0);
    }
    drawChart(rowChart, debugData.smoothRow, debugData.peaksRow || null);
    drawChart(colChart, debugData.smoothCol, debugData.peaksCol || null);
  }

  function processImage() {
    if (!imageDataUrl || isProcessing) return;
    isProcessing = true;
    processBtn.disabled = true;
    processBtn.textContent = "分析网格中…";
    resultError.hidden = true;
    resultPlaceholder.hidden = false;
    resultImg.hidden = true;
    resultMeta.hidden = true;
    downloadBtn.disabled = true;

    var img = new Image();
    img.onload = function () {
      try {
        var imageData = prepareImage(img);
        var w = imageData.width;
        var h = imageData.height;
        var data = new Float32Array(w * h * 4);
        for (var i = 0; i < imageData.data.length; i++) data[i] = imageData.data[i];
        var inputNd = PerfectPixelCore.createNdArray(data, [h, w, 4]);
        var cfg = getConfig();
        var maxFft = getMaxProcessDim();
        if (maxFft <= 0) {
          maxFft = cfg.maxFftDim || 16384;
        } else {
          maxFft = Math.max(maxFft, cfg.maxFftDim || 8192);
        }
        var result = getPerfectPixel(inputNd, {
          sampleMethod: samplingSelect.value,
          maxFftDim: maxFft,
          maxPixelSize: cfg.maxPixelSize
        });
        debugData = result.debugData || null;

        if (result.refinedW === null || result.refinedH === null) {
          throw new Error("网格检测失败，请尝试更换采样方式或换一张图片。");
        }

        refinedSize = { w: result.refinedW, h: result.refinedH };
        var outCanvas = ndArrayToCanvas(result.scaled);
        processedDataUrl = outCanvas.toDataURL();
        resultImg.src = processedDataUrl;
        resultImg.hidden = false;
        resultPlaceholder.hidden = true;
        resultMeta.hidden = false;
        updateScaleLabel();
        downloadBtn.disabled = false;
        if (debugToggle.checked) {
          debugPanel.hidden = false;
          renderDebug();
        }
      } catch (err) {
        resultError.textContent = err.message || "处理过程中发生未知错误。";
        resultError.hidden = false;
        resultPlaceholder.hidden = true;
      } finally {
        isProcessing = false;
        processBtn.disabled = !imageDataUrl;
        processBtn.textContent = "生成完美像素";
      }
    };
    img.onerror = function () {
      isProcessing = false;
      processBtn.disabled = false;
      processBtn.textContent = "生成完美像素";
      resultError.textContent = "图片加载失败。";
      resultError.hidden = false;
    };
    img.src = imageDataUrl;
  }

  function updateScaleLabel() {
    var scale = getExportScale();
    var cfg = getConfig();
    var maxCanvas = cfg.maxCanvasDim || 16384;
    if (refinedSize) {
      var outW = Math.round(refinedSize.w * scale);
      var outH = Math.round(refinedSize.h * scale);
      var text = "网格 " + refinedSize.w + " × " + refinedSize.h +
        " | 预览约 " + outW + " × " + outH +
        " | 导出倍率 " + scale + "x";
      if (outW > maxCanvas || outH > maxCanvas) {
        text += "（超过浏览器单边上限 " + maxCanvas + "，请降低倍率）";
      }
      scaleLabel.textContent = text;
      resultMeta.textContent = text;
      resultImg.style.imageRendering = "pixelated";
      var previewCap = Math.max(480, Math.min(maxCanvas, 2048));
      resultImg.style.width = Math.min(refinedSize.w * scale, previewCap) + "px";
      resultImg.style.height = "auto";
    } else {
      scaleLabel.textContent = "导出倍率 " + scale + "x";
    }
  }

  function downloadImage() {
    if (!processedDataUrl) return;
    var scale = getExportScale();
    var cfg = getConfig();
    var maxExport = cfg.maxExportScale || 8192;
    var maxCanvas = cfg.maxCanvasDim || 16384;
    if (scale > maxExport) {
      alert("导出倍率不能超过 " + maxExport);
      return;
    }
    var img = new Image();
    img.onload = function () {
      var outW = img.width * scale;
      var outH = img.height * scale;
      if (outW > maxCanvas || outH > maxCanvas) {
        alert("导出尺寸 " + outW + "×" + outH + " 超过浏览器 canvas 单边上限约 " + maxCanvas + "，请降低倍率或网格尺寸。");
        return;
      }
      var canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext("2d");
      if (!ctx) {
        alert("无法创建画布，尺寸可能过大。");
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var link = document.createElement("a");
      link.download = "perfect-pixel-scaled-x" + scale + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = processedDataUrl;
  }

  dropZone.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZone.classList.add("pp-drag-over");
  });
  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("pp-drag-over");
  });
  dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("pp-drag-over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  processBtn.addEventListener("click", processImage);
  downloadBtn.addEventListener("click", downloadImage);
  function onScaleSliderInput() {
    syncScaleControls(true);
    updateScaleLabel();
  }

  function onScaleInputChange() {
    var cfg = getConfig();
    var maxExport = cfg.maxExportScale || 8192;
    var n = parseInt(scaleInput.value, 10);
    if (!isNaN(n)) {
      n = Math.max(1, Math.min(maxExport, n));
      scaleInput.value = String(n);
      var maxSlider = cfg.maxExportScaleSlider != null ? cfg.maxExportScaleSlider : 512;
      scaleSlider.value = String(Math.min(n, maxSlider));
    }
    updateScaleLabel();
  }

  (function initScaleControls() {
    var cfg = getConfig();
    var maxSlider = cfg.maxExportScaleSlider != null ? cfg.maxExportScaleSlider : 512;
    var def = cfg.defaultExportScale != null ? cfg.defaultExportScale : 4;
    scaleSlider.max = String(maxSlider);
    scaleSlider.value = String(Math.min(def, maxSlider));
    if (scaleInput) {
      scaleInput.min = "1";
      scaleInput.max = String(cfg.maxExportScale || 8192);
      scaleInput.value = String(def);
    }
    updateScaleLabel();
  })();

  scaleSlider.addEventListener("input", onScaleSliderInput);
  scaleSlider.addEventListener("change", onScaleSliderInput);
  if (scaleInput) {
    scaleInput.addEventListener("input", onScaleInputChange);
    scaleInput.addEventListener("change", onScaleInputChange);
  }
  if (maxProcessSelect) {
    maxProcessSelect.addEventListener("change", function () {
      var cfg = getConfig();
      var v = getMaxProcessDim();
      if (v > 0) cfg.maxFftDim = v;
    });
  }
  debugToggle.addEventListener("change", function () {
    debugPanel.hidden = !debugToggle.checked;
    if (debugToggle.checked && debugData) renderDebug();
  });
})();
