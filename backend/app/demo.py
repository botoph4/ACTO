from __future__ import annotations

from .models import Lane, Scenario, Task


LANES = [
    Lane(id="right_arm", name="右臂 / 搓线", short_name="R", color="#2F6BFF", description="搓线、取线、捋线与复位"),
    Lane(id="right_ee", name="右末端 / 夹爪", short_name="RE", color="#5B86F5", description="皮带夹爪、抱紧夹爪与搓线末端动作"),
    Lane(id="transfer", name="中转平台", short_name="T", color="#8B5CF6", description="夹紧、旋转、二次定位"),
    Lane(id="left_arm", name="左臂 / 插线", short_name="L", color="#16A085", description="拔帽、取料、调姿与力控插入"),
    Lane(id="left_ee", name="左末端 / 夹爪", short_name="LE", color="#42B69B", description="电夹爪、拔帽末端与插线末端旋转"),
    Lane(id="vision", name="视觉系统", short_name="V", color="#F59E0B", description="手眼相机与末端内窥镜识别"),
    Lane(id="torso", name="躯干 / 升降", short_name="B", color="#D96C3B", description="机柜层高定位和姿态保持"),
]


def _task(
    task_id: str,
    name: str,
    lane: str,
    duration: float,
    color: str,
    category: str,
    *,
    dependencies: list[str] | None = None,
    stop_after: list[str] | None = None,
    can_parallel: bool = True,
    locked_resources: list[str] | None = None,
    notes: str = "",
) -> Task:
    return Task(
        id=task_id,
        name=name,
        lane=lane,
        duration=duration,
        color=color,
        category=category,
        dependencies=dependencies or [],
        stop_after=stop_after or [],
        can_parallel=can_parallel,
        locked_resources=locked_resources or [],
        notes=notes,
    )


R = "#3978F6"
RE = "#5B86F5"
T = "#8B5CF6"
L = "#18A586"
LE = "#42B69B"
V = "#F5A623"
B = "#D96C3B"

DEMO_SCENARIO = Scenario(
    id="m1-transfer-baseline-v1",
    name="M1 双臂搓线插线 + 中转平台",
    description="基于中转位节拍分析与胸前工作平台仿真方案构建。",
    tags=["M1", "双臂协同", "中转平台"],
    lanes=LANES,
    tasks=[
        _task("torso_pose", "躯干定位至目标层高", "torso", 0.8, B, "准备"),
        _task("r_move_photo", "右臂移动至拍照位", "right_arm", 1.0, R, "搓线取线", dependencies=["torso_pose"]),
        _task("r_photo", "线束拍照定位", "vision", 2.0, V, "视觉识别", dependencies=["r_move_photo"]),
        _task("r_enter_bundle", "右臂进入线束", "right_arm", 1.0, R, "搓线取线", dependencies=["r_photo"]),
        _task("r_clamp_1", "皮带夹爪一次夹紧", "right_ee", 0.8, RE, "搓线取线", dependencies=["r_enter_bundle"], locked_resources=["right_arm"]),
        _task("r_feed", "夹爪输送线缆", "right_ee", 0.8, RE, "搓线取线", dependencies=["r_clamp_1"], locked_resources=["right_arm"]),
        _task("r_stroke", "反复搓线成排", "right_ee", 2.4, RE, "搓线取线", dependencies=["r_feed"], locked_resources=["right_arm"]),
        _task("r_clamp_2", "皮带夹爪二次夹紧", "right_ee", 0.6, RE, "搓线取线", dependencies=["r_stroke"], locked_resources=["right_arm"]),
        _task("r_sensor", "输送至光电检测位", "right_arm", 0.8, R, "搓线取线", dependencies=["r_clamp_2"]),
        _task("r_hold", "抱紧夹爪夹紧线缆", "right_ee", 0.6, RE, "搓线取线", dependencies=["r_sensor"], locked_resources=["right_arm"]),
        _task("r_open", "皮带夹爪完全张开", "right_ee", 0.5, RE, "搓线取线", dependencies=["r_hold"], locked_resources=["right_arm"]),
        _task("r_to_route", "带线进入捋线初始位", "right_arm", 1.0, R, "捋线", dependencies=["r_open"]),
        _task("r_into_route", "进入捋线结构", "right_arm", 0.8, R, "捋线", dependencies=["r_to_route"]),
        _task("r_route_clamp_1", "捋线夹爪一次夹紧", "right_ee", 0.5, RE, "捋线", dependencies=["r_into_route"], locked_resources=["right_arm"]),
        _task("r_route", "右臂执行捋线", "right_arm", 1.5, R, "捋线", dependencies=["r_route_clamp_1"]),
        _task("r_route_clamp_2", "捋线夹爪二次夹紧", "right_ee", 0.5, RE, "捋线", dependencies=["r_route"], locked_resources=["right_arm"]),
        _task("r_release", "搓线末端松开线缆", "right_ee", 0.4, RE, "捋线", dependencies=["r_route_clamp_2"], locked_resources=["right_arm"]),
        _task("r_reset", "右臂搓线末端复位", "right_arm", 1.0, R, "复位", dependencies=["r_release"]),
        _task("t_clamp", "中转平台预夹紧", "transfer", 0.5, T, "中转平台", dependencies=["torso_pose"]),
        _task("t_wait_route", "等待捋线完成并确认", "transfer", 1.2, T, "中转平台", dependencies=["t_clamp"], stop_after=["r_route"]),
        _task("t_clamp_final", "捋线夹爪二次夹紧", "transfer", 0.4, T, "中转平台", dependencies=["t_wait_route"]),
        _task("t_photo_head", "线缆头部旋转角拍照", "vision", 2.0, V, "视觉识别", dependencies=["t_clamp_final"]),
        _task("t_rotate", "转台调整线缆角度", "transfer", 0.9, T, "中转平台", dependencies=["t_photo_head"]),
        _task("t_clamp_head", "下夹爪夹紧线缆头部", "transfer", 0.4, T, "中转平台", dependencies=["t_rotate"]),
        _task("t_release_top", "上夹爪打开待取料", "transfer", 0.4, T, "中转平台", dependencies=["t_clamp_head"]),
        _task("t_release_bottom", "插线取料后下夹爪松开", "transfer", 0.4, T, "中转平台", dependencies=["t_release_top"], stop_after=["l_grip_cable"]),
        _task("l_move_photo", "左臂移动至拍照位", "left_arm", 0.8, L, "拔帽", dependencies=["torso_pose"]),
        _task("l_photo_cap", "光模块帽拍照定位", "vision", 1.6, V, "视觉识别", dependencies=["l_move_photo"]),
        _task("l_move_cap", "左臂移动至拔帽位", "left_arm", 0.8, L, "拔帽", dependencies=["l_photo_cap"]),
        _task("l_grip_cap", "夹紧光模块帽", "left_ee", 0.4, LE, "拔帽", dependencies=["l_move_cap"], locked_resources=["left_arm"]),
        _task("l_pull_cap", "拔帽并移动至中转位", "left_arm", 1.0, L, "拔帽", dependencies=["l_grip_cap"]),
        _task("l_release_cap", "松开帽并复位", "left_arm", 0.5, L, "拔帽", dependencies=["l_pull_cap"]),
        _task("l_pickup", "左臂移动至中转取料位", "left_arm", 0.8, L, "插线", dependencies=["l_release_cap", "t_release_top"]),
        _task("l_grip_cable", "末端电夹爪夹紧线缆", "left_ee", 0.4, LE, "插线", dependencies=["l_pickup"], locked_resources=["left_arm"]),
        _task("l_to_insert", "左臂移动至插线位", "left_arm", 0.8, L, "插线", dependencies=["l_grip_cable"]),
        _task("l_rotate_horizontal", "末端旋转至水平", "left_ee", 0.9, LE, "末端动作", dependencies=["l_to_insert"], locked_resources=["left_arm"]),
        _task("l_endoscope", "内窥镜多次拍照调姿", "vision", 3.6, V, "视觉识别", dependencies=["l_rotate_horizontal"]),
        _task("l_force_insert", "力控插入线缆", "left_arm", 2.5, L, "力控插入", dependencies=["l_endoscope"], stop_after=["r_reset"], notes="插入期间右臂搓线动作必须停止。"),
        _task("l_open_ee", "末端夹爪打开", "left_ee", 0.4, LE, "末端动作", dependencies=["l_force_insert"], locked_resources=["left_arm"]),
        _task("release_all", "机构复位并确认完成", "torso", 0.6, B, "复位", dependencies=["l_open_ee", "t_release_bottom", "r_reset"], can_parallel=False),
    ],
)
