import {
  ALargeSmall,
  AlertCircle,
  Braces,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  Database,
  Download,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  FolderOpen,
  Gauge,
  Info,
  Layers3,
  Lightbulb,
  LoaderCircle,
  LogOut,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Table2,
  Trash2,
  UploadCloud,
  UsersRound,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchDemoScenario,
  heartbeat,
  logout as logoutSession,
  requestSchedule,
  restoreSession,
} from "./api";
import AccountManager from "./components/AccountManager";
import AuthScreen from "./components/AuthScreen";
import GanttChart from "./components/GanttChart";
import Inspector from "./components/Inspector";
import MetricGrid from "./components/MetricGrid";
import RepeatSummary from "./components/RepeatSummary";
import TaskSidebar from "./components/TaskSidebar";
import type {
  AuthUser,
  Diagnostic,
  Lane,
  Scenario,
  ScheduleResult,
  Task,
  Worksheet,
} from "./types";
import {
  calculateCycleTiming,
  computeParallelWindows,
  downloadFile,
  formatSeconds,
  mergeLegacyDependencies,
  scenarioFromCsv,
  scenarioToCsv,
  taskCode,
  uid,
} from "./utils";

const STORAGE_KEY = "acto-workspaces-v3";
const LEGACY_STORAGE_KEY = "m1-cycle-studio-scenario-v2";
const UI_SCALE_KEY = "acto-ui-scale";
const APP_VERSION = "0.2.4";
const SHOW_SCHEDULING_INSIGHT = false;

const UI_SCALE_OPTIONS = [
  { label: "50%", value: 0.5 },
  { label: "100%", value: 1 },
  { label: "130%", value: 1.3 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 },
];

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
};

type SavedWorkspaces = {
  version: 3;
  activeWorksheetId: string;
  worksheets: Worksheet[];
};

type ScenarioUpdater = Scenario | ((current: Scenario) => Scenario);

function isScenario(value: unknown): value is Scenario {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Scenario>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.lanes) &&
    Array.isArray(candidate.tasks)
  );
}

function isWorksheet(value: unknown): value is Worksheet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Worksheet>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    isScenario(candidate.scenario)
  );
}

function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario;
}

function makeWorksheet(name: string, scenario: Scenario): Worksheet {
  return {
    id: uid("sheet"),
    name,
    scenario,
    updatedAt: Date.now(),
  };
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAccountManagerOpen, setIsAccountManagerOpen] = useState(false);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [activeWorksheetId, setActiveWorksheetId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [scheduleDiagnostics, setScheduleDiagnostics] = useState<Diagnostic[]>([]);
  const [baselineMakespan, setBaselineMakespan] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [uiScale, setUiScale] = useState(() => {
    const requested = Number(
      new URLSearchParams(window.location.search).get("uiScale") ?? "",
    );
    if (Number.isFinite(requested) && requested >= 0.5 && requested <= 2) {
      return requested;
    }
    const stored = Number(window.localStorage.getItem(UI_SCALE_KEY));
    return Number.isFinite(stored) && stored >= 0.5 && stored <= 2
      ? stored
      : 1.3;
  });
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isParallelDetailsOpen, setIsParallelDetailsOpen] = useState(true);
  const [isWorksheetMenuOpen, setIsWorksheetMenuOpen] = useState(
    () => new URLSearchParams(window.location.search).get("sheetMenu") === "1",
  );
  const [sidebarMode, setSidebarMode] = useState<"tasks" | "units">(() =>
    new URLSearchParams(window.location.search).get("sidebar") === "units"
      ? "units"
      : "tasks",
  );
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(
    () => new URLSearchParams(window.location.search).get("import") === "1",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const worksheetMenuRef = useRef<HTMLDivElement>(null);
  const fontMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const baselineCaptured = useRef(false);
  const demoRef = useRef<Scenario | null>(null);
  const lastScheduledKey = useRef("");

  const activeWorksheet =
    worksheets.find((worksheet) => worksheet.id === activeWorksheetId) ?? null;
  const scenario = activeWorksheet?.scenario ?? null;

  const showToast = useCallback(
    (message: string, tone: ToastState["tone"] = "success") => {
      setToast({ id: Date.now(), message, tone });
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void restoreSession().then((user) => {
      if (!active) return;
      setAuthUser(user);
      setIsAuthChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void heartbeat().catch((error) => {
        if (
          error instanceof ApiError &&
          (error.message.includes("登录") || error.message.includes("401"))
        ) {
          setAuthUser(null);
        }
      });
    };
    ping();
    const timer = window.setInterval(ping, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authUser]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isWorksheetMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        worksheetMenuRef.current &&
        !worksheetMenuRef.current.contains(event.target as Node)
      ) {
        setIsWorksheetMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWorksheetMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isWorksheetMenuOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-scale",
      String(uiScale),
    );
    window.localStorage.setItem(UI_SCALE_KEY, String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    if (!isFontMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        fontMenuRef.current &&
        !fontMenuRef.current.contains(event.target as Node)
      ) {
        setIsFontMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFontMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFontMenuOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isProfileMenuOpen]);

  const changeUiScale = (value: number) => {
    setUiScale(Math.min(2, Math.max(0.5, Math.round(value * 20) / 20)));
    setIsWorksheetMenuOpen(false);
  };

  const boot = useCallback(async () => {
    if (!authUser) return;
    setIsBooting(true);
    setBootstrapError(null);
    try {
      const demo = await fetchDemoScenario();
      demoRef.current = cloneScenario(demo);
      let loadedWorksheets: Worksheet[] = [
        makeWorksheet("M1 基准方案", cloneScenario(demo)),
      ];

      const scopedStorageKey = `${STORAGE_KEY}:user:${authUser.id}`;
      const migrationKey = `${STORAGE_KEY}:migrated`;
      const saved =
        window.localStorage.getItem(scopedStorageKey) ??
        (window.localStorage.getItem(migrationKey)
          ? null
          : window.localStorage.getItem(STORAGE_KEY));
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Partial<SavedWorkspaces>;
          if (
            parsed.version === 3 &&
            Array.isArray(parsed.worksheets) &&
            parsed.worksheets.length > 0 &&
            parsed.worksheets.every(isWorksheet)
          ) {
            loadedWorksheets = parsed.worksheets;
          }
        } catch {
          window.localStorage.removeItem(scopedStorageKey);
        }
        window.localStorage.setItem(migrationKey, "1");
      } else {
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            if (isScenario(parsed)) {
              loadedWorksheets = [makeWorksheet(parsed.name, parsed)];
            }
          } catch {
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
      }

      const savedActive = (() => {
        try {
          return JSON.parse(saved ?? "{}").activeWorksheetId as string | undefined;
        } catch {
          return undefined;
        }
      })();
      const requestedRepeat = Number(
        new URLSearchParams(window.location.search).get("repeat") ?? "",
      );
      if (
        Number.isInteger(requestedRepeat) &&
        requestedRepeat >= 1 &&
        requestedRepeat <= 999
      ) {
        loadedWorksheets = loadedWorksheets.map((worksheet, index) =>
          index === 0
            ? {
                ...worksheet,
                scenario: {
                  ...worksheet.scenario,
                  repeat_count: requestedRepeat,
                },
              }
            : worksheet,
        );
      }
      loadedWorksheets = loadedWorksheets.map((worksheet) => ({
        ...worksheet,
        scenario: mergeLegacyDependencies(worksheet.scenario),
      }));
      const nextActive =
        loadedWorksheets.find((item) => item.id === savedActive) ??
        loadedWorksheets[0];
      setWorksheets(loadedWorksheets);
      setActiveWorksheetId(nextActive.id);
      setSelectedTaskId(
        nextActive.scenario.tasks[0]?.id ?? null,
      );
      lastScheduledKey.current = "";
      baselineCaptured.current = false;
      setBaselineMakespan(null);
    } catch (error) {
      setBootstrapError(
        error instanceof Error
          ? error.message
          : "无法连接排程服务，请检查后端是否启动。",
      );
    } finally {
      setIsBooting(false);
    }
  }, [authUser]);

  useEffect(() => {
    if (isAuthChecking) return;
    if (!authUser) {
      setIsBooting(false);
      return;
    }
    void boot();
  }, [authUser, boot, isAuthChecking]);

  const updateScenario = useCallback(
    (updater: ScenarioUpdater) => {
      if (!activeWorksheetId) return;
      setWorksheets((current) =>
        current.map((worksheet) => {
          if (worksheet.id !== activeWorksheetId) return worksheet;
          const nextScenario =
            typeof updater === "function"
              ? updater(worksheet.scenario)
              : updater;
          return {
            ...worksheet,
            scenario: nextScenario,
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeWorksheetId],
  );

  const updateScenarioMeta = useCallback(
    (patch: Partial<Pick<Scenario, "name" | "description" | "tags">>) => {
      if (!activeWorksheetId) return;
      setWorksheets((current) =>
        current.map((worksheet) => {
          if (worksheet.id !== activeWorksheetId) return worksheet;
          return {
            ...worksheet,
            name: patch.name ?? worksheet.name,
            scenario: { ...worksheet.scenario, ...patch },
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeWorksheetId],
  );

  const runSchedule = useCallback(
    async (
      target: Scenario,
      options: { signal?: AbortSignal; announce?: boolean } = {},
    ) => {
      setIsScheduling(true);
      const targetKey = JSON.stringify(target);
      try {
        const result = await requestSchedule(target, options.signal);
        if (options.signal?.aborted) return null;
        setSchedule(result);
        setScheduleDiagnostics(result.diagnostics);
        lastScheduledKey.current = targetKey;
        if (!baselineCaptured.current) {
          setBaselineMakespan(result.metrics.makespan);
          baselineCaptured.current = true;
        }
        if (options.announce) {
          const cacheMessage =
            result.algorithm.includes("cache") ? " · 缓存命中" : "";
          showToast(
            `排程完成：${formatSeconds(result.metrics.makespan, 2)} · ${result.solve_time_ms} ms${cacheMessage}`,
            "success",
          );
        }
        return result;
      } catch (error) {
        if (options.signal?.aborted) return null;
        if (
          error instanceof ApiError &&
          (error.message.includes("登录") || error.message.includes("401"))
        ) {
          setAuthUser(null);
        }
        lastScheduledKey.current = "";
        const diagnostics =
          error instanceof ApiError && error.diagnostics.length
            ? error.diagnostics
            : [
                {
                  level: "error" as const,
                  title: "求解服务不可用",
                  detail: error instanceof Error ? error.message : "未知排程错误",
                  task_ids: [],
                },
              ];
        setScheduleDiagnostics(diagnostics);
        showToast("存在无法满足的排程约束", "error");
        return null;
      } finally {
        if (!options.signal?.aborted) setIsScheduling(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!scenario) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void runSchedule(scenario, { signal: controller.signal });
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scenario, runSchedule]);

  useEffect(() => {
    if (!authUser || !worksheets.length || !activeWorksheetId) return;
    const payload: SavedWorkspaces = {
      version: 3,
      activeWorksheetId,
      worksheets,
    };
    window.localStorage.setItem(
      `${STORAGE_KEY}:user:${authUser.id}`,
      JSON.stringify(payload),
    );
  }, [worksheets, activeWorksheetId, authUser]);

  useEffect(() => {
    setSchedule(null);
    setScheduleDiagnostics([]);
    setSearch("");
    baselineCaptured.current = false;
    setBaselineMakespan(null);
    lastScheduledKey.current = "";
  }, [activeWorksheetId]);

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    updateScenario((current) => ({
      ...current,
    tasks: current.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const nextTask = { ...task, ...patch };
      if (
        "duration" in patch &&
        nextTask.motion_type === "motion" &&
        patch.motion_duration_mode === undefined
      ) {
        nextTask.motion_duration_mode = "manual";
      }
      return nextTask;
    }),
    }));
  };

  const setLoopStart = (taskId: string) => {
    if (!scenario) return;
    const releaseTaskId =
      scenario.loop?.release_after_task_id ??
      scenario.tasks.at(-1)?.id;
    if (!releaseTaskId) return;
    updateScenario({
      ...scenario,
      loop: {
        start_task_id: taskId,
        release_after_task_id: releaseTaskId,
      },
    });
    showToast("已设为循环开始动作", "success");
  };

  const setLoopEnd = (taskId: string) => {
    if (!scenario) return;
    const startTaskId =
      scenario.loop?.start_task_id ??
      scenario.tasks[0]?.id;
    if (!startTaskId) return;
    updateScenario({
      ...scenario,
      loop: {
        start_task_id: startTaskId,
        release_after_task_id: taskId,
      },
    });
    showToast("已设为循环结束/回跳动作", "success");
  };

  const addTask = () => {
    if (!scenario) return;
    const lane = scenario.lanes[0];
    if (!lane) return;
    const task: Task = {
      id: uid(),
      name: "新动作",
      lane: lane.id,
      duration: 1,
      color: lane.color,
      category: "自定义",
      dependencies: [],
      stop_after: [],
      can_parallel: true,
      locked_resources: [],
      notes: "",
      manual_start: null,
      motion_type: "non_motion",
      motion_distance_mm: null,
      motion_velocity_mm_s: null,
      motion_acceleration_mm_s2: null,
      motion_duration_mode: "manual",
      dependency_delay_enabled: false,
      dependency_delay_seconds: 0,
    };
    updateScenario({
      ...scenario,
      tasks: [...scenario.tasks, task],
    });
    setSelectedTaskId(task.id);
    showToast("已添加动作，请在右侧编辑耗时与依赖", "info");
  };

  const deleteTask = () => {
    if (!scenario || !selectedTaskId) return;
    const task = scenario.tasks.find((item) => item.id === selectedTaskId);
    if (!task) return;
    if (!window.confirm(`删除“${task.name}”？相关依赖引用也会移除。`)) return;
    const remaining = scenario.tasks
      .filter((item) => item.id !== task.id)
      .map((item) => ({
        ...item,
        dependencies: item.dependencies.filter((id) => id !== task.id),
        stop_after: item.stop_after.filter((id) => id !== task.id),
        locked_resources: item.locked_resources.filter((id) => id !== task.id),
      }));
    updateScenario({ ...scenario, tasks: remaining });
    setSelectedTaskId(remaining[0]?.id ?? null);
    showToast("动作已删除", "info");
  };

  const duplicateTask = () => {
    if (!scenario || !selectedTaskId) return;
    const source = scenario.tasks.find((task) => task.id === selectedTaskId);
    if (!source) return;
    const copy: Task = {
      ...source,
      id: uid(),
      name: `${source.name} 副本`,
      dependencies: [...source.dependencies],
      stop_after: [...source.stop_after],
      locked_resources: [...source.locked_resources],
      manual_start: null,
    };
    const index = scenario.tasks.findIndex((task) => task.id === source.id);
    const tasks = [...scenario.tasks];
    tasks.splice(index + 1, 0, copy);
    updateScenario({ ...scenario, tasks });
    setSelectedTaskId(copy.id);
    showToast("动作副本已创建", "success");
  };

  const updateLane = (laneId: string, patch: Partial<Lane>) => {
    updateScenario((current) => ({
      ...current,
      lanes: current.lanes.map((lane) =>
        lane.id === laneId ? { ...lane, ...patch } : lane,
      ),
    }));
  };

  const addExecutionUnit = () => {
    if (!scenario) return;
    const number = scenario.lanes.length + 1;
    const colors = [
      "#3978F6",
      "#18A586",
      "#8B5CF6",
      "#F5A623",
      "#D96C3B",
      "#E65F73",
      "#475569",
      "#0EA5C6",
    ];
    updateScenario({
      ...scenario,
      lanes: [
        ...scenario.lanes,
        {
          id: uid("lane"),
          name: `执行单元 ${number}`,
          short_name: `U${number}`,
          color: colors[(number - 1) % colors.length],
          description: "",
        },
      ],
    });
    showToast(`已新增执行单元 ${number}`, "success");
  };

  const deleteExecutionUnit = (laneId: string) => {
    if (!scenario || scenario.lanes.length <= 1) return;
    const lane = scenario.lanes.find((item) => item.id === laneId);
    if (!lane) return;
    const usage = scenario.tasks.filter(
      (task) => task.lane === laneId || task.locked_resources.includes(laneId),
    ).length;
    if (
      !window.confirm(
        usage
          ? `“${lane.name}”关联 ${usage} 个动作。删除后这些动作会转移到剩余执行单元，是否继续？`
          : `删除执行单元“${lane.name}”？`,
      )
    ) {
      return;
    }
    const remaining = scenario.lanes.filter((item) => item.id !== laneId);
    const remainingIds = new Set(remaining.map((item) => item.id));
    const fallbackLane = remaining[0].id;
    let reassigned = 0;
    const tasks = scenario.tasks.map((task) => {
      const nextLane = remainingIds.has(task.lane) ? task.lane : fallbackLane;
      if (nextLane !== task.lane) reassigned += 1;
      return {
        ...task,
        lane: nextLane,
        locked_resources: task.locked_resources.filter((id) =>
          remainingIds.has(id),
        ),
      };
    });
    updateScenario({ ...scenario, lanes: remaining, tasks });
    showToast(
      reassigned
        ? `执行单元已删除，${reassigned} 个动作已转移到 ${remaining[0].name}`
        : "执行单元已删除",
      "info",
    );
  };

  const switchWorksheet = (worksheetId: string) => {
    if (worksheetId === activeWorksheetId) return;
    const target = worksheets.find((worksheet) => worksheet.id === worksheetId);
    if (!target) return;
    setActiveWorksheetId(worksheetId);
    setSelectedTaskId(target.scenario.tasks[0]?.id ?? null);
  };

  const createWorksheet = () => {
    const base = scenario ?? demoRef.current;
    if (!base) return;
    const sequence = worksheets.length + 1;
    const name = `工作表 ${sequence}`;
    const worksheet = makeWorksheet(name, {
      ...base,
      id: uid("scenario"),
      name,
      description: "空白工作表",
      repeat_count: 1,
      tasks: [],
    });
    setWorksheets((current) => [...current, worksheet]);
    setActiveWorksheetId(worksheet.id);
    setSelectedTaskId(null);
    showToast("已新建空白工作表", "success");
  };

  const duplicateWorksheet = () => {
    if (!activeWorksheet) return;
    const copy = makeWorksheet(
      `${activeWorksheet.name} 副本`,
      cloneScenario(activeWorksheet.scenario),
    );
    copy.scenario.id = uid("scenario");
    copy.scenario.name = copy.name;
    setWorksheets((current) => [...current, copy]);
    setActiveWorksheetId(copy.id);
    setSelectedTaskId(copy.scenario.tasks[0]?.id ?? null);
    showToast("工作表已复制", "success");
  };

  const renameWorksheet = () => {
    if (!activeWorksheet) return;
    const name = window.prompt("工作表名称", activeWorksheet.name)?.trim();
    if (!name) return;
    setWorksheets((current) =>
      current.map((worksheet) =>
        worksheet.id === activeWorksheet.id
          ? {
              ...worksheet,
              name,
              scenario: { ...worksheet.scenario, name },
              updatedAt: Date.now(),
            }
          : worksheet,
      ),
    );
  };

  const deleteWorksheet = () => {
    if (!activeWorksheet || worksheets.length <= 1) return;
    if (!window.confirm(`删除工作表“${activeWorksheet.name}”？`)) return;
    const index = worksheets.findIndex(
      (worksheet) => worksheet.id === activeWorksheet.id,
    );
    const remaining = worksheets.filter(
      (worksheet) => worksheet.id !== activeWorksheet.id,
    );
    const next = remaining[Math.max(0, Math.min(index - 1, remaining.length - 1))];
    setWorksheets(remaining);
    setActiveWorksheetId(next.id);
    setSelectedTaskId(next.scenario.tasks[0]?.id ?? null);
  };

  const exportScenario = () => {
    if (!scenario || !activeWorksheet) return;
    downloadFile(
      `${safeFilename(activeWorksheet.name)}.json`,
      JSON.stringify(scenario, null, 2),
      "application/json",
    );
    showToast("完整场景 JSON 已导出", "success");
  };

  const exportAllWorksheets = () => {
    if (!worksheets.length) return;
    const payload: SavedWorkspaces = {
      version: 3,
      activeWorksheetId: activeWorksheetId ?? worksheets[0].id,
      worksheets,
    };
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replaceAll(":", "-");
    downloadFile(
      `ACTO-全部工作表-${timestamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    showToast(`已导出 ${worksheets.length} 个工作表`, "success");
  };

  const exportCsv = () => {
    if (!scenario || !activeWorksheet) return;
    downloadFile(
      `${safeFilename(activeWorksheet.name)}-动作表.csv`,
      `\uFEFF${scenarioToCsv(scenario)}`,
      "text/csv;charset=utf-8",
    );
    showToast("动作约束表已导出 CSV", "success");
  };

  const downloadJsonTemplate = () => {
    const base = scenario ?? demoRef.current;
    if (!base) return;
    downloadFile(
      "ACTO-场景模板.json",
      JSON.stringify({ ...base, name: "ACTO 示例场景" }, null, 2),
      "application/json",
    );
  };

  const downloadCsvTemplate = () => {
    const base = scenario ?? demoRef.current;
    if (!base) return;
    downloadFile(
      "ACTO-动作表模板.csv",
      `\uFEFF${scenarioToCsv(base)}`,
      "text/csv;charset=utf-8",
    );
  };

  const importScenario = async (file: File) => {
    if (!scenario) return;
    try {
      const content = await file.text();
      const extension = file.name.split(".").pop()?.toLowerCase();
      const importedName = file.name.replace(/\.[^.]+$/, "");
      let imported: Scenario;
      if (extension === "json") {
        const parsed = JSON.parse(content);
        if (!isScenario(parsed)) throw new Error("文件不是有效的 ACTO 场景 JSON");
        imported = mergeLegacyDependencies({
          ...parsed,
          id: uid("scenario"),
        });
      } else if (extension === "csv") {
        imported = scenarioFromCsv(
          content,
          scenario,
          importedName || "导入工作表",
        );
      } else {
        throw new Error("仅支持 .json 场景文件或 .csv 动作表");
      }
      const worksheet = makeWorksheet(importedName || imported.name, imported);
      setWorksheets((current) => [...current, worksheet]);
      setActiveWorksheetId(worksheet.id);
      setSelectedTaskId(imported.tasks[0]?.id ?? null);
      setIsImportDialogOpen(false);
      showToast(
        extension === "json"
          ? "完整场景已导入为新工作表"
          : "CSV 动作表已导入为新工作表",
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "无法导入场景文件",
        "error",
      );
    }
  };

  const resetDemo = async () => {
    if (!activeWorksheet) return;
    if (!window.confirm("将当前工作表恢复为初始示例？当前修改会被覆盖。")) {
      return;
    }
    try {
      const demo = await fetchDemoScenario();
      updateScenario({
        ...cloneScenario(demo),
        id: uid("scenario"),
      });
      setSelectedTaskId(demo.tasks[0]?.id ?? null);
      showToast("当前工作表已恢复为示例", "info");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "无法恢复示例场景",
        "error",
      );
    }
  };

  const signOut = async () => {
    setIsProfileMenuOpen(false);
    setIsAccountManagerOpen(false);
    await logoutSession();
    setAuthUser(null);
    setWorksheets([]);
    setActiveWorksheetId(null);
    setSchedule(null);
    setScheduleDiagnostics([]);
  };

  if (isAuthChecking) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">A</div>
        <div className="boot-spinner">
          <LoaderCircle size={22} className="spin" />
        </div>
        <h1>正在验证登录</h1>
        <p>检查账号会话…</p>
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen onAuthenticated={setAuthUser} />;
  }

  if (isBooting && !scenario) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">A</div>
        <div className="boot-spinner">
          <LoaderCircle size={22} className="spin" />
        </div>
        <h1>正在启动 ACTO</h1>
        <p>恢复工作表并连接约束排程服务…</p>
      </div>
    );
  }

  if (bootstrapError || !scenario || !activeWorksheet) {
    return (
      <div className="boot-screen boot-error">
        <div className="boot-mark">A</div>
        <AlertCircle size={24} />
        <h1>无法启动 ACTO</h1>
        <p>{bootstrapError ?? "工作表为空"}</p>
        <button className="button button-primary" onClick={() => void boot()}>
          <RefreshCw size={15} />
          重新连接
        </button>
        <code>cd ~/Documents/develop/ACTO && npm run dev</code>
      </div>
    );
  }

  const taskCodes = new Map(
    scenario.tasks.map((task, index) => [task.id, taskCode(index)]),
  );
  const selectedTask =
    scenario.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedSchedule =
    schedule?.scheduled_tasks.find(
      (task) =>
        (task.template_id ?? task.id) === selectedTaskId &&
        (task.iteration ?? 1) === 1,
    ) ?? null;
  const selectedLaneMetric =
    schedule?.metrics.lane_metrics.find(
      (metric) => metric.lane === selectedTask?.lane,
    ) ?? null;
  const criticalIds = new Set(
    schedule?.scheduled_tasks
      .filter((task) => task.critical)
      .map((task) => task.template_id ?? task.id) ?? [],
  );
  const primaryDiagnostic =
    scheduleDiagnostics.find((item) => item.level === "error") ??
    scheduleDiagnostics.find((item) => item.level === "warning") ??
    scheduleDiagnostics.find((item) => item.level === "info");
  const errorDiagnostics = scheduleDiagnostics.filter(
    (item) => item.level === "error",
  );
  const hasErrors = scheduleDiagnostics.some((item) => item.level === "error");
  const repeatCount = scenario.repeat_count ?? 1;
  const loopStartTaskId =
    scenario.loop?.start_task_id ?? scenario.tasks[0]?.id ?? null;
  const loopReleaseTaskId =
    scenario.loop?.release_after_task_id ??
    scenario.tasks.at(-1)?.id ??
    null;
  const ctStartTaskId =
    scenario.ct_range?.start_task_id ?? loopStartTaskId;
  const ctEndTaskId =
    scenario.ct_range?.end_task_id ?? loopReleaseTaskId;
  const cycleTiming =
    hasErrors || !schedule
      ? null
      : calculateCycleTiming(
          schedule,
          repeatCount,
          ctStartTaskId,
          ctEndTaskId,
        );
  const cycleTime = cycleTiming?.average ?? null;
  const shortestCycleTime = cycleTiming?.shortest ?? null;
  const parallelWindows =
    schedule && !hasErrors
      ? computeParallelWindows(schedule, scenario)
      : [];
  const totalParallelDuration = parallelWindows.reduce(
    (total, window) => total + window.duration,
    0,
  );
  const selectedTaskCode = selectedTaskId
    ? (taskCodes.get(selectedTaskId) ?? "—")
    : "—";

  const optimizeNow = () => {
    const automaticScenario: Scenario = {
      ...scenario,
      tasks: scenario.tasks.map((task) => ({
        ...task,
        manual_start: null,
      })),
    };
    const manualCount = scenario.tasks.filter(
      (task) => task.manual_start != null,
    ).length;
    if (manualCount) updateScenario(automaticScenario);
    const key = JSON.stringify(automaticScenario);
    if (schedule && lastScheduledKey.current === key && !hasErrors) {
      showToast(
        `当前结果已是最新：${formatSeconds(schedule.metrics.makespan, 2)}，无需重复求解`,
        "info",
      );
      return;
    }
    void runSchedule(automaticScenario, { announce: true });
  };

  const clearManualMoves = () => {
    if (!scenario.tasks.some((task) => task.manual_start != null)) return;
    updateScenario({
      ...scenario,
      tasks: scenario.tasks.map((task) => ({
        ...task,
        manual_start: null,
      })),
    });
    showToast("已清除全部手动调整，正在恢复自动排程", "info");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark">
            <span>ACTO</span>
            <i />
          </div>
          <div className="brand-copy">
            <div>
              <strong>Cycle Studio</strong>
              <span className="version-pill">{APP_VERSION}</span>
            </div>
            <p>Automation Cycle Time Optimizer</p>
          </div>
        </div>

        <div className="worksheet-switcher" ref={worksheetMenuRef}>
          <button
            type="button"
            className={`project-breadcrumb ${
              isWorksheetMenuOpen ? "active" : ""
            }`}
            onClick={() => setIsWorksheetMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={isWorksheetMenuOpen}
          >
            <Layers3 size={13} />
            <span className="project-title">{activeWorksheet.name}</span>
            <ChevronDown size={14} className="worksheet-chevron" />
          </button>

          {isWorksheetMenuOpen && (
            <div
              className="worksheet-menu"
              role="listbox"
              aria-label="选择工作表"
            >
              <div className="worksheet-menu-head">
                <span>切换工作表</span>
                <small>{worksheets.length} 个</small>
              </div>
              <div className="worksheet-menu-list">
                {worksheets.map((worksheet) => {
                  const active = worksheet.id === activeWorksheetId;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={active ? "active" : ""}
                      key={worksheet.id}
                      onClick={() => {
                        switchWorksheet(worksheet.id);
                        setIsWorksheetMenuOpen(false);
                      }}
                    >
                      <span className="worksheet-menu-icon">
                        <FileSpreadsheet size={15} />
                      </span>
                      <span className="worksheet-menu-copy">
                        <strong>{worksheet.name}</strong>
                        <small>
                          {worksheet.scenario.tasks.length} 个动作 ·{" "}
                          {worksheet.scenario.lanes.length} 个执行单元
                        </small>
                      </span>
                      {active && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="worksheet-menu-add"
                onClick={() => {
                  createWorksheet();
                  setIsWorksheetMenuOpen(false);
                }}
              >
                <Plus size={14} />
                新建工作表
              </button>
            </div>
          )}
        </div>

        <div className="topbar-actions">
          <div className="font-scale-control" ref={fontMenuRef}>
            <button
              type="button"
              className={`font-scale-button ${
                isFontMenuOpen ? "active" : ""
              }`}
              onClick={() => {
                setIsWorksheetMenuOpen(false);
                setIsFontMenuOpen((open) => !open);
              }}
              aria-haspopup="dialog"
              aria-expanded={isFontMenuOpen}
              title="调整整体界面字号"
            >
              <ALargeSmall size={15} />
              字号 {Math.round(uiScale * 100)}%
              <ChevronDown size={12} />
            </button>
            {isFontMenuOpen && (
              <section className="font-scale-menu" aria-label="界面字号设置">
                <div className="font-scale-head">
                  <span>
                    <ALargeSmall size={14} />
                    界面字号
                  </span>
                  <strong>{Math.round(uiScale * 100)}%</strong>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  step="10"
                  value={Math.round(uiScale * 100)}
                  onChange={(event) =>
                    changeUiScale(Number(event.target.value) / 100)
                  }
                  aria-label="界面字号百分比"
                />
                <div className="font-scale-step-row">
                  <button
                    type="button"
                    onClick={() => changeUiScale(uiScale - 0.5)}
                    disabled={uiScale <= 0.5}
                  >
                    −50%
                  </button>
                  <span>按 50% 快速调整</span>
                  <button
                    type="button"
                    onClick={() => changeUiScale(uiScale + 0.5)}
                    disabled={uiScale >= 2}
                  >
                    +50%
                  </button>
                </div>
                <div className="font-scale-options">
                  {UI_SCALE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={
                        Math.abs(uiScale - option.value) < 0.001
                          ? "active"
                          : ""
                      }
                      onClick={() => changeUiScale(option.value)}
                    >
                      <span
                        style={{
                          fontSize: `calc(${8 + option.value * 2}px * var(--font-scale, 1))`,
                        }}
                      >
                        A
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="font-scale-foot">
                  <span>范围 50%–200%，默认 130%</span>
                  <button type="button" onClick={() => changeUiScale(1.3)}>
                    恢复 130%
                  </button>
                </div>
              </section>
            )}
          </div>
          <div
            className={`api-state ${hasErrors ? "api-state-error" : ""}`}
            title="FastAPI + OR-Tools，输入未变化时使用缓存"
          >
            <Wifi size={13} />
            {hasErrors ? "约束异常" : "求解服务在线"}
          </div>
          <button
            className="top-action"
            type="button"
            onClick={() => setIsImportDialogOpen(true)}
          >
            <UploadCloud size={15} />
            导入场景
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,text/csv,.csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importScenario(file);
              event.target.value = "";
            }}
          />
          <button className="top-action" type="button" onClick={exportScenario}>
            <Download size={15} />
            导出场景
          </button>
          <button
            className="top-action icon-only"
            type="button"
            onClick={() => void resetDemo()}
            title="恢复当前工作表"
          >
            <RotateCcw size={15} />
          </button>
          <div className="profile-menu-control" ref={profileMenuRef}>
            <button
              className={`avatar-button ${
                isProfileMenuOpen ? "active" : ""
              }`}
              type="button"
              title="账户与工作区"
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              onClick={() => {
                setIsWorksheetMenuOpen(false);
                setIsProfileMenuOpen((open) => !open);
              }}
            >
              {(authUser.display_name || authUser.username)
                .slice(0, 2)
                .toUpperCase()}
              <span />
            </button>

            {isProfileMenuOpen && (
              <section className="profile-menu" role="menu">
                <header className="profile-menu-head">
                  <div className="profile-avatar-large">
                    {(authUser.display_name || authUser.username)
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div>
                    <strong>{authUser.display_name}</strong>
                    <span>@{authUser.username}</span>
                  </div>
                  <span className="profile-online">
                    {authUser.role === "admin" ? "管理员" : "已登录"}
                  </span>
                </header>
                <div className="profile-workspace-state">
                  <Cloud size={14} />
                  <div>
                    <strong>{worksheets.length} 个工作表</strong>
                    <span>已自动保存到当前浏览器</span>
                  </div>
                </div>
                <div className="profile-menu-actions">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      exportAllWorksheets();
                      setIsProfileMenuOpen(false);
                    }}
                  >
                    <Download size={15} />
                    <span>
                      <strong>导出全部工作表</strong>
                      <small>下载完整 JSON 工程文件</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      void resetDemo();
                    }}
                  >
                    <RotateCcw size={15} />
                    <span>
                      <strong>恢复当前示例</strong>
                      <small>覆盖当前工作表中的修改</small>
                    </span>
                  </button>
                  {authUser.role === "admin" && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        setIsAccountManagerOpen(true);
                      }}
                    >
                      <UsersRound size={15} />
                      <span>
                        <strong>账号管理</strong>
                        <small>创建普通用户或管理员账号</small>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void signOut()}
                  >
                    <LogOut size={15} />
                    <span>
                      <strong>退出登录</strong>
                      <small>结束当前浏览器会话</small>
                    </span>
                  </button>
                </div>
                <footer className="profile-menu-footer">
                  <span>ACTO {APP_VERSION} · CP-SAT</span>
                  <span className="profile-menu-copyright">
                    copyright: Agile Robot ISA Control。
                  </span>
                  <span className="profile-menu-copyright">
                    联系人：
                    <a href="mailto:xingchen.li@agile-robots.com">
                      xingchen.li@agile-robots.com
                    </a>
                  </span>
                </footer>
              </section>
            )}
          </div>
        </div>
      </header>

      <nav className="sheet-bar" aria-label="工作表">
        <div className="sheet-bar-title">
          <Layers3 size={13} />
          工作表
        </div>
        <div className="sheet-tabs" role="tablist">
          {worksheets.map((worksheet) => (
            <button
              type="button"
              role="tab"
              aria-selected={worksheet.id === activeWorksheetId}
              className={`sheet-tab ${
                worksheet.id === activeWorksheetId ? "active" : ""
              }`}
              key={worksheet.id}
              onClick={() => switchWorksheet(worksheet.id)}
              onDoubleClick={() => {
                switchWorksheet(worksheet.id);
                window.setTimeout(() => {
                  const name = window
                    .prompt("重命名工作表", worksheet.name)
                    ?.trim();
                  if (!name) return;
                  setWorksheets((current) =>
                    current.map((item) =>
                      item.id === worksheet.id
                        ? {
                            ...item,
                            name,
                            scenario: { ...item.scenario, name },
                            updatedAt: Date.now(),
                          }
                        : item,
                    ),
                  );
                }, 0);
              }}
              title="双击重命名"
            >
              <FileSpreadsheet size={13} />
              <span>{worksheet.name}</span>
              <small>{worksheet.scenario.tasks.length}</small>
            </button>
          ))}
        </div>
        <button
          className="sheet-add"
          type="button"
          onClick={createWorksheet}
        >
          <Plus size={13} />
          新建工作表
        </button>
        <div className="sheet-actions">
          <button type="button" onClick={renameWorksheet} title="重命名工作表">
            <PencilLine size={13} />
          </button>
          <button type="button" onClick={duplicateWorksheet} title="复制工作表">
            <Copy size={13} />
          </button>
          <button
            type="button"
            onClick={deleteWorksheet}
            disabled={worksheets.length <= 1}
            title="删除工作表"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </nav>

      <main
        className={`workspace ${
          isInspectorCollapsed ? "inspector-collapsed" : ""
        }`}
      >
        <TaskSidebar
          scenario={scenario}
          selectedTaskId={selectedTaskId}
          search={search}
          criticalIds={criticalIds}
          taskCodes={taskCodes}
          hasErrors={hasErrors}
          onSearch={setSearch}
          onSelect={setSelectedTaskId}
          onAdd={addTask}
          mode={sidebarMode}
          onUpdateScenarioMeta={updateScenarioMeta}
          onModeChange={setSidebarMode}
          onAddLane={addExecutionUnit}
          onUpdateLane={updateLane}
          onDeleteLane={deleteExecutionUnit}
          onSetLoopStart={setLoopStart}
          onSetLoopEnd={setLoopEnd}
        />

        <section className="main-workspace">
          <MetricGrid
            scenario={scenario}
            schedule={schedule}
            baselineMakespan={baselineMakespan}
            hasErrors={hasErrors}
            repeatCount={repeatCount}
          />

          <RepeatSummary
            repeatCount={repeatCount}
            cycleTime={cycleTime}
            shortestCycleTime={shortestCycleTime}
            tasks={scenario.tasks}
            loopStartTaskId={loopStartTaskId}
            loopReleaseTaskId={loopReleaseTaskId}
            ctStartTaskId={ctStartTaskId}
            ctEndTaskId={ctEndTaskId}
            onRepeatCountChange={(count) => {
              const nextLoop =
                scenario.loop ??
                (scenario.tasks.length
                  ? {
                      start_task_id: scenario.tasks[0].id,
                      release_after_task_id: scenario.tasks.at(-1)!.id,
                    }
                  : null);
              updateScenario({
                ...scenario,
                repeat_count: count,
                loop: nextLoop,
              });
            }}
            onLoopChange={(startTaskId, releaseTaskId) =>
              updateScenario({
                ...scenario,
                loop: {
                  start_task_id: startTaskId,
                  release_after_task_id: releaseTaskId,
                },
              })
            }
            onCtRangeChange={(startTaskId, endTaskId) =>
              updateScenario((current) => ({
                ...current,
                ct_range: {
                  start_task_id: startTaskId,
                  end_task_id: endTaskId,
                },
              }))
            }
          />

          {hasErrors ? (
            <section className="diagnostic-panel" role="alert">
              <header className="diagnostic-panel-head">
                <div>
                  <span className="diagnostic-alert-icon">
                    <AlertCircle size={16} />
                  </span>
                  <strong>约束异常 · {errorDiagnostics.length} 项</strong>
                  <span>
                    {schedule
                      ? "当前图表显示的是上次可行结果"
                      : "当前工作表中没有有效排程结果"}
                  </span>
                </div>
                <span className="diagnostic-fix-hint">修复后自动重新排程</span>
              </header>
              <div className="diagnostic-list">
                {errorDiagnostics.map((diagnostic, index) => (
                  <article
                    className="diagnostic-item"
                    key={`${diagnostic.title}-${index}`}
                  >
                    <span className="diagnostic-index">{index + 1}</span>
                    <div>
                      <strong>{diagnostic.title}</strong>
                      <p>{diagnostic.detail}</p>
                      {diagnostic.task_ids.length > 0 && (
                        <div className="diagnostic-task-list">
                          {diagnostic.task_ids.map((taskId) => {
                            const task = scenario.tasks.find(
                              (item) => item.id === taskId,
                            );
                            if (!task) return null;
                            return (
                              <button
                                type="button"
                                key={taskId}
                                onClick={() => {
                                  setSidebarMode("tasks");
                                  setSelectedTaskId(taskId);
                                }}
                              >
                                {taskCodes.get(taskId) ?? "—"} · {task.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : SHOW_SCHEDULING_INSIGHT ? (
            <>
              <div className="insight-line">
                <span className="insight-icon">
                  <Sparkles size={15} />
                </span>
                <span className="insight-label">排程洞察</span>
                <span className="insight-message">
                  {parallelWindows.length > 0
                    ? `发现 ${parallelWindows.length} 个并行窗口，累计并行 ${formatSeconds(totalParallelDuration)}`
                    : primaryDiagnostic
                      ? `${primaryDiagnostic.title}：${primaryDiagnostic.detail}`
                      : isScheduling
                        ? "正在搜索满足全部约束的最短动作序列…"
                        : "CP-SAT 精确求解；场景未变化时重新优化直接复用缓存。"}
                </span>
                {parallelWindows.length > 0 && (
                  <button
                    type="button"
                    className={`insight-parallel-toggle ${
                      isParallelDetailsOpen ? "open" : ""
                    }`}
                    onClick={() =>
                      setIsParallelDetailsOpen((open) => !open)
                    }
                  >
                    并行任务明细
                    <ChevronDown size={12} />
                  </button>
                )}
                <span className="insight-side">
                  <Braces size={13} />
                  {schedule?.metrics.dependency_count ?? 0} 条约束
                </span>
              </div>

              {parallelWindows.length > 0 && isParallelDetailsOpen && (
                <section className="parallel-window-panel">
                  <header>
                    <span>
                      <Sparkles size={13} />
                      并行窗口
                    </span>
                    <small>
                      基于首循环模板，不同执行单元同时执行的动作
                    </small>
                    <strong>{parallelWindows.length} 组</strong>
                  </header>
                  <div className="parallel-window-list">
                    {parallelWindows.map((window, index) => (
                      <article key={window.id}>
                        <div className="parallel-window-time">
                          <strong>#{index + 1}</strong>
                          <span>
                            {formatSeconds(window.start, 1)}–
                            {formatSeconds(window.end, 1)}
                          </span>
                          <em>{formatSeconds(window.duration, 1)}</em>
                        </div>
                        <div className="parallel-window-tasks">
                          {window.tasks.map((task) => (
                            <button
                              type="button"
                              key={task.instanceId}
                              onClick={() => {
                                setSidebarMode("tasks");
                                setSelectedTaskId(task.taskId);
                              }}
                              title={`${task.code} · ${task.name} · ${task.laneName}`}
                            >
                              <i style={{ background: task.laneColor }} />
                              <span>{task.code}</span>
                              <strong>{task.name}</strong>
                              <small>{task.laneName}</small>
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : null}

          <GanttChart
            scenario={scenario}
            schedule={schedule}
            selectedTaskId={selectedTaskId}
            taskCodes={taskCodes}
            isScheduling={isScheduling}
            hasErrors={hasErrors}
            errorCount={errorDiagnostics.length}
            repeatCount={repeatCount}
            cycleTime={cycleTime}
            shortestCycleTime={shortestCycleTime}
            fontScale={uiScale}
            onSelect={setSelectedTaskId}
            onExportCsv={exportCsv}
            onRunOptimize={optimizeNow}
            onNotify={showToast}
            onTaskTimeChange={(taskId, patch) => updateTask(taskId, patch)}
            onClearManualMoves={clearManualMoves}
          />
        </section>

        <Inspector
          task={selectedTask}
          taskCode={selectedTaskCode}
          tasks={scenario.tasks}
          lanes={scenario.lanes}
          scheduledTask={selectedSchedule}
          laneMetric={selectedLaneMetric}
          isCollapsed={isInspectorCollapsed}
          onToggleCollapsed={() =>
            setIsInspectorCollapsed((collapsed) => !collapsed)
          }
          onChange={(patch) => {
            if (selectedTaskId) updateTask(selectedTaskId, patch);
          }}
          onDelete={deleteTask}
          onDuplicate={duplicateTask}
          onManageUnits={() => setSidebarMode("units")}
        />
      </main>

      <div className="status-footer">
        <span>
          <Cloud size={12} />
          本地自动保存 · {worksheets.length} 个工作表
        </span>
        <span>
          <Cpu size={12} />
          CP-SAT · {schedule?.solve_time_ms ?? "—"} ms
        </span>
        <span>
          <Database size={12} />
          {scenario.tasks.length} 个动作 / {scenario.lanes.length} 个执行单元
          {" · "}重复 ×{repeatCount}
        </span>
        <span className="status-footer-right">
          <Gauge size={12} />
          目标：最短 CT
        </span>
      </div>

      {isImportDialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setIsImportDialogOpen(false)}
        >
          <section
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="dialog-head">
              <div>
                <span className="eyebrow">导入到新工作表</span>
                <h2 id="import-title">选择场景文件</h2>
              </div>
              <button
                type="button"
                className="dialog-close"
                onClick={() => setIsImportDialogOpen(false)}
              >
                <X size={16} />
              </button>
            </header>

            <div className="import-options">
              <button
                type="button"
                className="import-option"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="import-option-icon json">
                  <FileJson size={21} />
                </span>
                <span>
                  <strong>完整场景 · JSON</strong>
                  <small>
                    保留执行单元、动作颜色、统一前置依赖和所有工程属性。
                  </small>
                  <em>.json · 推荐</em>
                </span>
              </button>
              <button
                type="button"
                className="import-option"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="import-option-icon csv">
                  <Table2 size={21} />
                </span>
                <span>
                  <strong>动作清单 · CSV</strong>
                  <small>
                    Excel 可编辑后另存为 CSV UTF-8；执行单元沿用当前工作表。
                  </small>
                  <em>.csv · 适合表格维护</em>
                </span>
              </button>
            </div>

            <div className="import-note">
              <Info size={15} />
              <span>
                当前不直接解析 Excel 的 .xlsx/.xls 文件。请在 Excel 中选择
                “另存为 → CSV UTF-8”，再从这里导入。
              </span>
            </div>

            <div className="template-row">
              <span>下载模板：</span>
              <button type="button" onClick={downloadJsonTemplate}>
                <FileJson size={13} />
                场景 JSON
              </button>
              <button type="button" onClick={downloadCsvTemplate}>
                <Table2 size={13} />
                动作 CSV
              </button>
            </div>

            <footer className="dialog-footer">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setIsImportDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <FolderOpen size={15} />
                选择 JSON / CSV 文件
              </button>
            </footer>
          </section>
        </div>
      )}

      {isAccountManagerOpen && authUser.role === "admin" && (
        <AccountManager
          currentUser={authUser}
          onClose={() => setIsAccountManagerOpen(false)}
          onNotify={showToast}
        />
      )}

      {toast && (
        <div className={`toast toast-${toast.tone}`} key={toast.id}>
          <span className="toast-symbol">
            {toast.tone === "success" ? (
              <Check size={15} />
            ) : toast.tone === "error" ? (
              <AlertCircle size={15} />
            ) : (
              <Lightbulb size={15} />
            )}
          </span>
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
