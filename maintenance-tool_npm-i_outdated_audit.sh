# !/bin/bash

# TSプロジェクト全体に対して下記を実行します。
# 脆弱性対応など、横断的に対応したい場合の補助ツールです。
# ・脆弱性の自動Fix
# ・npmインストールして、結果をログ出力
# ・最新バージョンとのずれ、脆弱性監査をログ出力
# ※注：対象のプロジェクトが並列にCloneされていることを前提としています
# ※注：npm audit fixでアップデートを兼ねています。初期インストールには対応してないので、初回は手動でnpm installしてから実行してください。
# Requires npm 11.10.0+.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
WORKSPACE_ROOT=$(cd "$SCRIPT_DIR" && pwd)
LOG="$SCRIPT_DIR/maintenance-tool_npm-i_outdated_audit.log"
REQUIRED_NPM_VERSION="11.10.0"
NPM_MIN_RELEASE_AGE_DAYS="${NPM_MIN_RELEASE_AGE_DAYS:-7}"
RUN_MUTATING_STEPS=1
CLEAN_INSTALL_BEFORE_MUTATING=0

print_usage() {
  cat <<'EOF'
Usage: bash maintenance-tool_npm-i_outdated_audit.sh [options]

Options:
  --check-only      Skip both npm i and npm audit fix. Run only outdated/audit checks.
  --clean-install   Remove lock files and node_modules before install/audit phase.
  -h, --help        Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only)
      RUN_MUTATING_STEPS=0
      ;;
    --clean-install)
      CLEAN_INSTALL_BEFORE_MUTATING=1
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ "$RUN_MUTATING_STEPS" -eq 0 ] && [ "$CLEAN_INSTALL_BEFORE_MUTATING" -eq 1 ]; then
  echo "WARNING: --clean-install is ignored when --check-only is specified." | tee -a "$LOG" >&2
fi

# npmバージョンチェック
CURRENT_NPM_VERSION="$(command npm -v 2>/dev/null || true)"
if [ -z "$CURRENT_NPM_VERSION" ]; then
  echo "ERROR: npm is not installed or not found in PATH." | tee -a "$LOG" >&2
  exit 1
fi

if ! node -e '
const current = process.argv[1];
const required = process.argv[2];
const parse = (value) => value.split(".").map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
const [ca, cb, cc] = parse(current);
const [ra, rb, rc] = parse(required);
if (ca > ra || (ca === ra && (cb > rb || (cb === rb && cc >= rc)))) {
  process.exit(0);
}
process.exit(1);
' "$CURRENT_NPM_VERSION" "$REQUIRED_NPM_VERSION"; then
  echo "ERROR: npm $REQUIRED_NPM_VERSION or newer is required. Current: $CURRENT_NPM_VERSION" | tee -a "$LOG" >&2
  exit 1
fi

# npmコマンドをラップ
# -min-release-ageオプションを常に付与するようにする
npm() {
  # --min-release-ageオプションをnpmコマンドに渡すことで、指定した日数以上前にリリースされたパッケージのみを対象にする
  command npm --min-release-age="$NPM_MIN_RELEASE_AGE_DAYS" "$@"
}

NODE_TYPES_PACKAGES=(
  "@types/node@^22"
)

NODE24_TYPES_PACKAGES=(
  "@types/node@^24"
)

NODE26_TYPES_PACKAGES=(
  "@types/node@^26"
)

# 依存関係のインストールを行う関数。
# --Eオプションを付与して、package.jsonのsemverルールを無視して厳密に指定したバージョンをインストールする。
# check-onlyモードの場合はスキップする。
install_exact_dependencies() {
  if [ "$RUN_MUTATING_STEPS" -ne 1 ]; then
    echo "[SKIP] npm i $* --E" >> "$LOG"
    return 0
  fi
  npm i "$@" --E >> "$LOG"
}

# インストール前の状態を準備する関数。
# check-onlyモードの場合は何もしない。
# --clean-installオプションが指定されている場合は、node_modulesとロックファイルを削除して再インストールする。
prepare_install_state() {
  if [ "$RUN_MUTATING_STEPS" -ne 1 ]; then
    if [ "$CLEAN_INSTALL_BEFORE_MUTATING" -eq 1 ]; then
      echo "[SKIP] clean-install requested (check-only mode)" >> "$LOG"
    fi
    return 0
  fi

  if [ "$CLEAN_INSTALL_BEFORE_MUTATING" -eq 1 ]; then
    rm -rf node_modules package-lock.json npm-shrinkwrap.json
    echo "  [prepare] removed node_modules and lock files" >> "$LOG"
  fi

  if [ ! -f "package-lock.json" ] && [ ! -f "npm-shrinkwrap.json" ]; then
    echo "  [prepare] lock file not found, running npm i" >> "$LOG"
    npm i >> "$LOG"
  fi
}

# package.json の overrides に定義されているが、依存ツリーに存在しないパッケージを検出する。
# jq不要。node が使えれば動作する。
check_unused_overrides() {
  if [ ! -f "package.json" ]; then return 0; fi

  # node で overrides の最上位キーを抽出
  local keys
  keys=$(node -e '
    try {
      const p = require("./package.json");
      const ov = p.overrides;
      if (ov && typeof ov === "object") {
        process.stdout.write(Object.keys(ov).join("\n") + "\n");
      }
    } catch (e) {}
  ' 2>/dev/null)

  [ -z "$keys" ] && return 0

  local header_written=0
  local checked=0
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    checked=$((checked + 1))
    # 依存ツリーに pkg が含まれているか確認（2>/dev/null でピア警告を抑制）
    local ls_out
    ls_out=$(command npm ls "$pkg" --depth=Infinity 2>/dev/null || true)
    if ! echo "$ls_out" | grep -qF "${pkg}@"; then
      if [ "$header_written" -eq 0 ]; then
        echo "  [override-check] possibly unused overrides in $(basename "$(pwd)")/package.json:" >> "$LOG"
        header_written=1
      fi
      echo "    - \"$pkg\" (not found in dependency tree)" >> "$LOG"
    fi
  done <<< "$keys"

  if [ "$header_written" -eq 0 ]; then
    echo "  [override-check] all $checked override(s) are in use ($(basename "$(pwd)")/package.json)" >> "$LOG"
  fi
}

# npm outdated と npm audit を実行して、結果をログに出力する関数。
run_outdated_and_audit_dependencies() {
  prepare_install_state
  check_unused_overrides
  if [ "$RUN_MUTATING_STEPS" -eq 1 ]; then
    npm audit fix --registry=https://registry.npmjs.org/
  else
    echo "[SKIP] npm audit fix" >> "$LOG"
  fi
  npm outdated >> "$LOG"
  npm audit --registry=https://registry.npmjs.org/ >> "$LOG"
}

# APIプロジェクトの依存関係を更新する関数。
run_outdated_and_audit_dependencies_for_api() {
  install_exact_dependencies "@yazaki-common/api-generator@~1.1"
  run_outdated_and_audit_dependencies
}

run_logged_project() {
  local label="$1"
  local relative_dir="$2"
  shift 2

  (
    cd "$WORKSPACE_ROOT/$relative_dir" || exit 1
    echo "-----$label" >> "$LOG"
    "$@"
  )
}

run_ts_project_with_packages() {
  install_exact_dependencies "$@"
  run_outdated_and_audit_dependencies
}

run_online_fw_project() {
  install_exact_dependencies \
    "${NODE24_TYPES_PACKAGES[@]}" \
    "${PG_TYPES_PACKAGES[@]}" \
    "${NEST_CORE_PACKAGES_WITHOUT_COMMON[@]}" \
    "${ONLINE_TEST_FW_PACKAGES[@]}" \
    "${DOCS_PACKAGES[@]}" \
    "${TS_LINT_PACKAGES[@]}"
  if [ "$RUN_MUTATING_STEPS" -eq 1 ]; then
    npm pkg set "peerDependencies.${NEST_CORE_PEER_PACKAGE}" >> "$LOG"
  else
    echo "[SKIP] npm pkg set peerDependencies.${NEST_CORE_PEER_PACKAGE}" >> "$LOG"
  fi
  run_outdated_and_audit_dependencies
}

echo "Starting npm outdated listing..." > "$LOG"
echo "npm version: $CURRENT_NPM_VERSION (required: >= $REQUIRED_NPM_VERSION)" >> "$LOG"
echo "safe-chain: npm --min-release-age=$NPM_MIN_RELEASE_AGE_DAYS day(s)" >> "$LOG"
echo "mode: check-only=$((1 - RUN_MUTATING_STEPS))" >> "$LOG"

run_logged_project "mcp-auth-http" "mcp-auth" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}" \
  typescript@^7 \
  zod@^4
run_logged_project "mcp-server_http" "mcp-server_http" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}" \
  zod@^4
run_logged_project "mcp-server_stdio" "mcp-server_stdio" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}" \
  zod@^4
run_logged_project "rag-sample" "rag-sample" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}"
run_logged_project "yalc(demo-lib)" "yalc/packages/math-utils" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}"
run_logged_project "yalc(demo-app)" "yalc/demo-app" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}"

run_logged_project "consider_extend-relation" "consider_extend-relation" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}" \
  @biomejs/biome@^2 \
  @types/express@^5
run_logged_project "mcp-agent-bridge" "mcp-agent-bridge" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}" \
  @types/express@^5 \
  express@^5

echo "End npm outdated listing..." >> "$LOG"
