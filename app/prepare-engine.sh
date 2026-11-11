#!/usr/bin/env bash
set -euo pipefail

app_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
web_dir="$app_dir/../web"
output_dir=${1:?Expected an output resource directory}

mkdir -p "$output_dir/src" "$output_dir/profiles" "$output_dir/vendor"
rsync -a --delete "$web_dir/src/" "$output_dir/src/"
rsync -a --delete "$web_dir/profiles/" "$output_dir/profiles/"
# Public model weights use the existing verified on-demand download paths.
rsync -a --delete --delete-excluded --exclude='*.onnx*' --exclude='*.wasm' "$web_dir/vendor/" "$output_dir/vendor/"
cp "$app_dir/engine/index.html" "$app_dir/engine/start.js" "$app_dir/engine/FlyingFox-LICENSE.txt" "$web_dir/THIRD_PARTY_NOTICES.txt" "$output_dir/"
cp "$app_dir/Stylio/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$output_dir/AboutIcon.png"
rsync -a --delete "$app_dir/engine/live-photo-video/" "$output_dir/live-photo-video/"
