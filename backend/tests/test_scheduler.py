from app.demo import DEMO_SCENARIO
from app.models import Lane, Scenario, Task
from app.models import LoopConfig
from app.scheduler import solve_schedule


def test_demo_schedule_is_parallel_and_has_critical_path():
    result = solve_schedule(DEMO_SCENARIO, time_limit_seconds=2)
    assert result.status in {"optimal", "feasible"}
    assert result.metrics.makespan > 0
    assert result.metrics.overlap_time > 0
    assert result.metrics.critical_task_count > 0
    assert len(result.scheduled_tasks) == len(DEMO_SCENARIO.tasks)


def test_precedence_and_lane_exclusivity():
    scenario = Scenario(
        id="small",
        name="small",
        lanes=[Lane(id="arm", name="Arm", short_name="A", color="#000000")],
        tasks=[
            Task(id="a", name="A", lane="arm", duration=2, color="#111111"),
            Task(
                id="b",
                name="B",
                lane="arm",
                duration=3,
                color="#222222",
                dependencies=["a"],
            ),
        ],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    by_id = {item.id: item for item in result.scheduled_tasks}
    assert by_id["b"].start >= by_id["a"].end
    assert result.metrics.makespan == 5


def test_global_non_parallel_task_cannot_overlap_other_lane():
    scenario = Scenario(
        id="exclusive",
        name="exclusive",
        lanes=[
            Lane(id="left", name="Left", short_name="L", color="#000000"),
            Lane(id="right", name="Right", short_name="R", color="#111111"),
        ],
        tasks=[
            Task(
                id="left_task",
                name="Left task",
                lane="left",
                duration=3,
                color="#111111",
                can_parallel=False,
            ),
            Task(id="right_task", name="Right task", lane="right", duration=2, color="#222222"),
        ],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    by_id = {item.id: item for item in result.scheduled_tasks}
    left = by_id["left_task"]
    right = by_id["right_task"]
    assert left.end <= right.start or right.end <= left.start
    assert result.metrics.makespan == 5


def test_empty_scenario_has_zero_makespan():
    scenario = Scenario(
        id="empty",
        name="empty",
        lanes=[Lane(id="arm", name="Arm", short_name="A", color="#000000")],
        tasks=[],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    assert result.metrics.makespan == 0
    assert result.scheduled_tasks == []


def test_manual_start_is_fixed_in_solver():
    scenario = Scenario(
        id="manual",
        name="manual",
        lanes=[
            Lane(id="left", name="Left", short_name="L", color="#000000"),
            Lane(id="right", name="Right", short_name="R", color="#111111"),
        ],
        tasks=[
            Task(
                id="manual_task",
                name="Manual task",
                lane="left",
                duration=1.5,
                color="#111111",
                manual_start=4.2,
            ),
            Task(
                id="auto_task",
                name="Auto task",
                lane="right",
                duration=0.5,
                color="#222222",
            ),
        ],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    by_id = {item.id: item for item in result.scheduled_tasks}

    assert by_id["manual_task"].start == 4.2
    assert by_id["manual_task"].end == 5.7


def test_locked_resource_blocks_tasks_assigned_to_that_lane():
    scenario = Scenario(
        id="locked-resource",
        name="locked-resource",
        lanes=[
            Lane(id="left", name="Left", short_name="L", color="#000000"),
            Lane(id="right", name="Right", short_name="R", color="#111111"),
        ],
        tasks=[
            Task(
                id="right_task",
                name="Right task",
                lane="right",
                duration=5,
                color="#111111",
            ),
            Task(
                id="left_task",
                name="Left task",
                lane="left",
                duration=2,
                color="#222222",
                locked_resources=["right"],
            ),
        ],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    by_id = {item.id: item for item in result.scheduled_tasks}
    left = by_id["left_task"]
    right = by_id["right_task"]

    assert left.end <= right.start or right.end <= left.start
    assert result.metrics.makespan == 7
    lane_metrics = {
        metric.lane: metric for metric in result.metrics.lane_metrics
    }
    assert lane_metrics["right"].busy_time == 5
    assert lane_metrics["left"].busy_time == 2


def test_loop_start_waits_for_configured_release_task():
    scenario = Scenario(
        id="loop",
        name="loop",
        repeat_count=3,
        loop=LoopConfig(
            start_task_id="a",
            release_after_task_id="b",
        ),
        lanes=[
            Lane(id="arm", name="Arm", short_name="A", color="#000000"),
        ],
        tasks=[
            Task(id="a", name="Start", lane="arm", duration=1, color="#111111"),
            Task(
                id="b",
                name="Release",
                lane="arm",
                duration=2,
                color="#222222",
                dependencies=["a"],
            ),
        ],
    )
    result = solve_schedule(scenario, time_limit_seconds=1)
    first_cycle = [
        item for item in result.scheduled_tasks if item.iteration == 1
    ]
    second_start = next(
        item
        for item in result.scheduled_tasks
        if item.template_id == "a" and item.iteration == 2
    )
    first_release = next(
        item
        for item in first_cycle
        if item.template_id == "b"
    )

    assert first_release.end <= second_start.start
    assert len(result.scheduled_tasks) == 6
    assert result.repeat_count == 3
    assert result.metrics.makespan == 9


def test_legacy_stop_after_is_merged_into_dependencies():
    task = Task(
        id="merged",
        name="Merged",
        lane="arm",
        duration=1,
        color="#111111",
        dependencies=["dependency"],
        stop_after=["stop"],
    )

    assert task.dependencies == ["dependency", "stop"]
    assert task.stop_after == []


def test_dependency_delay_adds_wait_after_last_dependency():
    scenario = Scenario(
        id="delay",
        name="delay",
        lanes=[
            Lane(id="left", name="Left", short_name="L", color="#000000"),
            Lane(id="right", name="Right", short_name="R", color="#111111"),
        ],
        tasks=[
            Task(
                id="first",
                name="First",
                lane="left",
                duration=1,
                color="#222222",
            ),
            Task(
                id="second",
                name="Second",
                lane="right",
                duration=2,
                color="#333333",
                dependencies=["first"],
                dependency_delay_enabled=True,
                dependency_delay_seconds=2,
            ),
        ],
    )

    result = solve_schedule(scenario, time_limit_seconds=1)
    by_id = {item.id: item for item in result.scheduled_tasks}

    assert by_id["second"].start >= by_id["first"].end + 2 - 1e-6
    assert abs(result.metrics.makespan - 5) < 1e-6


def test_dependency_delay_does_not_apply_without_dependencies():
    scenario = Scenario(
        id="delay-no-dependency",
        name="delay-no-dependency",
        lanes=[Lane(id="arm", name="Arm", short_name="A", color="#000000")],
        tasks=[
            Task(
                id="only",
                name="Only",
                lane="arm",
                duration=1,
                color="#222222",
                dependency_delay_enabled=True,
                dependency_delay_seconds=5,
            )
        ],
    )

    result = solve_schedule(scenario, time_limit_seconds=1)

    assert abs(result.metrics.makespan - 1) < 1e-6
