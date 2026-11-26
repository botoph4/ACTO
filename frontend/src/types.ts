export type Lane = {
  id: string;
  name: string;
  short_name: string;
  color: string;
  description: string;
  capacity?: number;
};

export type Task = {
  id: string;
  name: string;
  lane: string;
  duration: number;
  color: string;
  category: string;
  dependencies: string[];
  stop_after: string[];
  can_parallel: boolean;
  locked_resources: string[];
  notes: string;
  manual_start?: number | null;
  motion_type?: "motion" | "non_motion";
  motion_distance_mm?: number | null;
  motion_velocity_mm_s?: number | null;
  motion_acceleration_mm_s2?: number | null;
  motion_duration_mode?: "auto" | "manual";
  dependency_delay_enabled?: boolean;
  dependency_delay_seconds?: number;
};

export type LoopConfig = {
  start_task_id: string;
  release_after_task_id: string;
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  repeat_count?: number;
  loop?: LoopConfig | null;
  lanes: Lane[];
  tasks: Task[];
};

export type ScheduledTask = {
  id: string;
  start: number;
  end: number;
  duration: number;
  lane: string;
  critical: boolean;
  waiting_for_dependency: number;
  waiting_for_resource: number;
  driver: string | null;
  template_id?: string | null;
  iteration?: number;
};

export type LaneMetric = {
  lane: string;
  busy_time: number;
  utilization: number;
  task_count: number;
};

export type ScheduleMetrics = {
  makespan: number;
  critical_path_duration: number;
  critical_task_count: number;
  total_busy_time: number;
  parallel_efficiency: number;
  overlap_time: number;
  bottleneck_lane: string | null;
  bottleneck_utilization: number;
  lane_metrics: LaneMetric[];
  dependency_count: number;
  exclusive_task_count: number;
};

export type Diagnostic = {
  level: "error" | "warning" | "info";
  title: string;
  detail: string;
  task_ids: string[];
};

export type ScheduleResult = {
  scenario_id: string;
  status: "optimal" | "feasible" | "infeasible" | "unknown";
  algorithm: string;
  solve_time_ms: number;
  repeat_count?: number;
  scheduled_tasks: ScheduledTask[];
  metrics: ScheduleMetrics;
  diagnostics: Diagnostic[];
};

export type Worksheet = {
  id: string;
  name: string;
  scenario: Scenario;
  updatedAt: number;
};

export type AuthUser = {
  id: number;
  username: string;
  display_name: string;
  role: "user" | "admin";
};

export type ManagedUser = AuthUser & {
  last_seen_at: number | null;
  is_online: boolean;
};
