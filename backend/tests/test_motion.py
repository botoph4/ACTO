import pytest

from app.models import Task, trapezoidal_motion_duration


def make_task(**updates):
    values = {
        "id": "motion",
        "name": "Move",
        "lane": "arm",
        "duration": 1,
        "color": "#3978F6",
    }
    values.update(updates)
    return Task(**values)


def test_trapezoidal_profile_uses_triangular_curve_for_short_distance():
    duration = trapezoidal_motion_duration(50, 100, 100)
    assert duration == pytest.approx(2 * (0.5**0.5))


def test_trapezoidal_profile_includes_cruise_time_for_long_distance():
    duration = trapezoidal_motion_duration(1000, 500, 1000)
    assert duration == pytest.approx(2.5)


def test_auto_motion_duration_overrides_stored_duration():
    task = make_task(
        motion_type="motion",
        motion_distance_mm=1000,
        motion_velocity_mm_s=500,
        motion_acceleration_mm_s2=1000,
        motion_duration_mode="auto",
        duration=99,
    )
    assert task.duration == pytest.approx(2.5)


def test_manual_motion_duration_is_preserved():
    task = make_task(
        motion_type="motion",
        motion_distance_mm=1000,
        motion_velocity_mm_s=500,
        motion_acceleration_mm_s2=1000,
        motion_duration_mode="manual",
        duration=3.4,
    )
    assert task.duration == pytest.approx(3.4)
