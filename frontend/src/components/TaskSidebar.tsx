import {
  Activity,
  Boxes,
  Check,
  ChevronRight,
  CircleDot,
  GitMerge,
  ListChecks,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Lane, Scenario, Task } from "../types";

type Props = {
  scenario: Scenario;
  selectedTaskId: string | null;
  search: string;
  criticalIds: Set<string>;
  taskCodes: Map<string, string>;
  hasErrors: boolean;
  mode: "tasks" | "units";
  onUpdateScenarioMeta: (
    patch: Partial<Pick<Scenario, "name" | "description" | "tags">>,
  ) => void;
  onSearch: (value: string) => void;
  onSelect: (taskId: string) => void;
  onAdd: () => void;
  onModeChange: (mode: "tasks" | "units") => void;
  onAddLane: () => void;
  onUpdateLane: (laneId: string, patch: Partial<Lane>) => void;
  onDeleteLane: (laneId: string) => void;
  onSetLoopStart: (taskId: string) => void;
  onSetLoopEnd: (taskId: string) => void;
};

function TaskRow({
  task,
  lane,
  selected,
  critical,
  taskCode,
  isLoopStart,
  isLoopEnd,
  onSelect,
  onSetLoopStart,
  onSetLoopEnd,
}: {
  task: Task;
  lane?: Lane;
  selected: boolean;
  critical: boolean;
  taskCode: string;
  isLoopStart: boolean;
  isLoopEnd: boolean;
  onSelect: () => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
}) {
  const isMotion = task.motion_type === "motion";
  return (
    <div className={`task-row ${selected ? "task-row-selected" : ""}`}>
      <button className="task-row-main" onClick={onSelect} type="button">
        <span
          className="task-code"
          style={{
            color: task.color,
            background: `${task.color}14`,
            borderColor: `${task.color}30`,
          }}
        >
          {taskCode}
        </span>
        <span className="task-main">
          <span className="task-name">
            {task.name}
            <span
              className={`task-kind-badge ${
                isMotion ? "motion" : "non-motion"
              }`}
              title={
                isMotion
                  ? "运动部件：时长由梯形速度规划计算，可人工覆盖"
                  : "非运动部件：直接使用人工设置时长"
              }
            >
              <Activity size={9} />
              {isMotion ? "运动" : "非运动"}
            </span>
            {critical && <span className="critical-dot" title="关键路径动作" />}
          </span>
          <span className="task-meta">
            <span>{lane?.name ?? "未分配"}</span>
            <span className="task-meta-dot">·</span>
            <span>
              {task.duration.toFixed(1)}s
              {isMotion &&
                (task.motion_duration_mode === "manual"
                  ? " · 人工"
                  : " · 自动")}
            </span>
            {isMotion && task.motion_distance_mm != null && (
              <>
                <span className="task-meta-dot">·</span>
                <span>{task.motion_distance_mm.toFixed(0)}mm</span>
              </>
            )}
            {task.dependency_delay_enabled &&
              task.dependencies.length > 0 && (
                <>
                  <span className="task-meta-dot">·</span>
                  <span className="task-delay-badge">
                    等待 +{(task.dependency_delay_seconds ?? 0).toFixed(1)}s
                  </span>
                </>
              )}
            {isLoopStart && (
              <span className="task-loop-badge head">循环头</span>
            )}
            {isLoopEnd && (
              <span className="task-loop-badge end">回跳点</span>
            )}
            {task.manual_start != null && (
              <>
                <span className="task-meta-dot">·</span>
                <span className="manual-badge">
                  手动 {task.manual_start.toFixed(1)}s
                </span>
              </>
            )}
            {task.dependencies.length > 0 && (
              <>
                <span className="task-meta-dot">·</span>
                <GitMerge size={11} />
                {task.dependencies.length}
              </>
            )}
          </span>
        </span>
        <ChevronRight size={15} className="task-chevron" />
      </button>
      {selected && (
        <div className="task-loop-settings">
          <button
            type="button"
            className={isLoopStart ? "active loop-start" : ""}
            onClick={onSetLoopStart}
          >
            {isLoopStart ? "✓ 循环开始" : "设为循环开始"}
          </button>
          <button
            type="button"
            className={isLoopEnd ? "active loop-end" : ""}
            onClick={onSetLoopEnd}
          >
            {isLoopEnd ? "✓ 循环结束" : "设为循环结束"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function TaskSidebar({
  scenario,
  selectedTaskId,
  search,
  criticalIds,
  taskCodes,
  hasErrors,
  mode,
  onUpdateScenarioMeta,
  onSearch,
  onSelect,
  onAdd,
  onModeChange,
  onAddLane,
  onUpdateLane,
  onDeleteLane,
  onSetLoopStart,
  onSetLoopEnd,
}: Props) {
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const addTagInputRef = useRef<HTMLInputElement>(null);
  const tags = scenario.tags ?? [];
  const laneMap = new Map(scenario.lanes.map((lane) => [lane.id, lane]));
  const query = search.trim().toLowerCase();
  const filtered = query
    ? scenario.tasks.filter((task) => {
        const lane = laneMap.get(task.lane);
        const motionLabel =
          task.motion_type === "motion" ? "运动 motion" : "非运动 non-motion";
        return [
          task.name,
          task.category,
          lane?.name ?? "",
          motionLabel,
        ].some((value) => value.toLowerCase().includes(query));
      })
    : scenario.tasks;

  const categories = filtered.reduce<Record<string, Task[]>>((result, task) => {
    (result[task.category] ??= []).push(task);
    return result;
  }, {});

  const dependencyCount = scenario.tasks.reduce(
    (count, task) => count + task.dependencies.length,
    0,
  );

  useEffect(() => {
    if (isAddingTag) addTagInputRef.current?.focus();
  }, [isAddingTag]);

  const updateTags = (nextTags: string[]) => {
    onUpdateScenarioMeta({ tags: nextTags });
  };

  const commitTag = () => {
    const value = newTag.trim();
    if (!value) {
      setIsAddingTag(false);
      setNewTag("");
      return;
    }
    if (!tags.includes(value)) updateTags([...tags, value]);
    setNewTag("");
    setIsAddingTag(false);
  };

  return (
    <aside className="side-panel task-sidebar">
      <div className="scene-summary">
        <div className="eyebrow">
          <CircleDot size={13} />
          当前场景
        </div>
        <input
          className="scene-name-input"
          aria-label="场景名称"
          value={scenario.name}
          placeholder="未命名场景"
          onChange={(event) =>
            onUpdateScenarioMeta({ name: event.target.value })
          }
          onBlur={() => {
            if (!scenario.name.trim()) {
              onUpdateScenarioMeta({ name: "未命名场景" });
            } else if (scenario.name !== scenario.name.trim()) {
              onUpdateScenarioMeta({ name: scenario.name.trim() });
            }
          }}
        />
        <textarea
          className="scene-description-input"
          aria-label="场景说明"
          rows={2}
          value={scenario.description}
          placeholder="添加场景说明"
          onChange={(event) =>
            onUpdateScenarioMeta({ description: event.target.value })
          }
          onBlur={() =>
            onUpdateScenarioMeta({ description: scenario.description.trim() })
          }
        />
        <div className="scene-tags">
          {tags.map((tag, index) => (
            <span className="scene-tag" key={index}>
              <input
                aria-label={`场景标签 ${index + 1}`}
                size={Math.max(2, Array.from(tag).length)}
                value={tag}
                onChange={(event) => {
                  const nextTags = [...tags];
                  nextTags[index] = event.target.value;
                  updateTags(nextTags);
                }}
                onBlur={() => {
                  const value = tag.trim();
                  if (!value) {
                    updateTags(tags.filter((_, tagIndex) => tagIndex !== index));
                  } else if (value !== tag) {
                    const nextTags = [...tags];
                    nextTags[index] = value;
                    updateTags(nextTags);
                  }
                }}
              />
              <button
                type="button"
                aria-label={`删除标签 ${tag || index + 1}`}
                title="删除标签"
                onClick={() =>
                  updateTags(tags.filter((_, tagIndex) => tagIndex !== index))
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {isAddingTag ? (
            <form
              className="scene-tag-editor"
              onSubmit={(event) => {
                event.preventDefault();
                commitTag();
              }}
            >
              <input
                ref={addTagInputRef}
                aria-label="新标签"
                value={newTag}
                placeholder="输入标签"
                onChange={(event) => setNewTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsAddingTag(false);
                    setNewTag("");
                  }
                }}
              />
              <button type="submit" aria-label="确认添加标签" title="确认">
                <Check size={11} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="scene-tag-add"
              onClick={() => setIsAddingTag(true)}
            >
              <Plus size={11} />
              标签
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-mode-switch" role="tablist" aria-label="侧栏内容">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "tasks"}
          className={mode === "tasks" ? "active" : ""}
          onClick={() => onModeChange("tasks")}
        >
          <ListChecks size={13} />
          动作
          <span>{scenario.tasks.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "units"}
          className={mode === "units" ? "active" : ""}
          onClick={() => onModeChange("units")}
        >
          <Boxes size={13} />
          执行单元
          <span>{scenario.lanes.length}</span>
        </button>
      </div>

      {mode === "tasks" ? (
        <>
          <div className="sidebar-section-head">
            <div>
              <span className="section-title">动作序列</span>
              <span className="count-badge">{scenario.tasks.length}</span>
            </div>
            <button className="icon-button" onClick={onAdd} type="button">
              <Plus size={17} />
              <span className="sr-only">添加动作</span>
            </button>
          </div>

          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索动作、分类或执行单元"
            />
          </label>

          <div className="task-list">
            {Object.entries(categories).map(([category, tasks]) => (
              <section className="task-category" key={category}>
                <div className="category-label">
                  <span>{category}</span>
                  <span>{tasks.length}</span>
                </div>
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    lane={laneMap.get(task.lane)}
                    selected={task.id === selectedTaskId}
                    critical={criticalIds.has(task.id)}
                    taskCode={taskCodes.get(task.id) ?? "—"}
                    isLoopStart={
                      (scenario.loop?.start_task_id ??
                        scenario.tasks[0]?.id) === task.id
                    }
                    isLoopEnd={
                      (scenario.loop?.release_after_task_id ??
                        scenario.tasks.at(-1)?.id) === task.id
                    }
                    onSelect={() => onSelect(task.id)}
                    onSetLoopStart={() => onSetLoopStart(task.id)}
                    onSetLoopEnd={() => onSetLoopEnd(task.id)}
                  />
                ))}
              </section>
            ))}
            {filtered.length === 0 && (
              <div className="empty-filter">
                <Search size={20} />
                <span>没有匹配的动作</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="sidebar-section-head">
            <div>
              <span className="section-title">执行单元</span>
              <span className="count-badge">{scenario.lanes.length}</span>
            </div>
            <button className="icon-button" onClick={onAddLane} type="button">
              <Plus size={17} />
              <span className="sr-only">添加执行单元</span>
            </button>
          </div>
          <p className="unit-inline-help">
            直接修改名称或颜色。同一执行单元内动作串行，不同执行单元可并行。
          </p>
          <div className="unit-inline-list">
            {scenario.lanes.map((lane, index) => {
              const usage = scenario.tasks.filter(
                (task) =>
                  task.lane === lane.id ||
                  task.locked_resources.includes(lane.id),
              ).length;
              return (
                <div className="unit-inline-row" key={lane.id}>
                  <span className="unit-inline-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <label
                    className="unit-inline-color"
                    style={{ background: lane.color }}
                    title="修改颜色"
                  >
                    <input
                      type="color"
                      value={lane.color}
                      onChange={(event) =>
                        onUpdateLane(lane.id, { color: event.target.value })
                      }
                    />
                  </label>
                  <input
                    className="unit-inline-name"
                    defaultValue={lane.name}
                    aria-label={`${lane.name} 名称`}
                    onBlur={(event) => {
                      const value = event.currentTarget.value.trim();
                      if (!value) {
                        event.currentTarget.value = lane.name;
                        return;
                      }
                      if (value !== lane.name) {
                        onUpdateLane(lane.id, { name: value });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <input
                    className="unit-inline-short"
                    defaultValue={lane.short_name}
                    maxLength={4}
                    aria-label={`${lane.name} 缩写`}
                    onBlur={(event) => {
                      const value = event.currentTarget.value.trim();
                      if (!value) {
                        event.currentTarget.value = lane.short_name;
                        return;
                      }
                      if (value !== lane.short_name) {
                        onUpdateLane(lane.id, { short_name: value });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <span
                    className="unit-inline-usage"
                    title="关联动作数（含附加占用）"
                  >
                    {usage}
                  </span>
                  <button
                    type="button"
                    className="unit-inline-delete"
                    onClick={() => onDeleteLane(lane.id)}
                    disabled={scenario.lanes.length <= 1}
                    title="删除执行单元"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="unit-inline-add"
            onClick={onAddLane}
          >
            <Plus size={14} />
            添加执行单元
          </button>
        </>
      )}

      <div className="constraint-summary">
        <div className="constraint-summary-title">
          <SlidersHorizontal size={15} />
          <span>约束健康度</span>
          <span className={`health-pill ${hasErrors ? "health-pill-error" : ""}`}>
            {hasErrors ? "需修复" : "有效"}
          </span>
        </div>
        <div className="constraint-stats">
          <div>
            <strong>{dependencyCount}</strong>
            <span>前置依赖</span>
          </div>
          <div>
            <strong>{scenario.lanes.length}</strong>
            <span>执行单元</span>
          </div>
          <div>
            <strong>{criticalIds.size}</strong>
            <span>关键动作</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

