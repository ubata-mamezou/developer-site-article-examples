# npm脆弱性修正の開発・運用手順

## 対象と実行方法

GitHub Actionsの「npm audit fix」を既定ブランチから手動実行し、`project`にnpmプロジェクトのリポジトリ相対パスを指定する。初期値は`mcp-auth`で、1回につき1プロジェクトを処理する。GitHub上での実行・push・Issue作成は未検証。

`test-run`は既定で`false`。`true`の場合、指定した`project`は無視して`tools/fixtures/audit-fix`に固定し、模擬npmで疑似差分を生成する。別の手動ワークフロー「npm audit fix test run」からも同じテスト実行ができる。両方とも再利用可能ワークフローを呼び出す。

`branch-prefix`で専用ブランチ名のprefixを指定できる。既定値は`automation/audit-fix`で、実行IDと試行番号を付けて作成する。ブランチ名はリポジトリで見えるため、公開リポジトリには企業環境固有の名前を指定しない。

`auto-minor`と`auto-patch`はそれぞれマイナー・パッチ更新の自動対応可否を指定し、既定はどちらも`true`。メジャー更新は常に自動対応せずIssueで追跡する。メジャーの最新版がある場合でも、同じメジャー内の許可された更新を検討する。

テスト実行では依存の追加や実際の脆弱性修正、Issue作成を行わず、フィクスチャのlockfileの整形とパッチバージョンを変更する。通常と同じ成果物の受け渡し・差分検証を経て、`automation/audit-fix-test-<実行ID>-<試行番号>`にpushする。テスト用ブランチの差分はマージしない。実際のnpmによる監査・修正やIssue作成は確認できない。
フィクスチャは外部依存を持たないテストデータのため、Dependabotの監視対象には含めない。

* 対象にはGit管理下の`package.json`と`package-lock.json`、`build`と`test`が必要。
* 対象の正式なSemVerバージョンが`package.json`、lockfileのルートと`packages[""]`で一致している必要がある。
* npm workspaces、ローカル依存や別プロジェクトから利用されるライブラリの統合検証は未対応のため停止する。
* outdatedはnpmの直接依存を対象とし、`dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies`を扱う。固定バージョン、`^`、`~`と正式な3要素バージョンのみ更新できる。複合範囲、タグ、エイリアス、プレリリースなどは自動更新せずIssueで確認する。未インストールの依存など現在・最新バージョンを判定できない場合もIssueにする。
* `latest`はnpmのlatest dist-tagで、`wanted`は指定範囲内の最大バージョン。両者が異なる場合は`wanted`も考慮する。0.xについても数字上のマイナー・パッチとして分類するため、互換性は更新後の検証とレビューで確認する。
* テスト結果はNode.js test runnerの`pass`件数を読み取る。別形式や全件スキップは未検証として停止する。
* npmの公開後待機期間を7日に設定する。更新候補が待機期間内の場合はインストールが失敗することがある。npmの除外設定等にも注意する。

## 処理と権限

1. 読み取り権限の修正ジョブで型チェック・ツールのテストを実行し、npm監査とoutdatedを調べる。Issue候補は成果物として保存する。
2. 更新前にビルド・テストを行い、脆弱性があれば`npm audit fix`を`--force`なしで実行する。outdatedの許可された更新を同じ候補に反映し、再インストール、ビルド、テスト、再監査を行う。
3. 修正差分がある場合、対象プロジェクトのパッチバージョンを上げる。`package.json`はバージョンと許可された直接依存の更新のみ、lockfileは対象プロジェクトのみ変更できる。想定外の変更、残存する脆弱性、検証失敗がある場合はpushしない。変更がなければバージョンは上げない。
4. 検証に成功した差分だけを別の再利用可能な書き込みジョブで検証し、`<branch-prefix>-<実行ID>-<試行番号>`へpushする。PR作成・マージ・デプロイは行わない。
5. Issue候補は別ジョブで検証し、`issues: write`を使用して作成する。修正が失敗しても候補が保存されていればIssue作成を試みる。同一プロジェクト・パッケージ・識別子のオープンIssueがあれば重複作成しない。閉じたIssueは重複対象としない。

ジョブの分離は書き込み権限を修正・テスト処理に渡さないための対策であり、生成されたlockfileやテスト結果の信頼性を保証するものではない。書き込みジョブではnpmインストールやテスト対象コードを実行しない。`contents: write`自体を専用ブランチに限定することはできないため、保護ブランチへのpushを防ぐルールを別途確認する。

ブランチの作成・pushはローカルの複合Actionに分離している。呼び出し側でcheckout、認証、作成対象コミットを準備する。既存ブランチを検出した場合は停止するが、確認とpushの間の競合は別途考慮が必要。

脆弱性のIssueは、監査で取得したadvisoryの影響範囲と、設定されたレジストリのバージョン一覧を照合し、インストール済みバージョンと同じメジャー・マイナーに範囲外のパッチ版が見つからない場合に作成する。CVEが監査結果に含まれない場合はGHSAまたはnpm advisory IDを使う。インストール済みバージョンが特定できない場合は未確認として扱う。レジストリの一覧やadvisoryが完全である保証はなく、範囲外でも安全性は保証されない。関連するライブラリ側Issueの自動調査は未実装。

Issueは候補を作成した時点の情報であり、後続の更新により解消している場合もある。重複確認と作成の間には競合時間窓があり、外部からの同時作成は防げない。利用者がIssue本文を編集できる場合、重複確認用の目印を偽装・削除できることにも注意する。releaseブランチの作成は今回の対象外。

`GITHUB_TOKEN`によるpushは通常のpushイベントのworkflowを起動しない。後日PRを作成してレビュー・CIを確認する。push直前に既定ブランチの更新を確認するが、その後にも更新される可能性があるため、PRでも最新ベースとの整合を確認する。

標準GitHub-hosted runnerを使用する。実行前にリポジトリの権限・利用可能な無料枠・成果物保存の制限を確認し、有償になる設定は使用しない。企業環境への適用はポリシー・料金・外部通信の確認が必要。

## ワークフローの補足

* **`steps.repair.outputs.changed`**: `repair`ステップが`GITHUB_OUTPUT`に`changed=true`または`changed=false`を書き込む。ステップ終了後、同じジョブの後続ステップから文字列として参照できる。`true`の場合に差分を保存し、ジョブの出力にも設定して後続の`publish`ジョブから参照する。[出力パラメーターの設定](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-output-parameter)
* **`RUNNER_TEMP`**: GitHub Actionsが提供するrunner上の一時ディレクトリのパス。`${{ runner.temp }}`でも参照できる。修正ジョブと反映ジョブは別のrunnerで動作するため、差分はartifactとしてアップロード・ダウンロードして受け渡す。[デフォルト環境変数](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables)
* **Gitのユーザー名とメールアドレス**: `github-actions[bot]`と`41898282+github-actions[bot]@users.noreply.github.com`は、GitHub.com向けの[checkoutの公式例](https://github.com/actions/checkout/tree/v7.0.1#push-a-commit-using-the-built-in-token)に記載されたコミット作成者情報であり、pushの認証情報ではない。公式例はGitHub Enterprise Serverでは使用できないとしている。

## ローカル開発

Node.js 24.12.0以降とnpm、Gitが必要。TypeScriptの実行はNode.jsの型除去機能を使い、型チェックはTypeScript 7で別途行う。Jestやts-jestは使用しない。

```shell
npm ci --prefix tools --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix tools
npm test --prefix tools
```

型チェック・テスト用の依存関係は`tools/package-lock.json`に固定し、Dependabotの監視対象に含める。Actionは最新の安定版をコミットSHAで固定し、更新時は公式の変更点とrunner要件を確認する。
模擬npmはローカルテストとテスト実行で共通化しており、バージョン計算に`semver`を使用する。

### コードの責務

* `tools/src/audit-fix.ts`: 実行モードの受付と結果出力。
* `tools/src/git-repository.ts`: Git操作、対象パスと変更ファイルの検査。
* `tools/src/repair-flow.ts`: 準備・検知・修正・検証・保存の順序と停止条件。実際の処理は呼び出し側から渡す。
* `tools/src/npm-project.ts`: npmプロジェクトの対象・依存関係・バージョンの検証。
* `tools/src/npm-commands.ts`: npmコマンド実行、監査結果とテスト結果の検証。
* `tools/src/npm-inspect.ts`・`npm-audit-issues.ts`・`npm-outdated.ts`: 監査・outdatedの分析と候補作成。
* `tools/src/npm-policy.ts`: 許可する依存バージョンの形式と更新範囲。
* `tools/src/npm-repair.ts`: npmにおける修正フローの組み立て。
* `tools/src/npm-apply.ts`: npmの候補差分の検証と適用。書き込みジョブでは修正処理を読み込まない。
* `tools/src/issue-candidates.ts`・`issue-publisher.ts`: Issue候補の検査と重複確認・作成。

共通フローは変更あり・変更なし・未解決を区別し、例外発生時は後続処理を実行しない。npmの修正・監査の失敗は例外として停止する。

現在実装している対象はnpmのみ。pnpm、Maven、pip、GitHub Actionsは未対応であり、対象ごとのファイルや検証方法を確認した上で追加する。共通フローがすべての対象に適合するとは限らない。

## 参考

* [Node.jsのTypeScriptサポート](https://nodejs.org/api/typescript.html)
* [GitHub Actionsのセキュリティ](https://docs.github.com/en/actions/reference/security/secure-use)
* [GitHub Actionsの料金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
