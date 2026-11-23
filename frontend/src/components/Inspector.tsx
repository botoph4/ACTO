import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  GitBranch,
  Info,
  LockKeyhole,
  Palette,
  Play,
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
import { formatSeconds } from "../utils";

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

        <section className="inspector-section">
          <div className="section-label-row">
            <span className="field-label">
              <Clock3 size={14} />
              预计耗时
            </span>
            <span className="duration-value">{formatSeconds(task.duration)}</span>
          </div>
          <div className="duration-control">
            <input
              aria-label="动作耗时"
              type="range"
              min="0.1"
              max="12"
              step="0.1"
              value={Math.min(12, task.duration)}
              onChange={(event) =>
                onChange({ duration: Number(event.target.value) })
              }
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
                  onChange({
                    duration: Math.max(0.1, Number(event.target.value) || 0.1),
                  })
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
                onClick={() => onChange({ duration: value })}
              >
                {value}s
              </button>
            ))}
          </div>
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

