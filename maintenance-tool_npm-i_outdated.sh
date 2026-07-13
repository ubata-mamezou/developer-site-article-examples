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
LOG="$SCRIPT_DIR/maintenance-tool_npm-outdated-suite_backend-ts.log"
REQUIRED_NPM_VERSION="11.10.0"
NPM_MIN_RELEASE_AGE_DAYS="${NPM_MIN_RELEASE_AGE_DAYS:-7}"
RUN_MUTATING_STEPS=1
CLEAN_INSTALL_BEFORE_MUTATING=0

print_usage() {
  cat <<'EOF'
Usage: bash maintenance-tool_npm-outdated-suite_backend-ts.sh [options]

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

PG_TYPES_PACKAGES=(
  "@types/pg@^8"
)

NEST_CORE_PACKAGES=(
  "@nestjs/common@11.1.27"
  "@nestjs/core@11.1.27"
  "@nestjs/platform-express@11.1.27"
  "@nestjs/testing@11.1.27"
  "@nestjs/schematics@11.1.0"
  "@nestjs/typeorm@11.0.3"
)

# online-fw では @nestjs/common を peerDependencies で管理する。
# dependencies 更新配列とは分けて定義し、バージョン更新忘れを防ぐ。
NEST_CORE_PEER_PACKAGE="@nestjs/common=^11.1.27"

NEST_CORE_PACKAGES_WITHOUT_COMMON=(
  "@nestjs/core@11.1.27"
  "@nestjs/platform-express@11.1.27"
  "@nestjs/testing@11.1.27"
  "@nestjs/schematics@11.1.0"
  "@nestjs/typeorm@11.0.3"
)

ONLINE_FW_PACKAGES=(
  # "@yazaki-common/yzk-online-fw@~1.6"
  "@yazaki-common/yzk-online-fw@1.6.4"
)

ONLINE_TEST_FW_PACKAGES=(
  "@yazaki-common/yzk-online-test-fw@~1.2"
)

DOCS_PACKAGES=(
  "typedoc@^0.28"
  "typedoc-plugin-markdown@^4"
)

TS_LINT_PACKAGES=(
  "typescript-eslint@~8.58"
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

echo "don't reflect libraries:" >> "$LOG"
echo "- @types/node v24.x.x(reason: Project standard version of node 22)" >> "$LOG"
# echo "- globals v16.4.0(reason: Library's CI fail)" >> "$LOG"
# echo "- @swc/core v1.13.20(reason: revert dist-tag)" >> "$LOG"
# echo "- @typescript-eslint/eslint-plugin 8.54.0(reason: ライブラリの公開に失敗しているため、反映できない)" >> "$LOG"
# echo "- @typescript-eslint/parser        8.54.0(reason: ライブラリの公開に失敗しているため、反映できない)" >> "$LOG"
# echo "- typescript-eslint                8.54.0(reason: ライブラリの公開に失敗しているため、反映できない)" >> "$LOG"
echo "- testcontainers v11.7.0(reason: get Credential process bug)" >> "$LOG"
echo "- @testcontainers/postgresql v11.7.0(reason: get Credential process bug)" >> "$LOG"
echo "- @testcontainers/redis v11.7.0(reason: get Credential process bug)" >> "$LOG"
echo "- form-data  4.0.0 - 4.0.5(reason: release 2026-06-10, タグのみで公開に失敗している可能性もあるので4.0.6の取込は見送る)" >> "$LOG"

echo "pending:" >> "$LOG"
# echo "- diff <8.0.3 jsdiff has a Denial of Service vulnerability in parsePatch and applyPatch (reason: 関連ライブラリが多く大幅ダウングレードしてしまう、プロダクトコードに影響はない、危険度もlowであることから、依存ライブラリの対応を待つ)" >> "$LOG"
echo "- @eslint/js, eslint 10+(reason: eslint-plugin-import@2.32.0がv10+に対応するまで保留 https://github.com/opentripplanner/OpenTripPlanner/issues/7319)" >> "$LOG"
# echo "- @swc/cli 0.8.0 (reason: @nestjs/cli@11.0.16が^0.7.0までしか対応できてないため、ライブラリの更新を待つ。)" >> "$LOG"
# echo "- class-validator 0.15+ (reason: @nestjs/mapped-types@2.1.0が^0.14.0までしか対応できてない。ITが実装されてないサービスが対象なので保留)" >> "$LOG"
echo "- typescript-eslint 8.59.0(reason: eslint10には対応したが、eslint-plugin-importが未対応なので取り込めない https://github.com/opentripplanner/OpenTripPlanner/issues/7319)" >> "$LOG"
# echo "- jest v30.4.0(reason: TypeScript7対応が一部入っているため、ESMとcommonjsの差異によってテストが失敗する)" >> "$LOG"
echo "- redis 6.0.0(reason: TypeORM未対応。TypeORMのredis機能は使ってないので、対応が遅れそうなら強制的にアップデートすることも検討)" >> "$LOG"
echo "- archiver 8.0.0(reason: NestJSはCJS、一方、archiverは8から完全にESM化されているため、取り込めない)" >> "$LOG"

# 対応済（ログとして残しておく）
# ---Overrideで対応したもの
# echo "- express 5.0.0-5.1.0 express improperly controls modification of query properties (reason: 依存ライブラリの対応を待つ)" >> "$LOG"
# echo "- Lodash has Prototype Pollution Vulnerability in _.unset and _.omit functions (reason: 使用率の高そうなメソッドなので安易なoverride対応は危険。危険度もmoderateなので、@nestjs/configの更新を待つ)" >> "$LOG"
# echo "- ajv has ReDoS when using `$data` option <8.18.0 (reason: ライブラリの更新を待つ。dataの使用箇所がなく、脆弱性レベルも低め。パッチ作成を試みたが複雑すぎるのでパッチ適用も見送り。audit fix --forceは大幅ダウングレードを迫られるため論外)" >> "$LOG"
# ---パッチバージョンがリリースされた
# echo "- dompurify  >=3.3.1(reason: 現状パッチがでてないため、ライブラリの更新を待つ)" >> "$LOG"
# echo "- axios 1.15.0(reason: 2026-04-08 01:09+7d)" >> "$LOG"
# echo "- @nestjs/** 11.1.18(reason: yzk-online-fw release 2026-04-09+7d)" >> "$LOG"
# echo "- follow-redirects 1.16.0(reason: 2026-04-13 08:02+7d)" >> "$LOG"
# echo "- DOMPurify 3.4.0(reason: 2026-04-14 04:45+7d)" >> "$LOG"
# echo "- protobufjs <7.5.5(reason: 2026-04-15 01:38+7d)" >> "$LOG"
# echo "- hono <4.12.14(reason: 2026-04-15 03:15+7d)" >> "$LOG"
# echo "- basic-ftp 5.3.0(reason: 2026-04-16 04:39+7d)" >> "$LOG"
# echo "- @yazaki-common/yzk-online-fw@1.6.1(reason: 2026-04-17 12:59+7d)" >> "$LOG"
# echo "- fast-xml-parser <5.7.0(reason: 2026-04-17 11:01+7d)" >> "$LOG"
# echo "- uuid<14.0.0(reason: 2026-04-20 12:15+7d)" >> "$LOG"
# echo "- fast-uri  <=3.1.1(reason: 2026-MM-dd hh:mm+7d)" >> "$LOG"
# echo "- hono  <=4.12.17(reason: 2026-MM-dd hh:mm+7d)" >> "$LOG"
# echo "- ip-address  <=10.1.0(reason: 2026-MM-dd hh:mm+7d)" >> "$LOG"
# echo "- protobufjs  <=7.6.2(reason: release 2026-06-10)" >> "$LOG"
# echo "- multer  1.0.0 - 2.1.1(reason: release 2026-06-16)" >> "$LOG"
# echo "- joi <17.13.4(reason: release 2026-06-12)" >> "$LOG"
# echo "- undici  7.0.0 - 7.27.2(reason: release 2026-06-16)" >> "$LOG"
# echo "- piscina  <=4.9.2(reason: release 2026-06-12)" >> "$LOG"

run_logged_project "mcp-server_http" "mcp-server_http" run_ts_project_with_packages \
  "${NODE22_TYPES_PACKAGES[@]}"
run_logged_project "mcp-server_stdio" "mcp-server_stdio" run_ts_project_with_packages \
  "${NODE22_TYPES_PACKAGES[@]}"

run_logged_project "yalc(demo-lib)" "yalc/packages/math-utils" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}"
run_logged_project "yalc(demo-app)" "yalc/demo-app" run_ts_project_with_packages \
  "${NODE26_TYPES_PACKAGES[@]}"

# run_logged_project "api-test-fw(online-test-fw)" "yzk-commons_api-fw/online-test-fw" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${PG_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${DOCS_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "api-fw(online-fw)" "yzk-commons_api-fw/online-fw" run_online_fw_project
# run_logged_project "api-generator" "yzk-commons_api-generator/tools" run_ts_project_with_packages @openapitools/openapi-generator-cli@^2
# run_logged_project "online-code-generator" "yzk-commons_online-code-generator" run_outdated_and_audit_dependencies
# run_logged_project "tr-api(api)" "yzk-commons_tr-api/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "tr-api(app-gen)" "yzk-commons_tr-api/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "tr-api(app)" "yzk-commons_tr-api/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${PG_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_TEST_FW_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "api-ref-app(api)" "yzk-commons_api-ref-app/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "api-ref-app(app-gen)" "yzk-commons_api-ref-app/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "api-ref-app(app)" "yzk-commons_api-ref-app/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${PG_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_TEST_FW_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "api-ref-app(ui)" "yzk-commons_api-ref-app/ui" run_ts_project_with_packages \
#   @playwright/test@^1 \
#   @tailwindcss/postcss@^4 \
#   @tanstack/react-query@^5 \
#   @types/react@^19 \
#   @vitejs/plugin-react@~6.0 \
#   autoprefixer@^10 \
#   date-fns@^4 \
#   lucide-react@latest \
#   postcss@^8 \
#   react@^19 \
#   react-day-picker@^10 \
#   react-dom@^19 \
#   react-hook-form@^7 \
#   react-router-dom@^7 \
#   tailwindcss@^4 \
#   "${TS_LINT_PACKAGES[@]}" \
#   vite@^8
# run_logged_project "api-ref-app(mcp-server)" "yzk-commons_api-ref-app/mcp-server" run_ts_project_with_packages "${NODE24_TYPES_PACKAGES[@]}"
# run_logged_project "api-ref-app(mcp-server-gen)" "yzk-commons_api-ref-app/mcp-server-gen" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   zod-to-json-schema@^3
# run_logged_project "api-ref-app(mcp-client)" "yzk-commons_api-ref-app/mcp-client" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   tsx@~4.22
# run_logged_project "api-ref-app(mcp-client_use-tool)" "yzk-commons_api-ref-app/mcp-client_use-tool" run_ts_project_with_packages \
#   @modelcontextprotocol/inspector@latest
# run_logged_project "authentication-service(app)" "cn-sales_authentication-service/app" run_ts_project_with_packages \
#   @types/aws-lambda@latest \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "authorization-service(api)" "cn-sales_authorization-service/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "authorization-service(app-gen)" "cn-sales_authorization-service/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "authorization-service(app)" "cn-sales_authorization-service/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_TEST_FW_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "internal-order(api)" "cn-sales_internal-order/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "internal-order(app-gen)" "cn-sales_internal-order/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "internal-order(app)" "cn-sales_internal-order/app" run_ts_project_with_packages \
#   class-validator@~0.15 \
#   @aws-sdk/client-s3@^3 \
#   @aws-sdk/client-sqs@^3 \
#   @aws-sdk/lib-storage@^3 \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "internal-order-master-service(api)" "cn-sales_internal-order-master-service/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "internal-order-master-service(app-gen)" "cn-sales_internal-order-master-service/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "internal-order-master-service(app)" "cn-sales_internal-order-master-service/app" run_ts_project_with_packages \
#   class-validator@~0.15 \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "mmcg-order(api)" "cn-sales_mmcg-order/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "mmcg-order(app-gen)" "cn-sales_mmcg-order/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "mmcg-order(app)" "cn-sales_mmcg-order/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${PG_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_TEST_FW_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   csv-parse@^7 \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "suzuki-order(api)" "cn-sales_suzuki_order/api/tools" run_outdated_and_audit_dependencies_for_api
# run_logged_project "suzuki-order(app-gen)" "cn-sales_suzuki_order/app/tools/code-generator" run_outdated_and_audit_dependencies
# run_logged_project "suzuki-order(app)" "cn-sales_suzuki_order/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${PG_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   "${ONLINE_TEST_FW_PACKAGES[@]}" \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "suzuki-meter-order(app)" "cn-sales_suzuki-meter_order/app" run_ts_project_with_packages \
#   "${NODE24_TYPES_PACKAGES[@]}" \
#   "${NEST_CORE_PACKAGES[@]}" \
#   @nestjs/swagger@^11 \
#   "${ONLINE_FW_PACKAGES[@]}" \
#   class-validator@~0.15 \
#   joi@^18 \
#   "${TS_LINT_PACKAGES[@]}"
# run_logged_project "dev-guide" "yzk-commons_dev-guide/site" run_outdated_and_audit_dependencies

echo "End npm outdated listing..." >> "$LOG"
