/**
 * Video → Sprite Sheet export — ported from video-timesheet-web (GPL-3.0)
 * https://github.com/mowangblog/video-timesheet-web
 */
(function (global) {
  "use strict";

  var Core = global.VideoSpriteCore;

  function clamp(value, min, max) {
    return Core ? Core.clamp(value, min, max) : Math.min(Math.max(value, min), max);
  }

  function sanitizeBaseName(input) {
    return (
      input
        .replace(/\.[^.]+$/, "")
        .trim()
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "video"
    );
  }

  function safeTimestampLabel(time) {
    var fmt = Core ? Core.formatTimestamp(time) : String(time);
    return fmt.replace(/[.:]/g, "-");
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("图片导出失败，请稍后再试。"));
          return;
        }
        resolve(blob);
      }, "image/png");
    });
  }

  function resizeCanvas(source, targetWidth, targetHeight, pixelated) {
    if (targetWidth === source.width && targetHeight === source.height) return source;
    var target = document.createElement("canvas");
    target.width = targetWidth;
    target.height = targetHeight;
    var ctx = target.getContext("2d");
    if (!ctx) throw new Error("无法创建缩放画布。");
    ctx.imageSmoothingEnabled = !pixelated;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return target;
  }

  var MAX_FRAME_WIDTH = 320;
  var LABEL_FONT_SIZE = 16;
  var LABEL_BLOCK_HEIGHT = 30;
  var CARD_PADDING = 10;

  function getLayoutMetrics(meta, frameCount, sheetOptions, includeTimestamps) {
    var rows = Math.max(1, Math.ceil(frameCount / sheetOptions.columns));
    var frameSize = sheetOptions.frameSize != null ? sheetOptions.frameSize : null;
    var frameWidth = frameSize != null ? frameSize : Math.min(MAX_FRAME_WIDTH, meta.width);
    var frameHeight =
      frameSize != null ? frameSize : Math.round((meta.height / meta.width) * frameWidth);
    var labelBlockHeight = includeTimestamps ? LABEL_BLOCK_HEIGHT : 0;
    var contentPadding = includeTimestamps ? CARD_PADDING : 0;
    var cardHeight = frameHeight + labelBlockHeight + contentPadding * 2;
    var horizontalGap = Math.max(sheetOptions.columns - 1, 0) * sheetOptions.gap;
    var verticalGap = Math.max(rows - 1, 0) * sheetOptions.gap;
    return {
      rows: rows,
      canvasWidth: sheetOptions.columns * frameWidth + horizontalGap,
      canvasHeight: rows * cardHeight + verticalGap,
      frameWidth: frameWidth,
      frameHeight: frameHeight,
      labelBlockHeight: labelBlockHeight,
    };
  }

  function getSheetAppearance(transparent) {
    return transparent
      ? { transparentBackground: true, showCardBackground: false }
      : { transparentBackground: false, showCardBackground: true };
  }

  function fillRoundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
    context.fill();
  }

  async function renderFrameSheet(frames, meta, sheetOptions, includeTimestamps, appearance) {
    if (!appearance) appearance = getSheetAppearance(false);
    var metrics = getLayoutMetrics(meta, frames.length, sheetOptions, includeTimestamps);
    if (metrics.canvasWidth > 16384 || metrics.canvasHeight > 16384) {
      throw new Error(
        "序列图尺寸超出浏览器限制（单边最大约 16384px）。请减少帧数、列数或缩小单帧尺寸。"
      );
    }
    var canvas = document.createElement("canvas");
    canvas.width = metrics.canvasWidth;
    canvas.height = metrics.canvasHeight;
    var context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建最终导出画布。");
    if (appearance.transparentBackground) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      context.fillStyle = sheetOptions.backgroundColor || "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.font = "600 " + LABEL_FONT_SIZE + 'px "Segoe UI", "PingFang SC", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    var contentPadding = includeTimestamps ? CARD_PADDING : 0;
    var cardHeight = metrics.frameHeight + metrics.labelBlockHeight + contentPadding * 2;
    var pixelated = sheetOptions.frameSize != null && sheetOptions.frameSize <= 256;
    for (var index = 0; index < frames.length; index++) {
      var frame = frames[index];
      var scaledFrame = resizeCanvas(
        frame.image, metrics.frameWidth, metrics.frameHeight, pixelated
      );
      var column = index % sheetOptions.columns;
      var row = Math.floor(index / sheetOptions.columns);
      var x = column * (metrics.frameWidth + sheetOptions.gap);
      var y = row * (cardHeight + sheetOptions.gap);
      if (appearance.showCardBackground) {
        context.fillStyle = "rgba(16, 24, 40, 0.08)";
        fillRoundedRect(
          context, x, y,
          metrics.frameWidth,
          metrics.frameHeight + metrics.labelBlockHeight + CARD_PADDING * 2,
          16
        );
      }
      context.drawImage(
        scaledFrame, x, y + contentPadding, metrics.frameWidth, metrics.frameHeight
      );
      if (includeTimestamps) {
        context.fillStyle = "#182230";
        context.fillText(
          frame.label,
          x + metrics.frameWidth / 2,
          y + contentPadding + metrics.frameHeight + metrics.labelBlockHeight / 2
        );
      }
      if (index % 4 === 3 && index < frames.length - 1) {
        await new Promise(function (r) { window.setTimeout(r, 0); });
      }
    }
    var blob = await canvasToBlob(canvas);
    return {
      blob: blob,
      objectUrl: URL.createObjectURL(blob),
      outputWidth: canvas.width,
      outputHeight: canvas.height,
    };
  }

  function getBaseFileName(input) {
    return sanitizeBaseName(input);
  }

  function getSheetFileName(baseName, transparent) {
    var safeBase = sanitizeBaseName(baseName);
    return safeBase + (transparent ? "-transparent" : "") + "-timesheet.png";
  }

  function getFrameFileName(baseName, index, time) {
    var safeBase = sanitizeBaseName(baseName);
    var frameNumber = String(index + 1).padStart(3, "0");
    return safeBase + "-frame-" + frameNumber + "-" + safeTimestampLabel(time) + ".png";
  }

  function getZipFileName(baseName) {
    return sanitizeBaseName(baseName) + "-frames.zip";
  }

  function getGifFileName(baseName, transparent) {
    var safeBase = sanitizeBaseName(baseName);
    return safeBase + (transparent ? "-transparent" : "") + "-animation.gif";
  }

  async function buildTransparentFramesZip(frames, baseName) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip 未加载，无法导出 ZIP。");
    }
    var zip = new JSZip();
    for (var index = 0; index < frames.length; index++) {
      var frame = frames[index];
      var blob = await canvasToBlob(frame.processedImage || frame.image);
      zip.file(getFrameFileName(baseName, index, frame.time), blob);
    }
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  /* ---- GIF encoder (from video-timesheet-web gif.ts) ---- */

  var GIF_SIGNATURE = "GIF89a";
  var GIF_TRAILER = 0x3b;
  var MAX_GIF_COLORS = 256;
  var MAX_GIF_CODE_SIZE = 12;
  var MAX_LZW_CODE = (1 << MAX_GIF_CODE_SIZE) - 1;
  var COLOR_BIN_LEVELS = 32;
  var COLOR_BIN_COUNT = COLOR_BIN_LEVELS * COLOR_BIN_LEVELS * COLOR_BIN_LEVELS;
  var DEFAULT_ALPHA_THRESHOLD = 96;
  var DEFAULT_SAMPLE_PIXEL_BUDGET = 220000;
  var PROGRESS_YIELD_INTERVAL = 4;

  function ByteWriter() {
    this.bytes = [];
  }
  ByteWriter.prototype.writeByte = function (value) {
    this.bytes.push(value & 0xff);
  };
  ByteWriter.prototype.writeShort = function (value) {
    this.writeByte(value & 0xff);
    this.writeByte((value >> 8) & 0xff);
  };
  ByteWriter.prototype.writeBytes = function (values) {
    for (var index = 0; index < values.length; index++) {
      this.writeByte(values[index] || 0);
    }
  };
  ByteWriter.prototype.toUint8Array = function () {
    return Uint8Array.from(this.bytes);
  };

  function BitWriter() {
    this.bytes = [];
    this.currentByte = 0;
    this.bitOffset = 0;
  }
  BitWriter.prototype.write = function (code, size) {
    var value = code;
    var bits = size;
    while (bits > 0) {
      this.currentByte |= (value & 1) << this.bitOffset;
      value >>= 1;
      this.bitOffset += 1;
      bits -= 1;
      if (this.bitOffset >= 8) {
        this.bytes.push(this.currentByte);
        this.currentByte = 0;
        this.bitOffset = 0;
      }
    }
  };
  BitWriter.prototype.finish = function () {
    if (this.bitOffset > 0) {
      this.bytes.push(this.currentByte);
      this.currentByte = 0;
      this.bitOffset = 0;
    }
    return Uint8Array.from(this.bytes);
  };

  function ceilPowerOfTwo(input) {
    var value = Math.max(2, input);
    if ((value & (value - 1)) === 0) return value;
    value -= 1;
    value |= value >> 1;
    value |= value >> 2;
    value |= value >> 4;
    value |= value >> 8;
    value |= value >> 16;
    return value + 1;
  }

  function getCanvasImageData(canvas, width, height) {
    if (canvas.width !== width || canvas.height !== height) {
      throw new Error("GIF 导出失败：检测到帧尺寸不一致。");
    }
    var context = canvas.getContext("2d");
    if (!context) throw new Error("GIF 导出失败：当前浏览器不支持 Canvas 2D。");
    return context.getImageData(0, 0, width, height).data;
  }

  function getBinIndex(r, g, b) {
    return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  }

  function pickPaletteColors(colorStats, targetCount) {
    var binsWithColor = [];
    for (var index = 0; index < colorStats.length; index++) {
      if ((colorStats[index] && colorStats[index].count) > 0) binsWithColor.push(index);
    }
    if (binsWithColor.length <= targetCount) {
      return binsWithColor.map(function (bin) {
        var entry = colorStats[bin];
        return {
          bin: bin,
          r: Math.round(entry.r / entry.count),
          g: Math.round(entry.g / entry.count),
          b: Math.round(entry.b / entry.count),
        };
      });
    }
    binsWithColor.sort(function (left, right) {
      return (colorStats[right] && colorStats[right].count || 0) -
        (colorStats[left] && colorStats[left].count || 0);
    });
    return binsWithColor.slice(0, targetCount).map(function (bin) {
      var entry = colorStats[bin];
      return {
        bin: bin,
        r: Math.round(entry.r / entry.count),
        g: Math.round(entry.g / entry.count),
        b: Math.round(entry.b / entry.count),
      };
    });
  }

  function findNearestPaletteColorIndex(r, g, b, paletteEntries) {
    var nearestIndex = paletteEntries[0] ? paletteEntries[0].index : 0;
    var nearestDistance = Number.POSITIVE_INFINITY;
    for (var i = 0; i < paletteEntries.length; i++) {
      var entry = paletteEntries[i];
      var dr = r - entry.r;
      var dg = g - entry.g;
      var db = b - entry.b;
      var distance = dr * dr + dg * dg + db * db;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = entry.index;
        if (distance === 0) break;
      }
    }
    return nearestIndex;
  }

  function buildPalette(frameData, options) {
    var colorStats = [];
    for (var i = 0; i < COLOR_BIN_COUNT; i++) {
      colorStats.push({ count: 0, r: 0, g: 0, b: 0 });
    }
    var hasTransparentPixel = false;
    var totalPixels = 0;
    for (var fi = 0; fi < frameData.length; fi++) {
      totalPixels += frameData[fi].length / 4;
    }
    var sampleStride = Math.max(1, Math.floor(Math.sqrt(totalPixels / DEFAULT_SAMPLE_PIXEL_BUDGET)));
    for (var fdi = 0; fdi < frameData.length; fdi++) {
      var data = frameData[fdi];
      for (var index = 0; index < data.length; index += 4 * sampleStride) {
        var alpha = data[index + 3] != null ? data[index + 3] : 255;
        if (options.transparent && alpha < options.alphaThreshold) {
          hasTransparentPixel = true;
          continue;
        }
        var r = data[index] || 0;
        var g = data[index + 1] || 0;
        var b = data[index + 2] || 0;
        var bin = getBinIndex(r, g, b);
        var stat = colorStats[bin];
        stat.count += 1;
        stat.r += r;
        stat.g += g;
        stat.b += b;
      }
    }
    var reserveTransparentSlot = options.transparent && hasTransparentPixel;
    var maxPaletteColors = clamp(
      reserveTransparentSlot ? options.maxColors - 1 : options.maxColors,
      1,
      reserveTransparentSlot ? MAX_GIF_COLORS - 1 : MAX_GIF_COLORS
    );
    var pickedColors = pickPaletteColors(colorStats, maxPaletteColors);
    var tableStartIndex = reserveTransparentSlot ? 1 : 0;
    var paletteEntries = pickedColors.map(function (color, index) {
      return { index: tableStartIndex + index, r: color.r, g: color.g, b: color.b };
    });
    if (paletteEntries.length === 0) {
      paletteEntries.push({ index: tableStartIndex, r: 0, g: 0, b: 0 });
    }
    var tableSize = ceilPowerOfTwo(Math.min(MAX_GIF_COLORS, paletteEntries.length + tableStartIndex));
    var table = new Uint8Array(tableSize * 3);
    if (reserveTransparentSlot) {
      table[0] = 0; table[1] = 0; table[2] = 0;
    }
    for (var pe = 0; pe < paletteEntries.length; pe++) {
      var entry = paletteEntries[pe];
      var tableOffset = entry.index * 3;
      table[tableOffset] = entry.r;
      table[tableOffset + 1] = entry.g;
      table[tableOffset + 2] = entry.b;
    }
    var binToPalette = new Int16Array(COLOR_BIN_COUNT);
    binToPalette.fill(-1);
    for (var pc = 0; pc < pickedColors.length; pc++) {
      var color = pickedColors[pc];
      for (var pe2 = 0; pe2 < paletteEntries.length; pe2++) {
        var mapped = paletteEntries[pe2];
        if (mapped.r === color.r && mapped.g === color.g && mapped.b === color.b) {
          binToPalette[color.bin] = mapped.index;
          break;
        }
      }
    }
    return {
      table: table,
      paletteEntries: paletteEntries,
      binToPalette: binToPalette,
      transparentIndex: reserveTransparentSlot ? 0 : null,
    };
  }

  function buildIndexedPixels(data, palette, alphaThreshold) {
    var pixelCount = data.length / 4;
    var indexed = new Uint8Array(pixelCount);
    for (var pixel = 0; pixel < pixelCount; pixel++) {
      var offset = pixel * 4;
      var alpha = data[offset + 3] != null ? data[offset + 3] : 255;
      if (palette.transparentIndex !== null && alpha < alphaThreshold) {
        indexed[pixel] = palette.transparentIndex;
        continue;
      }
      var r = data[offset] || 0;
      var g = data[offset + 1] || 0;
      var b = data[offset + 2] || 0;
      var bin = getBinIndex(r, g, b);
      var cachedIndex = palette.binToPalette[bin];
      if (cachedIndex >= 0) {
        indexed[pixel] = cachedIndex;
        continue;
      }
      var nearest = findNearestPaletteColorIndex(r, g, b, palette.paletteEntries);
      palette.binToPalette[bin] = nearest;
      indexed[pixel] = nearest;
    }
    return indexed;
  }

  function writeSubBlocks(writer, data) {
    var offset = 0;
    while (offset < data.length) {
      var chunkSize = Math.min(255, data.length - offset);
      writer.writeByte(chunkSize);
      writer.writeBytes(data.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    }
    writer.writeByte(0);
  }

  function encodeLzwIndices(indexedPixels, minCodeSize) {
    var bitWriter = new BitWriter();
    var clearCode = 1 << minCodeSize;
    var endCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var dictionarySize = endCode + 1;
    var hasPreviousLiteral = false;
    function resetDictionary() {
      codeSize = minCodeSize + 1;
      dictionarySize = endCode + 1;
      hasPreviousLiteral = false;
    }
    bitWriter.write(clearCode, codeSize);
    resetDictionary();
    for (var i = 0; i < indexedPixels.length; i++) {
      var literalCode = indexedPixels[i];
      if (hasPreviousLiteral && dictionarySize > MAX_LZW_CODE) {
        bitWriter.write(clearCode, codeSize);
        resetDictionary();
      }
      bitWriter.write(literalCode, codeSize);
      if (hasPreviousLiteral) {
        dictionarySize += 1;
        if (dictionarySize === (1 << codeSize) && codeSize < MAX_GIF_CODE_SIZE) {
          codeSize += 1;
        }
      }
      hasPreviousLiteral = true;
    }
    bitWriter.write(endCode, codeSize);
    return bitWriter.finish();
  }

  function writeNetscapeLoopExtension(writer, loopCount) {
    writer.writeByte(0x21);
    writer.writeByte(0xff);
    writer.writeByte(0x0b);
    writer.writeBytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
    writer.writeByte(0x03);
    writer.writeByte(0x01);
    writer.writeShort(clamp(loopCount, 0, 65535));
    writer.writeByte(0x00);
  }

  function writeGraphicControlExtension(writer, delayCs, transparentIndex) {
    var transparentFlag = transparentIndex !== null ? 1 : 0;
    var disposalMethod = transparentIndex !== null ? 2 : 0;
    var packed = (disposalMethod << 2) | transparentFlag;
    writer.writeByte(0x21);
    writer.writeByte(0xf9);
    writer.writeByte(0x04);
    writer.writeByte(packed);
    writer.writeShort(clamp(delayCs, 1, 65535));
    writer.writeByte(transparentIndex != null ? transparentIndex : 0);
    writer.writeByte(0x00);
  }

  function writeImageDescriptor(writer, width, height) {
    writer.writeByte(0x2c);
    writer.writeShort(0);
    writer.writeShort(0);
    writer.writeShort(width);
    writer.writeShort(height);
    writer.writeByte(0x00);
  }

  function getTableBitSize(table) {
    return Math.max(1, Math.ceil(Math.log2(Math.max(2, table.length / 3))));
  }

  function getDelayFromFrames(frames, fallbackFps, index) {
    var fallbackSeconds = 1 / Math.max(fallbackFps, 1);
    var nextFrame = frames[index + 1];
    var currentFrame = frames[index];
    if (nextFrame && nextFrame.time > currentFrame.time) {
      return clamp(Math.round((nextFrame.time - currentFrame.time) * 100), 1, 65535);
    }
    if (index > 0) {
      var previousFrame = frames[index - 1];
      if (currentFrame.time > previousFrame.time) {
        return clamp(Math.round((currentFrame.time - previousFrame.time) * 100), 1, 65535);
      }
    }
    return clamp(Math.round(fallbackSeconds * 100), 1, 65535);
  }

  function deriveGifFrameDelays(frames, fallbackFps) {
    var delays = [];
    for (var i = 0; i < frames.length; i++) {
      delays.push(getDelayFromFrames(frames, fallbackFps, i));
    }
    return delays;
  }

  async function buildAnimatedGif(frames, options) {
    if (!frames.length) throw new Error("GIF 导出失败：请先生成至少 1 帧。");
    var width = frames[0].image.width || 0;
    var height = frames[0].image.height || 0;
    if (width <= 0 || height <= 0) throw new Error("GIF 导出失败：帧尺寸无效。");
    var normalizedFps = clamp(options.fps, 1, 60);
    var normalizedMaxColors = clamp(Math.floor(options.maxColors || MAX_GIF_COLORS), 2, MAX_GIF_COLORS);
    var alphaThreshold = clamp(options.alphaThreshold || DEFAULT_ALPHA_THRESHOLD, 1, 255);
    var transparent = Boolean(options.transparent);
    var frameData = [];
    for (var index = 0; index < frames.length; index++) {
      frameData.push(getCanvasImageData(frames[index].image, width, height));
      if (options.onProgress) {
        options.onProgress({ phase: "palette", current: index + 1, total: frames.length });
      }
      if ((index + 1) % PROGRESS_YIELD_INTERVAL === 0 && index < frames.length - 1) {
        await new Promise(function (r) { window.setTimeout(r, 0); });
      }
    }
    var palette = buildPalette(frameData, {
      maxColors: normalizedMaxColors,
      transparent: transparent,
      alphaThreshold: alphaThreshold,
    });
    var tableBitSize = getTableBitSize(palette.table);
    var colorTableSizeValue = clamp(tableBitSize - 1, 0, 7);
    var lzwMinCodeSize = Math.max(2, tableBitSize);
    var delays = deriveGifFrameDelays(frames, normalizedFps);
    var writer = new ByteWriter();
    writer.writeBytes(Array.from(GIF_SIGNATURE).map(function (c) { return c.charCodeAt(0); }));
    writer.writeShort(width);
    writer.writeShort(height);
    writer.writeByte(0x80 | (7 << 4) | colorTableSizeValue);
    writer.writeByte(0);
    writer.writeByte(0);
    writer.writeBytes(palette.table);
    if (options.loop !== false) writeNetscapeLoopExtension(writer, 0);
    for (var fi = 0; fi < frameData.length; fi++) {
      var indexedPixels = buildIndexedPixels(frameData[fi], palette, alphaThreshold);
      var lzwData = encodeLzwIndices(indexedPixels, lzwMinCodeSize);
      writeGraphicControlExtension(writer, delays[fi] || 10, palette.transparentIndex);
      writeImageDescriptor(writer, width, height);
      writer.writeByte(lzwMinCodeSize);
      writeSubBlocks(writer, lzwData);
      if (options.onProgress) {
        options.onProgress({ phase: "encode", current: fi + 1, total: frameData.length });
      }
      if ((fi + 1) % PROGRESS_YIELD_INTERVAL === 0 && fi < frameData.length - 1) {
        await new Promise(function (r) { window.setTimeout(r, 0); });
      }
    }
    writer.writeByte(GIF_TRAILER);
    var bytes = writer.toUint8Array().slice();
    var buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Blob([buffer], { type: "image/gif" });
  }

  /* ---- Spine export ---- */

  function getSpineJsonFileName(baseName) {
    return getBaseFileName(baseName) + "-spine.json";
  }

  function getSpineZipFileName(baseName) {
    return getBaseFileName(baseName) + "-spine.zip";
  }

  function getSpineFrameStem(baseName, index) {
    var frameNumber = String(index + 1).padStart(3, "0");
    return getBaseFileName(baseName) + "-spine-" + frameNumber;
  }

  function getSpineFrameFileName(baseName, index) {
    return "images/" + getSpineFrameStem(baseName, index) + ".png";
  }

  function buildSpineReadme(draft, options) {
    return [
      "Spine 动画导出说明",
      "",
      "此 ZIP 包包含：",
      "- " + getSpineJsonFileName(draft.baseName),
      "- images/*.png",
      "",
      "导入建议：",
      "1. 将 ZIP 解压到本地目录。",
      "2. 在 Spine 中使用 Import Data 或作为新 skeleton 导入 JSON。",
      "3. 保持 JSON 文件与 images 文件夹的相对路径不变。",
      "",
      "当前导出参数：",
      "- skeleton: " + options.skeletonName,
      "- animation: " + options.animationName,
      "- slot: " + options.slotName,
      "- fps: " + options.fps,
      "- frames: " + draft.frames.length,
      "- transparent: " + (draft.transparent ? "yes" : "no"),
    ].join("\n");
  }

  function buildSpineSkeletonData(draft, options) {
    var attachmentEntries = {};
    for (var index = 0; index < draft.frames.length; index++) {
      var attachmentName = getSpineFrameStem(draft.baseName, index);
      attachmentEntries[attachmentName] = {
        type: "region",
        path: "images/" + attachmentName,
        x: 0,
        y: 0,
        width: draft.width,
        height: draft.height,
      };
    }
    var attachmentTimeline = [];
    for (var ti = 0; ti < draft.frames.length - 1; ti++) {
      attachmentTimeline.push({
        time: Number(((ti + 1) / Math.max(options.fps, 1)).toFixed(6)),
        name: getSpineFrameStem(draft.baseName, ti + 1),
      });
    }
    var slotAttachments = {};
    slotAttachments[options.slotName] = attachmentEntries;
    var animSlots = {};
    animSlots[options.slotName] = { attachment: attachmentTimeline };
    var animations = {};
    animations[options.animationName] = { slots: animSlots };
    return {
      skeleton: {
        name: options.skeletonName,
        spine: "4.2.0",
        images: "./images/",
      },
      bones: [{ name: "root" }],
      slots: [{
        name: options.slotName,
        bone: "root",
        attachment: getSpineFrameStem(draft.baseName, 0),
      }],
      skins: [{ name: "default", attachments: slotAttachments }],
      animations: animations,
    };
  }

  async function buildSpineBundleZip(draft, options) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip 未加载，无法导出 Spine ZIP。");
    }
    var zip = new JSZip();
    var jsonFileName = getSpineJsonFileName(draft.baseName);
    var jsonData = buildSpineSkeletonData(draft, options);
    zip.file(jsonFileName, JSON.stringify(jsonData, null, 2));
    zip.file("README.txt", buildSpineReadme(draft, options));
    for (var index = 0; index < draft.frames.length; index++) {
      var frame = draft.frames[index];
      var blob = await canvasToBlob(frame.image);
      zip.file(getSpineFrameFileName(draft.baseName, index), blob);
    }
    return zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  global.VideoSpriteExport = {
    getLayoutMetrics: getLayoutMetrics,
    getSheetAppearance: getSheetAppearance,
    renderFrameSheet: renderFrameSheet,
    getBaseFileName: getBaseFileName,
    getSheetFileName: getSheetFileName,
    getZipFileName: getZipFileName,
    getGifFileName: getGifFileName,
    getSpineZipFileName: getSpineZipFileName,
    buildTransparentFramesZip: buildTransparentFramesZip,
    buildAnimatedGif: buildAnimatedGif,
    buildSpineBundleZip: buildSpineBundleZip,
    downloadBlob: downloadBlob,
    canvasToBlob: canvasToBlob,
  };
})(typeof window !== "undefined" ? window : this);
