from __future__ import annotations

from math import sqrt
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def trapezoidal_motion_duration(
    distance_mm: float,
    max_velocity_mm_s: float,
    acceleration_mm_s2: float,
) -> float:
    """Return minimum duration for a symmetric trapezoidal velocity profile."""
    acceleration_distance = (
        max_velocity_mm_s * max_velocity_mm_s / acceleration_mm_s2
    )
    if distance_mm <= acceleration_distance:
        return 2 * sqrt(distance_mm / acceleration_mm_s2)
    return distance_mm / max_velocity_mm_s + (
        max_velocity_mm_s / acceleration_mm_s2
    )


class Lane(BaseModel):
    id: str
    name: str
    short_name: str
    color: str
    description: str = ""


class Task(BaseModel):
    id: str
    name: str
    lane: str
    duration: float = Field(gt=0, le=600)
    color: str
    category: str = "未分类"
    dependencies: list[str] = Field(default_factory=list)
    stop_after: list[str] = Field(default_factory=list)
    can_parallel: bool = True
    locked_resources: list[str] = Field(default_factory=list)
    notes: str = ""
    manual_start: float | None = Field(default=None, ge=0, le=600)
    motion_type: Literal["motion", "non_motion"] = "non_motion"
    motion_distance_mm: float | None = Field(default=None, gt=0, le=1_000_000)
    motion_velocity_mm_s: float | None = Field(default=None, gt=0, le=1_000_000)
    motion_acceleration_mm_s2: float | None = Field(
        default=None,
        gt=0,
        le=1_000_000,
    )
    motion_duration_mode: Literal["auto", "manual"] = "manual"
    dependency_delay_enabled: bool = False
    dependency_delay_seconds: float = Field(default=0, ge=0, le=600)

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if not value.startswith("#") or len(value) not in (4, 7):
            raise ValueError("color must be a hex color")
        return value

    @model_validator(mode="after")
    def merge_legacy_stop_after(self) -> "Task":
        self.dependencies = list(
            dict.fromkeys([*self.dependencies, *self.stop_after])
        )
        self.stop_after = []
        if self.motion_type == "motion":
            distance = self.motion_distance_mm
            velocity = self.motion_velocity_mm_s
            acceleration = self.motion_acceleration_mm_s2
            if distance is None or velocity is None or acceleration is None:
                raise ValueError("运动部件必须填写运动行程、最大速度和加速度")
            if self.motion_duration_mode == "auto":
                self.duration = round(
                    trapezoidal_motion_duration(
                        distance,
                        velocity,
                        acceleration,
                    ),
                    3,
                )
        return self


class LoopConfig(BaseModel):
    start_task_id: str
    release_after_task_id: str


class Scenario(BaseModel):
    id: str = "acto-demo"
    name: str = "M1 双臂搓线插线 + 中转平台"
    description: str = ""
    tags: list[str] = Field(default_factory=list, max_length=50)
    repeat_count: int = Field(default=1, ge=1, le=999)
    loop: LoopConfig | None = None
    lanes: list[Lane]
    tasks: list[Task]


class ScheduleRequest(BaseModel):
    scenario: Scenario
    time_limit_seconds: float = Field(default=2, ge=0.25, le=30)
    optimize: bool = True


class ScheduledTask(BaseModel):
    id: str
    start: float
    end: float
    duration: float
    lane: str
    critical: bool = False
    waiting_for_dependency: float = 0
    waiting_for_resource: float = 0
    driver: str | None = None
    template_id: str | None = None
    iteration: int = 1


class LaneMetric(BaseModel):
    lane: str
    busy_time: float
    utilization: float
    task_count: int


class ScheduleMetrics(BaseModel):
    makespan: float
    critical_path_duration: float
    critical_task_count: int
    total_busy_time: float
    parallel_efficiency: float
    overlap_time: float
    bottleneck_lane: str | None
    bottleneck_utilization: float
    lane_metrics: list[LaneMetric]
    dependency_count: int
    exclusive_task_count: int


class Diagnostic(BaseModel):
    level: Literal["error", "warning", "info"]
    title: str
    detail: str
    task_ids: list[str] = Field(default_factory=list)


class ScheduleResponse(BaseModel):
    scenario_id: str
    status: Literal["optimal", "feasible", "infeasible", "unknown"]
    algorithm: str
    solve_time_ms: int
    repeat_count: int = 1
    scheduled_tasks: list[ScheduledTask]
    metrics: ScheduleMetrics
    diagnostics: list[Diagnostic]

