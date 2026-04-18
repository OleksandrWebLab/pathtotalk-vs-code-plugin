#!/usr/bin/env bash
# Tool: release
# Target: whole project
# Input: version (argv[1]), e.g. 0.1.1 (no "v" prefix)
# Output:
#   - package.json + package-lock.json bumped to the given version
#   - commit "chore: release vX.Y.Z" pushed to origin/main
#   - tag vX.Y.Z pushed to origin
#   - GitHub Release vX.Y.Z created with puthtotalk-X.Y.Z.vsix attached
#
# Requires: docker, docker compose, gh CLI (authenticated), git remote "origin"

set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "Usage: tools/release.sh <version>"
    echo "Example: tools/release.sh 0.1.1"
    exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must be in X.Y.Z format (got: $VERSION)"
    exit 1
fi

TAG="v$VERSION"
VSIX="puthtotalk-$VERSION.vsix"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Preflight checks
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh CLI not installed. Install from https://cli.github.com/"
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "Error: gh CLI not authenticated. Run: gh auth login"
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Error: no 'origin' remote configured. Run: gh repo create ... --remote=origin --push"
    exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
    echo "Error: working tree is not clean. Commit or stash your changes first."
    git status --short
    exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: tag $TAG already exists locally"
    exit 1
fi

if git ls-remote --tags origin | grep -q "refs/tags/$TAG$"; then
    echo "Error: tag $TAG already exists on origin"
    exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
    echo "Warning: current branch is '$BRANCH', not 'main'"
    read -r -p "Continue anyway? [y/N] " answer
    if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
        exit 1
    fi
fi

# Step 1: bump version via npm (updates both package.json and package-lock.json)
echo "==> Bumping version to $VERSION"
UID_="$(id -u)"
GID_="$(id -g)"
docker compose run --rm --user "$UID_:$GID_" -e HOME=/tmp node sh -c "npm version $VERSION --no-git-tag-version"

# Step 2: build .vsix
echo "==> Building $VSIX"
make clean
make build

if [[ ! -f "$VSIX" ]]; then
    echo "Error: expected $VSIX, not found after build"
    exit 1
fi

# Step 3: commit bump + tag + push
echo "==> Committing, tagging and pushing"
git add package.json package-lock.json
git commit -m "chore: release $TAG"
git tag "$TAG"
git push origin "$BRANCH"
git push origin "$TAG"

# Step 4: create GitHub release with auto-generated notes
echo "==> Creating GitHub release $TAG"
gh release create "$TAG" "$VSIX" \
    --title "$TAG" \
    --generate-notes

echo
echo "Done. Release URL: $(gh release view "$TAG" --json url -q .url)"
