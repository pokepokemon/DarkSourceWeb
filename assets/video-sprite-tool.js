/**
 * Video → Sprite Sheet tool UI
 */
(function () {
  "use strict";

  var Core = window.VideoSpriteCore;
  var Export = window.VideoSpriteExport;
  if (!Core || !Export) return;

  var state = {
    videoUrl: null,
    meta: null,
    cropArea: { leftPercent: 0, topPercent: 0, widthPercent: 100, heightPercent: 100 },
    rawFrames: [],
    processedFrames: [],
    chromaEnabled: false,
    colorSample: null,
    isBusy: false,
    animTimer: null,
    animIndex: 0,
    sheetPreviewUrl: null,
  };

  var fileInput = document.getElementById("file-input");
  var dropZone = document.getElementById("drop-zone");
  var videoPreview = document.getElementById("video-preview");
  var videoPlaceholder = document.getElementById("video-placeholder");
  var cropCanvas = document.getElementById("crop-canvas");
  var cropOverlay = document.getElementById("crop-overlay");
  var segmentStart = document.getElementById("segment-start");
  var segmentEnd = document.getElementById("segment-end");
  var fpsInput = document.getElementById("fps-input");
  var frameCountHint = document.getElementById("frame-count-hint");
  var extractBtn = document.getElementById("extract-btn");
  var extractProgress = document.getElementById("extract-progress");
  var refCanvas = document.getElementById("ref-canvas");
  var chromaToggle = document.getElementById("chroma-toggle");
  var chromaPanel = document.getElementById("chroma-panel");
  var toleranceInput = document.getElementById("tolerance-input");
  var softnessInput = document.getElementById("softness-input");
  var despillInput = document.getElementById("despill-input");
  var sampleColorDisplay = document.getElementById("sample-color-display");
  var applyChromaBtn = document.getElementById("apply-chroma-btn");
  var sheetPreview = document.getElementById("sheet-preview");
  var sheetPlaceholder = document.getElementById("sheet-placeholder");
  var animCanvas = document.getElementById("anim-canvas");
  var animPlayBtn = document.getElementById("anim-play-btn");
  var animStopBtn = document.getElementById("anim-stop-btn");
  var columnsInput = document.getElementById("columns-input");
  var gapInput = document.getElementById("gap-input");
  var frameSizeSelect = document.getElementById("frame-size-select");
  var sheetBgInput = document.getElementById("sheet-bg-input");
  var exportSheetBtn = document.getElementById("export-sheet-btn");
  var exportGifBtn = document.getElementById("export-gif-btn");
  var exportZipBtn = document.getElementById("export-zip-btn");
  var exportSpineBtn = document.getElementById("export-spine-btn");
  var statusMsg = document.getElementById("status-msg");
  var cropLeft = document.getElementById("crop-left");
  var cropTop = document.getElementById("crop-top");
  var cropWidth = document.getElementById("crop-width");
  var cropHeight = document.getElementById("crop-height");
  var metaDisplay = document.getElementById("meta-display");
  var gridStepInput = document.getElementById("grid-step-input");
  var cropPreviewCanvas = document.getElementById("crop-preview-canvas");
  var cropPreviewPlaceholder = document.getElementById("crop-preview-placeholder");

  var cropDrag = { active: false, startX: 0, startY: 0, mode: "new" };

  function setStatus(msg, isError) {
    if (!statusMsg) return;
    statusMsg.textContent = msg || "";
    statusMsg.style.color = isError ? "var(--accent-pink)" : "var(--accent-cyan)";
  }

  function setBusy(busy) {
    state.isBusy = busy;
    updateExportButtons();
    updateChromaControls();
  }

  function updateChromaControls() {
    var canApply =
      !state.isBusy &&
      state.rawFrames.length > 0 &&
      Boolean(state.colorSample) &&
      chromaToggle &&
      chromaToggle.checked;
    if (applyChromaBtn) applyChromaBtn.disabled = !canApply;
  }

  function resetFrames() {
    state.rawFrames = [];
    state.processedFrames = [];
    state.chromaEnabled = false;
    state.colorSample = null;
    stopAnimation();
    if (sheetPreview) { sheetPreview.hidden = true; sheetPreview.src = ""; }
    if (sheetPlaceholder) sheetPlaceholder.hidden = false;
    if (refCanvas) {
      var ctx = refCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, refCanvas.width, refCanvas.height);
    }
    if (sampleColorDisplay) {
      sampleColorDisplay.style.background = "";
      sampleColorDisplay.textContent = "未采样";
    }
    if (state.sheetPreviewUrl) {
      URL.revokeObjectURL(state.sheetPreviewUrl);
      state.sheetPreviewUrl = null;
    }
    updateExportButtons();
    updateChromaControls();
  }

  function updateExportButtons() {
    var hasFrames = state.rawFrames.length > 0;
    if (exportSheetBtn) exportSheetBtn.disabled = state.isBusy || !hasFrames;
    if (exportGifBtn) exportGifBtn.disabled = state.isBusy || !hasFrames;
    if (exportZipBtn) exportZipBtn.disabled = state.isBusy || !state.chromaEnabled || !state.processedFrames.length;
    if (exportSpineBtn) exportSpineBtn.disabled = state.isBusy || !hasFrames;
    if (extractBtn) extractBtn.disabled = state.isBusy || !state.videoUrl;
    updateChromaControls();
  }

  function getVideoDisplayRect() {
    if (!videoPreview || !cropOverlay) return null;
    var vw = videoPreview.videoWidth;
    var vh = videoPreview.videoHeight;
    if (!vw || !vh) return null;
    var containerW = cropOverlay.clientWidth;
    var containerH = cropOverlay.clientHeight;
    if (!containerW || !containerH) return null;
    var videoAspect = vw / vh;
    var containerAspect = containerW / containerH;
    var displayW;
    var displayH;
    var offsetX;
    var offsetY;
    if (videoAspect > containerAspect) {
      displayW = containerW;
      displayH = containerW / videoAspect;
      offsetX = 0;
      offsetY = (containerH - displayH) / 2;
    } else {
      displayH = containerH;
      displayW = containerH * videoAspect;
      offsetX = (containerW - displayW) / 2;
      offsetY = 0;
    }
    return {
      x: offsetX,
      y: offsetY,
      width: displayW,
      height: displayH,
    };
  }

  function getGridStep() {
    var step = parseInt(gridStepInput && gridStepInput.value, 10);
    return !isNaN(step) && step >= 1 ? step : 16;
  }

  function drawCheckerboard(ctx, x, y, w, h, cellSize) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    var size = Math.max(4, cellSize);
    var cols = Math.ceil(w / size) + 1;
    var rows = Math.ceil(h / size) + 1;
    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        ctx.fillStyle = (row + col) % 2 === 0
          ? "rgba(255, 255, 255, 0.12)"
          : "rgba(0, 0, 0, 0.18)";
        ctx.fillRect(x + col * size, y + row * size, size, size);
      }
    }
    ctx.restore();
  }

  function drawPixelGrid(ctx, crop, bounds) {
    if (!bounds || bounds.width < 1 || bounds.height < 1) return;
    var scaleX = crop.width / bounds.width;
    var scaleY = crop.height / bounds.height;
    var step = getGridStep();
    var majorEvery = 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.clip();
    for (var px = 0; px <= bounds.width; px += step) {
      var dx = crop.x + px * scaleX;
      var isMajor = px % (step * majorEvery) === 0;
      ctx.strokeStyle = isMajor
        ? "rgba(255, 220, 100, 0.55)"
        : "rgba(110, 197, 255, 0.35)";
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(dx + 0.5, crop.y);
      ctx.lineTo(dx + 0.5, crop.y + crop.height);
      ctx.stroke();
    }
    for (var py = 0; py <= bounds.height; py += step) {
      var dy = crop.y + py * scaleY;
      var isMajorY = py % (step * majorEvery) === 0;
      ctx.strokeStyle = isMajorY
        ? "rgba(255, 220, 100, 0.55)"
        : "rgba(110, 197, 255, 0.35)";
      ctx.lineWidth = isMajorY ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(crop.x, dy + 0.5);
      ctx.lineTo(crop.x + crop.width, dy + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateFrameCountHint() {
    if (!frameCountHint || !state.meta) return;
    var fps = parseFloat(fpsInput && fpsInput.value) || 10;
    var start = parseFloat(segmentStart && segmentStart.value) || 0;
    var end = parseFloat(segmentEnd && segmentEnd.value) || state.meta.duration;
    var times = Core.getSampleTimes(state.meta.duration, fps, start, end);
    frameCountHint.textContent = "预计提取 " + times.length + " 帧";
  }

  function loadVideoFile(file) {
    if (!file || !file.type.match(/^video\//)) {
      setStatus("请选择视频文件（MP4 / WebM 等）。", true);
      return;
    }
    setBusy(true);
    setStatus("正在加载视频…");
    if (state.videoUrl) Core.revokeVideoAsset(state.videoUrl);
    resetFrames();
    Core.loadVideoAsset(file).then(function (asset) {
      state.videoUrl = asset.url;
      state.meta = asset.meta;
      state.cropArea = { leftPercent: 0, topPercent: 0, widthPercent: 100, heightPercent: 100 };
      if (videoPreview) {
        videoPreview.src = asset.url;
        videoPreview.hidden = false;
      }
      if (videoPlaceholder) videoPlaceholder.hidden = true;
      if (cropOverlay) cropOverlay.hidden = false;
      if (dropZone) dropZone.classList.remove("vs-drop-zone");
      if (metaDisplay) {
        metaDisplay.textContent =
          asset.meta.name + " · " + asset.meta.width + "×" + asset.meta.height +
          " · " + asset.meta.duration.toFixed(2) + "s";
        metaDisplay.hidden = false;
      }
      if (segmentStart) {
        segmentStart.max = String(asset.meta.duration);
        segmentStart.value = "0";
      }
      if (segmentEnd) {
        segmentEnd.max = String(asset.meta.duration);
        segmentEnd.value = String(asset.meta.duration);
      }
      syncCropInputs();
      updateFrameCountHint();
      setStatus("视频已加载，可框选裁剪区域后提取帧。");
      setBusy(false);
      videoPreview.addEventListener("loadeddata", function onLoaded() {
        videoPreview.removeEventListener("loadeddata", onLoaded);
        window.requestAnimationFrame(function () {
          drawCropOverlay();
          refreshCropPreview();
        });
      });
    }).catch(function (err) {
      setStatus(err.message || "视频加载失败。", true);
      setBusy(false);
    });
  }

  function syncCropInputs() {
    if (cropLeft) cropLeft.value = String(Math.round(state.cropArea.leftPercent));
    if (cropTop) cropTop.value = String(Math.round(state.cropArea.topPercent));
    if (cropWidth) cropWidth.value = String(Math.round(state.cropArea.widthPercent));
    if (cropHeight) cropHeight.value = String(Math.round(state.cropArea.heightPercent));
  }

  function syncCropFromInputs() {
    state.cropArea = Core.normalizeCropArea({
      leftPercent: parseFloat(cropLeft && cropLeft.value) || 0,
      topPercent: parseFloat(cropTop && cropTop.value) || 0,
      widthPercent: parseFloat(cropWidth && cropWidth.value) || 100,
      heightPercent: parseFloat(cropHeight && cropHeight.value) || 100,
    });
    drawCropOverlay();
  }

  function getCropDisplayRect() {
    var videoRect = getVideoDisplayRect();
    if (!videoRect || !cropOverlay) return null;
    var area = Core.normalizeCropArea(state.cropArea);
    return {
      x: videoRect.x + (area.leftPercent / 100) * videoRect.width,
      y: videoRect.y + (area.topPercent / 100) * videoRect.height,
      width: (area.widthPercent / 100) * videoRect.width,
      height: (area.heightPercent / 100) * videoRect.height,
      overlayW: cropOverlay.clientWidth,
      overlayH: cropOverlay.clientHeight,
      videoRect: videoRect,
    };
  }

  function refreshCropPreview() {
    if (!cropPreviewCanvas || !videoPreview || !state.meta) return;
    var vw = videoPreview.videoWidth;
    var vh = videoPreview.videoHeight;
    if (!vw || !vh || videoPreview.readyState < 2) return;
    var bounds = Core.getCropBounds(vw, vh, state.cropArea);
    if (bounds.width < 1 || bounds.height < 1) return;
    var maxPreview = 160;
    var scale = Math.min(1, maxPreview / Math.max(bounds.width, bounds.height));
    var pw = Math.max(1, Math.round(bounds.width * scale));
    var ph = Math.max(1, Math.round(bounds.height * scale));
    cropPreviewCanvas.width = pw;
    cropPreviewCanvas.height = ph;
    var ctx = cropPreviewCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);
    var cell = Math.max(4, Math.round(getGridStep() * scale));
    drawCheckerboard(ctx, 0, 0, pw, ph, cell);
    ctx.drawImage(
      videoPreview,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, pw, ph
    );
    var step = getGridStep();
    ctx.save();
    ctx.strokeStyle = "rgba(110, 197, 255, 0.5)";
    ctx.lineWidth = 1;
    for (var px = 0; px <= bounds.width; px += step) {
      var dx = px * scale;
      ctx.beginPath();
      ctx.moveTo(dx + 0.5, 0);
      ctx.lineTo(dx + 0.5, ph);
      ctx.stroke();
    }
    for (var py = 0; py <= bounds.height; py += step) {
      var dy = py * scale;
      ctx.beginPath();
      ctx.moveTo(0, dy + 0.5);
      ctx.lineTo(pw, dy + 0.5);
      ctx.stroke();
    }
    ctx.restore();
    cropPreviewCanvas.hidden = false;
    if (cropPreviewPlaceholder) cropPreviewPlaceholder.hidden = true;
  }

  function drawCropOverlay() {
    if (!cropCanvas || !cropOverlay) return;
    var rect = cropOverlay.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);
    if (w < 1 || h < 1) return;
    cropCanvas.width = w;
    cropCanvas.height = h;
    var ctx = cropCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    var crop = getCropDisplayRect();
    if (!crop) return;
    var bounds = state.meta
      ? Core.getCropBounds(state.meta.width, state.meta.height, state.cropArea)
      : null;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, w, h);
    ctx.clearRect(crop.x, crop.y, crop.width, crop.height);
    var displayCell = Math.max(
      6,
      Math.min(
        crop.width / Math.max(1, bounds ? bounds.width / getGridStep() : 8),
        crop.height / Math.max(1, bounds ? bounds.height / getGridStep() : 8)
      )
    );
    drawCheckerboard(ctx, crop.x, crop.y, crop.width, crop.height, displayCell);
    if (bounds) drawPixelGrid(ctx, crop, bounds);
    ctx.strokeStyle = "#6ec5ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
    ctx.setLineDash([]);
    if (bounds) {
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.fillStyle = "rgba(255, 220, 100, 0.95)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(bounds.width + " × " + bounds.height + " px", crop.x + 4, crop.y + 4);
    }
    refreshCropPreview();
  }

  function pointerToPercent(clientX, clientY) {
    var videoRect = getVideoDisplayRect();
    if (!videoRect || !cropOverlay) return { x: 0, y: 0 };
    var rect = cropOverlay.getBoundingClientRect();
    var relX = clientX - rect.left - videoRect.x;
    var relY = clientY - rect.top - videoRect.y;
    return {
      x: clamp(relX / videoRect.width * 100, 0, 100),
      y: clamp(relY / videoRect.height * 100, 0, 100),
    };
  }

  function clamp(v, min, max) {
    return Core.clamp(v, min, max);
  }

  function onCropPointerDown(e) {
    if (!state.videoUrl || state.isBusy) return;
    e.preventDefault();
    cropDrag.active = true;
    var p = pointerToPercent(e.clientX, e.clientY);
    cropDrag.startX = p.x;
    cropDrag.startY = p.y;
    cropDrag.mode = "new";
  }

  function onCropPointerMove(e) {
    if (!cropDrag.active) return;
    var p = pointerToPercent(e.clientX, e.clientY);
    var left = Math.min(cropDrag.startX, p.x);
    var top = Math.min(cropDrag.startY, p.y);
    var width = Math.abs(p.x - cropDrag.startX);
    var height = Math.abs(p.y - cropDrag.startY);
    if (width < 1) width = 1;
    if (height < 1) height = 1;
    state.cropArea = Core.normalizeCropArea({
      leftPercent: left,
      topPercent: top,
      widthPercent: width,
      heightPercent: height,
    });
    syncCropInputs();
    drawCropOverlay();
  }

  function onCropPointerUp() {
    cropDrag.active = false;
  }

  function getCropMeta() {
    if (!state.meta) return { width: 1, height: 1 };
    var bounds = Core.getCropBounds(state.meta.width, state.meta.height, state.cropArea);
    return { width: bounds.width, height: bounds.height };
  }

  function getSheetOptions() {
    var frameSizeVal = frameSizeSelect ? frameSizeSelect.value : "";
    var frameSize = frameSizeVal ? parseInt(frameSizeVal, 10) : null;
    return {
      columns: Math.max(1, parseInt(columnsInput && columnsInput.value, 10) || 4),
      gap: Math.max(0, parseInt(gapInput && gapInput.value, 10) || 0),
      backgroundColor: (sheetBgInput && sheetBgInput.value) || "#ffffff",
      frameSize: frameSize,
    };
  }

  function getChromaOptions() {
    return {
      sample: state.colorSample,
      tolerance: parseFloat(toleranceInput && toleranceInput.value) || 30,
      softness: parseFloat(softnessInput && softnessInput.value) || 15,
      despill: parseFloat(despillInput && despillInput.value) || 50,
      sampleRadius: 2,
      edgeRadius: 8,
      smoothing: true,
      despillEnabled: true,
      algorithm: "enhanced",
    };
  }

  function showRefFrame() {
    if (!refCanvas || !state.rawFrames.length) return;
    var frame = state.rawFrames[0];
    refCanvas.width = frame.image.width;
    refCanvas.height = frame.image.height;
    var ctx = refCanvas.getContext("2d");
    if (ctx) ctx.drawImage(frame.image, 0, 0);
  }

  async function extractFramesAction() {
    if (!state.videoUrl || !state.meta || state.isBusy) return;
    setBusy(true);
    stopAnimation();
    if (extractProgress) extractProgress.hidden = false;
    setStatus("正在提取帧，请稍候…");
    var fps = parseFloat(fpsInput && fpsInput.value) || 10;
    var start = parseFloat(segmentStart && segmentStart.value) || 0;
    var end = parseFloat(segmentEnd && segmentEnd.value) || state.meta.duration;
    try {
      state.rawFrames = await Core.extractFrames(
        state.videoUrl,
        state.meta,
        {
          framesPerSecond: fps,
          segmentStart: start,
          segmentEnd: end,
          cropArea: state.cropArea,
        },
        function (current, total) {
          if (extractProgress) {
            extractProgress.textContent = "提取进度 " + current + " / " + total;
          }
        }
      );
      state.processedFrames = [];
      state.chromaEnabled = false;
      state.colorSample = null;
      if (sampleColorDisplay) {
        sampleColorDisplay.style.background = "";
        sampleColorDisplay.textContent = "未采样";
      }
      showRefFrame();
      if (chromaToggle && chromaToggle.checked && chromaPanel) chromaPanel.hidden = false;
      await refreshSheetPreview();
      setStatus("已提取 " + state.rawFrames.length + " 帧。可选抠图后导出透明资源。");
    } catch (err) {
      setStatus(err.message || "提取失败。", true);
    }
    if (extractProgress) extractProgress.hidden = true;
    setBusy(false);
    updateExportButtons();
  }

  async function applyChromaKey() {
    if (state.isBusy) return;
    if (!chromaToggle || !chromaToggle.checked) {
      setStatus("请先勾选「启用 ChromaKey 抠图」。", true);
      return;
    }
    if (!state.rawFrames.length) {
      setStatus("请先提取序列帧。", true);
      return;
    }
    if (!state.colorSample) {
      setStatus("请先在参考帧上点击拾取背景色。", true);
      return;
    }
    setBusy(true);
    setStatus("正在应用抠图…");
    try {
      state.processedFrames = await processAllFramesAsync(
        state.rawFrames,
        getChromaOptions(),
        function (cur, total) {
          setStatus("抠图进度 " + cur + " / " + total);
        }
      );
      state.chromaEnabled = true;
      if (refCanvas && state.processedFrames[0]) {
        var preview = state.processedFrames[0].processedImage;
        refCanvas.width = preview.width;
        refCanvas.height = preview.height;
        var pctx = refCanvas.getContext("2d");
        if (pctx) pctx.drawImage(preview, 0, 0);
      }
      await refreshSheetPreview();
      setStatus("抠图完成，可导出透明序列图 / GIF / ZIP。");
    } catch (err) {
      setStatus(err.message || "抠图失败。", true);
    }
    setBusy(false);
    updateExportButtons();
  }

  function processAllFramesAsync(frames, options, onProgress) {
    return new Promise(function (resolve, reject) {
      var result = [];
      var index = 0;
      function step() {
        try {
          while (index < frames.length) {
            result.push(Core.processExtractedFrame(frames[index], options));
            index += 1;
            if (onProgress) onProgress(index, frames.length);
            if (index % 2 === 0 && index < frames.length) {
              window.setTimeout(step, 0);
              return;
            }
          }
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }
      step();
    });
  }

  function getExportFrames() {
    return Core.getEffectiveFrames(state.rawFrames, state.processedFrames, state.chromaEnabled);
  }

  async function refreshSheetPreview() {
    var frames = getExportFrames();
    if (!frames.length || !state.meta) return;
    var cropMeta = getCropMeta();
    var sheetOpts = getSheetOptions();
    var transparent = state.chromaEnabled;
    try {
      var result = await Export.renderFrameSheet(
        frames,
        { width: cropMeta.width, height: cropMeta.height },
        sheetOpts,
        false,
        Export.getSheetAppearance(transparent)
      );
      if (state.sheetPreviewUrl) URL.revokeObjectURL(state.sheetPreviewUrl);
      state.sheetPreviewUrl = result.objectUrl;
      if (sheetPreview) {
        sheetPreview.src = result.objectUrl;
        sheetPreview.hidden = false;
      }
      if (sheetPlaceholder) sheetPlaceholder.hidden = true;
    } catch (err) {
      setStatus(err.message || "预览生成失败。", true);
    }
  }

  function stopAnimation() {
    if (state.animTimer) {
      window.clearInterval(state.animTimer);
      state.animTimer = null;
    }
    state.animIndex = 0;
  }

  function playAnimation() {
    var frames = getExportFrames();
    if (!frames.length || !animCanvas) return;
    stopAnimation();
    var w = frames[0].image.width;
    var h = frames[0].image.height;
    animCanvas.width = w;
    animCanvas.height = h;
    var ctx = animCanvas.getContext("2d");
    if (!ctx) return;
    var fps = parseFloat(fpsInput && fpsInput.value) || 10;
    var interval = Math.max(16, Math.round(1000 / fps));
    state.animIndex = 0;
    function drawFrame() {
      var frame = frames[state.animIndex];
      if (!frame) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(frame.image, 0, 0);
      state.animIndex = (state.animIndex + 1) % frames.length;
    }
    drawFrame();
    state.animTimer = window.setInterval(drawFrame, interval);
  }

  async function exportSheet() {
    var frames = getExportFrames();
    if (!frames.length || !state.meta) return;
    setBusy(true);
    setStatus("正在导出序列图…");
    try {
      var cropMeta = getCropMeta();
      var transparent = state.chromaEnabled;
      var result = await Export.renderFrameSheet(
        frames,
        { width: cropMeta.width, height: cropMeta.height },
        getSheetOptions(),
        false,
        Export.getSheetAppearance(transparent)
      );
      Export.downloadBlob(
        result.blob,
        Export.getSheetFileName(state.meta.name, transparent)
      );
      setStatus("序列图已下载。");
    } catch (err) {
      setStatus(err.message || "导出失败。", true);
    }
    setBusy(false);
  }

  async function exportGif() {
    var frames = getExportFrames();
    if (!frames.length || !state.meta) return;
    setBusy(true);
    setStatus("正在生成 GIF…");
    try {
      var fps = parseFloat(fpsInput && fpsInput.value) || 10;
      var blob = await Export.buildAnimatedGif(frames, {
        fps: fps,
        transparent: state.chromaEnabled,
        loop: true,
        onProgress: function (p) {
          setStatus("GIF " + p.phase + " " + p.current + "/" + p.total);
        },
      });
      Export.downloadBlob(
        blob,
        Export.getGifFileName(state.meta.name, state.chromaEnabled)
      );
      setStatus("GIF 已下载。");
    } catch (err) {
      setStatus(err.message || "GIF 导出失败。", true);
    }
    setBusy(false);
  }

  async function exportZip() {
    if (!state.processedFrames.length || !state.meta) return;
    setBusy(true);
    setStatus("正在打包 ZIP…");
    try {
      var blob = await Export.buildTransparentFramesZip(
        state.processedFrames,
        state.meta.name
      );
      Export.downloadBlob(blob, Export.getZipFileName(state.meta.name));
      setStatus("透明帧 ZIP 已下载。");
    } catch (err) {
      setStatus(err.message || "ZIP 导出失败。", true);
    }
    setBusy(false);
  }

  async function exportSpine() {
    var frames = getExportFrames();
    if (!frames.length || !state.meta) return;
    setBusy(true);
    setStatus("正在生成 Spine 资源包…");
    try {
      var cropMeta = getCropMeta();
      var fps = parseFloat(fpsInput && fpsInput.value) || 10;
      var blob = await Export.buildSpineBundleZip(
        {
          frames: frames,
          baseName: state.meta.name,
          width: cropMeta.width,
          height: cropMeta.height,
          transparent: state.chromaEnabled,
        },
        {
          skeletonName: "root",
          animationName: "idle",
          slotName: "sprite",
          fps: fps,
        }
      );
      Export.downloadBlob(blob, Export.getSpineZipFileName(state.meta.name));
      setStatus("Spine ZIP 已下载。");
    } catch (err) {
      setStatus(err.message || "Spine 导出失败。", true);
    }
    setBusy(false);
  }

  function onRefCanvasClick(e) {
    if (!state.rawFrames.length || state.isBusy) return;
    var rect = refCanvas.getBoundingClientRect();
    var scaleX = refCanvas.width / rect.width;
    var scaleY = refCanvas.height / rect.height;
    var x = (e.clientX - rect.left) * scaleX;
    var y = (e.clientY - rect.top) * scaleY;
    try {
      state.colorSample = Core.sampleCanvasColor(refCanvas, x, y, 2);
      if (sampleColorDisplay) {
        sampleColorDisplay.style.background = state.colorSample.hex;
        sampleColorDisplay.textContent = state.colorSample.hex;
      }
      setStatus("已采样背景色 " + state.colorSample.hex + "，可点击「应用抠图」。");
      updateChromaControls();
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) loadVideoFile(fileInput.files[0]);
    });
  }

  if (dropZone) {
    dropZone.addEventListener("click", function (e) {
      if (state.videoUrl) return;
      if (fileInput) fileInput.click();
    });
    dropZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropZone.classList.add("vs-drag-over");
    });
    dropZone.addEventListener("dragleave", function () {
      dropZone.classList.remove("vs-drag-over");
    });
    dropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropZone.classList.remove("vs-drag-over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadVideoFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (cropOverlay) {
    cropOverlay.addEventListener("mousedown", onCropPointerDown);
    window.addEventListener("mousemove", onCropPointerMove);
    window.addEventListener("mouseup", onCropPointerUp);
    window.addEventListener("resize", drawCropOverlay);
  }

  [cropLeft, cropTop, cropWidth, cropHeight].forEach(function (el) {
    if (el) el.addEventListener("change", syncCropFromInputs);
  });

  if (gridStepInput) {
    gridStepInput.addEventListener("change", function () {
      drawCropOverlay();
    });
  }

  [segmentStart, segmentEnd, fpsInput].forEach(function (el) {
    if (el) el.addEventListener("input", updateFrameCountHint);
  });

  [columnsInput, gapInput, frameSizeSelect, sheetBgInput].forEach(function (el) {
    if (el) el.addEventListener("change", function () {
      if (state.rawFrames.length) refreshSheetPreview();
    });
  });

  if (extractBtn) extractBtn.addEventListener("click", extractFramesAction);
  if (applyChromaBtn) applyChromaBtn.addEventListener("click", applyChromaKey);
  if (animPlayBtn) animPlayBtn.addEventListener("click", playAnimation);
  if (animStopBtn) animStopBtn.addEventListener("click", stopAnimation);
  if (exportSheetBtn) exportSheetBtn.addEventListener("click", exportSheet);
  if (exportGifBtn) exportGifBtn.addEventListener("click", exportGif);
  if (exportZipBtn) exportZipBtn.addEventListener("click", exportZip);
  if (exportSpineBtn) exportSpineBtn.addEventListener("click", exportSpine);
  if (refCanvas) refCanvas.addEventListener("click", onRefCanvasClick);

  if (chromaToggle) {
    chromaToggle.addEventListener("change", function () {
      if (chromaPanel) chromaPanel.hidden = !chromaToggle.checked;
      updateChromaControls();
      if (chromaToggle.checked && !state.rawFrames.length) {
        setStatus("请先提取序列帧，再在参考帧上拾取背景色。", true);
      }
    });
  }

  updateExportButtons();
})();
