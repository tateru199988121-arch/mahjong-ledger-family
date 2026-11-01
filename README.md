# 麻將有帳

家庭麻將記帳網站，支援多個麻將場、人物名單、每日輸贏與東錢統計。參與者可分次補登同一天的紀錄，並透過唯讀分享連結查看單日結果。

線上網站：[麻將有帳](https://mahjong-ledger-family-20261003.tateru199988121.chatgpt.site)

## 功能與技術

- 家庭編輯碼登入、簽章工作階段、房間與人物管理。
- 每日輸贏及東錢登錄、修改、封存與統計。
- 使用版本檢查避免多人更新互相覆蓋；單日分享連結供朋友查看。
- Vinext、React、TypeScript、Cloudflare Workers 與 D1，搭配 Drizzle 資料表及遷移檔。

## 本機執行

需要 Node.js **22.13.0 以上**及可讀取 `pnpm-lock.yaml`（lockfile v9）的 pnpm。以下指令皆在專案根目錄執行。

```sh
pnpm install --frozen-lockfile
```

將 `.dev.vars.example` 複製成 `.dev.vars`。Windows PowerShell 可執行：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

編輯 `.dev.vars`，設定自己的 `FAMILY_CODE`，並為 `SESSION_SECRET` 產生至少 32 字元的隨機密鑰。可使用下列指令產生隨機字串；請自行填入檔案，勿提交至 Git：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

首次啟動前，建置 Worker 並初始化**本機** D1 資料庫：

```sh
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mushy_lockheed.sql
```

此遷移只需對新的本機資料庫執行一次。之後若新增遷移，依序套用尚未執行的檔案。

開發模式：

```sh
pnpm dev
```

預設使用 `http://localhost:5173`；以終端機實際顯示的位址為準。使用 `.dev.vars` 的家庭編輯碼進入帳本。

也可以預覽建置完成的 Worker：

```sh
pnpm build
pnpm start
```

`start` 在本機執行 Wrangler，並沿用 `.wrangler/state`；以上指令不會部署線上網站。

## 專案結構

- `lib/api.ts`：家庭登入、帳本 API、D1 儲存與更新檢查。
- `public/app.js`、`public/styles.css`：主要操作介面。
- `app/`：頁面及 API 路由。
- `db/`、`drizzle/`：資料表定義與遷移。
- `build/`、`scripts/`：Vinext／Workers 整合及開發工具；`build/` 是必要原始碼。
- `.openai/hosting.json`：既有 Sites 專案與 D1 綁定設定。

`scripts/smoke.mjs` 是會新增及封存合成資料的 API 測試，只應對可丟棄的本機測試帳本執行。執行前需設定 `SMOKE_BASE_URL` 為本機位址，並以 `SMOKE_FAMILY_CODE` 指定該測試帳本的家庭編輯碼。

`scripts/import-local.mjs` 是選用的舊帳本匯入工具，預期從上一層 `data/ledger.json` 讀取資料；公開副本未附帶該檔案，一般開發不需要執行。

## 公開副本與資料範圍

此 repository 是既有專案的乾淨原始碼 snapshot，來源 commit 為 `3705d8d0a7c355d97a6ecbc7c8b5c038d6fbb3fa`。公開副本另行整理 README、環境變數範本及忽略規則，並將 smoke 測試改為由環境變數提供編輯碼，未包含原本 Git 歷史。

真實家庭帳本、玩家紀錄、資料庫檔案、家庭編輯碼、工作階段密鑰及本機部署狀態均未包含。首次初始化會建立空帳本；請勿將 `.dev.vars`、資料庫或資料匯出檔提交至公開 repository。

線上 Sites 的執行環境、資料與秘密設定由原部署管理；下載此原始碼不會取得線上帳本的資料或存取權。
