/**
 * Perfect Pixel 尺寸与导出限制（可在工具页「高级选项」中覆盖部分项）
 */
(function (global) {
  global.PerfectPixelConfig = {
    /** 处理前最长边上限；0 = 不缩小原图 */
    maxProcessDim: 8192,
    /** FFT 填充边长上限（2 的幂；大图检测需与处理边长匹配，可至 16384） */
    maxFftDim: 16384,
    /**
     * 单格在源图上的最大像素边长；0 = 按图像自适应（约 max(W,H)），不人为卡死
     * 原算法固定 20，仅适合约 512–1024 的 AI 像素图
     */
    maxPixelSize: 0,
    minPixelSize: 4,
    /** 导出倍率滑块上限 */
    maxExportScaleSlider: 512,
    /** 自定义导出倍率输入上限 */
    maxExportScale: 8192,
    /** 浏览器 canvas 单边常见上限（超限会提示） */
    maxCanvasDim: 16384,
    defaultExportScale: 4
  };
})(typeof window !== "undefined" ? window : this);
