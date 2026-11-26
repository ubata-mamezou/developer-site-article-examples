# npm脆弱性修正の開発・運用手順

## 対象と実行方法

GitHub Actionsの「npm audit fix」を既定ブランチから手動実行し、`project`にnpmプロジェクトのリポジトリ相対パスを指定する。初期値は`mcp-auth`で、1回につき1プロジェクトを処理する。GitHub上での実行・pushは未検証。

`test-run`は既定で`false`。`true`の場合、指定した`project`は無視して`tools/fixtures/audit-fix`に固定し、模擬npmで疑似差分を生成する。別の手動ワークフロー「npm audit fix test run」からも同じテスト実行ができる。両方とも再利用可能ワークフローを呼び出す。

テスト実行では依存の追加や実際の脆弱性修正は行わず、フィクスチャのlockfileの整形だけを変更する。通常と同じ成果物の受け渡し・差分検証を経て、`automation/audit-fix-test-<実行ID>-<試行番号>`にpushする。テスト用ブランチの差分はマージしない。実際のnpmによる監査・修正の動作は確認できない。
フィクスチャは外部依存を持たないテストデータのため、Dependabotの監視対象には含めない。

* 対象にはGit管理下の`package.json`と`package-lock.json`、`build`と`test`が必要。
* npm workspaces、ローカル依存や別プロジェクトから利用されるライブラリの統合検証は未対応のため停止する。
* テスト結果はNode.js test runnerの`pass`件数を読み取る。別形式や全件スキップは未検証として停止する。
* npmの公開後待機期間を7日に設定する。npmの除外設定等には注意する。

## 処理と権限

1. 読み取り権限の修正ジョブで型チェック・ツールのテストを実行し、対象の更新前ビルド・テスト、監査を行う。
2. 脆弱性があれば`npm audit fix`を`--force`なしで実行し、再インストール、ビルド、テスト、再監査を行う。
3. 変更は対象の`package-lock.json`のみを許可する。想定外の変更、修正不能な脆弱性、検証失敗がある場合はpushしない。脆弱性がなければ変更しない。
4. 検証に成功した差分だけを別の書き込みジョブで検証し、`automation/audit-fix-<実行ID>-<試行番号>`へpushする。PR作成・マージ・デプロイは行わない。

ジョブの分離は書き込み権限を修正・テスト処理に渡さないための対策であり、生成されたlockfileやテスト結果の信頼性を保証するものではない。書き込みジョブではnpmインストールやテスト対象コードを実行しない。`contents: write`自体を専用ブランチに限定することはできないため、保護ブランチへのpushを防ぐルールを別途確認する。

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
模擬npmはローカルテストとテスト実行で共通化しており、新しい依存パッケージは使用しない。

## 参考

* [Node.jsのTypeScriptサポート](https://nodejs.org/api/typescript.html)
* [GitHub Actionsのセキュリティ](https://docs.github.com/en/actions/reference/security/secure-use)
* [GitHub Actionsの料金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
