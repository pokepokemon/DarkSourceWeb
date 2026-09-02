/**
 * 伪像素规整（AI Pixel Convert）— 参数默认值与三档分级定义
 * 默认值对齐参考项目 qianmozhiyu/AIPixelImageConversionTool 的 PipelineParams（src/pipeline.py）
 */
(function (global) {
  "use strict";

  // 全部参数默认值（与参考项目 PipelineParams 对齐）
  var DEFAULTS = {
    // 降噪
    enableAiDenoise: true,
    aiDenoiseMethod: "nl_means", // none / nl_means / tv_chambolle / bilateral
    aiDenoiseStrength: 0.5,
    enableClahe: false,
    claheClipLimit: 0.03,
    enableAaRemoval: false,
    aaRemovalPasses: 2,
    aaRemovalThreshold: 0.5,
    denoiseGridGuard: false,
    // 放大与锐化
    enableUpscale: false,
    upscaleFactor: 2,
    upscaleMethod: "bilinear", // nearest / bilinear / bicubic / lanczos
    enableSharpen: false,
    sharpenStrength: 0.5,
    // 网格检测
    minP: 3,
    maxP: 40,
    detectMaxSize: 2048,
    detectSignal: "gray", // gray / oklab
    enablePreQuantize: false,
    userHint: null, // { w, h } 或 null
    phaseStep: 0.1,
    snrThreshold: 8.0,
    edgeSearchTolerance: 3,
    enableSubpixelRefine: true,
    smoothStrength: 0.5,
    outlierRejectRatio: 0.5,
    enablePeakLatticeFit: true, // G3
    enableCombEnergyScore: true, // G2
    jpegGridGuard: true, // G5
    enableInteriorCleanliness: false, // P0
    enableRunsCrosscheck: true, // runs/GCD 交叉验证
    enablePlausibilityGate: true, // 高分辨率门控
    // 块提取
    extractMethod: "dominant", // median / mean / mode / kmeans / dominant
    extractCoreRatio: 0.6,
    fixSquare: false,
    // 调色板精炼
    enablePaletteRefine: true,
    paletteColors: 16,
    // alpha 半透明处理
    alphaMode: "fill" // delete / fill / keep
  };

  // 三档分级：simple / normal / expert（normal 包含 simple，expert 包含全部）
  var SIMPLE_KEYS = ["userHint", "extractMethod", "paletteColors", "alphaMode"];
  var NORMAL_KEYS = SIMPLE_KEYS.concat([
    "enableAiDenoise", "aiDenoiseMethod", "aiDenoiseStrength",
    "enableUpscale", "upscaleFactor", "upscaleMethod",
    "minP", "maxP", "snrThreshold"
  ]);

  // 参数元数据（用于 UI 动态渲染）：level 表示该参数首次出现在哪个档位
  var PARAMS = [
    // 简易档
    { key: "userHint", label: "块尺寸提示（留空自动检测）", type: "hint", level: "simple", help: "手动指定输出的逻辑分辨率（宽×高）。留空则由算法自动检测像素块大小；自动检测不准时可在此强制指定。" },
    { key: "extractMethod", label: "提取方法", type: "select", level: "simple",
      help: "每个像素块取「代表色」的算法。dominant＝取块内出现最多的颜色，最稳定；median＝中位数，抗噪好；mean＝均值，最平滑。",
      options: [
        { value: "dominant", label: "dominant（主色）" },
        { value: "median", label: "median（中位数）" },
        { value: "mean", label: "mean（均值）" },
        { value: "mode", label: "mode（众数）" },
        { value: "kmeans", label: "kmeans（聚类）" }
      ] },
    { key: "paletteColors", label: "调色板色数", type: "range", min: 2, max: 256, step: 1, level: "simple", help: "最终调色板的目标颜色数。像素画通常只用 8~64 色，颜色越少越像手工绘制的像素图。" },
    { key: "alphaMode", label: "半透明像素处理", type: "select", level: "simple",
      help: "遇到半透明像素时怎么处理。填充＝强制不透明（主体边缘扩张）；删除＝视为透明（主体边缘收缩）；保留原样＝保留半透明、不做二值化。",
      options: [
        { value: "fill", label: "填充（强制不透明）" },
        { value: "delete", label: "删除（视为透明）" },
        { value: "keep", label: "保留原样（不二值化）" }
      ] },
    // 一般档
    { key: "enableAiDenoise", label: "降噪", type: "checkbox", level: "normal", help: "是否先对图像去噪。AI 生成的图常带噪点和杂色，开启后网格检测更准确。" },
    { key: "aiDenoiseMethod", label: "降噪方法", type: "select", level: "normal",
      help: "去噪算法。nl_means＝非局部均值，最稳（默认）；tv_chambolle＝全变分，保边好；bilateral＝双边，兼顾颜色与空间。",
      options: [
        { value: "nl_means", label: "nl_means（非局部均值）" },
        { value: "tv_chambolle", label: "tv_chambolle（全变分）" },
        { value: "bilateral", label: "bilateral（双边）" },
        { value: "none", label: "none（不处理）" }
      ] },
    { key: "aiDenoiseStrength", label: "降噪强度", type: "range", min: 0, max: 1, step: 0.01, level: "normal", help: "去噪力度。越大画面越干净，但可能抹掉细节；越小越保真。" },
    { key: "enableUpscale", label: "放大", type: "checkbox", level: "normal", help: "是否先放大原图。对极小像素块可放大后再检测；一般不需要，默认关闭。" },
    { key: "upscaleFactor", label: "放大倍数", type: "range", min: 2, max: 4, step: 1, level: "normal", help: "放大的倍数（2~4 倍）。" },
    { key: "upscaleMethod", label: "放大方法", type: "select", level: "normal",
      help: "放大插值算法。nearest＝最近邻，最锐利（保像素感）；bilinear／bicubic／lanczos 依次更平滑。",
      options: [
        { value: "nearest", label: "nearest（最近邻）" },
        { value: "bilinear", label: "bilinear（双线性）" },
        { value: "bicubic", label: "bicubic（双三次）" },
        { value: "lanczos", label: "lanczos" }
      ] },
    { key: "minP", label: "最小块周期", type: "range", min: 1, max: 40, step: 1, level: "normal", help: "像素块边长的最小候选值（像素）。通常保持默认 3 即可。" },
    { key: "maxP", label: "最大块周期", type: "range", min: 1, max: 80, step: 1, level: "normal", help: "像素块边长的最大候选值（像素）。块越大需要越大上限，一般 40 够用。" },
    { key: "snrThreshold", label: "网格 SNR 阈值", type: "range", min: 0, max: 100, step: 0.5, level: "normal", help: "判定「存在像素网格」的信号强度门槛。检测不到网格时可调低；误判时可调高。" },
    // 专家档
    { key: "enableClahe", label: "CLAHE 对比度增强", type: "checkbox", level: "expert", help: "局部对比度增强，让网格边缘更清晰。对低对比度图有帮助，默认关。" },
    { key: "claheClipLimit", label: "CLAHE 裁剪限制", type: "range", min: 0.01, max: 0.1, step: 0.005, level: "expert", help: "CLAHE 的对比度裁剪上限，越大对比度增强越强。" },
    { key: "enableAaRemoval", label: "抗锯齿消除", type: "checkbox", level: "expert", help: "消除像素块边缘的抗锯齿半透明像素，让边缘更干净利落。" },
    { key: "aaRemovalPasses", label: "AA 消除迭代次数", type: "range", min: 1, max: 5, step: 1, level: "expert", help: "抗锯齿消除的迭代轮数，越多越干净但越慢。" },
    { key: "aaRemovalThreshold", label: "AA 两主色距离阈值", type: "range", min: 0, max: 2, step: 0.05, level: "expert", help: "判定「两个主色」的颜色距离门槛，决定多明显的边缘会被当作抗锯齿处理。" },
    { key: "denoiseGridGuard", label: "降噪-检测耦合保护", type: "checkbox", level: "expert", help: "若去噪把网格边缘也一起抹掉了，自动减半去噪力度重试，保护检测。" },
    { key: "enableSharpen", label: "锐化（unsharp）", type: "checkbox", level: "expert", help: "放大后锐化，让边缘更清晰。默认关。" },
    { key: "sharpenStrength", label: "锐化强度", type: "range", min: 0, max: 1, step: 0.01, level: "expert", help: "锐化强度，越大边缘越锐利。" },
    { key: "detectMaxSize", label: "检测输入最大边长", type: "range", min: 512, max: 4096, step: 64, level: "expert", help: "网格检测输入图的最大边长，超过会提示。超大图检测会很慢。" },
    { key: "detectSignal", label: "检测信号模式", type: "select", level: "expert",
      help: "用什么信号做网格检测。gray＝灰度（默认）；oklab＝色差，对靠颜色区分像素块的图更准。",
      options: [
        { value: "gray", label: "gray（灰度）" },
        { value: "oklab", label: "oklab（色差）" }
      ] },
    { key: "enablePreQuantize", label: "检测前预量化", type: "checkbox", level: "expert", help: "检测前先粗略量化颜色，减少噪点干扰。" },
    { key: "phaseStep", label: "相位扫描步长", type: "range", min: 0.05, max: 1, step: 0.05, level: "expert", help: "网格相位搜索的步长，越小越精细但越慢。" },
    { key: "edgeSearchTolerance", label: "共享边界搜索半径", type: "range", min: 1, max: 8, step: 1, level: "expert", help: "相邻块共享边界时，搜索边缘峰的半径（像素）。" },
    { key: "enableSubpixelRefine", label: "亚像素精炼", type: "checkbox", level: "expert", help: "把整数像素的块边界精炼到亚像素精度，对非整数块（如 7.5px）更准。" },
    { key: "smoothStrength", label: "全局正则化强度", type: "range", min: 0, max: 1, step: 0.05, level: "expert", help: "网格全局正则化的强度，越大网格越整齐，但越偏离真实边缘。" },
    { key: "outlierRejectRatio", label: "离群间距剔除比例", type: "range", min: 0.1, max: 1, step: 0.05, level: "expert", help: "剔除明显偏离的网格间距的比例，越大剔除越激进。" },
    { key: "enablePeakLatticeFit", label: "G3 峰值格点拟合", type: "checkbox", level: "expert", help: "用峰值格点拟合把整数周期精炼为浮点，处理非整数像素块（如 7.5px）。" },
    { key: "enableCombEnergyScore", label: "G2 梳状能量终审", type: "checkbox", level: "expert", help: "梳状能量集中度终审，进一步确认周期与相位。" },
    { key: "jpegGridGuard", label: "G5 JPEG 网格防护", type: "checkbox", level: "expert", help: "识别并抑制 JPEG 压缩的 8×8 伪网格对检测的干扰。" },
    { key: "enableInteriorCleanliness", label: "P0 内部洁净度", type: "checkbox", level: "expert", help: "要求像素块内部干净（少边缘）。对内部有纹理的图会误判，默认关。" },
    { key: "enableRunsCrosscheck", label: "runs 整数尺度校验", type: "checkbox", level: "expert", help: "用行程长度／GCD 校验周期的整数尺度，防止倍频误判。" },
    { key: "enablePlausibilityGate", label: "高分辨率门控", type: "checkbox", level: "expert", help: "高分辨率下把 1~2px 的细纹理周期放大到合理尺度，防止误检。" },
    { key: "extractCoreRatio", label: "核心区采样比例", type: "range", min: 0.5, max: 1, step: 0.05, level: "expert", help: "取块中心多大比例的区域来算代表色，比例越小越抗边缘污染。" },
    { key: "fixSquare", label: "正方形修正", type: "checkbox", level: "expert", help: "输出逻辑分辨率若非正方形（差 1），裁掉多出的一行／列使其正方。" },
    { key: "enablePaletteRefine", label: "调色板精炼", type: "checkbox", level: "expert", help: "是否对提取结果做 K-means 调色板精简。" }
  ];

  // 由 PARAMS 推导各档 key 列表（保持声明顺序，供 UI 按档渲染）
  function keysForLevel(level) {
    var order = ["simple", "normal", "expert"];
    var maxIdx = order.indexOf(level);
    return PARAMS.filter(function (p) {
      return order.indexOf(p.level) <= maxIdx;
    }).map(function (p) { return p.key; });
  }

  var LEVEL_KEYS = {
    simple: keysForLevel("simple"),
    normal: keysForLevel("normal"),
    expert: keysForLevel("expert")
  };

  function paramMeta(key) {
    for (var i = 0; i < PARAMS.length; i++) if (PARAMS[i].key === key) return PARAMS[i];
    return null;
  }

  global.AiPixelConfig = {
    DEFAULTS: DEFAULTS,
    PARAMS: PARAMS,
    LEVEL_KEYS: LEVEL_KEYS,
    SIMPLE_KEYS: SIMPLE_KEYS,
    NORMAL_KEYS: NORMAL_KEYS,
    paramMeta: paramMeta
  };
})(typeof window !== "undefined" ? window : this);
