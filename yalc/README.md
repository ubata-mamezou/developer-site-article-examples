# yalc利用のサンプルコード

このディレクトリには、yalcを使った実例が含まれています。

## プロジェクト構成

```
yalc/
├── packages/
│   └── math-utils/          # ローカル開発中のライブラリ
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
└── demo-app/                # ライブラリを使用するアプリ
    ├── src/
    │   └── index.ts
    ├── package.json
    └── tsconfig.json
```

## 手順

### ステップ1: ライブラリをビルドして公開

```bash
cd packages/math-utils
npm install
npm run build
yalc publish
```

### ステップ2: デモアプリでライブラリを使用

```bash
cd ../../demo-app
npm install
yalc add @local/math-utils
npm run dev
```

出力例：
```
=== Math Utils Demo ===

10 + 5 = 15
10 - 5 = 5
10 × 5 = 50
10 ÷ 5 = 2

--- Error Handling Demo ---
エラー: Division by zero is not allowed

✓ Demo completed successfully!
```

### ステップ3: ライブラリを更新

`packages/math-utils/src/index.ts`を変更した後：

```bash
cd packages/math-utils
npm run build
yalc push
```

これで、demo-appが自動的に更新されます。

