#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf 'Usage: bash scripts/build-ios.sh [--codemagic] [--wait] [--clean]\n'
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

codemagic_request() {
    curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
        --header @- "$@" <<< "x-auth-token: $CODEMAGIC_API_TOKEN"
}

start_codemagic_build() {
    local app_id branch remote_head payload build_id status previous_status=''
    app_id=${CODEMAGIC_APP_ID:-6af4c62554bfac27b6820e4c}
    [[ "$app_id" =~ ^[0-9a-f]{24}$ ]] || fail 'Invalid CODEMAGIC_APP_ID.'
    [[ -n "${CODEMAGIC_API_TOKEN:-}" ]] || fail 'Set CODEMAGIC_API_TOKEN from your Codemagic account settings.'
    command -v curl >/dev/null && command -v node >/dev/null || fail 'The Codemagic option requires curl and Node.js.'

    git -C "$repo_root" cat-file -e "$revision:codemagic.yaml" 2>/dev/null ||
        fail 'Commit codemagic.yaml before requesting a Codemagic build.'
    branch=$(git -C "$repo_root" symbolic-ref --quiet --short HEAD) || fail 'Check out the branch you want Codemagic to build.'
    remote_head=$(git -C "$repo_root" ls-remote --exit-code origin "refs/heads/$branch") ||
        fail 'Could not find this branch on origin. Push it before requesting a build.'
    [[ "${remote_head%%$'\t'*}" == "$revision" ]] ||
        fail 'Local HEAD differs from the tip of the branch on origin. Sync the branch before requesting a build.'

    payload=$(node -e '
        const [appId, branch, commit, clean] = process.argv.slice(1);
        console.log(JSON.stringify({appId, branch, workflowId: "stylio-ios", environment: {variables: {
            STYLIO_EXPECTED_COMMIT: commit, STYLIO_CLEAN_BUILD: clean
        }}}));
    ' "$app_id" "$branch" "$revision" "$clean")
    build_id=$(codemagic_request --header 'Content-Type: application/json' --data "$payload" https://api.codemagic.io/builds |
        node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).buildId ?? ""') ||
        fail 'Codemagic did not confirm the build request. Check the build list before retrying.'
    [[ "$build_id" =~ ^[0-9a-f]{24}$ ]] || fail 'Codemagic did not return a build ID.'
    printf 'Requested Stylio iOS on Codemagic for %s.\nhttps://codemagic.io/build/%s\n' "${revision:0:12}" "$build_id"

    if [[ "$wait_for_build" == false ]]; then return 0; fi
    while true; do
        status=$(codemagic_request --retry 2 "https://codemagic.io/api/v3/builds/$build_id" |
            node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).data?.status ?? ""') ||
            fail 'Could not read the Codemagic build status. Follow the build at the link above.'
        if [[ "$status" != "$previous_status" ]]; then
            printf 'Codemagic status: %s\n' "$status"
            previous_status=$status
        fi
        case "$status" in
            finished) return 0 ;;
            failed|canceled|timeout|skipped) fail "Codemagic build ended with status: $status." ;;
            initializing|queued|waiting|preparing|fetching|testing|building|publishing|finishing) sleep 15 ;;
            *) fail 'Unexpected Codemagic status. Follow the build at the link above.' ;;
        esac
    done
}

use_codemagic=false
wait_for_build=false
clean=false
for option in "$@"; do
    case "$option" in
        --codemagic) use_codemagic=true ;;
        --wait) wait_for_build=true ;;
        --clean) clean=true ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown option: $option" ;;
    esac
done

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
revision=$(git -C "$repo_root" rev-parse --verify HEAD) || fail 'Commit the source you want to build first.'
git -C "$repo_root" cat-file -e "$revision:app/Stylio.xcodeproj/project.pbxproj" 2>/dev/null ||
    fail 'Commit the iOS project before requesting a build.'

changes=$(git -C "$repo_root" status --porcelain -- app web/src web/profiles web/vendor web/THIRD_PARTY_NOTICES.txt .github/workflows/ios-build.yml codemagic.yaml)
if [[ -n "$changes" ]]; then
    printf 'Warning: this build uses committed HEAD. Local iOS changes are excluded.\n' >&2
fi

if [[ "$use_codemagic" == true ]]; then
    start_codemagic_build
    exit 0
fi

command -v gh >/dev/null || fail 'Install GitHub CLI and run gh auth login first.'
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
        --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_title $revision\" or .displayTitle == \"$run_title\") | .databaseId") ||
        fail 'The build was requested. Check its status in GitHub Actions.'
    if [[ -n "$run_id" ]]; then
        printf '%s/runs/%s\n' "$actions_url" "$run_id"
        gh run watch "$run_id" --repo "$repository" --exit-status
        exit 0
    fi
    sleep 3
done

fail 'The request was accepted, but the run is not visible yet. Check GitHub Actions before requesting another build.'
