import {
  Blocks,
  CircleGauge,
  GitBranch,
  TimerReset,
} from "lucide-react";
import type { Scenario, ScheduleResult } from "../types";
import { formatSeconds } from "../utils";

type Props = {
  scenario: Scenario;
  schedule: ScheduleResult | null;
  baselineMakespan: number | null;
  hasErrors: boolean;
  repeatCount: number;
};

export default function MetricGrid({
  scenario,
  schedule,
  baselineMakespan,
  hasErrors,
  repeatCount,
}: Props) {
  const metrics = schedule?.metrics;
  const effectiveRepeat = schedule?.repeat_count ?? repeatCount;
  const bottleneck = scenario.lanes.find(
    (lane) => lane.id === metrics?.bottleneck_lane,
  );
  return (
    <section className="metric-grid" aria-label="排程关键指标">
      <article className="metric-card metric-primary">
        <div className="metric-icon">
          <TimerReset size={18} />
        </div>
        <div className="metric-copy">
          <span className="metric-label">批次总时间</span>
          <strong>
            {metrics ? formatSeconds(metrics.makespan) : "—"}
          </strong>
          <span
            className={`metric-foot ${hasErrors ? "metric-foot-error" : ""}`}
          >
            {hasErrors
              ? schedule
                ? "上次可行解 · 当前约束异常"
                : "无有效排程结果 · 请修复约束"
              : metrics
                ? `共 ${effectiveRepeat} 次循环`
                : "等待排程结果"}
          </span>
        </div>
        <span className="metric-sequence">01</span>
      </article>

      <article className="metric-card">
        <div className="metric-icon metric-icon-violet">
          <Blocks size={18} />
        </div>
        <div className="metric-copy">
          <span className="metric-label">并行重合</span>
          <strong>{metrics ? formatSeconds(metrics.overlap_time) : "—"}</strong>
          <span className="metric-foot">
            并行效率 {metrics?.parallel_efficiency.toFixed(0) ?? "—"}%
          </span>
        </div>
      </article>

      <article
        className="metric-card"
        title="瓶颈单元：执行单元占用时间除以批次总时间后，利用率最高的执行单元。"
      >
        <div className="metric-icon metric-icon-orange">
          <CircleGauge size={18} />
        </div>
        <div className="metric-copy">
          <span className="metric-label">瓶颈单元</span>
          <strong className="metric-text">
            {bottleneck?.name.split(" / ")[0] ?? "—"}
          </strong>
          <span className="metric-foot">
            利用率 {metrics?.bottleneck_utilization.toFixed(0) ?? "—"}%
          </span>
        </div>
      </article>

      <article
        className="metric-card"
        title="关键路径：由实际排程中决定批次完成时间的动作、依赖等待和同单元串行关系组成的零余量链。"
      >
        <div className="metric-icon metric-icon-green">
          <GitBranch size={18} />
        </div>
        <div className="metric-copy">
          <span className="metric-label">关键路径</span>
          <strong>
            {metrics?.critical_task_count ?? "—"}
            <small> 个动作</small>
          </strong>
          <span className="metric-foot">
            约束时长{" "}
            {metrics ? formatSeconds(metrics.critical_path_duration) : "—"}
          </span>
        </div>
      </article>
    </section>
  );
}

