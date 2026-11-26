from __future__ import annotations

import heapq
import os
from collections import defaultdict, deque
from dataclasses import dataclass
from time import perf_counter

from ortools.sat.python import cp_model

from .models import (
    Diagnostic,
    LaneMetric,
    Scenario,
    ScheduledTask,
    ScheduleMetrics,
    ScheduleResponse,
)

TIME_UNITS_PER_SECOND = 10


def _solver_worker_count() -> int:
    configured = os.getenv("ACTO_SOLVER_WORKERS")
    if configured:
        try:
            return max(1, min(16, int(configured)))
        except ValueError:
            pass
    return max(1, min(8, os.cpu_count() or 1))


def _solver_relative_gap() -> float:
    configured = os.getenv("ACTO_SOLVER_RELATIVE_GAP")
    if configured:
        try:
            return max(0.0, min(1.0, float(configured)))
        except ValueError:
            pass
    return 0.01


class ScheduleValidationError(ValueError):
    def __init__(self, diagnostics: list[Diagnostic]):
        super().__init__("; ".join(item.detail for item in diagnostics))
        self.diagnostics = diagnostics


@dataclass
class TemporalLink:
    predecessor: str
    successor: str
    kind: str


def _validate(scenario: Scenario) -> list[Diagnostic]:
    errors: list[Diagnostic] = []
    task_ids = [task.id for task in scenario.tasks]
    task_set = set(task_ids)
    task_names = {task.id: task.name for task in scenario.tasks}
    lane_ids = [lane.id for lane in scenario.lanes]
    lane_set = set(lane_ids)

    if len(task_ids) != len(task_set):
        duplicates = [item for item in task_set if task_ids.count(item) > 1]
        errors.append(
            Diagnostic(
                level="error",
                title="动作 ID 重复",
                detail=f"以下 ID 重复：{', '.join(sorted(duplicates))}",
            )
        )
    if len(lane_ids) != len(lane_set):
        errors.append(
            Diagnostic(
                level="error",
                title="执行单元 ID 重复",
                detail="执行单元 ID 必须唯一。",
            )
        )

    if scenario.loop:
        for label, task_id in (
            ("循环起点", scenario.loop.start_task_id),
            ("回跳触发动作", scenario.loop.release_after_task_id),
        ):
            if task_id not in task_set:
                errors.append(
                    Diagnostic(
                        level="error",
                        title="循环边界不存在",
                        detail=f"{label}引用了不存在的动作：{task_id}。",
                    )
                )

    if scenario.ct_range:
        for label, task_id in (
            ("CT 起始动作", scenario.ct_range.start_task_id),
            ("CT 终止动作", scenario.ct_range.end_task_id),
        ):
            if task_id not in task_set:
                errors.append(
                    Diagnostic(
                        level="error",
                        title="CT 统计范围无效",
                        detail=f"{label}引用了不存在的动作：{task_id}。",
                    )
                )

    for task in scenario.tasks:
        if task.lane not in lane_set:
            errors.append(
                Diagnostic(
                    level="error",
                    title="执行单元不存在",
                    detail=f"“{task.name}”指向了不存在的执行单元 {task.lane}。",
                    task_ids=[task.id],
                )
            )
        unknown = [
            item
            for item in task.dependencies + task.stop_after
            if item not in task_set
        ]
        if unknown:
            errors.append(
                Diagnostic(
                    level="error",
                    title="依赖引用失效",
                    detail=f"“{task.name}”引用了不存在的动作：{', '.join(unknown)}。",
                    task_ids=[task.id],
                )
            )
        if task.id in task.dependencies + task.stop_after:
            errors.append(
                Diagnostic(
                    level="error",
                    title="动作依赖自身",
                    detail=f"“{task.name}”不能依赖自己。",
                    task_ids=[task.id],
                )
            )
        unknown_locks = [item for item in task.locked_resources if item not in lane_set]
        if unknown_locks:
            errors.append(
                Diagnostic(
                    level="error",
                    title="附加占用资源不存在",
                    detail=f"“{task.name}”引用了不存在的执行单元：{', '.join(unknown_locks)}。",
                    task_ids=[task.id],
                )
            )

    graph: dict[str, set[str]] = {task_id: set() for task_id in task_ids}
    indegree = {task_id: 0 for task_id in task_ids}
    for task in scenario.tasks:
        for dep in task.dependencies + task.stop_after:
            if dep in task_set and task.id not in graph[dep]:
                graph[dep].add(task.id)
                indegree[task.id] += 1

    queue = deque([task_id for task_id, count in indegree.items() if count == 0])
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for child in graph[node]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if visited != len(task_ids):
        blocked = sorted(task_id for task_id, count in indegree.items() if count > 0)
        names = "、".join(task_names[task_id] for task_id in blocked[:6])
        if len(blocked) > 6:
            names += f" 等 {len(blocked)} 个动作"
        errors.append(
            Diagnostic(
                level="error",
                title="依赖关系存在环",
                detail=f"以下动作参与依赖闭环或被其阻塞，无法排出先后顺序：{names}。",
                task_ids=blocked,
            )
        )
    return errors


def _resource_predecessors(
    scenario: Scenario,
    starts: dict[str, float],
) -> dict[str, list[str]]:
    resource_tasks: dict[str, list[str]] = defaultdict(list)
    for task in scenario.tasks:
        for resource in set([task.lane, *task.locked_resources]):
            resource_tasks[resource].append(task.id)
    for ids in resource_tasks.values():
        ids.sort(key=lambda task_id: starts[task_id])

    result: dict[str, list[str]] = {}
    for task in scenario.tasks:
        predecessors: list[str] = []
        for resource in set([task.lane, *task.locked_resources]):
            index = resource_tasks[resource].index(task.id)
            if index > 0:
                predecessors.append(resource_tasks[resource][index - 1])
        result[task.id] = list(dict.fromkeys(predecessors))
    return result


def _critical_tasks(
    scenario: Scenario,
    starts: dict[str, float],
    ends: dict[str, float],
    makespan: float,
) -> set[str]:
    by_id = {task.id: task for task in scenario.tasks}
    resource_predecessors = _resource_predecessors(scenario, starts)
    ending = [task.id for task in scenario.tasks if abs(ends[task.id] - makespan) < 1e-6]
    if not ending:
        return set()
    current = max(ending, key=lambda task_id: starts[task_id])
    critical = {current}

    for _ in range(len(scenario.tasks) + 2):
        task = by_id[current]
        candidates = [
            item
            for item in task.dependencies + task.stop_after
            if abs(
                ends[item]
                + (
                    task.dependency_delay_seconds
                    if task.dependency_delay_enabled
                    else 0
                )
                - starts[current]
            )
            < 1e-6
        ]
        candidates.extend(
            item
            for item in resource_predecessors[current]
            if abs(ends[item] - starts[current]) < 1e-6
        )
        if not candidates:
            break
        current = max(set(candidates), key=lambda task_id: ends[task_id])
        if current in critical:
            break
        critical.add(current)
    return critical


def _drivers(
    scenario: Scenario,
    starts: dict[str, float],
    ends: dict[str, float],
) -> dict[str, tuple[str | None, float, float]]:
    by_id = {task.id: task for task in scenario.tasks}
    resource_predecessors = _resource_predecessors(scenario, starts)
    result: dict[str, tuple[str | None, float, float]] = {}

    for task in scenario.tasks:
        predecessors = [
            item
            for item in task.dependencies + task.stop_after
            if item in by_id
        ]
        dependency_delay = (
            task.dependency_delay_seconds
            if task.dependency_delay_enabled and predecessors
            else 0.0
        )
        dependency_end = max(
            (ends[item] + dependency_delay for item in predecessors),
            default=0.0,
        )
        resource_end = max(
            (ends[item] for item in resource_predecessors[task.id]),
            default=0.0,
        )
        dep_wait = max(0.0, dependency_end)
        res_wait = max(0.0, resource_end - dependency_end)

        if resource_end > dependency_end + 1e-6 and resource_predecessors[task.id]:
            driver = max(resource_predecessors[task.id], key=lambda item: ends[item])
            result[task.id] = (driver, dep_wait, res_wait)
        elif dependency_end > 0:
            candidates = [
                item
                for item in predecessors
                if abs(ends[item] + dependency_delay - dependency_end) < 1e-6
            ]
            result[task.id] = (
                candidates[0] if candidates else None,
                dep_wait,
                res_wait,
            )
        else:
            result[task.id] = (None, dep_wait, res_wait)
    return result


def _diagnostics(
    scenario: Scenario,
    metrics: ScheduleMetrics,
    scheduled: list[ScheduledTask],
) -> list[Diagnostic]:
    result: list[Diagnostic] = []
    multi_lane = [lane for lane in metrics.lane_metrics if lane.task_count > 1]
    if len(multi_lane) >= 2:
        result.append(
            Diagnostic(
                level="info",
                title="已识别并行窗口",
                detail=f"{len(multi_lane)} 个执行单元存在并发任务，总周期由约束链决定。",
            )
        )
    if metrics.bottleneck_lane and metrics.bottleneck_utilization >= 85:
        lane = next(
            (item for item in scenario.lanes if item.id == metrics.bottleneck_lane),
            None,
        )
        if lane:
            result.append(
                Diagnostic(
                    level="warning",
                    title=f"{lane.name}接近满载",
                    detail=f"利用率 {metrics.bottleneck_utilization:.1f}%，优先拆分或转移该执行单元上的动作。",
                )
            )
    delayed = sorted(
        [task for task in scheduled if task.waiting_for_resource >= 0.5],
        key=lambda task: task.waiting_for_resource,
        reverse=True,
    )
    if delayed:
        first = delayed[0]
        task = next(item for item in scenario.tasks if item.id == first.id)
        result.append(
            Diagnostic(
                level="warning",
                title="存在执行单元等待",
                detail=f"“{task.name}”等待执行单元释放 {first.waiting_for_resource:.1f}s。",
                task_ids=[first.id],
            )
        )
    return result


def _empty_result(
    scenario: Scenario,
    validation: list[Diagnostic],
    started_at: float,
) -> ScheduleResponse:
    return ScheduleResponse(
        scenario_id=scenario.id,
        status="optimal",
        algorithm="OR-Tools CP-SAT",
        solve_time_ms=round((perf_counter() - started_at) * 1000),
        scheduled_tasks=[],
        metrics=ScheduleMetrics(
            makespan=0,
            critical_path_duration=0,
            critical_task_count=0,
            total_busy_time=0,
            parallel_efficiency=0,
            overlap_time=0,
            bottleneck_lane=None,
            bottleneck_utilization=0,
            lane_metrics=[
                LaneMetric(lane=lane.id, busy_time=0, utilization=0, task_count=0)
                for lane in scenario.lanes
            ],
            dependency_count=0,
            exclusive_task_count=0,
        ),
        diagnostics=validation,
        repeat_count=scenario.repeat_count,
    )


def _expand_cycles(
    scenario: Scenario,
) -> tuple[Scenario, dict[str, tuple[str, int]]]:
    if scenario.repeat_count <= 1:
        return scenario, {
            task.id: (task.id, 1)
            for task in scenario.tasks
        }

    start_task_id = (
        scenario.loop.start_task_id
        if scenario.loop
        else scenario.tasks[0].id
    )
    release_after_task_id = (
        scenario.loop.release_after_task_id
        if scenario.loop
        else scenario.tasks[-1].id
    )
    expanded = []
    metadata: dict[str, tuple[str, int]] = {}

    def instance_id(task_id: str, iteration: int) -> str:
        return f"{task_id}__iter_{iteration}"

    for iteration in range(1, scenario.repeat_count + 1):
        for task in scenario.tasks:
            task_id = instance_id(task.id, iteration)
            dependencies = [
                instance_id(dep, iteration)
                for dep in task.dependencies
            ]
            if iteration > 1:
                dependencies.append(instance_id(task.id, iteration - 1))
                if task.id == start_task_id:
                    dependencies.append(
                        instance_id(release_after_task_id, iteration - 1)
                    )
            stop_after = [
                instance_id(dep, iteration)
                for dep in task.stop_after
            ]
            expanded.append(
                task.model_copy(
                    update={
                        "id": task_id,
                        "dependencies": list(dict.fromkeys(dependencies)),
                        "stop_after": list(dict.fromkeys(stop_after)),
                        "manual_start": None,
                    }
                )
            )
            metadata[task_id] = (task.id, iteration)

    return (
        Scenario(
            id=scenario.id,
            name=scenario.name,
            description=scenario.description,
            repeat_count=scenario.repeat_count,
            loop=scenario.loop,
            ct_range=scenario.ct_range,
            tags=scenario.tags,
            lanes=scenario.lanes,
            tasks=expanded,
        ),
        metadata,
    )


def _greedy_schedule_hint(scenario: Scenario) -> dict[str, int]:
    task_by_id = {task.id: task for task in scenario.tasks}
    dependencies = {
        task.id: list(dict.fromkeys(task.dependencies + task.stop_after))
        for task in scenario.tasks
    }
    successors: dict[str, list[str]] = defaultdict(list)
    indegree = {
        task.id: len(dependencies[task.id])
        for task in scenario.tasks
    }
    for task_id, predecessor_ids in dependencies.items():
        for predecessor in predecessor_ids:
            successors[predecessor].append(task_id)

    ready = [task_id for task_id, degree in indegree.items() if degree == 0]
    topological: list[str] = []
    while ready:
        task_id = ready.pop()
        topological.append(task_id)
        for successor in successors[task_id]:
            indegree[successor] -= 1
            if indegree[successor] == 0:
                ready.append(successor)

    remaining_rank = {
        task_id: task_by_id[task_id].duration
        for task_id in topological
    }
    for task_id in reversed(topological):
        best_successor = max(
            (remaining_rank[item] for item in successors[task_id]),
            default=0,
        )
        remaining_rank[task_id] += best_successor

    ready = [
        (-remaining_rank[task.id], task.id)
        for task in scenario.tasks
        if not dependencies[task.id]
    ]
    heapq.heapify(ready)
    resource_available: dict[str, float] = defaultdict(float)
    global_available = 0.0
    blocking_intervals: list[tuple[float, float]] = []
    starts: dict[str, float] = {}
    ends: dict[str, float] = {}

    while ready:
        _, task_id = heapq.heappop(ready)
        task = task_by_id[task_id]
        dependency_delay = (
            task.dependency_delay_seconds
            if task.dependency_delay_enabled and dependencies[task_id]
            else 0
        )
        dependency_ready = max(
            (
                ends[predecessor] + dependency_delay
                for predecessor in dependencies[task_id]
            ),
            default=0,
        )
        resources = {task.lane, *task.locked_resources}
        resource_ready = max(
            (resource_available[resource] for resource in resources),
            default=0,
        )
        start = max(dependency_ready, resource_ready)
        if not task.can_parallel:
            start = max(start, global_available)
        if task.manual_start is not None:
            start = max(start, task.manual_start)
        for blocked_start, blocked_end in blocking_intervals:
            if start < blocked_end and start + task.duration > blocked_start:
                start = blocked_end

        end = start + task.duration
        starts[task_id] = round(start * TIME_UNITS_PER_SECOND)
        ends[task_id] = end
        for resource in resources:
            resource_available[resource] = end
        if not task.can_parallel:
            global_available = end
            blocking_intervals.append((start, end))

        for successor in successors[task_id]:
            if all(predecessor in ends for predecessor in dependencies[successor]):
                heapq.heappush(
                    ready,
                    (-remaining_rank[successor], successor),
                )
    return starts


def solve_schedule(
    scenario: Scenario,
    time_limit_seconds: float = 60,
    optimize: bool = True,
) -> ScheduleResponse:
    started_at = perf_counter()
    validation = _validate(scenario)
    if any(item.level == "error" for item in validation):
        raise ScheduleValidationError(validation)
    effective_scenario, instance_metadata = _expand_cycles(scenario)
    if not effective_scenario.tasks:
        return _empty_result(scenario, validation, started_at)

    manual_horizon = max(
        (
            task.manual_start + task.duration
            for task in effective_scenario.tasks
            if task.manual_start is not None
        ),
        default=0,
    )
    horizon = int(
        (
            sum(task.duration for task in effective_scenario.tasks)
            + max(task.duration for task in effective_scenario.tasks)
            + manual_horizon
            + sum(
                task.dependency_delay_seconds
                for task in effective_scenario.tasks
                if task.dependency_delay_enabled
                and (task.dependencies or task.stop_after)
            )
        )
        * TIME_UNITS_PER_SECOND
    )
    model = cp_model.CpModel()
    starts: dict[str, cp_model.IntVar] = {}
    ends: dict[str, cp_model.IntVar] = {}
    intervals_by_id: dict[str, cp_model.IntervalVar] = {}
    resource_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    links: list[TemporalLink] = []
    hint_starts = _greedy_schedule_hint(effective_scenario)

    for task in effective_scenario.tasks:
        duration = max(1, round(task.duration * TIME_UNITS_PER_SECOND))
        start = model.NewIntVar(0, horizon, f"start_{task.id}")
        end = model.NewIntVar(0, horizon, f"end_{task.id}")
        interval = model.NewIntervalVar(start, duration, end, f"interval_{task.id}")
        starts[task.id] = start
        ends[task.id] = end
        model.AddHint(start, hint_starts[task.id])
        if task.manual_start is not None:
            model.Add(
                start
                == round(task.manual_start * TIME_UNITS_PER_SECOND)
            )
        intervals_by_id[task.id] = interval
        for resource in set([task.lane, *task.locked_resources]):
            resource_intervals[resource].append(interval)

    for task in effective_scenario.tasks:
        dependency_delay = (
            round(task.dependency_delay_seconds * TIME_UNITS_PER_SECOND)
            if task.dependency_delay_enabled
            and (task.dependencies or task.stop_after)
            else 0
        )
        for predecessor in dict.fromkeys(task.dependencies + task.stop_after):
            kind = "stop" if predecessor in task.stop_after else "dependency"
            model.Add(
                ends[predecessor] + dependency_delay <= starts[task.id]
            )
            links.append(TemporalLink(predecessor, task.id, kind))

    for intervals in resource_intervals.values():
        if len(intervals) > 1:
            model.AddNoOverlap(intervals)
    for task in effective_scenario.tasks:
        if task.can_parallel:
            continue
        for other in effective_scenario.tasks:
            if other.id != task.id:
                model.AddNoOverlap([intervals_by_id[task.id], intervals_by_id[other.id]])

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, list(ends.values()))
    if optimize:
        model.Minimize(makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = min(60.0, time_limit_seconds)
    solver.parameters.num_search_workers = _solver_worker_count()
    solver.parameters.relative_gap_limit = _solver_relative_gap()
    solver.parameters.log_search_progress = False
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        timed_out = status == cp_model.UNKNOWN
        diagnostics = validation + [
            Diagnostic(
                level="error",
                title="求解超时，尚未找到可行解"
                if timed_out
                else "约束组合无法生成可行排程",
                detail="已使用当前 60 秒上限，未取得可行解；可降低重复次数后先分析单循环。"
                if timed_out
                else "请检查前置依赖和执行单元是否构成无法满足的约束。",
            )
        ]
        raise ScheduleValidationError(diagnostics)

    start_values = {
        task_id: solver.Value(value) / TIME_UNITS_PER_SECOND
        for task_id, value in starts.items()
    }
    end_values = {
        task_id: solver.Value(value) / TIME_UNITS_PER_SECOND
        for task_id, value in ends.items()
    }
    makespan_value = solver.Value(makespan) / TIME_UNITS_PER_SECOND
    critical = _critical_tasks(
        effective_scenario,
        start_values,
        end_values,
        makespan_value,
    )
    driver_data = _drivers(
        effective_scenario,
        start_values,
        end_values,
    )

    scheduled: list[ScheduledTask] = []
    for task in effective_scenario.tasks:
        driver, dep_wait, res_wait = driver_data[task.id]
        template_id, iteration = instance_metadata[task.id]
        scheduled.append(
            ScheduledTask(
                id=task.id,
                start=round(start_values[task.id], 2),
                end=round(end_values[task.id], 2),
                duration=task.duration,
                lane=task.lane,
                critical=task.id in critical,
                waiting_for_dependency=round(dep_wait, 2),
                waiting_for_resource=round(res_wait, 2),
                driver=driver,
                template_id=template_id,
                iteration=iteration,
            )
        )
    scheduled.sort(key=lambda item: (item.start, item.lane, item.end))

    lane_metrics = []
    for lane in effective_scenario.lanes:
        lane_tasks = [
            task
            for task in effective_scenario.tasks
            if task.lane == lane.id or lane.id in task.locked_resources
        ]
        busy = sum(task.duration for task in lane_tasks)
        lane_metrics.append(
            LaneMetric(
                lane=lane.id,
                busy_time=round(busy, 2),
                utilization=round(busy / makespan_value * 100, 1) if makespan_value else 0,
                task_count=len(lane_tasks),
            )
        )
    bottleneck = max(lane_metrics, key=lambda item: item.utilization, default=None)
    total_busy = sum(item.busy_time for item in lane_metrics)

    points = sorted({point for task in scheduled for point in (task.start, task.end)})
    overlap = 0.0
    for left, right in zip(points, points[1:]):
        active = sum(
            1
            for task in scheduled
            if task.start < right and task.end > left
        )
        if active > 1:
            overlap += (right - left) * (active - 1)

    critical_duration = sum(
        task.duration
        for task in effective_scenario.tasks
        if task.id in critical
    )
    metrics = ScheduleMetrics(
        makespan=round(makespan_value, 2),
        critical_path_duration=round(critical_duration, 2),
        critical_task_count=len(critical),
        total_busy_time=round(total_busy, 2),
        parallel_efficiency=round(
            total_busy
            / (len(effective_scenario.lanes) * makespan_value)
            * 100,
            1,
        )
        if makespan_value and effective_scenario.lanes
        else 0,
        overlap_time=round(overlap, 2),
        bottleneck_lane=bottleneck.lane if bottleneck else None,
        bottleneck_utilization=bottleneck.utilization if bottleneck else 0,
        lane_metrics=lane_metrics,
        dependency_count=len(links),
        exclusive_task_count=sum(
            1
            for task in effective_scenario.tasks
            if not task.can_parallel
        ),
    )
    diagnostics = validation + _diagnostics(
        effective_scenario,
        metrics,
        scheduled,
    )
    solved_to_tolerance = status == cp_model.OPTIMAL and (
        not optimize
        or abs(solver.BestObjectiveBound() - solver.ObjectiveValue()) < 1e-6
    )
    return ScheduleResponse(
        scenario_id=scenario.id,
        status="optimal" if solved_to_tolerance else "feasible",
        algorithm="OR-Tools CP-SAT",
        solve_time_ms=round((perf_counter() - started_at) * 1000),
        repeat_count=scenario.repeat_count,
        scheduled_tasks=scheduled,
        metrics=metrics,
        diagnostics=diagnostics,
    )
