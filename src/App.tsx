import { ChangeEvent, useMemo, useState } from "react";
import * as THREE from "three";
import {
  Box,
  CheckCircle2,
  Cpu,
  Download,
  Factory,
  FileWarning,
  Printer,
  RefreshCw,
  RotateCw,
  Ruler,
  SlidersHorizontal,
  Upload,
  WifiOff,
} from "lucide-react";
import { PartAnalysisPreview } from "./components/PartAnalysisPreview";
import { SceneViewport } from "./components/SceneViewport";
import { createFaceSelectionFromAxis, getPartTopFaceLabel } from "./components/PartFacePreview";
import { getMotionConstraints, getVibrationFeedRate } from "./geometry/bowlMotion";
import { isSideTopFace } from "./geometry/orientationGuide";
import { buildRecommendedParams, getAnalysisEnvelope, parsePartFile, validateParams } from "./geometry/partAnalysis";
import { getTrackRisePerTurn } from "./geometry/trackClimb";
import { exportBowl } from "./geometry/vibratoryBowl";
import { defaultAnimationParams, defaultParams } from "./types";
import type {
  AnimationParams,
  BowlParams,
  ExportFormat,
  PartAnalysis,
  PartFaceSelection,
  PartTopFace,
} from "./types";

type NumericParamKey = {
  [K in keyof BowlParams]-?: NonNullable<BowlParams[K]> extends number ? K : never;
}[keyof BowlParams];

type NumericAnimationParamKey = {
  [K in keyof AnimationParams]: AnimationParams[K] extends number ? K : never;
}[keyof AnimationParams];

function App() {
  const [params, setParams] = useState<BowlParams>(defaultParams);
  const [animationParams, setAnimationParams] = useState<AnimationParams>(defaultAnimationParams);
  const [analysis, setAnalysis] = useState<PartAnalysis | null>(null);
  const [partObject, setPartObject] = useState<THREE.Object3D | null>(null);
  const [selectedFace, setSelectedFace] = useState<PartFaceSelection | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("stl");
  const [status, setStatus] = useState("等待导入零件，或直接调整参数生成振动盘。");
  const [isLoading, setIsLoading] = useState(false);
  const warnings = useMemo(() => validateParams(params), [params]);
  const effectiveAmplitude = Math.round(animationParams.amplitude * (animationParams.voltage / 220) * 10) / 10;
  const previewSpeed = Math.round((animationParams.frequency / 50) * animationParams.speed * 100) / 100;
  const feedRate = Math.round(getVibrationFeedRate(animationParams));
  const manufacturing = useMemo(() => getManufacturingRecommendation(params, analysis), [params, analysis]);
  const physicsState = useMemo(() => {
    if (!analysis) return "等待零件";

    const envelope = getAnalysisEnvelope(analysis, params.partTopFace);
    const constraints = getMotionConstraints(params, envelope);
    if (!constraints.canEnterTrack) return "轨道卡料";
    if (!constraints.canPassGuide) return "导向卡料";
    if (!constraints.canExit) return "出口卡料";
    return params.partTopFace === "auto" ? "可送料" : "定向送料";
  }, [analysis, params]);
  const physicsPassed = physicsState === "可送料" || physicsState === "定向送料";

  const updateNumber = (key: NumericParamKey, value: number) => {
    setParams((current) => ({
      ...normalizeClimbParams({
        ...current,
        [key]: Number.isFinite(value) ? value : current[key],
      }),
    }));
  };

  const updateAnimationNumber = (key: NumericAnimationParamKey, value: number) => {
    setAnimationParams((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? value : current[key],
    }));
  };

  const setTrackTopFace = (axis: PartTopFace, selection = createFaceSelectionFromAxis(axis)) => {
    setSelectedFace(selection);
    setParams((current) => {
      const outletOrientation = isSideTopFace(axis)
        ? (current.outletOrientation === "frontUp" || current.outletOrientation === "backUp"
          ? "free"
          : current.outletOrientation)
        : (axis === "auto"
          && (current.outletOrientation === "sideUp" || current.outletOrientation === "standing")
          ? current.outletOrientation
          : "free");
      const next = {
        ...current,
        outletOrientation,
        partTopFace: axis,
      };

      if (!analysis) return next;

      const recommended = buildRecommendedParams(analysis, next);
      return mergeOrientationRecommendation(next, recommended);
    });
    return selection;
  };

  const handleFaceSelected = (selection: PartFaceSelection) => {
    if (selection.axis === "yNegative") {
      setStatus("下表面朝上需要真实的 180° 翻面机构；当前模型不会用动画假装完成，请改选侧面立姿或增加可识别特征。");
      return;
    }
    setTrackTopFace(selection.axis, selection);
    setStatus(isSideTopFace(selection.axis)
      ? `${selection.label} 已设为立姿目标面，已从盘底生成集料舌、单层门、回料口和连续扭转锁姿轨。`
      : `${selection.label} 已设为平躺基准面，已生成单层限高与保持导向。`);
  };

  const handleTopFaceChange = (axis: PartTopFace) => {
    if (axis === "yNegative") {
      setStatus("下表面朝上需要真实的 180° 翻面机构；当前版本暂不生成不可信的自动翻面。");
      return;
    }
    const selection = setTrackTopFace(axis);
    setStatus(selection
      ? (isSideTopFace(axis)
        ? `${selection.label} 已设为立姿目标面，已从盘底生成集料舌、单层门、回料口和连续扭转锁姿轨。`
        : `${selection.label} 已设为平躺基准面，已生成单层限高与保持导向。`)
      : "已取消指定定向目标面。");
  };

  const handleOutletOrientationChange = (outletOrientation: BowlParams["outletOrientation"]) => {
    if (outletOrientation === "frontUp" || outletOrientation === "backUp") return;
    if (outletOrientation === "sideUp" || outletOrientation === "standing") {
      const resetFlatTarget = params.partTopFace === "yPositive";
      if (resetFlatTarget) setSelectedFace(null);
      setParams((current) => {
        const next = {
          ...current,
          outletOrientation,
          partTopFace: resetFlatTarget ? "auto" as const : current.partTopFace,
        };
        return analysis
          ? mergeOrientationRecommendation(next, buildRecommendedParams(analysis, next))
          : next;
      });
      setStatus(resetFlatTarget
        ? "已改为立式出料：目标面重置为自动，并从盘底入口启用连续扭转与全程锁姿。"
        : "已从盘底入口启用集料、单层回料、0–90° 连续扭转和全程锁姿。");
      return;
    }
    setParams((current) => ({ ...current, outletOrientation }));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setStatus(`正在本地解析 ${file.name}...`);

    try {
      const parsed = await parsePartFile(file);
      const recommended = buildRecommendedParams(parsed.analysis, {
        ...params,
        partTopFace: "auto",
      });
      setPartObject(parsed.object);
      setAnalysis(parsed.analysis);
      setSelectedFace(null);
      setParams(recommended);
      setStatus("已完成零件几何分析。请在左上角点击目标面，软件将按平躺入口与目标姿态分别计算导向间隙。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模型解析失败，请检查文件格式。");
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  };

  const applyRecommendation = () => {
    if (!analysis) {
      setStatus("请先导入 STL、OBJ 或 STEP 零件模型，再应用推荐参数。");
      return;
    }

    setParams((current) => buildRecommendedParams(analysis, current));
    setStatus("已按当前定向目标面重新计算平躺入口、翻转段和锁姿槽参数。");
  };

  const resetParams = () => {
    setParams(defaultParams);
    setAnimationParams(defaultAnimationParams);
    setSelectedFace(null);
    setStatus("已恢复默认振动盘参数。");
  };

  const exportModel = () => {
    const exported = exportBowl(params, exportFormat);
    const blob = new Blob([exported.content], { type: exported.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exported.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`已在本地生成并导出 ${exported.label} 文件。`);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Cpu size={22} />
          </div>
          <div>
            <h1>振动盘3D生成器</h1>
            <p>导入零件模型，自动推荐参数，本地生成振动盘 3D 图</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="offline-badge">
            <WifiOff size={16} />
            离线本地
          </span>
          <button type="button" className="secondary-button" onClick={resetParams}>
            <RefreshCw size={16} />
            默认参数
          </button>
          <div className="export-actions">
            <select
              className="export-select"
              value={exportFormat}
              aria-label="导出格式"
              onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
            >
              <option value="stl">STL</option>
              <option value="obj">OBJ</option>
              <option value="step">STEP</option>
            </select>
            <button type="button" className="primary-button" onClick={exportModel}>
              <Download size={16} />
              导出
            </button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="side-panel left-panel">
          <section className="panel-section">
            <div className="section-title">
              <Upload size={18} />
              <h2>零件导入</h2>
            </div>
            <label className={isLoading ? "upload-zone is-loading" : "upload-zone"}>
              <input
                type="file"
                accept=".stl,.obj,.step,.stp"
                onChange={handleFileChange}
                disabled={isLoading}
              />
              <Box size={30} />
              <strong>{isLoading ? "解析中" : "选择 STL / OBJ / STEP 文件"}</strong>
              <span>模型只在本机读取，不上传网络</span>
            </label>
            <p className="status-line">{status}</p>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Ruler size={18} />
              <h2>零件分析</h2>
              {analysis && (
                <span className={physicsPassed ? "section-badge is-ok" : "section-badge is-warn"}>
                  {physicsPassed ? "通过" : physicsState}
                </span>
              )}
            </div>
            {analysis ? (
              <>
                <div className="analysis-file-row">
                  <span className="analysis-file-name">{analysis.fileName}</span>
                  <span className="analysis-file-format">{analysis.format}</span>
                </div>
                <div className="analysis-report">
                  <div className="analysis-preview-card">
                    <PartAnalysisPreview partObject={partObject} />
                    <span>零件预览</span>
                  </div>
                  <div className="analysis-measurements">
                    <Metric label="长度 X" value={analysis.length} unit="mm" />
                    <Metric label="宽度 Z" value={analysis.width} unit="mm" />
                    <Metric label="高度 Y" value={analysis.height} unit="mm" />
                    <Metric
                      label="体积"
                      value={analysis.volume ? Math.round(analysis.volume / 1000) : "未闭合"}
                      unit={analysis.volume ? "cm3" : ""}
                    />
                  </div>
                </div>
                <dl className="analysis-list">
                  <div>
                    <dt>稳定姿态</dt>
                    <dd>{analysis.stableFace}</dd>
                  </div>
                  <div>
                    <dt>推荐方向</dt>
                    <dd>{analysis.recommendedFeedDirection}</dd>
                  </div>
                  <div>
                    <dt>定向目标面</dt>
                    <dd>{selectedFace?.label ?? "未选定"}</dd>
                  </div>
                </dl>
                <button type="button" className="full-button" onClick={applyRecommendation}>
                  <RotateCw size={16} />
                  应用推荐参数
                </button>
              </>
            ) : (
              <div className="empty-state">
                <FileWarning size={24} />
                <span>导入模型后会显示尺寸、体积、姿态和推荐方向。</span>
              </div>
            )}
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Factory size={18} />
              <h2>制造建议</h2>
            </div>
            <div className="manufacturing-card">
              <div className="manufacturing-icon">
                {manufacturing.kind === "print" ? <Printer size={18} /> : <Factory size={18} />}
              </div>
              <div>
                <strong>{manufacturing.title}</strong>
                <p>{manufacturing.description}</p>
                <span>{manufacturing.process}</span>
              </div>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              {warnings.length > 0 ? <FileWarning size={18} /> : <CheckCircle2 size={18} />}
              <h2>参数检查</h2>
            </div>
            {warnings.length > 0 ? (
              <ul className="warning-list">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="ok-line">当前参数可生成完整预览。</p>
            )}
          </section>
        </aside>

        <section className="center-stage">
          <SceneViewport
            params={params}
            partObject={partObject}
            selectedFace={selectedFace}
            animationParams={animationParams}
            onFaceSelected={handleFaceSelected}
          />
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-section">
            <div className="section-title">
              <SlidersHorizontal size={18} />
              <h2>振动盘参数</h2>
            </div>

            <div className="field-group">
              <label className="field-label">盘体形状</label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={params.shape === "round" ? "is-active" : ""}
                  onClick={() => setParams((current) => ({ ...current, shape: "round" }))}
                >
                  圆形盘
                </button>
                <button
                  type="button"
                  className={params.shape === "rect" ? "is-active" : ""}
                  onClick={() => setParams((current) => ({ ...current, shape: "rect" }))}
                >
                  矩形盘
                </button>
              </div>
            </div>

            {params.shape === "round" && (
              <div className="field-group">
                <label className="field-label">侧壁轮廓</label>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={params.bowlProfile === "cylindrical" ? "is-active" : ""}
                    onClick={() => setParams((current) => ({ ...current, bowlProfile: "cylindrical" }))}
                  >
                    柱形
                  </button>
                  <button
                    type="button"
                    className={params.bowlProfile === "conical" ? "is-active" : ""}
                    onClick={() => setParams((current) => ({ ...current, bowlProfile: "conical" }))}
                  >
                    锥形
                  </button>
                </div>
              </div>
            )}

            <div className="field-grid">
              {params.shape === "round" && params.bowlProfile === "conical" && (
                <NumberField
                  label="底部直径比例"
                  unit="%"
                  value={params.conicalBottomRatio}
                  min={45}
                  max={98}
                  step={1}
                  onChange={(value) => updateNumber("conicalBottomRatio", value)}
                />
              )}
              <NumberField
                label="圆盘直径"
                unit="mm"
                value={params.bowlDiameter}
                min={160}
                max={1200}
                step={10}
                onChange={(value) => updateNumber("bowlDiameter", value)}
              />
              <NumberField
                label="盘体高度"
                unit="mm"
                value={params.bowlHeight}
                min={60}
                max={500}
                step={5}
                onChange={(value) => updateNumber("bowlHeight", value)}
              />
              <NumberField
                label="盘体长度"
                unit="mm"
                value={params.bowlLength}
                min={160}
                max={1400}
                step={10}
                onChange={(value) => updateNumber("bowlLength", value)}
              />
              <NumberField
                label="盘体宽度"
                unit="mm"
                value={params.bowlWidth}
                min={160}
                max={1400}
                step={10}
                onChange={(value) => updateNumber("bowlWidth", value)}
              />
              <NumberField
                label="壁厚"
                unit="mm"
                value={params.wallThickness}
                min={2}
                max={20}
                step={1}
                onChange={(value) => updateNumber("wallThickness", value)}
              />
              <NumberField
                label="底板厚度"
                unit="mm"
                value={params.bottomThickness}
                min={3}
                max={40}
                step={1}
                onChange={(value) => updateNumber("bottomThickness", value)}
              />
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <RotateCw size={18} />
              <h2>轨道爬升与出料</h2>
            </div>
            <div className="field-grid">
              <NumberField
                label="螺圈数量"
                unit="圈"
                value={params.trackTurns}
                min={0.5}
                max={7}
                step={0.5}
                onChange={(value) => updateNumber("trackTurns", value)}
              />
              <NumberField
                label="轨道宽度"
                unit="mm"
                value={params.trackWidth}
                min={12}
                max={180}
                step={2}
                onChange={(value) => updateNumber("trackWidth", value)}
              />
              <NumberField
                label="轨道厚度"
                unit="mm"
                value={params.trackThickness}
                min={2}
                max={30}
                step={1}
                onChange={(value) => updateNumber("trackThickness", value)}
              />
              <NumberField
                label="爬升角度"
                unit="°"
                value={params.trackClimbAngleDeg}
                min={1}
                max={12}
                step={0.5}
                onChange={(value) => updateNumber("trackClimbAngleDeg", value)}
              />
              <NumberField
                label="挡边高度"
                unit="mm"
                value={params.guardHeight}
                min={4}
                max={80}
                step={2}
                onChange={(value) => updateNumber("guardHeight", value)}
              />
              <NumberField
                label="出料口宽"
                unit="mm"
                value={params.outletWidth}
                min={12}
                max={220}
                step={2}
                onChange={(value) => updateNumber("outletWidth", value)}
              />
              <NumberField
                label="出料口高"
                unit="mm"
                value={params.outletHeight}
                min={10}
                max={160}
                step={2}
                onChange={(value) => updateNumber("outletHeight", value)}
              />
              <NumberField
                label="出料直段"
                unit="mm"
                value={params.outletLength}
                min={40}
                max={360}
                step={10}
                onChange={(value) => updateNumber("outletLength", value)}
              />
            </div>

            <div className="field-group">
              <label className="field-label">出料方向</label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={params.feedDirection === "clockwise" ? "is-active" : ""}
                  onClick={() => setParams((current) => ({ ...current, feedDirection: "clockwise" }))}
                >
                  顺时针
                </button>
                <button
                  type="button"
                  className={params.feedDirection === "counterclockwise" ? "is-active" : ""}
                  onClick={() => setParams((current) => ({ ...current, feedDirection: "counterclockwise" }))}
                >
                  逆时针
                </button>
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">定向目标面</label>
              <select
                className="field-select"
                title="决定零件经过单层、翻转和锁姿机构后哪个面朝上"
                value={params.partTopFace}
                onChange={(event) => handleTopFaceChange(event.target.value as PartTopFace)}
              >
                <option value="auto">未选定（保持平躺稳定姿态）</option>
                <option value="yPositive">{getPartTopFaceLabel("yPositive")}</option>
                <option value="yNegative" disabled>{getPartTopFaceLabel("yNegative")}（需 180° 翻面机构）</option>
                <option value="xPositive">{getPartTopFaceLabel("xPositive")}</option>
                <option value="xNegative">{getPartTopFaceLabel("xNegative")}</option>
                <option value="zPositive">{getPartTopFaceLabel("zPositive")}</option>
                <option value="zNegative">{getPartTopFaceLabel("zNegative")}</option>
              </select>
              <small className="field-help">
                {isSideTopFace(params.partTopFace)
                  ? "盘底散料 → 振动铺开 → 入口捕获 → 首圈 0–90° 翻转 → 全程锁姿"
                  : "平躺目标只做单层限高与保持；选择侧面才会生成 90° 翻转机构"}
              </small>
              <small className="field-help field-help-warning">正反面对称零件无法靠被动轨道辨面，必须增加特征量规或视觉检测。</small>
            </div>

            <div className="field-group">
              <label className="field-label">出口末端处理</label>
              <select
                className="field-select"
                title="控制出料要求；立式要求会在盘底入口后的首圈完成翻转并持续锁姿"
                value={params.outletOrientation}
                onChange={(event) => handleOutletOrientationChange(event.target.value as BowlParams["outletOrientation"])}
              >
                <option value="free">保持定向后的姿态</option>
                <option value="frontUp" disabled>末端正面朝上（需特征量规）</option>
                <option value="backUp" disabled>末端背面朝上（需 180° 翻面机构）</option>
                <option value="sideUp">末端侧面朝上</option>
                <option value="standing">末端立式出料</option>
              </select>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <RotateCw size={18} />
              <h2>振动动画</h2>
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={animationParams.enabled}
                onChange={(event) => setAnimationParams((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))}
              />
              <span>
                <strong>开启动画</strong>
                <small>按变压器参数预览振动状态</small>
              </span>
            </label>

            <div className="field-grid">
              <NumberField
                label="变压器电压"
                unit="V"
                value={animationParams.voltage}
                min={0}
                max={260}
                step={5}
                onChange={(value) => updateAnimationNumber("voltage", value)}
              />
              <NumberField
                label="振动频率"
                unit="Hz"
                value={animationParams.frequency}
                min={10}
                max={120}
                step={1}
                onChange={(value) => updateAnimationNumber("frequency", value)}
              />
              <NumberField
                label="振动幅度"
                unit="mm"
                value={animationParams.amplitude}
                min={0}
                max={12}
                step={0.2}
                onChange={(value) => updateAnimationNumber("amplitude", value)}
              />
              <NumberField
                label="速度倍率"
                unit="x"
                value={animationParams.speed}
                min={0.2}
                max={3}
                step={0.1}
                onChange={(value) => updateAnimationNumber("speed", value)}
              />
              <NumberField
                label="盘底零件数量"
                unit="个"
                value={animationParams.partCount}
                min={1}
                max={32}
                step={1}
                onChange={(value) => updateAnimationNumber("partCount", Math.round(value))}
              />
            </div>

            <div className="animation-summary">
              <span>
                有效振幅
                <strong>{effectiveAmplitude} mm</strong>
              </span>
              <span>
                预览速度
                <strong>{previewSpeed}x</strong>
              </span>
              <span>
                送料速度
                <strong>{feedRate} mm/s</strong>
              </span>
              <span>
                物理状态
                <strong>{physicsState}</strong>
              </span>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Box size={18} />
              <h2>底座参数</h2>
            </div>
            <div className="field-grid">
              <NumberField
                label="底座长度"
                unit="mm"
                value={params.baseLength}
                min={180}
                max={1600}
                step={10}
                onChange={(value) => updateNumber("baseLength", value)}
              />
              <NumberField
                label="底座宽度"
                unit="mm"
                value={params.baseWidth}
                min={180}
                max={1600}
                step={10}
                onChange={(value) => updateNumber("baseWidth", value)}
              />
              <NumberField
                label="底座高度"
                unit="mm"
                value={params.baseHeight}
                min={30}
                max={260}
                step={5}
                onChange={(value) => updateNumber("baseHeight", value)}
              />
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function mergeOrientationRecommendation(base: BowlParams, recommended: BowlParams): BowlParams {
  return {
    ...base,
    guardHeight: recommended.guardHeight,
    outletHeight: recommended.outletHeight,
    outletLength: recommended.outletLength,
    outletWidth: recommended.outletWidth,
    partFitClearance: recommended.partFitClearance,
    partFitHeight: recommended.partFitHeight,
    partFitLength: recommended.partFitLength,
    partFitWidth: recommended.partFitWidth,
    partEntryHeight: recommended.partEntryHeight,
    partEntryLength: recommended.partEntryLength,
    partEntryWidth: recommended.partEntryWidth,
    partForwardAxis: recommended.partForwardAxis,
    trackWidth: recommended.trackWidth,
  };
}

interface MetricProps {
  label: string;
  value: number | string;
  unit: string;
}

function Metric({ label, value, unit }: MetricProps) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}

function NumberField({ label, value, min, max, step, unit, onChange }: NumberFieldProps) {
  return (
    <label className="number-field">
      <span>
        {label}
        <small>{unit}</small>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default App;

function normalizeClimbParams(params: BowlParams): BowlParams {
  const risePerTurn = roundToStep(getTrackRisePerTurn(params), 5);

  return {
    ...params,
    trackRisePerTurn: risePerTurn,
  };
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function getManufacturingRecommendation(params: BowlParams, analysis: PartAnalysis | null) {
  const maxMachineSize = Math.max(
    params.bowlDiameter,
    params.bowlLength,
    params.bowlWidth,
    params.baseLength,
    params.baseWidth,
  );
  const partMax = analysis ? Math.max(analysis.length, analysis.width, analysis.height) : 0;

  if (maxMachineSize <= 360 && params.trackWidth <= 70 && partMax <= 80) {
    return {
      kind: "print" as const,
      title: "小型盘可 3D 打印试制",
      description: "适合先用尼龙、树脂或金属打印验证轨道、姿态和出料逻辑。",
      process: "建议：打印样机 → 试料 → 再做金属版",
    };
  }

  if (maxMachineSize <= 760) {
    return {
      kind: "cnc" as const,
      title: "建议 CNC 铝合金整体加工",
      description: "尺寸适中时，盘体、轨道和出料口可用铝合金锣出，再做阳极或硬化处理。",
      process: "建议：CNC 开粗 → 精加工轨道 → 表面处理",
    };
  }

  return {
    kind: "cnc" as const,
    title: "大尺寸建议分体 CNC / 焊接结构",
    description: "盘体较大时建议分段加工轨道和出料机构，底座独立做刚性支撑。",
    process: "建议：分体加工 → 定位装配 → 试料调机",
  };
}
