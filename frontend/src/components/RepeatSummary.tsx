import { CircleHelp, Minus, Plus, Repeat2, TimerReset } from "lucide-react";
import { useState } from "react";
import type { Task } from "../types";
import { clamp, formatSeconds, taskCode } from "../utils";

type Props = {
  repeatCount: number;
  cycleTime: number | null;
  shortestCycleTime: number | null;
  tasks: Task[];
  loopStartTaskId: string | null;
  loopReleaseTaskId: string | null;
  ctStartTaskId: string | null;
  ctEndTaskId: string | null;
  onRepeatCountChange: (count: number) => void;
  onLoopChange: (startTaskId: string, releaseTaskId: string) => void;
  onCtRangeChange: (startTaskId: string, endTaskId: string) => void;
};

const PRESETS = [1, 3, 5, 10, 20];

export default function RepeatSummary({
  repeatCount,
  cycleTime,
  shortestCycleTime,
  tasks,
  loopStartTaskId,
  loopReleaseTaskId,
  ctStartTaskId,
  ctEndTaskId,
  onRepeatCountChange,
  onLoopChange,
  onCtRangeChange,
}: Props) {
  const change = (value: number) =>
    onRepeatCountChange(Math.round(clamp(value, 1, 999)));
  const codeById = new Map(
    tasks.map((task, index) => [task.id, taskCode(index)]),
  );
  const [openHelp, setOpenHelp] = useState<
    "average" | "shortest" | null
  >(null);
  const canShowShortest = repeatCount > 2;
  const usesAdjacentInterval =
    ctStartTaskId != null && ctStartTaskId === ctEndTaskId;

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

      <div className="repeat-results">
        <span className="ct-result-with-help">
          <span className="repeat-ct-result">
            平均 CT
            <strong>
              {cycleTime == null ? "—" : formatSeconds(cycleTime, 1)}
            </strong>
            <small>/ 件</small>
          </span>
          <button
            type="button"
            className={`ct-help-button ${
              openHelp === "average" ? "is-open" : ""
            }`}
            aria-label="查看平均 CT 计算说明"
            aria-describedby="average-ct-help"
            aria-expanded={openHelp === "average"}
            onClick={() =>
              setOpenHelp((current) =>
                current === "average" ? null : "average",
              )
            }
          >
            <CircleHelp size={14} />
            <span
              className="ct-help-tooltip"
              id="average-ct-help"
              role="tooltip"
            >
              平均 CT = 批次总时间 ÷ 总次数，用于比较不同方案的单件折算节拍。
            </span>
          </button>
        </span>
        {canShowShortest && (
          <span className="ct-result-with-help">
            <span className="repeat-ct-result repeat-shortest-result">
              最短 CT
              <strong>
                {shortestCycleTime == null
                  ? "—"
                  : formatSeconds(shortestCycleTime, 1)}
              </strong>
              <small>/ 件</small>
            </span>
            <button
              type="button"
              className={`ct-help-button ${
                openHelp === "shortest" ? "is-open" : ""
              }`}
              aria-label="查看最短 CT 计算说明"
              aria-describedby="shortest-ct-help"
              aria-expanded={openHelp === "shortest"}
              onClick={() =>
                setOpenHelp((current) =>
                  current === "shortest" ? null : "shortest",
                )
              }
            >
              <CircleHelp size={14} />
              <span
                className="ct-help-tooltip"
                id="shortest-ct-help"
                role="tooltip"
              >
                最短 CT 按“最短 CT 统计范围”计算：3 次取第 1→2 次间隔，4 次以上排除首尾循环，1-2 次不显示。
              </span>
            </button>
          </span>
        )}
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

      <div className="repeat-ct-range-row">
        <span>
          <TimerReset size={12} />
          最短 CT 统计范围
        </span>
        <label>
          起点
          <select
            value={ctStartTaskId ?? ""}
            disabled={!tasks.length}
            onChange={(event) =>
              onCtRangeChange(
                event.target.value,
                ctEndTaskId ?? tasks.at(-1)?.id ?? "",
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
        <span className="repeat-ct-arrow">→</span>
        <label>
          终点
          <select
            value={ctEndTaskId ?? ""}
            disabled={!tasks.length}
            onChange={(event) =>
              onCtRangeChange(
                ctStartTaskId ?? tasks[0]?.id ?? "",
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
          {usesAdjacentInterval
            ? "起止动作相同：按相邻两次动作的时间间隔计算"
            : "按每次实际起止动作计算最短 CT"}
        </small>
      </div>

    </section>
  );
}
