#!/usr/bin/env python3
import argparse
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import UnityPy

MAX_TRIANGLES_PER_MESH = 9000


def clamp_float(value):
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def v3(data, default=None):
    if default is None:
        default = {"x": 0.0, "y": 0.0, "z": 0.0}
    if not isinstance(data, dict):
        data = default
    return {
        "x": clamp_float(data.get("x", default["x"])),
        "y": clamp_float(data.get("y", default["y"])),
        "z": clamp_float(data.get("z", default["z"])),
    }


def q4(data):
    if not isinstance(data, dict):
        return {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
    return {
        "x": clamp_float(data.get("x", 0.0)),
        "y": clamp_float(data.get("y", 0.0)),
        "z": clamp_float(data.get("z", 0.0)),
        "w": clamp_float(data.get("w", 1.0)),
    }


def q_mul(a, b):
    return {
        "x": a["w"] * b["x"] + a["x"] * b["w"] + a["y"] * b["z"] - a["z"] * b["y"],
        "y": a["w"] * b["y"] - a["x"] * b["z"] + a["y"] * b["w"] + a["z"] * b["x"],
        "z": a["w"] * b["z"] + a["x"] * b["y"] - a["y"] * b["x"] + a["z"] * b["w"],
        "w": a["w"] * b["w"] - a["x"] * b["x"] - a["y"] * b["y"] - a["z"] * b["z"],
    }


def q_conj(q):
    return {"x": -q["x"], "y": -q["y"], "z": -q["z"], "w": q["w"]}


def q_rotate(q, vec):
    vq = {"x": vec["x"], "y": vec["y"], "z": vec["z"], "w": 0.0}
    rq = q_mul(q_mul(q, vq), q_conj(q))
    return {"x": rq["x"], "y": rq["y"], "z": rq["z"]}


def v_add(a, b):
    return {"x": a["x"] + b["x"], "y": a["y"] + b["y"], "z": a["z"] + b["z"]}


def v_mul(a, b):
    return {"x": a["x"] * b["x"], "y": a["y"] * b["y"], "z": a["z"] * b["z"]}


def ptr_path_id(ptr):
    if not isinstance(ptr, dict):
        return 0
    return int(ptr.get("m_PathID", 0) or 0)


def parse_obj_geometry(obj_text, max_triangles=MAX_TRIANGLES_PER_MESH):
    vertices = []
    triangles = []

    for raw_line in obj_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("v "):
            parts = line.split()
            if len(parts) < 4:
                continue
            vertices.append((clamp_float(parts[1]), clamp_float(parts[2]), clamp_float(parts[3])))
            continue
        if line.startswith("f "):
            parts = line.split()[1:]
            face = []
            for token in parts:
                idx_part = token.split("/")[0]
                if not idx_part:
                    continue
                try:
                    idx = int(idx_part)
                except ValueError:
                    continue
                if idx > 0:
                    face.append(idx - 1)
            if len(face) < 3:
                continue
            for i in range(1, len(face) - 1):
                triangles.append((face[0], face[i], face[i + 1]))

    if not vertices or not triangles:
        return [], []

    if len(triangles) > max_triangles:
        step = int(math.ceil(len(triangles) / max_triangles))
        triangles = triangles[::step]

    positions = []
    for x, y, z in vertices:
        positions.extend((round(x, 4), round(y, 4), round(z, 4)))

    indices = []
    vert_count = len(vertices)
    for a, b, c in triangles:
        if a < vert_count and b < vert_count and c < vert_count:
            indices.extend((int(a), int(b), int(c)))

    return positions, indices


def build_metadata(input_file):
    env = UnityPy.load(str(input_file))

    game_objects = {}
    transforms = {}
    component_type_by_id = {}
    component_go_by_id = {}
    components_by_go = defaultdict(list)
    colliders = []
    mesh_objects = {}
    mesh_filter_by_go = defaultdict(list)
    mesh_renderer_go = set()
    type_counts = Counter()

    tracked_component_types = {
        "Transform",
        "RectTransform",
        "MeshRenderer",
        "SkinnedMeshRenderer",
        "MeshFilter",
        "MeshCollider",
        "BoxCollider",
        "SphereCollider",
        "CapsuleCollider",
        "Rigidbody",
        "Light",
        "Camera",
        "AudioSource",
        "ParticleSystem",
        "MonoBehaviour",
        "Terrain",
        "Tree",
    }

    for obj in env.objects:
        obj_type = obj.type.name
        type_counts[obj_type] += 1
        path_id = int(obj.path_id)
        component_type_by_id[path_id] = obj_type

        if obj_type == "Mesh":
            mesh_objects[path_id] = obj

        if obj_type == "GameObject":
            try:
                data = obj.read_typetree()
            except Exception:
                continue
            game_objects[path_id] = {
                "id": path_id,
                "name": data.get("m_Name") or f"GameObject_{path_id}",
                "layer": int(data.get("m_Layer", 0) or 0),
                "tag": data.get("m_TagString") or "",
                "active": bool(data.get("m_IsActive", False)),
                "components": [
                    int(ptr_path_id(c.get("component", {})))
                    for c in (data.get("m_Component") or [])
                    if isinstance(c, dict)
                ],
            }
            continue

        if obj_type not in tracked_component_types:
            continue

        try:
            data = obj.read_typetree()
        except Exception:
            continue

        go_id = ptr_path_id(data.get("m_GameObject"))
        if go_id:
            component_go_by_id[path_id] = go_id
            components_by_go[go_id].append(path_id)

        if obj_type in {"Transform", "RectTransform"}:
            transforms[path_id] = {
                "id": path_id,
                "game_object_id": go_id,
                "parent_id": ptr_path_id(data.get("m_Father")),
                "local_position": v3(data.get("m_LocalPosition")),
                "local_rotation": q4(data.get("m_LocalRotation")),
                "local_scale": v3(data.get("m_LocalScale"), {"x": 1.0, "y": 1.0, "z": 1.0}),
            }
            continue

        if obj_type == "MeshRenderer":
            mesh_renderer_go.add(go_id)
            continue

        if obj_type == "MeshFilter":
            mesh_id = ptr_path_id(data.get("m_Mesh"))
            if go_id and mesh_id:
                mesh_filter_by_go[go_id].append(mesh_id)
            continue

        if obj_type in {"MeshCollider", "BoxCollider", "SphereCollider", "CapsuleCollider"}:
            colliders.append(
                {
                    "id": path_id,
                    "type": obj_type,
                    "game_object_id": go_id,
                    "is_trigger": bool(data.get("m_IsTrigger", False)),
                    "enabled": bool(data.get("m_Enabled", True)),
                    "center": v3(data.get("m_Center")),
                    "size": v3(data.get("m_Size"), {"x": 1.0, "y": 1.0, "z": 1.0}),
                    "radius": clamp_float(data.get("m_Radius", 1.0)),
                    "height": clamp_float(data.get("m_Height", 2.0)),
                    "direction": int(data.get("m_Direction", 1) or 1),
                }
            )

    world_transforms = {}

    def resolve_world_transform(transform_id, stack=None):
        if transform_id in world_transforms:
            return world_transforms[transform_id]
        if transform_id not in transforms:
            default = {
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
                "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
            }
            world_transforms[transform_id] = default
            return default

        if stack is None:
            stack = set()
        if transform_id in stack:
            return {
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
                "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
            }

        stack.add(transform_id)
        tr = transforms[transform_id]
        parent_id = tr["parent_id"]
        local_pos = tr["local_position"]
        local_rot = tr["local_rotation"]
        local_scale = tr["local_scale"]

        if not parent_id or parent_id not in transforms:
            world = {
                "position": local_pos,
                "rotation": local_rot,
                "scale": local_scale,
            }
        else:
            parent = resolve_world_transform(parent_id, stack)
            scaled = v_mul(local_pos, parent["scale"])
            rotated = q_rotate(parent["rotation"], scaled)
            world = {
                "position": v_add(parent["position"], rotated),
                "rotation": q_mul(parent["rotation"], local_rot),
                "scale": v_mul(parent["scale"], local_scale),
            }

        world_transforms[transform_id] = world
        stack.remove(transform_id)
        return world

    for tr_id in transforms:
        resolve_world_transform(tr_id)

    transform_by_go = {}
    for tr_id, tr in transforms.items():
        go_id = tr["game_object_id"]
        if go_id and go_id not in transform_by_go:
            transform_by_go[go_id] = tr_id

    features = []
    category_counts = Counter()

    for go_id, go in game_objects.items():
        comp_ids = sorted(set(go.get("components", []) + components_by_go.get(go_id, [])))
        comp_types = [component_type_by_id.get(c_id, "Unknown") for c_id in comp_ids]
        comp_type_set = set(comp_types)

        categories = []
        if "MeshRenderer" in comp_type_set or "SkinnedMeshRenderer" in comp_type_set:
            categories.append("visible")
        if any(ct.endswith("Collider") for ct in comp_type_set):
            categories.append("collider")
        if "Light" in comp_type_set:
            categories.append("light")
        if "Camera" in comp_type_set:
            categories.append("camera")
        if "AudioSource" in comp_type_set:
            categories.append("audio")
        if "ParticleSystem" in comp_type_set:
            categories.append("particle")
        if "MonoBehaviour" in comp_type_set:
            categories.append("script")
        if "Rigidbody" in comp_type_set:
            categories.append("physics")

        has_trigger = False
        for col in colliders:
            if col["game_object_id"] == go_id and col["is_trigger"]:
                has_trigger = True
                break
        if has_trigger:
            categories.append("trigger")

        tr_id = transform_by_go.get(go_id)
        world = world_transforms.get(tr_id, None)
        if world is None:
            pos = {"x": 0.0, "y": 0.0, "z": 0.0}
        else:
            pos = world["position"]

        for cat in categories:
            category_counts[cat] += 1

        features.append(
            {
                "id": go_id,
                "name": go["name"],
                "active": go["active"],
                "layer": go["layer"],
                "tag": go["tag"],
                "position": {
                    "x": round(pos["x"], 4),
                    "y": round(pos["y"], 4),
                    "z": round(pos["z"], 4),
                },
                "categories": sorted(set(categories)),
                "components": sorted(set(comp_types)),
            }
        )

    collider_features = []
    mesh_instances = []
    mesh_usage_count = Counter()
    mesh_gameobjects = defaultdict(list)
    mesh_defs = []
    bounds = {
        "minX": math.inf,
        "maxX": -math.inf,
        "minZ": math.inf,
        "maxZ": -math.inf,
    }

    def update_bounds(x, z):
        bounds["minX"] = min(bounds["minX"], x)
        bounds["maxX"] = max(bounds["maxX"], x)
        bounds["minZ"] = min(bounds["minZ"], z)
        bounds["maxZ"] = max(bounds["maxZ"], z)

    for f in features:
        update_bounds(f["position"]["x"], f["position"]["z"])

    for go_id, mesh_ids in mesh_filter_by_go.items():
        if go_id not in mesh_renderer_go:
            continue
        tr_id = transform_by_go.get(go_id)
        world = world_transforms.get(tr_id)
        if world is None:
            continue

        go_name = game_objects.get(go_id, {}).get("name", f"GameObject_{go_id}")
        for mesh_id in mesh_ids:
            mesh_instances.append(
                {
                    "meshId": int(mesh_id),
                    "gameObjectId": int(go_id),
                    "gameObjectName": go_name,
                    "position": {
                        "x": round(world["position"]["x"], 4),
                        "y": round(world["position"]["y"], 4),
                        "z": round(world["position"]["z"], 4),
                    },
                    "rotation": {
                        "x": round(world["rotation"]["x"], 6),
                        "y": round(world["rotation"]["y"], 6),
                        "z": round(world["rotation"]["z"], 6),
                        "w": round(world["rotation"]["w"], 6),
                    },
                    "scale": {
                        "x": round(world["scale"]["x"], 6),
                        "y": round(world["scale"]["y"], 6),
                        "z": round(world["scale"]["z"], 6),
                    },
                }
            )
            mesh_usage_count[int(mesh_id)] += 1
            mesh_gameobjects[int(mesh_id)].append(int(go_id))

    for mesh_id in sorted(mesh_usage_count.keys()):
        mesh_obj = mesh_objects.get(mesh_id)
        if mesh_obj is None:
            continue
        try:
            mesh_data = mesh_obj.read()
            obj_text = mesh_data.export()
            positions, indices = parse_obj_geometry(obj_text)
        except Exception:
            continue

        if not positions or not indices:
            continue

        mesh_defs.append(
            {
                "id": int(mesh_id),
                "name": getattr(mesh_data, "m_Name", f"Mesh_{mesh_id}") or f"Mesh_{mesh_id}",
                "positions": positions,
                "indices": indices,
                "instanceCount": int(mesh_usage_count[mesh_id]),
            }
        )

    for col in colliders:
        go_id = col["game_object_id"]
        tr_id = transform_by_go.get(go_id)
        world = world_transforms.get(tr_id)
        if world is None:
            base_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
            rot = {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
            scale = {"x": 1.0, "y": 1.0, "z": 1.0}
        else:
            base_pos = world["position"]
            rot = world["rotation"]
            scale = world["scale"]

        local_center_scaled = v_mul(col["center"], scale)
        world_center = v_add(base_pos, q_rotate(rot, local_center_scaled))
        name = game_objects.get(go_id, {}).get("name", f"GameObject_{go_id}")

        data = {
            "id": col["id"],
            "gameObjectId": go_id,
            "gameObjectName": name,
            "type": col["type"],
            "isTrigger": col["is_trigger"],
            "enabled": col["enabled"],
            "center": {
                "x": round(world_center["x"], 4),
                "y": round(world_center["y"], 4),
                "z": round(world_center["z"], 4),
            },
        }

        if col["type"] == "BoxCollider":
            size = {
                "x": abs(col["size"]["x"] * scale["x"]),
                "y": abs(col["size"]["y"] * scale["y"]),
                "z": abs(col["size"]["z"] * scale["z"]),
            }
            data["size"] = {k: round(v, 4) for k, v in size.items()}
            ex = size["x"] * 0.5
            ez = size["z"] * 0.5
            update_bounds(world_center["x"] - ex, world_center["z"] - ez)
            update_bounds(world_center["x"] + ex, world_center["z"] + ez)
        elif col["type"] in {"SphereCollider", "CapsuleCollider"}:
            radius = abs(col["radius"] * max(scale["x"], scale["z"]))
            data["radius"] = round(radius, 4)
            if col["type"] == "CapsuleCollider":
                data["height"] = round(abs(col["height"] * scale["y"]), 4)
                data["direction"] = col["direction"]
            update_bounds(world_center["x"] - radius, world_center["z"] - radius)
            update_bounds(world_center["x"] + radius, world_center["z"] + radius)
        else:
            update_bounds(world_center["x"], world_center["z"])

        collider_features.append(data)

    if math.isinf(bounds["minX"]):
        bounds = {"minX": -100.0, "maxX": 100.0, "minZ": -100.0, "maxZ": 100.0}
    else:
        padding_x = max((bounds["maxX"] - bounds["minX"]) * 0.05, 10.0)
        padding_z = max((bounds["maxZ"] - bounds["minZ"]) * 0.05, 10.0)
        bounds = {
            "minX": round(bounds["minX"] - padding_x, 4),
            "maxX": round(bounds["maxX"] + padding_x, 4),
            "minZ": round(bounds["minZ"] - padding_z, 4),
            "maxZ": round(bounds["maxZ"] + padding_z, 4),
        }

    payload = {
        "meta": {
            "source": input_file.name,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "unityObjectCount": int(sum(type_counts.values())),
            "gameObjectCount": len(game_objects),
            "featureCount": len(features),
            "colliderCount": len(collider_features),
            "meshDefinitionCount": len(mesh_defs),
            "meshInstanceCount": len(mesh_instances),
        },
        "stats": {
            "objectTypeCounts": dict(type_counts.most_common()),
            "categoryCounts": dict(category_counts.most_common()),
            "triggerColliderCount": sum(1 for c in collider_features if c["isTrigger"]),
        },
        "bounds": bounds,
        "features": features,
        "colliders": collider_features,
        "mapGeometry": {
            "meshes": mesh_defs,
            "instances": mesh_instances,
        },
    }
    return payload


def main():
    parser = argparse.ArgumentParser(description="Extract map metadata from a Unity WebData file")
    parser.add_argument("input", type=Path, help="Path to the Unity WebData file")
    parser.add_argument("output", type=Path, help="Output JSON path")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input file not found: {args.input}")

    payload = build_metadata(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote metadata: {args.output}")
    print(
        f"GameObjects={payload['meta']['gameObjectCount']}, Features={payload['meta']['featureCount']}, "
        f"Colliders={payload['meta']['colliderCount']}, Triggers={payload['stats']['triggerColliderCount']}"
    )


if __name__ == "__main__":
    main()