---
name: ai-zhangben
description: AI 记账工具的操作手册。当用户要求「记账」「平账」「核对账户余额」「记一笔支出/收入」「周期账」「查看本月账单/资产」时，调用本工具的后端 API 完成记账。核心流程：平账（账户对齐差额归入现金）→ 分类记账（全从现金走）→ 平账清零现金。
---

# AI 记账工具 · 操作手册

这是一个本地记账工具，后端运行在 `http://localhost:3000`，数据存 SQLite。**所有金额单位是「分」（整数）**，展示时除以 100 才是元。

## 鉴权

所有 API（除 `/api/auth/login`）都需要请求头：

```
Authorization: Bearer <API_TOKEN>
```

获取 token：`POST /api/auth/login`，body `{"password":"网页密码"}`（默认 `admin123`），响应 `{ok:true, token:"..."}`。用返回的 `token` 作为后续所有请求的 Bearer token。

## 核心记账模型（务必理解）

用户**一个月记一次总账**，现金账户是「中转枢纽」：

1. **平账**：把各账户对齐到实际余额，差额净流入现金账户。
2. **记账**：所有明细支出/收入都从现金账户走。
3. **清零**：记完明细后，按现金余额记一条「平账记录」，让现金归零（差额即"无法逐笔统计的一般性支出/收入"）。

## API 一览

### 账户
- `GET /api/accounts` → `{accounts:[...]}`，每个账户有 `id, name, type(asset/liability/receivable/payable), balance(分), shown, color`
- `POST /api/accounts` → 新建账户，body `{name, type, sub_label?, balance?, color?}`
- `PATCH /api/accounts/:id` → 修改账户（含 `shown` 0/1 切换显示、`balance`）
- `DELETE /api/accounts/:id` → 删除（现金账户不可删）
- `GET /api/accounts/cash` → 现金账户

### 平账（重点）
- `POST /api/accounts/flatten` → 批量平账，body：
  ```json
  {"date":"2026-10-27", "balances": {"账户id": 实际余额分, ...}}
  ```
  对每个非现金账户：`差额 = 实际 - 账面`，生成转账流水，差额净计入现金。返回 `{ok, results, cash}`。

### 记账
- `POST /api/entries` → 记一笔，body：
  ```json
  {"date":"2026-10-27", "type":"expense|income|transfer", "category":"餐饮", "amount":3000, "note":"备注"}
  ```
  - `expense`：现金减少 amount；`income`：现金增加 amount
  - `transfer`：`account_id` 转出、`target_account_id` 转入
- `GET /api/entries?month=2026-10` → 流水列表
- `PATCH /api/entries/:id` → 修改单条（微调）
- `DELETE /api/entries/:id` → 删除单条

### 平账清零（重点）
- `POST /api/entries/balance` → body `{"date":"2026-10-27","note":"一般性支出"}`，计算当前现金余额并记一条平账记录使其归零。返回 `{entry, cleared, cashBefore}`。

### 周期账
- `GET /api/periodic` / `POST /api/periodic` → 列表/新建
- 新建 body：`{"name":"房贷","type":"expense","category":"房贷","amount":500000,"cron":"MONTHLY:1"}`
- `cron` 支持简写 `MONTHLY:1`（每月1号）或标准 5 段 cron
- `POST /api/periodic/run-due` → 手动触发到期检查

### 应收/应付
- `GET /api/receivables?type=receivable|payable` → 明细列表
- `POST /api/receivables` → 新建，body `{account_id, name, amount, date, status}`
- `PATCH /api/receivables/:id` → 修改（含 `status: "done"` 标记结清）

### 报告
- `GET /api/report?month=2026-10` → `{totalAsset, totalLiability, receivable, payable, netAsset, monthly:{income,expense,balance}, accounts}`

## 典型记账流程（发给 AI 截图后，AI 应这样做）

1. 从截图识别各账户「实际余额」和「消费记录」。
2. 调 `POST /api/accounts/flatten` 平账（账户 id 需先 `GET /api/accounts` 查映射）。
3. 逐条调 `POST /api/entries` 记账（分类从截图识别，支出用 expense、收入用 income）。
4. 调 `POST /api/entries/balance` 清零现金。
5. 回读 `GET /api/report` 告知用户总资产/净资产/本月收支，请其确认是否微调。

## 注意事项

- **金额一律用分**：截图里的 `5000.00` 元 → 传 `500000`。
- **日期**格式 `YYYY-MM-DD`。
- 现金账户 `type="asset"` 且 `name="现金"`，是唯一中转账户，勿手动删改。
- 负债账户 `type="liability"`，余额为正表示欠款。
- 应收 `receivable`（别人欠我）、应付 `payable`（我欠别人），有独立明细表 `receivable_payable_items`。
