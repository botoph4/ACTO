import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Gauge,
  GitBranch,
  Info,
  LockKeyhole,
  Palette,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
  Unlock,
} from "lucide-react";
import { useState } from "react";
import type {
  Lane,
  LaneMetric,
  ScheduledTask,
  Task,
} from "../types";
import { calculateTrapezoidalProfile, formatSeconds } from "../utils";

type Props = {
  task: Task | null;
  taskCode: string;
  tasks: Task[];
  lanes: Lane[];
  scheduledTask: ScheduledTask | null;
  laneMetric: LaneMetric | null;
  onChange: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onManageUnits: () => void;
};

const COLORS = [
  "#3978F6",
  "#18A586",
  "#8B5CF6",
  "#F5A623",
  "#D96C3B",
  "#E65F73",
  "#475569",
  "#0EA5C6",
];

function DependencyEditor({
  title,
  icon,
  emptyText,
  selectedIds,
  tasks,
  currentId,
  onChange,
}: {
  title: string;
  icon: React.ReactNode;
  emptyText: string;
  selectedIds: string[];
  tasks: Task[];
  currentId: string;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = new Set(selectedIds);
  const filtered = tasks
    .filter((item) => item.id !== currentId)
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));

  const toggle = (taskId: string) => {
    if (selectedSet.has(taskId)) {
      onChange(selectedIds.filter((id) => id !== taskId));
    } else {
      onChange([...selectedIds, taskId]);
    }
  };

  return (
    <details className="dependency-editor">
      <summary>
        <span className="editor-summary-title">
          {icon}
          {title}
        </span>
        <span className="editor-summary-count">{selectedIds.length}</span>
        <ChevronDown size={14} className="summary-chevron" />
      </summary>
      <div className="dependency-body">
        {selectedIds.length > 0 ? (
          <div className="selected-dependencies">
            {selectedIds.map((id) => {
              const item = tasks.find((task) => task.id === id);
              if (!item) return null;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => toggle(id)}
                  title="点击移除"
                >
                  {item.name}
                  <span>×</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="dependency-empty">{emptyText}</p>
        )}
        <input
          className="dependency-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索动作…"
        />
        <div className="dependency-options">
          {filtered.map((item) => (
            <button
              type="button"
              className={selectedSet.has(item.id) ? "is-selected" : ""}
              key={item.id}
              onClick={() => toggle(item.id)}
            >
              <span className="dependency-check">
                {selectedSet.has(item.id) && <Check size={11} />}
              </span>
              <span>{item.name}</span>
              <small>{item.duration.toFixed(1)}s</small>
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

export default function Inspector({
  task,
  taskCode,
  tasks,
  lanes,
  scheduledTask,
  laneMetric,
  onChange,
  onDelete,
  onDuplicate,
  onManageUnits,
}: Props) {
  if (!task) {
    return (
      <aside className="side-panel inspector">
        <div className="inspector-empty">
          <Play size={26} />
          <h3>选择一个动作</h3>
          <p>点击左侧列表或甘特图中的动作，查看并修改耗时、依赖和并行约束。</p>
        </div>
      </aside>
    );
  }

  const isMotion = task.motion_type === "motion";
  const motionDistance = task.motion_distance_mm ?? 100;
  const motionVelocity = task.motion_velocity_mm_s ?? 100;
  const motionAcceleration = task.motion_acceleration_mm_s2 ?? 500;
  const motionProfile = calculateTrapezoidalProfile(
    motionDistance,
    motionVelocity,
    motionAcceleration,
  );
  const motionDurationMode = isMotion
    ? (task.motion_duration_mode ?? "auto")
    : "manual";

  const updateDuration = (duration: number) => {
    onChange({
      duration,
      ...(isMotion ? { motion_duration_mode: "manual" as const } : {}),
    });
  };

  const setMotionType = (motion: boolean) => {
    if (!motion) {
      onChange({
        motion_type: "non_motion",
        motion_duration_mode: "manual",
      });
      return;
    }
    const profile = calculateTrapezoidalProfile(
      motionDistance,
      motionVelocity,
      motionAcceleration,
    );
    onChange({
      motion_type: "motion",
      motion_distance_mm: motionDistance,
      motion_velocity_mm_s: motionVelocity,
      motion_acceleration_mm_s2: motionAcceleration,
      motion_duration_mode: "auto",
      duration: profile?.duration ?? task.duration,
    });
  };

  const updateMotionParameter = (
    patch: Partial<
      Pick<
        Task,
        | "motion_distance_mm"
        | "motion_velocity_mm_s"
        | "motion_acceleration_mm_s2"
      >
    >,
  ) => {
    const nextDistance = patch.motion_distance_mm ?? motionDistance;
    const nextVelocity = patch.motion_velocity_mm_s ?? motionVelocity;
    const nextAcceleration =
      patch.motion_acceleration_mm_s2 ?? motionAcceleration;
    const profile = calculateTrapezoidalProfile(
      nextDistance,
      nextVelocity,
      nextAcceleration,
    );
    onChange({
      ...patch,
      ...(motionDurationMode === "auto" && profile
        ? { duration: profile.duration }
        : {}),
    });
  };

  const restoreAutomaticDuration = () => {
    if (!motionProfile) return;
    onChange({
      motion_duration_mode: "auto",
      duration: motionProfile.duration,
    });
  };

  return (
    <aside className="side-panel inspector">
      <div className="inspector-title-row">
        <div>
          <span className="eyebrow">动作属性 · {taskCode}</span>
          <h2>编辑约束</h2>
        </div>
        <span className="selected-color" style={{ background: task.color }} />
      </div>

      <div className="inspector-scroll">
        <section className="inspector-section">
          <label className="field-label" htmlFor="task-name">
            动作名称
          </label>
          <input
            id="task-name"
            className="text-input task-name-input"
            value={task.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />

          <div className="field-grid">
            <div className="lane-field">
              <div className="field-label-row">
                <span className="field-label">执行单元</span>
                <button
                  type="button"
                  className="field-mini-action"
                  onClick={onManageUnits}
                >
                  <Settings2 size={11} />
                  管理
                </button>
              </div>
              <select
                className="select-input"
                value={task.lane}
                onChange={(event) => onChange({ lane: event.target.value })}
              >
                {lanes.map((lane) => (
                  <option value={lane.id} key={lane.id}>
                    {lane.name}
                  </option>
                ))}
              </select>
            </div>
            <label>
              <span className="field-label">分类</span>
              <input
                className="text-input"
                value={task.category}
                onChange={(event) => onChange({ category: event.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="inspector-section motion-definition">
          <div className="section-label-row">
            <span className="field-label">
              <Activity size={14} />
              动作类型
            </span>
            <div className="motion-type-switch">
              <button
                type="button"
                className={!isMotion ? "active" : ""}
                onClick={() => setMotionType(false)}
              >
                非运动
              </button>
              <button
                type="button"
                className={isMotion ? "active" : ""}
                onClick={() => setMotionType(true)}
              >
                运动部件
              </button>
            </div>
          </div>

          {isMotion ? (
            <>
              <p className="field-help motion-help">
                根据运动行程、最大速度和加速度，以对称梯形速度曲线计算最短运动时间。
              </p>
              <div className="motion-parameter-grid">
                <label>
                  <span>运动行程</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="1"
                      value={motionDistance}
                      onChange={(event) =>
                        updateMotionParameter({
                          motion_distance_mm: Math.max(
                            0.1,
                            Number(event.target.value) || 0.1,
                          ),
                        })
                      }
                    />
                    <em>mm</em>
                  </div>
                </label>
                <label>
                  <span>最大速度</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="1"
                      value={motionVelocity}
                      onChange={(event) =>
                        updateMotionParameter({
                          motion_velocity_mm_s: Math.max(
                            0.1,
                            Number(event.target.value) || 0.1,
                          ),
                        })
                      }
                    />
                    <em>mm/s</em>
                  </div>
                </label>
                <label>
                  <span>加速度</span>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="1"
                      value={motionAcceleration}
                      onChange={(event) =>
                        updateMotionParameter({
                          motion_acceleration_mm_s2: Math.max(
                            0.1,
                            Number(event.target.value) || 0.1,
                          ),
                        })
                      }
                    />
                    <em>mm/s²</em>
                  </div>
                </label>
              </div>
              <div className="motion-profile-result">
                <div>
                  <span>
                    <Gauge size={13} />
                    梯形速度规划
                  </span>
                  <small>
                    {motionProfile?.reachesMaxVelocity
                      ? "达到最大速度，包含匀速段"
                      : "未达到最大速度，为三角形速度曲线"}
                  </small>
                </div>
                <strong>
                  {motionProfile ? `${motionProfile.duration.toFixed(2)}s` : "—"}
                </strong>
                <em>
                  加速 {motionProfile?.accelerationTime.toFixed(2) ?? "—"}s · 匀速{" "}
                  {motionProfile?.cruiseTime.toFixed(2) ?? "—"}s
                </em>
              </div>
              <div className="motion-mode-row">
                <span>时长来源</span>
                <div>
                  <button
                    type="button"
                    className={motionDurationMode === "auto" ? "active" : ""}
                    onClick={restoreAutomaticDuration}
                    disabled={!motionProfile}
                  >
                    自动计算
                  </button>
                  <button
                    type="button"
                    className={motionDurationMode === "manual" ? "active" : ""}
                    onClick={() =>
                      onChange({ motion_duration_mode: "manual" })
                    }
                  >
                    人工指定
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="field-help motion-help">
              非运动部件不参与运动学时长计算，直接使用下方预计耗时。
            </p>
          )}
        </section>

        <section className="inspector-section">
          <div className="section-label-row">
            <span className="field-label">
              <Clock3 size={14} />
              预计耗时
            </span>
            <span className="duration-heading-value">
              {isMotion && (
                <small
                  className={`duration-source ${
                    motionDurationMode === "manual" ? "manual" : ""
                  }`}
                >
                  {motionDurationMode === "manual" ? "人工" : "自动"}
                </small>
              )}
              <span className="duration-value">
                {formatSeconds(task.duration)}
              </span>
            </span>
          </div>
          <div className="duration-control">
            <input
              aria-label="动作耗时"
              type="range"
              min="0.1"
              max="12"
              step="0.1"
              value={Math.min(12, task.duration)}
              onChange={(event) => updateDuration(Number(event.target.value))}
              style={
                {
                  "--range-progress": `${Math.min(100, (task.duration / 12) * 100)}%`,
                } as React.CSSProperties
              }
            />
            <div className="number-input-wrap">
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={task.duration}
                onChange={(event) =>
                  updateDuration(
                    Math.max(0.1, Number(event.target.value) || 0.1),
                  )
                }
              />
              <span>s</span>
            </div>
          </div>
          <div className="quick-duration">
            {[0.5, 1, 2, 3, 5].map((value) => (
              <button
                type="button"
                key={value}
                className={task.duration === value ? "active" : ""}
                onClick={() => updateDuration(value)}
              >
                {value}s
              </button>
            ))}
          </div>
          {isMotion && motionDurationMode === "manual" && (
            <button
              type="button"
              className="restore-auto-duration"
              onClick={restoreAutomaticDuration}
              disabled={!motionProfile}
            >
              <RotateCcw size={12} />
              按运动参数重新计算（{motionProfile?.duration.toFixed(2) ?? "—"}s）
            </button>
          )}
        </section>

        <section className="inspector-section">
          <span className="field-label">
            <Palette size={14} />
            甘特图颜色
          </span>
          <div className="color-row">
            {COLORS.map((color) => (
              <button
                type="button"
                aria-label={`选择颜色 ${color}`}
                key={color}
                className={task.color === color ? "active" : ""}
                style={{ background: color }}
                onClick={() => onChange({ color })}
              />
            ))}
            <label className="custom-color" title="自定义颜色">
              <input
                type="color"
                value={task.color}
                onChange={(event) => onChange({ color: event.target.value })}
              />
              <span>+</span>
            </label>
          </div>
        </section>

        <section className="inspector-section">
          <div className="parallel-setting">
            <div>
              <span className="field-label">
                <Unlock size={14} />
                可与其他动作并行
              </span>
              <p>关闭后，该动作执行期间全局串行。</p>
            </div>
            <button
              role="switch"
              aria-checked={task.can_parallel}
              type="button"
              className={`switch ${task.can_parallel ? "on" : ""}`}
              onClick={() => onChange({ can_parallel: !task.can_parallel })}
            >
              <span />
            </button>
          </div>
          {!task.can_parallel && (
            <div className="inline-alert inline-alert-amber">
              <AlertTriangle size={14} />
              全局互斥会直接拉长 CT，请确认必要性。
            </div>
          )}
        </section>

        <section className="inspector-section">
          <span className="field-label">
            <LockKeyhole size={14} />
            附加占用资源
          </span>
          <p className="field-help">
            末端夹爪动作通常会同时占用对应机械臂，避免资源冲突。
          </p>
          <div className="resource-locks">
            {lanes
              .filter((lane) => lane.id !== task.lane)
              .map((lane) => {
                const active = task.locked_resources.includes(lane.id);
                return (
                  <button
                    type="button"
                    key={lane.id}
                    className={active ? "active" : ""}
                    onClick={() =>
                      onChange({
                        locked_resources: active
                          ? task.locked_resources.filter((id) => id !== lane.id)
                          : [...task.locked_resources, lane.id],
                      })
                    }
                  >
                    <span
                      className="resource-dot"
                      style={{ background: lane.color }}
                    />
                    {lane.name}
                    {active && <Check size={11} />}
                  </button>
                );
              })}
          </div>
        </section>

        <section className="inspector-section dependency-section">
          <p className="field-help dependency-help">
            这些动作全部完成后，当前动作才能开始；原来的“等待动作停止”已合并到这里。
          </p>
          <div
            className={`dependency-delay-control ${
              task.dependency_delay_enabled ? "active" : ""
            }`}
          >
            <div>
              <span>
                <Clock3 size={12} />
                前置完成后延时等待
              </span>
              <small>
                {task.dependencies.length
                  ? "所有前置完成后再额外等待指定时间"
                  : "添加前置依赖后此选项生效"}
              </small>
            </div>
            <button
              role="switch"
              aria-checked={task.dependency_delay_enabled ?? false}
              type="button"
              className={`switch ${
                task.dependency_delay_enabled ? "on" : ""
              }`}
              disabled={task.dependencies.length === 0}
              title={
                task.dependencies.length
                  ? "启用或关闭前置延时等待"
                  : "请先添加前置依赖"
              }
              onClick={() =>
                onChange({
                  dependency_delay_enabled:
                    !task.dependency_delay_enabled,
                  dependency_delay_seconds:
                    task.dependency_delay_enabled
                      ? (task.dependency_delay_seconds ?? 0)
                      : Math.max(0.1, task.dependency_delay_seconds ?? 1),
                })
              }
            >
              <span />
            </button>
          </div>
          {task.dependency_delay_enabled &&
            task.dependencies.length > 0 && (
              <label className="dependency-delay-input">
                <span>额外等待时间</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    max="600"
                    step="0.1"
                    value={task.dependency_delay_seconds ?? 0}
                    onChange={(event) =>
                      onChange({
                        dependency_delay_seconds: Math.min(
                          600,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      })
                    }
                  />
                  <em>s</em>
                </div>
              </label>
            )}
          <DependencyEditor
            title="前置 / 等待完成依赖"
            icon={<GitBranch size={14} />}
            emptyText="无前置依赖"
            selectedIds={task.dependencies}
            tasks={tasks}
            currentId={task.id}
            onChange={(ids) => onChange({ dependencies: ids })}
          />
        </section>

        <section className="inspector-section">
          <label className="field-label" htmlFor="task-notes">
            备注
          </label>
          <textarea
            id="task-notes"
            className="notes-input"
            value={task.notes}
            rows={3}
            onChange={(event) => onChange({ notes: event.target.value })}
            placeholder="记录动作假设、风险或工艺说明…"
          />
        </section>

        {scheduledTask && (
          <section className="schedule-readout">
            <div className="schedule-readout-head">
              <Info size={14} />
              当前求解结果
            </div>
            <div className="schedule-time-row">
              <div>
                <span>开始</span>
                <strong>{formatSeconds(scheduledTask.start, 2)}</strong>
              </div>
              <span className="time-connector" />
              <div>
                <span>结束</span>
                <strong>{formatSeconds(scheduledTask.end, 2)}</strong>
              </div>
            </div>
            <div className="schedule-facts">
              <span>
                执行单元占用 {laneMetric?.utilization.toFixed(0) ?? "—"}%
              </span>
              {scheduledTask.waiting_for_resource > 0.05 && (
                <span className="waiting-fact">
                  等待单元 {scheduledTask.waiting_for_resource.toFixed(1)}s
                </span>
              )}
              {scheduledTask.critical && (
                <span className="critical-fact">位于关键路径</span>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="inspector-footer">
        <button className="button button-ghost" type="button" onClick={onDuplicate}>
          <Copy size={15} />
          复制
        </button>
        <button
          className="button button-danger-ghost"
          type="button"
          onClick={onDelete}
        >
          <Trash2 size={15} />
          删除
        </button>
      </div>
    </aside>
  );
}

