"""Read the app's catalog and reproduce its SDR preview renderer for research."""

import hashlib
import json
import re
from pathlib import Path

import numpy as np


def load_contract(workspace):
    repo = Path(workspace).resolve().parents[1]
    selection = (repo / "web/src/recommend/style-selection.js").read_text(encoding="utf-8")
    renderer = (repo / "web/src/recommend/style-display-render.js").read_text(encoding="utf-8")
    entries = re.search(r"const entries=\[(.*?)\n\];", selection, re.S).group(1)
    styles = []
    for match in re.finditer(r"\[(\d+),'([^']+)',([^\]]+)\]", entries):
        style_id = int(match[1])
        if style_id in (13, 15):
            continue
        tone, color, palette = map(float, match[3].split(","))
        styles.append(dict(styleId=style_id, name=match[2], tone=tone, color=color, palette=palette))
    block = re.search(r"const PROFILES=Object.freeze\(\{(.*?)\n\}\);", renderer, re.S).group(1)
    profiles = {}
    for style_id, body in re.findall(r"(\d+):\{([^}]*)\}", block):
        profiles[int(style_id)] = {
            key: float(value) for key, value in re.findall(r"(\w+):(-?[.\d]+)", body)
        }
    if len(styles) != 14 or not all(s["styleId"] in profiles for s in styles):
        raise ValueError("The app style contract changed; review the research adapter")
    return {"styles": styles, "profiles": profiles,
            "sha256": hashlib.sha256((selection + renderer).encode()).hexdigest()}


def render(rgb, candidate, contract):
    """Same RGB math/rounding/black padding behavior as applyStyleDisplayRgba."""
    original = np.asarray(rgb, dtype=np.uint8)
    source = original.astype(np.float64) / 255
    style = next(s for s in contract["styles"] if s["styleId"] == candidate["styleId"])
    profile = contract["profiles"][style["styleId"]]
    if style["styleId"] != 1 and candidate["palette"] <= .01:
        return original.copy()
    td, cd = candidate["tone"] - style["tone"], candidate["color"] - style["color"]
    strength = np.clip(.22 + .78 * np.clip(candidate["palette"] / max(.25, style["palette"]), 0, 1), 0, 1) if style["styleId"] != 1 else 1
    exposure = profile.get("exposure", 0) + td * .11
    contrast = profile.get("contrast", 0) - td * .06
    saturation = max(0, 1 + profile.get("saturation", 0) + cd * .2)
    warmth = profile.get("warmth", 0) + cd * .035
    tint, fade = profile.get("tint", 0), profile.get("fade", 0)
    changed = (source * 2**exposure - .5) * (1 + contrast) + .5
    y = np.sum(changed * np.array([.2126, .7152, .0722]), axis=-1, keepdims=True)
    changed = y + (changed - y) * saturation
    changed += np.array([warmth*.075+tint*.035, -tint*.045, -warmth*.075+tint*.035])
    changed = changed * (1-fade) + fade*.16
    output = np.floor(255 * np.clip(source + (np.clip(changed, 0, 1)-source)*strength, 0, 1) + .5).astype(np.uint8)
    output[np.all(original == 0, axis=-1)] = 0
    return output


def candidates(contract):
    """A bounded search, including an exact unchanged Standard candidate."""
    output = []
    for style in contract["styles"]:
        variants = [(style["tone"], style["color"], style["palette"])]
        variants += [(np.clip(style["tone"]+dt, -1, 1), np.clip(style["color"]+dc, -1, 1), style["palette"])
                     for dt, dc in ((.3, -.2), (-.3, .2))]
        if style["styleId"] != 1:
            variants.append((style["tone"], style["color"], style["palette"]*.55))
        for tone, color, palette in variants:
            output.append({"candidate_id": len(output), "styleId": style["styleId"],
                           "tone": float(tone), "color": float(color), "palette": float(palette)})
    return output


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))
