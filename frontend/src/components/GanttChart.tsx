import {
  AlertCircle,
  Download,
  Expand,
  GitBranch,
  ImageDown,
  LoaderCircle,
  Minus,
  MoveHorizontal,
  PinOff,
  Plus,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { toPng } from "html-to-image";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Scenario, ScheduledTask, ScheduleResult } from "../types";
import { clamp, formatSeconds } from "../utils";

const ROW_HEIGHT = 64;
const LABEL_WIDTH = 164;
const HEADER_HEIGHT = 48;
const MIN_BAR_WIDTH = 8;
const BAR_VERTICAL_PADDING = 7;

function estimateLineCount(
  text: string,
  availableWidth: number,
  fontSize: number,
): number {
  const units = Array.from(text).reduce(
    (total, character) =>
      total + (/[\u2E80-\u9FFF\uF900-\uFAFF]/.test(character) ? 1 : 0.58),
    0,
  );
  const width = units * fontSize;
  return Math.max(1, Math.ceil(width / Math.max(6, availableWidth)));
}

function calculateBarHeight(
  name: string,
  width: number,
  fontScale: number,
): number {
  const tiny = width < 30;
  const fontSize = (tiny ? 6.5 : 8.6) * fontScale;
  const horizontalPadding = tiny ? 4 : 14;
  const lines = estimateLineCount(name, width - horizontalPadding, fontSize);
  return Math.max(
    44,
    BAR_VERTICAL_PADDING +
      11 +
      lines * ((tiny ? 7.4 : 11.5) * fontScale) +
      12,
  );
}

type DragMode = "move" | "resize-start" | "resize-end";

type DragState = {
  taskId: string;
  mode: DragMode;
  originX: number;
  originStart: number;
  originEnd: number;
  originDuration: number;
  moved: boolean;
};

type TimePreview = {
  taskId: string;
  start: number;
  end: number;
  duration: number;
};

type GanttInstance = ScheduledTask & {
  instanceId: string;
  templateId: string;
  repeatIndex: number;
};

type ConnectorPath = {
  key: string;
  path: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bend: number;
  loop?: boolean;
};

function drawConnector(
  context: CanvasRenderingContext2D,
  connector: ConnectorPath,
  scale: number,
) {
  const x1 = (LABEL_WIDTH + connector.x1) * scale;
  const y1 = (HEADER_HEIGHT + connector.y1) * scale;
  const x2 = (LABEL_WIDTH + connector.x2) * scale;
  const y2 = (HEADER_HEIGHT + connector.y2) * scale;
  const bend = connector.bend * scale;

  context.beginPath();
  context.moveTo(x1, y1);
  context.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
  context.lineWidth = (connector.loop ? 1.2 : 0.9) * scale;
  context.strokeStyle = connector.loop ? "#7b61d9" : "#aab3c3";
  context.globalAlpha = connector.loop ? 0.9 : 0.7;
  context.setLineDash(
    connector.loop ? [4 * scale, 3 * scale] : [],
  );
  context.stroke();

  const arrowSize = (connector.loop ? 6 : 5) * scale;
  context.globalAlpha = connector.loop ? 0.9 : 0.7;
  context.fillStyle = connector.loop ? "#7b61d9" : "#a8b1c2";
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - arrowSize, y2 - arrowSize * 0.55);
  context.lineTo(x2 - arrowSize, y2 + arrowSize * 0.55);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
}

type Props = {
  scenario: Scenario;
  schedule: ScheduleResult | null;
  selectedTaskId: string | null;
  taskCodes: Map<string, string>;
  isScheduling: boolean;
  hasErrors: boolean;
  errorCount: number;
  repeatCount: number;
  fontScale: number;
  onSelect: (taskId: string) => void;
  onExportCsv: () => void;
  onRunOptimize: () => void;
  onNotify: (message: string, tone?: "success" | "error" | "info") => void;
  onTaskTimeChange: (
    taskId: string,
    patch: { manual_start: number; duration: number },
  ) => void;
  onClearManualMoves: () => void;
};

export default function GanttChart({
  scenario,
  schedule,
  selectedTaskId,
  taskCodes,
  isScheduling,
  hasErrors,
  errorCount,
  repeatCount,
  fontScale,
  onSelect,
  onExportCsv,
  onRunOptimize,
  onNotify,
  onTaskTimeChange,
  onClearManualMoves,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(42);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [showDependencies, setShowDependencies] = useState(true);
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [timePreview, setTimePreview] = useState<TimePreview | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const timePreviewRef = useRef<TimePreview | null>(null);
  const hasFitted = useRef(false);
  const lastFitRepeatCount = useRef(repeatCount);

  const tasksMap = new Map(scenario.tasks.map((task) => [task.id, task]));
  const scheduledMap = new Map<string, ScheduledTask>();
  for (const task of schedule?.scheduled_tasks ?? []) {
    const templateId = task.template_id ?? task.id;
    if (!scheduledMap.has(templateId)) scheduledMap.set(templateId, task);
  }
  const loopStartTaskId =
    scenario.loop?.start_task_id ?? scenario.tasks[0]?.id ?? null;
  const loopReleaseTaskId =
    scenario.loop?.release_after_task_id ??
    scenario.tasks.at(-1)?.id ??
    null;
  const batchMakespan = schedule?.metrics.makespan ?? 0;
  const instances = useMemo<GanttInstance[]>(
    () =>
      (schedule?.scheduled_tasks ?? []).map((task) => {
        const repeatIndex = (task.iteration ?? 1) - 1;
        return {
          ...task,
          instanceId: task.id,
          templateId: task.template_id ?? task.id,
          repeatIndex,
        };
      }),
    [schedule],
  );
  const instanceByTemplateIteration = useMemo(
    () =>
      new Map(
        instances.map((item) => [
          `${item.templateId}__${item.repeatIndex + 1}`,
          item,
        ]),
      ),
    [instances],
  );
  const cycleStartInstances = useMemo(
    () =>
      instances
        .filter((item) => item.templateId === loopStartTaskId)
        .sort((left, right) => left.repeatIndex - right.repeatIndex),
    [instances, loopStartTaskId],
  );
  const barLayouts = useMemo(() => {
    const result = new Map<
      string,
      { width: number; height: number; nameLines: number }
    >();
    for (const item of instances) {
      const task = tasksMap.get(item.templateId);
      if (!task) continue;
      const preview =
        item.repeatIndex === 0 && timePreview?.taskId === task.id
          ? timePreview
          : null;
      const duration = preview?.duration ?? item.duration;
      const width = Math.max(MIN_BAR_WIDTH, duration * scale);
      const height = calculateBarHeight(task.name, width, fontScale);
      const nameLines = Math.max(
        1,
        Math.round((height - BAR_VERTICAL_PADDING - 25) / (11.5 * fontScale)),
      );
      result.set(item.instanceId, { width, height, nameLines });
    }
    return result;
  }, [instances, timePreview, scale, fontScale, tasksMap]);

  const laneLayouts = useMemo(() => {
    let top = 0;
    return scenario.lanes.map((lane) => {
      const laneInstances = instances.filter(
        (instance) => instance.lane === lane.id,
      );
      const maxBarHeight = laneInstances.reduce(
        (height, instance) =>
          Math.max(
            height,
            barLayouts.get(instance.instanceId)?.height ?? 44,
          ),
        44,
      );
      const height = Math.max(ROW_HEIGHT, maxBarHeight + 20);
      const layout = { lane, instances: laneInstances, top, height };
      top += height;
      return layout;
    });
  }, [scenario.lanes, instances, barLayouts]);
  const laneLayoutMap = new Map(
    laneLayouts.map((layout) => [layout.lane.id, layout]),
  );
  const totalBodyHeight = laneLayouts.reduce(
    (total, layout) => total + layout.height,
    0,
  );
  const previewEnd = timePreview?.end ?? 0;
  const previewBatchEnd =
    timePreview && repeatCount > 1
      ? Math.max(
          previewEnd,
          Math.max(0, ...instances.map((item) => item.end)),
        )
      : previewEnd;
  const totalTime = Math.max(
    10,
    Math.ceil(Math.max(batchMakespan, previewBatchEnd) + 1),
  );
  const timelineWidth = Math.max(viewportWidth - LABEL_WIDTH - 2, totalTime * scale);
  const tickStep =
    scale >= 70 ? 1 : scale >= 38 ? 2 : scale >= 12 ? 5 : 10;
  const ticks = useMemo(
    () =>
      Array.from(
        { length: Math.floor(totalTime / tickStep) + 2 },
        (_, index) => index * tickStep,
      ),
    [tickStep, totalTime],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewportWidth(element.clientWidth);
    });
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!schedule || viewportWidth <= 0 || dragState) return;
    if (
      hasFitted.current &&
      lastFitRepeatCount.current === repeatCount
    ) {
      return;
    }
    const fit = (viewportWidth - LABEL_WIDTH - 32) / totalTime;
    setScale(Math.round(clamp(fit, 2, 60)));
    hasFitted.current = true;
    lastFitRepeatCount.current = repeatCount;
  }, [schedule, totalTime, viewportWidth, dragState, repeatCount]);

  const fitToWindow = () => {
    if (!scrollRef.current) return;
    const fit =
      (scrollRef.current.clientWidth - LABEL_WIDTH - 32) / Math.max(1, totalTime);
    setScale(Math.round(clamp(fit, 2, 96)));
  };

  const changeScale = (direction: number) => {
    setScale((current) => clamp(current + direction * 10, 2, 120));
  };

  const manualCount = scenario.tasks.filter(
    (task) => task.manual_start != null,
  ).length;

  const snapTime = (value: number) =>
    Math.round(clamp(value, 0, 600) * 10) / 10;

  const setDrag = (next: DragState | null) => {
    dragStateRef.current = next;
    setDragState(next);
  };

  const setPreview = (next: TimePreview | null) => {
    timePreviewRef.current = next;
    setTimePreview(next);
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    taskId: string,
    mode: DragMode,
  ) => {
    const item = scheduledMap.get(taskId);
    if (!item || isScheduling || repeatCount > 1) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(taskId);
    const nextDrag: DragState = {
      taskId,
      mode,
      originX: event.clientX,
      originStart: item.start,
      originEnd: item.end,
      originDuration: item.duration,
      moved: false,
    };
    setDrag(nextDrag);
    setPreview({
      taskId,
      start: item.start,
      end: item.end,
      duration: item.duration,
    });
    const bar = (event.currentTarget as HTMLElement).closest(
      ".gantt-bar",
    ) as HTMLElement | null;
    bar?.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current) return;
    const delta = (event.clientX - current.originX) / scale;
    let start = current.originStart;
    let duration = current.originDuration;

    if (current.mode === "move") {
      start = snapTime(current.originStart + delta);
    } else if (current.mode === "resize-end") {
      duration = snapTime(current.originDuration + delta);
      duration = Math.max(0.1, duration);
    } else {
      start = snapTime(
        Math.min(current.originStart + delta, current.originEnd - 0.1),
      );
      duration = snapTime(current.originEnd - start);
    }

    const nextDrag = {
      ...current,
      moved:
        current.moved || Math.abs(event.clientX - current.originX) > 2,
    };
    dragStateRef.current = nextDrag;
    setDragState(nextDrag);
    setPreview({
      taskId: current.taskId,
      start,
      end: start + duration,
      duration,
    });
  };

  const finishDrag = (commit: boolean) => {
    const current = dragStateRef.current;
    const preview = timePreviewRef.current;
    if (commit && current?.moved && preview) {
      onTaskTimeChange(current.taskId, {
        manual_start: preview.start,
        duration: preview.duration,
      });
      window.setTimeout(() => {
        if (timePreviewRef.current === preview) setPreview(null);
      }, 1200);
    } else {
      setPreview(null);
    }
    setDrag(null);
  };

  useEffect(() => {
    if (!timePreview || dragState) return;
    const item = scheduledMap.get(timePreview.taskId);
    if (
      item &&
      Math.abs(item.start - timePreview.start) < 0.05 &&
      Math.abs(item.duration - timePreview.duration) < 0.05
    ) {
      setPreview(null);
    }
  }, [schedule, dragState, scheduledMap, timePreview]);

  const dependencyPaths: ConnectorPath[] =
    showDependencies && schedule
      ? scenario.tasks
          .flatMap((target) => {
            const targetLane = laneLayoutMap.get(target.lane);
            if (!targetLane) return [];
            return target.dependencies.flatMap((sourceId) => {
              const source = tasksMap.get(sourceId);
              if (!source) return [];
              const sourceLane = laneLayoutMap.get(source.lane);
              if (!sourceLane) return [];
              return Array.from({ length: repeatCount }, (_, repeatIndex) => {
                const sourceSchedule = instanceByTemplateIteration.get(
                  `${sourceId}__${repeatIndex + 1}`,
                );
                const targetSchedule = instanceByTemplateIteration.get(
                  `${target.id}__${repeatIndex + 1}`,
                );
                if (!sourceSchedule || !targetSchedule) return null;
                const x1 =
                  (repeatIndex === 0 && timePreview?.taskId === sourceId
                    ? timePreview.end
                    : sourceSchedule.end) * scale;
                const x2 =
                  (repeatIndex === 0 && timePreview?.taskId === target.id
                    ? timePreview.start
                    : targetSchedule.start) * scale;
                const y1 = sourceLane.top + sourceLane.height / 2;
                const y2 = targetLane.top + targetLane.height / 2;
                const bend = Math.max(
                  18,
                  Math.min(52, Math.abs(x2 - x1) / 2),
                );
                return {
                  key: `${sourceId}-${target.id}-${repeatIndex}`,
                  path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
                  x1,
                  y1,
                  x2,
                  y2,
                  bend,
                };
              });
            });
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

  const loopPaths =
    showDependencies &&
    schedule &&
    repeatCount > 1 &&
    loopStartTaskId &&
    loopReleaseTaskId
      ? Array.from(
          { length: repeatCount - 1 },
          (_, index) => {
            const iteration = index + 1;
            const releaseInstance = instanceByTemplateIteration.get(
              `${loopReleaseTaskId}__${iteration}`,
            );
            const nextStartInstance = instanceByTemplateIteration.get(
              `${loopStartTaskId}__${iteration + 1}`,
            );
            if (!releaseInstance || !nextStartInstance) return null;
            const releaseTask = tasksMap.get(loopReleaseTaskId);
            const startTask = tasksMap.get(loopStartTaskId);
            if (!releaseTask || !startTask) return null;
            const sourceLane = laneLayoutMap.get(releaseTask.lane);
            const targetLane = laneLayoutMap.get(startTask.lane);
            if (!sourceLane || !targetLane) return null;
            const x1 = releaseInstance.end * scale;
            const x2 = nextStartInstance.start * scale;
            const y1 = sourceLane.top + sourceLane.height / 2;
            const y2 = targetLane.top + targetLane.height / 2;
            const bend = Math.max(
              18,
              Math.min(52, Math.abs(x2 - x1) / 2),
            );
            return {
              key: `loop-${iteration}`,
              path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
              x1,
              y1,
              x2,
              y2,
              bend,
              loop: true,
            };
          },
        ).filter((item): item is NonNullable<typeof item> => item !== null)
      : [];

  const gridStyle = {
    "--major-grid": `${scale * tickStep}px`,
    "--minor-grid": `${scale}px`,
  } as CSSProperties;

  const exportGanttPng = async () => {
    const node = exportRef.current;
    if (!node || !schedule || isExportingImage) return;
    setIsExportingImage(true);
    try {
      await document.fonts?.ready;
      const width = Math.ceil(node.scrollWidth);
      const height = Math.ceil(node.scrollHeight);
      const pixelRatio = width > 6500 ? 1 : 2;
      const dataUrl = await toPng(node, {
        cacheBust: true,
        skipFonts: true,
        backgroundColor: "#ffffff",
        pixelRatio,
        width,
        height,
        filter: (element) =>
          !(
            element instanceof SVGElement &&
            element.classList.contains("dependency-layer")
          ),
        style: {
          width: `${width}px`,
          height: `${height}px`,
          overflow: "visible",
        },
      });
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0);
      if (context) {
        context.save();
        context.lineCap = "round";
        const outputScale = canvas.width / width;
        for (const connector of [...dependencyPaths, ...loopPaths]) {
          if (connector) drawConnector(context, connector, outputScale);
        }
        context.restore();
      }
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replaceAll(":", "-");
      const link = document.createElement("a");
      link.download = `ACTO-甘特图-${timestamp}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      onNotify("甘特图 PNG 已导出", "success");
    } catch (error) {
      onNotify(
        `PNG 导出失败：${error instanceof Error ? error.message : "未知错误"}`,
        "error",
      );
    } finally {
      setIsExportingImage(false);
    }
  };

  return (
    <section className="gantt-card">
      <header className="gantt-toolbar">
        <div className="gantt-title">
          <div className="gantt-icon">
            <ScanLine size={18} />
          </div>
          <div>
            <div className="gantt-title-line">
              <h2>动作甘特图</h2>
              <span className="gantt-repeat-badge">单循环模板 ×{repeatCount}</span>
              {isScheduling ? (
                <span className="solve-status solving">
                  <LoaderCircle size={12} className="spin" />
                  求解中
                </span>
              ) : hasErrors ? (
                <span className="solve-status solve-status-error">
                  <AlertCircle size={12} />
                  约束异常 · {errorCount} 项
                </span>
              ) : (
                <span className="solve-status">
                  <span className="status-dot" />
                  约束已满足
                </span>
              )}
            </div>
            <p>
              {dragState
                ? "拖动调整开始时间；拖动两端调整动作时长"
                : hasErrors
                ? "排程未更新 · 请根据上方异常信息修复当前工作表"
                : schedule
                ? `${schedule.algorithm} · ${schedule.solve_time_ms} ms · 单循环模板 ×${repeatCount}`
                : "正在读取排程结果"}
            </p>
          </div>
        </div>

        <div className="gantt-toolbar-actions">
          <button
            type="button"
            className={`toolbar-toggle ${showDependencies ? "active" : ""}`}
            onClick={() => setShowDependencies((value) => !value)}
          >
            <GitBranch size={14} />
            依赖线
          </button>
          <div className="zoom-control" aria-label="时间轴缩放">
            <button type="button" onClick={() => changeScale(-1)} title="缩小">
              <Minus size={14} />
            </button>
            <span>{Math.round(scale)} px/s</span>
            <button type="button" onClick={() => changeScale(1)} title="放大">
              <Plus size={14} />
            </button>
          </div>
          <button
            type="button"
            className="icon-only-tool"
            onClick={fitToWindow}
            title="适配窗口"
          >
            <Expand size={15} />
          </button>
          <button
            type="button"
            className="icon-only-tool"
            onClick={onExportCsv}
            title="导出 CSV"
          >
            <Download size={15} />
          </button>
          <button
            type="button"
            className="toolbar-toggle png-export-button"
            onClick={() => void exportGanttPng()}
            disabled={!schedule || isExportingImage}
            title="导出完整甘特图为 PNG"
          >
            {isExportingImage ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <ImageDown size={13} />
            )}
            {isExportingImage ? "导出中" : "PNG"}
          </button>
          {manualCount > 0 && (
            <button
              type="button"
              className="toolbar-manual-clear"
              onClick={onClearManualMoves}
              title="清除全部手动调整"
            >
              <PinOff size={13} />
              清除手动 {manualCount}
            </button>
          )}
          <button
            type="button"
            className="optimize-button"
            onClick={onRunOptimize}
            disabled={isScheduling}
          >
            <Sparkles size={14} />
            重新优化
          </button>
        </div>
      </header>

      <div className="gantt-scroll" ref={scrollRef}>
        <div
          className="gantt-canvas"
          ref={exportRef}
          style={{ width: LABEL_WIDTH + timelineWidth + 2 }}
        >
          <div className="gantt-header">
            <div className="gantt-corner">执行单元</div>
            <div
              className="gantt-time-axis"
              style={{ width: timelineWidth, ...gridStyle }}
            >
              {ticks.map((tick) => (
                <div
                  className="time-tick"
                  key={tick}
                  style={{ left: tick * scale }}
                >
                  <span>{tick}s</span>
                </div>
              ))}
              {schedule &&
                cycleStartInstances.map((startInstance, repeatIndex) => (
                  <div
                    className="cycle-band-label"
                    key={`cycle-label-${repeatIndex}`}
                    style={{ left: startInstance.start * scale + 5 }}
                  >
                    第 {repeatIndex + 1} 次
                  </div>
                ))}
              {schedule && (
                <div
                  className="ct-flag"
                  style={{ left: batchMakespan * scale }}
                  title={`批次总时间 ${formatSeconds(batchMakespan, 2)}`}
                >
                  总 CT
                </div>
              )}
            </div>
          </div>

          <div
            className="gantt-body"
            style={{ height: totalBodyHeight }}
          >
            {showDependencies && (
              <svg
                className="dependency-layer"
                width={timelineWidth}
                height={totalBodyHeight}
                style={{ left: LABEL_WIDTH, overflow: "visible" }}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="dependency-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L6,3 z" fill="#a8b1c2" />
                  </marker>
                  <marker
                    id="loop-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L0,6 L6,3 z" fill="#7b61d9" />
                  </marker>
                </defs>
                {dependencyPaths.map(
                  (item) =>
                    item && (
                      <path
                        key={item.key}
                        d={item.path}
                        fill="none"
                        stroke="#aab3c3"
                        strokeWidth="0.9"
                        strokeOpacity="0.7"
                        markerEnd="url(#dependency-arrow)"
                      />
                    ),
                )}
                {loopPaths.map(
                  (item) =>
                    item && (
                      <path
                        key={item.key}
                        d={item.path}
                        className="loop-link"
                        fill="none"
                        stroke="#7b61d9"
                        strokeWidth="1.2"
                        strokeOpacity="0.9"
                        strokeDasharray="4 3"
                        markerEnd="url(#loop-arrow)"
                      />
                    ),
                )}
              </svg>
            )}

            {schedule && (
              <>
                {cycleStartInstances.slice(1).map((startInstance, index) => (
                  <div
                    className="cycle-divider-line"
                    key={`cycle-divider-${index}`}
                    style={{
                      left: LABEL_WIDTH + startInstance.start * scale,
                      height: totalBodyHeight,
                    }}
                  />
                ))}
                <div
                  className="makespan-line"
                  style={{
                    left: LABEL_WIDTH + batchMakespan * scale,
                    height: totalBodyHeight,
                  }}
                />
              </>
            )}

            {laneLayouts.map(({ lane, instances: laneInstances, height }) => {
              const laneTemplateTasks = scenario.tasks.filter(
                (task) => task.lane === lane.id,
              );
              return (
                <div
                  className="gantt-row"
                  key={lane.id}
                  style={{ height }}
                >
                  <div className="lane-label" style={{ height }}>
                    <span
                      className="lane-monogram"
                      style={{
                        color: lane.color,
                        background: `${lane.color}14`,
                      }}
                    >
                      {lane.short_name}
                    </span>
                    <span>
                      <strong>{lane.name}</strong>
                      <small>
                        {laneTemplateTasks.length} 个动作 ×{repeatCount} ·{" "}
                        {(laneTemplateTasks
                          .reduce((sum, task) => sum + task.duration, 0)
                          * repeatCount
                        ).toFixed(1)}
                        s
                      </small>
                    </span>
                  </div>
                  <div
                    className="gantt-track"
                    style={
                      {
                        width: timelineWidth,
                        height,
                        "--lane-tint": `${lane.color}0d`,
                        ...gridStyle,
                      } as CSSProperties
                    }
                  >
                    {laneInstances.map((item) => {
                      const task = tasksMap.get(item.templateId);
                      if (!task) return null;
                      const preview =
                        item.repeatIndex === 0 &&
                        timePreview?.taskId === task.id
                          ? timePreview
                          : null;
                      const displayStart = preview?.start ?? item.start;
                      const displayEnd = preview?.end ?? item.end;
                      const displayDuration =
                        preview?.duration ?? item.duration;
                      const barLayout = barLayouts.get(item.instanceId);
                      const width = barLayout?.width ?? MIN_BAR_WIDTH;
                      const barHeight = barLayout?.height ?? 44;
                      const barTop = Math.max(
                        8,
                        (height - barHeight) / 2,
                      );
                      const tiny = width < 30;
                      const compact = width < 86;
                      const selected = task.id === selectedTaskId;
                      const code = taskCodes.get(task.id) ?? "—";
                      const activelyDragging =
                        item.repeatIndex === 0 &&
                        dragState?.taskId === task.id &&
                        dragState.moved;
                      const manual =
                        task.manual_start != null || preview != null;
                      const isLoopStart = task.id === loopStartTaskId;
                      const isLoopEnd = task.id === loopReleaseTaskId;
                      const draggable =
                        repeatCount === 1 && item.repeatIndex === 0;
                      return (
                        <Fragment key={item.instanceId}>
                          {preview && dragState && (
                            <>
                              <div
                                className="drag-start-guide"
                                style={{ left: preview.start * scale }}
                              />
                              <div
                                className="drag-time-bubble"
                                style={{
                                  left: Math.min(
                                    preview.start * scale,
                                    Math.max(0, timelineWidth - 128),
                                  ),
                                }}
                              >
                                {preview.start.toFixed(1)} →{" "}
                                {preview.end.toFixed(1)}s
                              </div>
                            </>
                          )}
                          <button
                            type="button"
                            className={[
                              "gantt-bar",
                              compact ? "compact" : "",
                              tiny ? "tiny" : "",
                              selected ? "selected" : "",
                              item.critical ? "critical" : "",
                              manual ? "manual" : "",
                              activelyDragging ? "dragging" : "",
                              item.repeatIndex > 0 ? "repeat-instance" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              left: displayStart * scale,
                              top: barTop,
                              width,
                              height: barHeight,
                              background: task.color,
                              "--bar-color": task.color,
                            } as CSSProperties}
                            onClick={() => onSelect(task.id)}
                            onPointerDown={
                              draggable
                                ? (event) =>
                                    beginDrag(event, task.id, "move")
                                : undefined
                            }
                            onPointerMove={draggable ? moveDrag : undefined}
                            onPointerUp={
                              draggable
                                ? () => finishDrag(true)
                                : undefined
                            }
                            onPointerCancel={
                              draggable
                                ? () => finishDrag(false)
                                : undefined
                            }
                            title={`${code} · ${task.name}${isLoopStart ? " · 循环开始" : ""}${isLoopEnd ? " · 循环结束/回跳" : ""}\n第 ${item.repeatIndex + 1} 次 · ${displayStart.toFixed(2)}s → ${displayEnd.toFixed(2)}s · ${displayDuration.toFixed(1)}s${manual ? " · 手动调整" : ""}${draggable ? "\n拖动移动，拖动边缘调整时长" : "\n重复实例由模板和重复次数生成"}`}
                          >
                            <span className="bar-content">
                              <span className="bar-meta-line">
                                <span className="bar-code">
                                  {code}
                                  {item.repeatIndex > 0 && (
                                    <em>·{item.repeatIndex + 1}</em>
                                  )}
                                </span>
                                {isLoopStart && (
                                  <span className="bar-loop-role start">头</span>
                                )}
                                {isLoopEnd && (
                                  <span className="bar-loop-role end">尾</span>
                                )}
                              </span>
                              <span className="bar-name">
                                {task.name}
                              </span>
                            </span>
                            {!compact && (
                              <span className="bar-duration">
                                {displayDuration.toFixed(1)}s
                              </span>
                            )}
                            {item.critical && (
                              <span className="critical-rail" />
                            )}
                            {manual && <span className="manual-pin" />}
                            {selected && (
                              <span className="selected-handle" />
                            )}
                            {draggable && (
                              <>
                                <span
                                  className="bar-resize-handle resize-left"
                                  onPointerDown={(event) =>
                                    beginDrag(
                                      event,
                                      task.id,
                                      "resize-start",
                                    )
                                  }
                                />
                                <span
                                  className="bar-resize-handle resize-right"
                                  onPointerDown={(event) =>
                                    beginDrag(event, task.id, "resize-end")
                                  }
                                />
                              </>
                            )}
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="gantt-footer">
        <div className="legend">
          <span>
            <i className="legend-critical" />
            关键路径
          </span>
          <span>
            <i className="legend-dependency" />
            前置依赖
          </span>
          {repeatCount > 1 && (
            <span>
              <i className="legend-loop" />
              循环回跳
            </span>
          )}
        </div>
        <div className="gantt-hint">
          <MoveHorizontal size={13} />
          {repeatCount > 1
            ? "循环模式：修改循环边界或重复次数后自动重新排程"
            : "拖动色块调整开始时间；拖动左右边缘调整时长"}
        </div>
      </footer>
    </section>
  );
}

