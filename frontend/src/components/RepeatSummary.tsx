import { Minus, Plus, Repeat2 } from "lucide-react";
import type { Task } from "../types";
import { clamp, formatSeconds, taskCode } from "../utils";

type Props = {
  repeatCount: number;
  cycleTime: number | null;
  shortestCycleTime: number | null;
  firstCycleTime: number | null;
  middleCycleCount: number | null;
  lastCycleTime: number | null;
  tasks: Task[];
  loopStartTaskId: string | null;
  loopReleaseTaskId: string | null;
  onRepeatCountChange: (count: number) => void;
  onLoopChange: (startTaskId: string, releaseTaskId: string) => void;
};

const PRESETS = [1, 3, 5, 10, 20];

export default function RepeatSummary({
  repeatCount,
  cycleTime,
  shortestCycleTime,
  firstCycleTime,
  middleCycleCount,
  lastCycleTime,
  tasks,
  loopStartTaskId,
  loopReleaseTaskId,
  onRepeatCountChange,
  onLoopChange,
}: Props) {
  const change = (value: number) =>
    onRepeatCountChange(Math.round(clamp(value, 1, 999)));
  const codeById = new Map(
    tasks.map((task, index) => [task.id, taskCode(index)]),
  );

  return (
    <section className="repeat-summary" aria-label="重复批次折算">
      <div className="repeat-setting">
        <span className="repeat-title">
          <Repeat2 size={14} />
          重复次数
        </span>
        <div className="repeat-stepper">
          <button
            type="button"
            onClick={() => change(repeatCount - 1)}
            disabled={repeatCount <= 1}
            title="减少重复次数"
          >
            <Minus size={12} />
          </button>
          <input
            type="number"
            min="1"
            max="999"
            value={repeatCount}
            aria-label="重复次数"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => change(Number(event.target.value) || 1)}
          />
          <button
            type="button"
            onClick={() => change(repeatCount + 1)}
            disabled={repeatCount >= 999}
            title="增加重复次数"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="repeat-presets">
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={repeatCount === preset ? "active" : ""}
              onClick={() => change(preset)}
            >
              ×{preset}
            </button>
          ))}
        </div>
      </div>

      <div className="repeat-formula">
        <span title="首次 CT">
          首次 CT
          <strong>
            {firstCycleTime == null
              ? "—"
              : formatSeconds(firstCycleTime, 1)}
          </strong>
        </span>
        <i>+</i>
        <span title="中间循环按最短 CT 折算">
          <strong>{middleCycleCount ?? "—"} 次</strong>
          × 最短 CT
          <strong>
            {shortestCycleTime == null
              ? "—"
              : formatSeconds(shortestCycleTime, 1)}
          </strong>
        </span>
        <i>+</i>
        <span title="最后一次循环时间">
          末次时间
          <strong>
            {lastCycleTime == null
              ? "—"
              : formatSeconds(lastCycleTime, 1)}
          </strong>
        </span>
        <i>÷</i>
        <span>
          总次数
          <strong>{repeatCount} 次</strong>
        </span>
        <i>=</i>
        <span className="repeat-ct-result">
          平均 CT
          <strong>
            {cycleTime == null ? "—" : formatSeconds(cycleTime, 1)}
          </strong>
          <small>/ 件</small>
        </span>
        <span className="repeat-ct-result repeat-shortest-result">
          最短 CT
          <strong>
            {shortestCycleTime == null
              ? "—"
              : formatSeconds(shortestCycleTime, 1)}
          </strong>
          <small>/ 件</small>
        </span>
      </div>

      <div className="repeat-loop-row">
        <span>
          <Repeat2 size={12} />
          循环边界
        </span>
        <label>
          起点
          <select
            value={loopStartTaskId ?? ""}
            disabled={!tasks.length}
            onChange={(event) =>
              onLoopChange(
                event.target.value,
                loopReleaseTaskId ?? tasks.at(-1)?.id ?? "",
              )
            }
          >
            {tasks.map((task) => (
              <option value={task.id} key={task.id}>
                {codeById.get(task.id)} · {task.name}
              </option>
            ))}
          </select>
        </label>
        <span className="repeat-loop-arrow">↻</span>
        <label>
          回跳触发
          <select
            value={loopReleaseTaskId ?? ""}
            disabled={!tasks.length}
            onChange={(event) =>
              onLoopChange(
                loopStartTaskId ?? tasks[0]?.id ?? "",
                event.target.value,
              )
            }
          >
            {tasks.map((task) => (
              <option value={task.id} key={task.id}>
                {codeById.get(task.id)} · {task.name}
              </option>
            ))}
          </select>
        </label>
        <small>
          下一次起点动作在上一轮回跳动作完成后启动
        </small>
      </div>

    </section>
  );
}
