import {
  Blocks,
  CircleGauge,
  Clock3,
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
  const laneMetricMap = new Map(
    metrics?.lane_metrics.map((metric) => [metric.lane, metric]) ?? [],
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
        className="metric-card metric-detail-card"
        title="利用率：执行单元累计占用时间除以批次总时间。橙色高亮为瓶颈单元。"
      >
        <div className="metric-icon metric-icon-orange">
          <CircleGauge size={17} />
        </div>
        <div className="metric-copy metric-lane-copy">
          <span className="metric-label">利用率情况</span>
          <div
            className="metric-lane-list"
            aria-label="各执行单元利用率，可使用滚轮查看"
          >
            {scenario.lanes.map((lane) => {
              const utilization = laneMetricMap.get(lane.id)?.utilization;
              return (
                <span
                  className={`metric-lane-row ${
                    lane.id === bottleneck?.id ? "is-bottleneck" : ""
                  }`}
                  key={lane.id}
                  title={`${lane.name} 利用率 ${
                    utilization?.toFixed(1) ?? "—"
                  }%`}
                >
                  <i style={{ background: lane.color }} />
                  <em>{lane.name}</em>
                  <b>
                    {utilization == null
                      ? "—"
                      : `${utilization.toFixed(0)}%`}
                  </b>
                </span>
              );
            })}
          </div>
        </div>
      </article>

      <article
        className="metric-card metric-detail-card"
        title="等待时间：批次总时间减去该执行单元的累计占用时间，包含未占用、依赖等待和资源等待。"
      >
        <div className="metric-icon metric-icon-green">
          <Clock3 size={17} />
        </div>
        <div className="metric-copy metric-lane-copy">
          <span className="metric-label">等待时间</span>
          <div
            className="metric-lane-list wait-list"
            aria-label="各执行单元等待时间，可使用滚轮查看"
          >
            {scenario.lanes.map((lane) => {
              const busyTime = laneMetricMap.get(lane.id)?.busy_time;
              const waitingTime =
                metrics && busyTime != null
                  ? Math.max(0, metrics.makespan - busyTime)
                  : null;
              return (
                <span
                  className="metric-lane-row"
                  key={lane.id}
                  title={`${lane.name} 等待/空闲 ${formatSeconds(
                    waitingTime ?? 0,
                    1,
                  )}`}
                >
                  <i style={{ background: lane.color }} />
                  <em>{lane.name}</em>
                  <b>
                    {waitingTime == null
                      ? "—"
                      : formatSeconds(waitingTime, 1)}
                  </b>
                </span>
              );
            })}
          </div>
        </div>
      </article>
    </section>
  );
}

