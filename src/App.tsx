import { ChangeEvent, useMemo, useState } from "react";
import * as THREE from "three";
import {
  Box,
  Cpu,
  Download,
  FileWarning,
  RefreshCw,
  RotateCw,
  Ruler,
  SlidersHorizontal,
  Upload,
  WifiOff,
} from "lucide-react";
import { SceneViewport } from "./components/SceneViewport";
import { buildRecommendedParams, parsePartFile, validateParams } from "./geometry/partAnalysis";
import { exportBowlToStl } from "./geometry/vibratoryBowl";
import { BowlParams, defaultParams, PartAnalysis } from "./types";

type NumericParamKey = {
  [K in keyof BowlParams]: BowlParams[K] extends number ? K : never;
}[keyof BowlParams];

function App() {
  const [params, setParams] = useState<BowlParams>(defaultParams);
  const [analysis, setAnalysis] = useState<PartAnalysis | null>(null);
  const [partObject, setPartObject] = useState<THREE.Object3D | null>(null);
  const [status, setStatus] = useState("等待导入零件，或直接调整参数生成振动盘。");
  const [isLoading, setIsLoading] = useState(false);
  const warnings = useMemo(() => validateParams(params), [params]);

  const updateNumber = (key: NumericParamKey, value: number) => {
    setParams((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? value : current[key],
    }));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setStatus(`正在本地解析 ${file.name}...`);

    try {
      const parsed = await parsePartFile(file);
      const recommended = buildRecommendedParams(parsed.analysis, params);
      setPartObject(parsed.object);
      setAnalysis(parsed.analysis);
      setParams(recommended);
      setStatus("已完成零件几何分析，并生成推荐振动盘参数。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模型解析失败，请检查文件格式。");
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  };

  const applyRecommendation = () => {
    if (!analysis) {
      setStatus("请先导入 STL 或 OBJ 零件模型，再应用推荐参数。");
      return;
    }

    setParams((current) => buildRecommendedParams(analysis, current));
    setStatus("已重新应用推荐参数。");
  };

  const resetParams = () => {
    setParams(defaultParams);
    setStatus("已恢复默认振动盘参数。");
  };

  const exportStl = () => {
    const stl = exportBowlToStl(params);
    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vibratory-bowl-generated.stl";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("已在本地生成并导出 STL 文件。");
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
          <button type="button" className="primary-button" onClick={exportStl}>
            <Download size={16} />
            导出 STL
          </button>
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
                accept=".stl,.obj"
                onChange={handleFileChange}
                disabled={isLoading}
              />
              <Box size={30} />
              <strong>{isLoading ? "解析中" : "选择 STL / OBJ 文件"}</strong>
              <span>模型只在本机读取，不上传网络</span>
            </label>
            <p className="status-line">{status}</p>
          </section>

          <section className="panel-section">
            <div className="section-title">
              <Ruler size={18} />
              <h2>零件分析</h2>
            </div>
            {analysis ? (
              <>
                <div className="analysis-name">{analysis.fileName}</div>
                <div className="metric-grid">
                  <Metric label="长度 X" value={analysis.length} unit="mm" />
                  <Metric label="宽度 Z" value={analysis.width} unit="mm" />
                  <Metric label="高度 Y" value={analysis.height} unit="mm" />
                  <Metric
                    label="体积"
                    value={analysis.volume ? Math.round(analysis.volume / 1000) : "未闭合"}
                    unit={analysis.volume ? "cm3" : ""}
                  />
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
              <FileWarning size={18} />
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
          <SceneViewport params={params} partObject={partObject} />
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
              <h2>轨道与出料</h2>
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
                label="每圈上升"
                unit="mm"
                value={params.trackRisePerTurn}
                min={4}
                max={90}
                step={2}
                onChange={(value) => updateNumber("trackRisePerTurn", value)}
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
