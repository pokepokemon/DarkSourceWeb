/**
 * Video → Sprite Sheet core — ported from video-timesheet-web (GPL-3.0)
 * https://github.com/mowangblog/video-timesheet-web
 */
(function (global) {
  "use strict";

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  function channelToHex(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  }

  function rgbToHex(rgb) {
    return "#" + channelToHex(rgb.r) + channelToHex(rgb.g) + channelToHex(rgb.b);
  }

  function createCanvas(width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function formatTimestamp(seconds) {
    var clamped = Math.max(0, seconds);
    var totalMilliseconds = Math.round(clamped * 1000);
    var totalSeconds = Math.floor(totalMilliseconds / 1000);
    var milliseconds = totalMilliseconds % 1000;
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var secs = totalSeconds % 60;
    var time =
      hours > 0
        ? [hours, minutes, secs].map(function (v) { return String(v).padStart(2, "0"); }).join(":")
        : [minutes, secs].map(function (v) { return String(v).padStart(2, "0"); }).join(":");
    return time + "." + String(milliseconds).padStart(3, "0");
  }

  function waitForEvent(target, event) {
    return new Promise(function (resolve, reject) {
      function cleanup() {
        target.removeEventListener(event, onSuccess);
        target.removeEventListener("error", onError);
      }
      function onSuccess() {
        cleanup();
        resolve();
      }
      function onError() {
        cleanup();
        reject(new Error("视频读取失败，请检查文件是否可被当前浏览器解码。"));
      }
      target.addEventListener(event, onSuccess, { once: true });
      target.addEventListener("error", onError, { once: true });
    });
  }

  function createVideoElement(videoUrl) {
    var video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;
    return video;
  }

  function releaseVideoElement(video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  async function seekTo(video, time) {
    if (Math.abs(video.currentTime - time) < 0.001) return;
    var promise = waitForEvent(video, "seeked");
    video.currentTime = time;
    await promise;
  }

  function drawFrame(video) {
    var canvas = createCanvas(video.videoWidth, video.videoHeight);
    var context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建 Canvas 绘图上下文。");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function loadVideoAsset(file) {
    var url = URL.createObjectURL(file);
    var video = createVideoElement(url);
    try {
      await waitForEvent(video, "loadedmetadata");
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    var width = video.videoWidth;
    var height = video.videoHeight;
    var duration = video.duration;
    releaseVideoElement(video);
    if (!width || !height || !duration || !Number.isFinite(duration)) {
      URL.revokeObjectURL(url);
      throw new Error("无法读取视频元数据，请换一个常见编码的 MP4 文件后重试。");
    }
    return {
      url: url,
      meta: { duration: duration, width: width, height: height, name: file.name },
    };
  }

  function revokeVideoAsset(url) {
    URL.revokeObjectURL(url);
  }

  async function createVideoFrameReader(videoUrl) {
    var video = createVideoElement(videoUrl);
    await waitForEvent(video, "loadeddata");
    return {
      captureFrameAt: async function (time) {
        var clampedTime = Math.max(0, Math.min(time, video.duration || time));
        await seekTo(video, clampedTime);
        return drawFrame(video);
      },
      dispose: function () {
        releaseVideoElement(video);
      },
    };
  }

  var MIN_CROP_PERCENT = 1;
  var MAX_CROP_PERCENT = 100;

  function normalizeCropArea(cropArea) {
    if (!cropArea) {
      return { leftPercent: 0, topPercent: 0, widthPercent: 100, heightPercent: 100 };
    }
    var leftPercent = clamp(cropArea.leftPercent, 0, MAX_CROP_PERCENT - MIN_CROP_PERCENT);
    var topPercent = clamp(cropArea.topPercent, 0, MAX_CROP_PERCENT - MIN_CROP_PERCENT);
    var widthLimit = MAX_CROP_PERCENT - leftPercent;
    var heightLimit = MAX_CROP_PERCENT - topPercent;
    return {
      leftPercent: leftPercent,
      topPercent: topPercent,
      widthPercent: clamp(cropArea.widthPercent, MIN_CROP_PERCENT, widthLimit),
      heightPercent: clamp(cropArea.heightPercent, MIN_CROP_PERCENT, heightLimit),
    };
  }

  function getCropBounds(sourceWidth, sourceHeight, cropArea) {
    var width = Math.max(1, Math.round(sourceWidth));
    var height = Math.max(1, Math.round(sourceHeight));
    var normalized = normalizeCropArea(cropArea);
    var x = Math.floor((normalized.leftPercent / 100) * width);
    var y = Math.floor((normalized.topPercent / 100) * height);
    var maxCropWidth = Math.max(1, width - x);
    var maxCropHeight = Math.max(1, height - y);
    var rawCropWidth = Math.round((normalized.widthPercent / 100) * width);
    var rawCropHeight = Math.round((normalized.heightPercent / 100) * height);
    return {
      x: x,
      y: y,
      width: clamp(rawCropWidth, 1, maxCropWidth),
      height: clamp(rawCropHeight, 1, maxCropHeight),
    };
  }

  function cropCanvas(source, cropArea) {
    var bounds = getCropBounds(source.width, source.height, cropArea);
    var isFullFrame =
      bounds.x === 0 &&
      bounds.y === 0 &&
      bounds.width === source.width &&
      bounds.height === source.height;
    if (isFullFrame) return source;
    var canvas = createCanvas(bounds.width, bounds.height);
    var context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建 Canvas 绘图上下文。");
    context.drawImage(
      source,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, bounds.width, bounds.height
    );
    return canvas;
  }

  function clampTime(time, duration) {
    if (!Number.isFinite(time)) return 0;
    return Math.max(0, Math.min(time, duration));
  }

  function getSampleTimes(duration, framesPerSecond, segmentStart, segmentEnd) {
    if (segmentStart === undefined) segmentStart = 0;
    if (segmentEnd === undefined) segmentEnd = duration;
    if (!Number.isFinite(duration) || duration <= 0 || framesPerSecond <= 0) return [];
    var rawStart = clampTime(Math.min(segmentStart, segmentEnd), duration);
    var rawEnd = clampTime(Math.max(segmentStart, segmentEnd), duration);
    var segmentDuration = rawEnd - rawStart;
    if (segmentDuration <= 0.001) {
      return [Number(rawStart.toFixed(3))];
    }
    var margin = Math.min(0.2, segmentDuration * 0.05);
    var safeStart = rawStart + margin;
    var safeEnd = rawEnd - margin;
    var safeDuration = safeEnd - safeStart;
    if (safeDuration <= 0) {
      return [Number(((rawStart + rawEnd) / 2).toFixed(3))];
    }
    var frameCount = Math.floor(safeDuration * framesPerSecond) + 1;
    if (frameCount <= 1) {
      return [Number(((safeStart + safeEnd) / 2).toFixed(3))];
    }
    var step = safeDuration / (frameCount - 1);
    var times = [];
    for (var index = 0; index < frameCount; index++) {
      var next = safeStart + step * index;
      times.push(Number(Math.min(duration, Math.max(0, next)).toFixed(3)));
    }
    return times;
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  async function extractFrames(videoUrl, meta, options, onProgress) {
    var reader = await createVideoFrameReader(videoUrl);
    try {
      var sampleTimes = getSampleTimes(
        meta.duration,
        options.framesPerSecond,
        options.segmentStart,
        options.segmentEnd
      );
      var frames = [];
      for (var index = 0; index < sampleTimes.length; index++) {
        var time = sampleTimes[index];
        var image = await reader.captureFrameAt(time);
        var croppedImage = cropCanvas(image, options.cropArea);
        frames.push({
          image: croppedImage,
          time: time,
          label: formatTimestamp(time),
        });
        if (onProgress) onProgress(index + 1, sampleTimes.length, time);
        if (index < sampleTimes.length - 1) await nextFrame();
      }
      return frames;
    } finally {
      reader.dispose();
    }
  }

  function getDominantChannel(sample) {
    if (sample.r >= sample.g && sample.r >= sample.b) return "r";
    if (sample.g >= sample.r && sample.g >= sample.b) return "g";
    return "b";
  }

  function computeColorDistance(pixel, sample, algorithm) {
    var dr = pixel.r - sample.r;
    var dg = pixel.g - sample.g;
    var db = pixel.b - sample.b;
    if (algorithm === "classic") {
      return Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
    }
    return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
  }

  function getOpacityForDistance(distance, tolerance, softness, algorithm, smoothing) {
    var threshold = Math.max(0, tolerance);
    var feather = smoothing ? Math.max(0, softness) : 0;
    if (distance <= threshold) return 0;
    if (feather <= 0) return 1;
    if (distance >= threshold + feather) return 1;
    var progress = (distance - threshold) / feather;
    if (algorithm === "classic") return progress;
    return progress * progress * (3 - 2 * progress);
  }

  function applyDespill(pixel, sample, opacity, despill) {
    var normalizedDespill = clamp(despill, 0, 100) / 100;
    var reductionFactor = (1 - opacity) * normalizedDespill;
    if (reductionFactor <= 0) return pixel;
    var dominant = getDominantChannel(sample);
    var output = { r: pixel.r, g: pixel.g, b: pixel.b };
    if (dominant === "g" && output.g > Math.max(output.r, output.b)) {
      output.g -= (output.g - Math.max(output.r, output.b)) * reductionFactor;
    }
    if (dominant === "r" && output.r > Math.max(output.g, output.b)) {
      output.r -= (output.r - Math.max(output.g, output.b)) * reductionFactor;
    }
    if (dominant === "b" && output.b > Math.max(output.r, output.g)) {
      output.b -= (output.b - Math.max(output.r, output.g)) * reductionFactor;
    }
    return {
      r: clamp(Math.round(output.r), 0, 255),
      g: clamp(Math.round(output.g), 0, 255),
      b: clamp(Math.round(output.b), 0, 255),
    };
  }

  function sampleCanvasColor(canvas, x, y, radius) {
    var context = canvas.getContext("2d");
    if (!context) throw new Error("无法读取参考帧像素数据。");
    var clampedX = clamp(Math.round(x), 0, canvas.width - 1);
    var clampedY = clamp(Math.round(y), 0, canvas.height - 1);
    var sampleRadius = Math.max(0, Math.round(radius));
    var startX = clamp(clampedX - sampleRadius, 0, canvas.width - 1);
    var startY = clamp(clampedY - sampleRadius, 0, canvas.height - 1);
    var endX = clamp(clampedX + sampleRadius, 0, canvas.width - 1);
    var endY = clamp(clampedY + sampleRadius, 0, canvas.height - 1);
    var width = endX - startX + 1;
    var height = endY - startY + 1;
    var imageData = context.getImageData(startX, startY, width, height).data;
    var totalR = 0, totalG = 0, totalB = 0, samples = 0;
    for (var index = 0; index < imageData.length; index += 4) {
      totalR += imageData[index];
      totalG += imageData[index + 1];
      totalB += imageData[index + 2];
      samples += 1;
    }
    var rgb = {
      r: Math.round(totalR / Math.max(samples, 1)),
      g: Math.round(totalG / Math.max(samples, 1)),
      b: Math.round(totalB / Math.max(samples, 1)),
    };
    return { x: clampedX, y: clampedY, hex: rgbToHex(rgb), rgb: rgb };
  }

  function applyColorKey(source, options) {
    var sourceContext = source.getContext("2d");
    if (!sourceContext) throw new Error("无法读取原始帧图像。");
    var sourceImageData = sourceContext.getImageData(0, 0, source.width, source.height);
    var sourcePixels = sourceImageData.data;
    var outputCanvas = createCanvas(source.width, source.height);
    var maskCanvas = createCanvas(source.width, source.height);
    var outputContext = outputCanvas.getContext("2d");
    var maskContext = maskCanvas.getContext("2d");
    if (!outputContext || !maskContext) throw new Error("无法创建抠像预览画布。");
    var outputImageData = outputContext.createImageData(source.width, source.height);
    var maskImageData = maskContext.createImageData(source.width, source.height);
    var outputPixels = outputImageData.data;
    var maskPixels = maskImageData.data;
    for (var index = 0; index < sourcePixels.length; index += 4) {
      var pixel = {
        r: sourcePixels[index],
        g: sourcePixels[index + 1],
        b: sourcePixels[index + 2],
      };
      var distance = computeColorDistance(pixel, options.sample.rgb, options.algorithm);
      var opacity = getOpacityForDistance(
        distance, options.tolerance, options.softness, options.algorithm, options.smoothing
      );
      var edgeWeight =
        options.edgeRadius <= 0
          ? 1
          : clamp((options.tolerance + options.edgeRadius - distance) / options.edgeRadius, 0, 1);
      var adjustedPixel =
        options.despillEnabled && options.despill > 0
          ? applyDespill(pixel, options.sample.rgb, opacity, options.despill * edgeWeight)
          : pixel;
      var alpha = Math.round(opacity * 255);
      outputPixels[index] = adjustedPixel.r;
      outputPixels[index + 1] = adjustedPixel.g;
      outputPixels[index + 2] = adjustedPixel.b;
      outputPixels[index + 3] = alpha;
      maskPixels[index] = alpha;
      maskPixels[index + 1] = alpha;
      maskPixels[index + 2] = alpha;
      maskPixels[index + 3] = 255;
    }
    outputContext.putImageData(outputImageData, 0, 0);
    maskContext.putImageData(maskImageData, 0, 0);
    return { image: outputCanvas, mask: maskCanvas };
  }

  function processExtractedFrame(frame, options) {
    var processed = applyColorKey(frame.image, options);
    return {
      image: frame.image,
      time: frame.time,
      label: frame.label,
      processedImage: processed.image,
      maskImage: processed.mask,
    };
  }

  function processAllFrames(frames, options, onProgress) {
    var result = [];
    for (var i = 0; i < frames.length; i++) {
      result.push(processExtractedFrame(frames[i], options));
      if (onProgress) onProgress(i + 1, frames.length);
    }
    return result;
  }

  function getEffectiveFrames(rawFrames, processedFrames, useChromaKey) {
    if (!useChromaKey || !processedFrames || !processedFrames.length) {
      return rawFrames.map(function (f) {
        return { image: f.image, time: f.time, label: f.label };
      });
    }
    return processedFrames.map(function (f) {
      return { image: f.processedImage, time: f.time, label: f.label };
    });
  }

  global.VideoSpriteCore = {
    clamp: clamp,
    formatTimestamp: formatTimestamp,
    loadVideoAsset: loadVideoAsset,
    revokeVideoAsset: revokeVideoAsset,
    createVideoFrameReader: createVideoFrameReader,
    normalizeCropArea: normalizeCropArea,
    getCropBounds: getCropBounds,
    cropCanvas: cropCanvas,
    getSampleTimes: getSampleTimes,
    extractFrames: extractFrames,
    sampleCanvasColor: sampleCanvasColor,
    applyColorKey: applyColorKey,
    processExtractedFrame: processExtractedFrame,
    processAllFrames: processAllFrames,
    getEffectiveFrames: getEffectiveFrames,
    createCanvas: createCanvas,
  };
})(typeof window !== "undefined" ? window : this);
