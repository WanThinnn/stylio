#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf 'Usage: bash scripts/build-ios.sh [--wait] [--clean]\n'
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

wait_for_build=false
clean=false
for option in "$@"; do
    case "$option" in
        --wait) wait_for_build=true ;;
        --clean) clean=true ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown option: $option" ;;
    esac
done

command -v gh >/dev/null || fail 'Install GitHub CLI and run gh auth login first.'

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
origin=$(git -C "$repo_root" remote get-url origin) || fail 'The origin remote is missing.'
case "$origin" in
    https://github.com/*) repository=${origin#https://github.com/} ;;
    git@github.com:*) repository=${origin#git@github.com:} ;;
    ssh://git@github.com/*) repository=${origin#ssh://git@github.com/} ;;
    *) fail 'The origin remote must point to a GitHub repository.' ;;
esac
repository=${repository%/}
repository=${repository%.git}
[[ "$repository" =~ ^[[:alnum:]_.-]+/[[:alnum:]_.-]+$ ]] || fail 'Invalid GitHub origin.'
endpoint="repos/$repository"

revision=$(git -C "$repo_root" rev-parse --verify HEAD) || fail 'Commit the source you want to build first.'
git -C "$repo_root" cat-file -e "$revision:app/Stylio.xcodeproj/project.pbxproj" 2>/dev/null ||
    fail 'Commit the iOS project before requesting a build.'

changes=$(git -C "$repo_root" status --porcelain -- app .github/workflows/ios-build.yml)
if [[ -n "$changes" ]]; then
    printf 'Warning: this build uses committed HEAD. Local iOS changes are excluded.\n' >&2
fi

if ! workflow=$(gh api "$endpoint/contents/.github/workflows/ios-build.yml" -H 'Accept: application/vnd.github.raw+json') ||
    [[ "$workflow" != *'types: [stylio-ios-build]'* ]]; then
    fail 'Push the updated ios-build.yml to the default branch before requesting an iOS build.'
fi

if ! remote_revision=$(gh api "$endpoint/commits/$revision" --jq '.sha') || [[ "$remote_revision" != "$revision" ]]; then
    fail 'GitHub cannot find local HEAD. Push the commit to origin and run this script again.'
fi

request_hash=$(printf '%s:%s:%s:%s\n' "$revision" "$(date -u +%Y%m%dT%H%M%S)" "$$" "$RANDOM" | git hash-object --stdin)
request_id=${request_hash:0:16}
run_title="Stylio iOS - $request_id"
actions_url="https://github.com/$repository/actions"

gh api --method POST "$endpoint/dispatches" \
    --raw-field 'event_type=stylio-ios-build' \
    --raw-field "client_payload[sha]=$revision" \
    --raw-field "client_payload[request_id]=$request_id" \
    --field "client_payload[clean]=$clean" ||
    fail 'The build request failed. Check gh auth status and your repository write access.'

printf 'Requested %s for %s.\n%s/workflows/ios-build.yml\n' "$run_title" "${revision:0:12}" "$actions_url"
if [[ "$wait_for_build" == false ]]; then
    exit 0
fi

for ((attempt = 0; attempt < 30; attempt++)); do
    run_id=$(gh run list --repo "$repository" --workflow ios-build.yml --event repository_dispatch --limit 20 \
        --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_title\") | .databaseId") ||
        fail 'The build was requested. Check its status in GitHub Actions.'
    if [[ -n "$run_id" ]]; then
        printf '%s/runs/%s\n' "$actions_url" "$run_id"
        gh run watch "$run_id" --repo "$repository" --exit-status
        exit 0
    fi
    sleep 3
done

fail 'The request was accepted, but the run is not visible yet. Check GitHub Actions before requesting another build.'
