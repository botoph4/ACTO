import type { Scenario, ScheduleResult, Task } from "./types";

export type ParallelWindowTask = {
  instanceId: string;
  taskId: string;
  code: string;
  name: string;
  laneName: string;
  laneColor: string;
  iteration: number;
  start: number;
  end: number;
};

export type ParallelWindow = {
  id: string;
  start: number;
  end: number;
  duration: number;
  tasks: ParallelWindowTask[];
};

export function formatSeconds(value: number, digits = 1): string {
  return `${value.toFixed(digits)}s`;
}

export type CycleTimingMetrics = {
  average: number | null;
  shortest: number | null;
  sampleCount: number;
};

export function calculateCycleTiming(
  schedule: ScheduleResult,
  repeatCount: number,
  startTaskId: string | null,
  endTaskId: string | null,
): CycleTimingMetrics {
  const effectiveRepeat = Math.max(
    1,
    schedule.repeat_count ?? repeatCount,
  );
  const fallback = schedule.metrics.makespan / effectiveRepeat;
  if (!startTaskId || !endTaskId) {
    return {
      average: fallback,
      shortest: fallback,
      sampleCount: effectiveRepeat,
    };
  }

  const startsByIteration = new Map<number, number>();
  const endsByIteration = new Map<number, number>();
  for (const task of schedule.scheduled_tasks) {
    const templateId = task.template_id ?? task.id;
    const iteration = task.iteration ?? 1;
    if (templateId === startTaskId) {
      startsByIteration.set(iteration, task.start);
    }
    if (templateId === endTaskId) {
      endsByIteration.set(iteration, task.end);
    }
  }

  const cycleDurations =
    startTaskId === endTaskId
      ? Array.from(
          { length: Math.max(0, effectiveRepeat - 3) },
          (_, index) => {
            const currentStart = startsByIteration.get(index + 2);
            const nextStart = startsByIteration.get(index + 3);
            return currentStart == null || nextStart == null
              ? null
              : nextStart - currentStart;
          },
        ).filter(
          (duration): duration is number =>
            duration != null && duration >= 0,
        )
      : Array.from(
          { length: Math.max(0, effectiveRepeat - 2) },
          (_, index) => {
            const iteration = index + 2;
            const start = startsByIteration.get(iteration);
            const end = endsByIteration.get(iteration);
            return start == null || end == null ? null : end - start;
          },
        ).filter(
          (duration): duration is number =>
            duration != null && duration >= 0,
        );

  if (!cycleDurations.length) {
    return {
      average: null,
      shortest: null,
      sampleCount: 0,
    };
  }
  return {
    average: fallback,
    shortest: Math.min(...cycleDurations),
    sampleCount: cycleDurations.length,
  };
}

export type MotionProfile = {
  duration: number;
  peakVelocity: number;
  accelerationTime: number;
  cruiseTime: number;
  accelerationDistance: number;
  reachesMaxVelocity: boolean;
};

export function calculateTrapezoidalProfile(
  distanceMm: number,
  maxVelocityMmS: number,
  accelerationMmS2: number,
): MotionProfile | null {
  if (
    !Number.isFinite(distanceMm) ||
    !Number.isFinite(maxVelocityMmS) ||
    !Number.isFinite(accelerationMmS2) ||
    distanceMm <= 0 ||
    maxVelocityMmS <= 0 ||
    accelerationMmS2 <= 0
  ) {
    return null;
  }

  const fullAccelerationDistance =
    (maxVelocityMmS * maxVelocityMmS) / accelerationMmS2;
  const reachesMaxVelocity = distanceMm > fullAccelerationDistance;
  const peakVelocity = reachesMaxVelocity
    ? maxVelocityMmS
    : Math.sqrt(distanceMm * accelerationMmS2);
  const accelerationTime = peakVelocity / accelerationMmS2;
  const cruiseTime = reachesMaxVelocity
    ? (distanceMm - fullAccelerationDistance) / maxVelocityMmS
    : 0;

  return {
    duration: 2 * accelerationTime + cruiseTime,
    peakVelocity,
    accelerationTime,
    cruiseTime,
    accelerationDistance: reachesMaxVelocity
      ? fullAccelerationDistance
      : distanceMm,
    reachesMaxVelocity,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix = "task"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function taskCode(index: number): string {
  return String(index + 1).padStart(2, "0");
}

export function computeParallelWindows(
  schedule: ScheduleResult,
  scenario: Scenario,
): ParallelWindow[] {
  const scheduledTasks =
    (schedule.repeat_count ?? 1) > 1
      ? schedule.scheduled_tasks.filter(
          (task) => (task.iteration ?? 1) === 1,
        )
      : schedule.scheduled_tasks;
  const tasksById = new Map(
    scenario.tasks.map((task, index) => [
      task.id,
      { task, code: taskCode(index) },
    ]),
  );
  const lanesById = new Map(scenario.lanes.map((lane) => [lane.id, lane]));
  const points = Array.from(
    new Set(
      scheduledTasks.flatMap((task) => [task.start, task.end]),
    ),
  ).sort((left, right) => left - right);
  const windows: ParallelWindow[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end - start < 0.01) continue;
    const active = scheduledTasks.filter(
      (task) => task.start < end - 0.001 && task.end > start + 0.001,
    );
    if (active.length < 2) continue;

    const activeTasks = active.flatMap((item) => {
      const templateId = item.template_id ?? item.id;
      const source = tasksById.get(templateId);
      if (!source) return [];
      const lane = lanesById.get(source.task.lane);
      const iteration = item.iteration ?? 1;
      return [{
        instanceId: item.id,
        taskId: templateId,
        code: `${source.code}${iteration > 1 ? `·${iteration}` : ""}`,
        name: source.task.name,
        laneName: lane?.name ?? "未分配",
        laneColor: lane?.color ?? source.task.color,
        iteration,
        start: item.start,
        end: item.end,
      }];
    });
    if (activeTasks.length < 2) continue;

    const key = activeTasks
      .map((task) => task.instanceId)
      .sort()
      .join("|");
    const previous = windows.at(-1);
    if (
      previous &&
      Math.abs(previous.end - start) < 0.011 &&
      previous.tasks
        .map((task) => task.instanceId)
        .sort()
        .join("|") === key
    ) {
      previous.end = end;
      previous.duration = previous.end - previous.start;
    } else {
      windows.push({
        id: `${key}-${start}`,
        start,
        end,
        duration: end - start,
        tasks: activeTasks.sort((left, right) =>
          left.start === right.start
            ? left.code.localeCompare(right.code)
            : left.start - right.start
        ),
      });
    }
  }

  return windows;
}

export function mergeLegacyDependencies(scenario: Scenario): Scenario {
  return {
    ...scenario,
    tags: Array.isArray(scenario.tags) ? scenario.tags : [],
    tasks: scenario.tasks.map((task) => ({
      ...task,
      dependencies: Array.from(
        new Set([...(task.dependencies ?? []), ...(task.stop_after ?? [])]),
      ),
      stop_after: [],
    })),
  };
}

export function downloadFile(
  filename: string,
  content: string,
  contentType: string,
): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function scenarioToCsv(scenario: Scenario): string {
  const lines = [
    [
      "任务ID",
      "动作名称",
      "分类",
      "执行单元",
      "预计耗时(s)",
      "运动类型",
      "运动行程(mm)",
      "最大速度(mm/s)",
      "加速度(mm/s²)",
      "时长模式",
      "甘特图颜色",
      "前置依赖",
      "启用前置延时",
      "前置延时等待(s)",
      "可与其他动作并行",
      "附加占用资源",
      "手动开始时间(s)",
      "备注",
    ],
    ...scenario.tasks.map((task) => [
      task.id,
      task.name,
      task.category,
      task.lane,
      String(task.duration),
      task.motion_type === "motion" ? "运动" : "非运动",
      task.motion_type === "motion" ? String(task.motion_distance_mm ?? "") : "",
      task.motion_type === "motion" ? String(task.motion_velocity_mm_s ?? "") : "",
      task.motion_type === "motion"
        ? String(task.motion_acceleration_mm_s2 ?? "")
        : "",
      task.motion_type === "motion"
        ? task.motion_duration_mode === "manual"
          ? "人工"
          : "自动"
        : "人工",
      task.color,
      task.dependencies.join("|"),
      task.dependency_delay_enabled ? "是" : "否",
      task.dependency_delay_enabled
        ? String(task.dependency_delay_seconds ?? 0)
        : "",
      task.can_parallel ? "是" : "否",
      task.locked_resources.join("|"),
      task.manual_start == null ? "" : String(task.manual_start),
      task.notes,
    ]),
  ];
  return lines
    .map((line) =>
      line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

export function scenarioFromCsv(
  content: string,
  base: Scenario,
  name: string,
): Scenario {
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV 中没有动作数据");

  const headers = rows[0].map((header) => header.trim());
  const value = (row: string[], ...aliases: string[]): string => {
    for (const alias of aliases) {
      const index = headers.findIndex(
        (header) => header.toLowerCase() === alias.toLowerCase(),
      );
      if (index >= 0) return row[index]?.trim() ?? "";
    }
    return "";
  };
  const splitRefs = (text: string) =>
    text
      .split(/[|;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const laneIds = new Set(base.lanes.map((lane) => lane.id));
  const defaultLane = base.lanes[0]?.id ?? "";
  const tasks: Task[] = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const taskName = value(row, "动作名称", "name");
    if (!taskName) return;
    const lane = value(row, "执行单元", "lane") || defaultLane;
    if (!laneIds.has(lane)) {
      throw new Error(`第 ${rowIndex + 2} 行引用了不存在的执行单元：${lane}`);
    }
    const motionTypeText = value(
      row,
      "运动类型",
      "motion_type",
    ).toLowerCase();
    const motionType = ["运动", "motion", "true", "是", "1"].includes(
      motionTypeText,
    )
      ? "motion"
      : "non_motion";
    const numberValue = (...aliases: string[]): number | null => {
      const raw = value(row, ...aliases);
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const motionDistance = numberValue("运动行程(mm)", "motion_distance_mm");
    const motionVelocity = numberValue(
      "最大速度(mm/s)",
      "motion_velocity_mm_s",
    );
    const motionAcceleration = numberValue(
      "加速度(mm/s²)",
      "motion_acceleration_mm_s2",
      "加速度(mm/s2)",
    );
    const durationModeText = value(row, "时长模式", "motion_duration_mode");
    const motionDurationMode =
      motionType === "motion" &&
      !["人工", "manual"].includes(durationModeText.toLowerCase())
        ? "auto"
        : "manual";
    const motionProfile =
      motionType === "motion" &&
      motionDistance != null &&
      motionVelocity != null &&
      motionAcceleration != null
        ? calculateTrapezoidalProfile(
            motionDistance,
            motionVelocity,
            motionAcceleration,
          )
        : null;
    if (motionType === "motion" && !motionProfile) {
      throw new Error(
        `第 ${rowIndex + 2} 行运动参数无效，请填写行程、最大速度和加速度`,
      );
    }
    const importedDuration = Number(
      value(row, "预计耗时(s)", "duration", "耗时"),
    );
    const duration =
      motionType === "motion" && motionDurationMode === "auto"
        ? motionProfile!.duration
        : importedDuration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`第 ${rowIndex + 2} 行动作耗时无效`);
    }
    const laneColor =
      base.lanes.find((laneItem) => laneItem.id === lane)?.color ?? "#3978F6";
    const canParallelValue = value(
      row,
      "可与其他动作并行",
      "can_parallel",
    ).toLowerCase();
    const dependencies = splitRefs(
      value(row, "前置依赖", "dependencies"),
    );
    const legacyStopAfter = splitRefs(
      value(row, "必须停止后执行", "stop_after", "停止条件"),
    );
    const delayEnabledValue = value(
      row,
      "启用前置延时",
      "dependency_delay_enabled",
    ).toLowerCase();
    const dependencyDelayEnabled = ["是", "true", "1", "yes"].includes(
      delayEnabledValue,
    );
    const dependencyDelaySeconds = Number(
      value(
        row,
        "前置延时等待(s)",
        "dependency_delay_seconds",
      ) || 0,
    );
    if (
      dependencyDelayEnabled &&
      (!Number.isFinite(dependencyDelaySeconds) ||
        dependencyDelaySeconds < 0 ||
        dependencyDelaySeconds > 600)
    ) {
      throw new Error(`第 ${rowIndex + 2} 行前置延时等待时间无效`);
    }
    tasks.push({
      id: value(row, "任务ID", "id") || `imported_${rowIndex + 1}`,
      name: taskName,
      category: value(row, "分类", "category") || "导入动作",
      lane,
      duration: Math.round(duration * 1000) / 1000,
      motion_type: motionType,
      motion_distance_mm: motionType === "motion" ? motionDistance : null,
      motion_velocity_mm_s: motionType === "motion" ? motionVelocity : null,
      motion_acceleration_mm_s2:
        motionType === "motion" ? motionAcceleration : null,
      motion_duration_mode: motionDurationMode,
      color:
        value(row, "甘特图颜色", "color") ||
        laneColor,
      dependencies: Array.from(
        new Set([...dependencies, ...legacyStopAfter]),
      ),
      stop_after: [],
      can_parallel: !["否", "false", "0", "no"].includes(canParallelValue),
      locked_resources: splitRefs(
        value(row, "附加占用资源", "locked_resources"),
      ),
      dependency_delay_enabled: dependencyDelayEnabled,
      dependency_delay_seconds: dependencyDelayEnabled
        ? dependencyDelaySeconds
        : 0,
      manual_start: (() => {
        const raw = value(row, "手动开始时间(s)", "manual_start");
        if (!raw) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      })(),
      notes: value(row, "备注", "notes"),
    });
  });

  if (!tasks.length) throw new Error("CSV 中没有可导入的动作");
  return {
    ...base,
    id: uid("scenario"),
    name,
    description: `由 CSV 动作表导入：${name}`,
    tasks,
  };
}

