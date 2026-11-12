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

# ONNX Runtime loads this binary beside its bundled JS loader. Keep it on the
# engine's local origin so WebKit can initialize WASM without a remote redirect.
ort_name=ort-wasm-simd-threaded.jsep.wasm
ort_dir="$web_dir/vendor/ai-portrait"
ort_asset=$(python3 -c 'import json, sys
with open(sys.argv[1], encoding="utf-8") as manifest:
    entry = json.load(manifest)["files"][sys.argv[2]]
print(entry["sha256"], entry["url"])' "$ort_dir/assets.json" "$ort_name")
read -r ort_hash ort_url <<< "$ort_asset"
ort_cache="${STYLIO_ENGINE_CACHE_DIR:-$HOME/Library/Caches/stylio-ios/EngineAssets}"
ort_binary="$ort_cache/$ort_hash.wasm"
matches_hash() {
  [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d ' ' -f 1)" == "$ort_hash" ]]
}
if matches_hash "$ort_dir/$ort_name"; then
  ort_binary="$ort_dir/$ort_name"
elif ! matches_hash "$ort_binary"; then
  mkdir -p "$ort_cache"
  download=$(mktemp "$ort_cache/ort.XXXXXX")
  trap 'rm -f -- "$download"' EXIT
  curl --fail --silent --show-error --location --retry 2 --max-time 120 --output "$download" "$ort_url"
  if ! matches_hash "$download"; then
    printf 'error: ONNX Runtime WASM failed its SHA-256 integrity check.\n' >&2
    exit 1
  fi
  mv -f -- "$download" "$ort_binary"
fi
cp "$ort_binary" "$output_dir/vendor/ai-portrait/$ort_name"

cp "$app_dir/engine/index.html" "$app_dir/engine/start.js" "$app_dir/engine/FlyingFox-LICENSE.txt" "$web_dir/THIRD_PARTY_NOTICES.txt" "$output_dir/"
cp "$app_dir/Stylio/Assets.xcassets/AppIcon.appiconset/AppIcon.png" "$output_dir/AboutIcon.png"
rsync -a --delete "$app_dir/engine/live-photo-video/" "$output_dir/live-photo-video/"
