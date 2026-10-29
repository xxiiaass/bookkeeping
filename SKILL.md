---
name: ai-zhangben
description: AI 记账工具的操作手册。当用户要求「记账」「平账」「核对账户余额」「记一笔支出/收入」「周期账」「查看本月账单/资产」时，调用本工具的后端 API 完成记账。核心流程：平账（账户对齐差额归入现金）→ 分类记账（全从现金走）→ 平账清零现金。
---

# AI 记账工具 · 操作手册

这是一个本地记账工具，后端运行在 `http://kevinxia.online:3000`，数据存 SQLite。**所有金额单位是「分」（整数）**，展示时除以 100 才是元。

## 鉴权

所有 API（除 `/api/auth/login`）都需要请求头：

```
Authorization: Bearer <API_TOKEN>
```

token找用户获取，或者从项目目录.env获取

## 核心记账模型（务必理解）

用户**一个月记一次总账**，现金账户是「中转枢纽」：

1. **平账**：把各账户对齐到实际余额，差额净流入现金账户。
2. **记账**：所有明细支出/收入都从现金账户走。
3. **清零**：记完明细后，按现金余额记一条「平账记录」，让现金归零（差额即"无法逐笔统计的一般性支出/收入"），由用户自己操作执行。

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


## 典型记账流程（发给 AI 截图后，AI 应这样做）

1. 从截图识别各账户「实际余额」和「消费记录」。
  a. 消费的记录，100元以上单独记录，100元以下的三餐餐饮、停车费、小额日常开销支出，汇总记录一条“月餐饮”，100元以下的网购消费，汇总后，一个平台一条记录，备注好购买的内容清单，简单说明即可，一两个字说明一个物品。
  b. 具体消费到哪个分类，需要拉取全量的分类列表后，具体评估。
2. 逐条调 `POST /api/entries` 记账（分类从截图识别，支出用 expense、收入用 income）。
3. 调 `POST /api/accounts/flatten` 平账（账户 id 需先 `GET /api/accounts` 查映射）。
  a. 涉及股票的账户比较特殊，无法直接对账，因为股票每天都在浮动，所以股票账户只通过账户出入金记录“投资额”。而不是像其他账户一样直接对总金额。
  b. 对于信用卡账户，不能直接比对当期账单来计算负债，需要使用总额度-可用额度来比对。
  c. 对于装修贷，比较特殊，属于分期的内容，记录到信用卡中，需要根据每次还款金额，和总额度的变化，计算出每期利息，记录一笔利息支出。
  d. 对于微粒贷，类似于装修贷，需要特别注意的是，微粒贷的额度有可能自动变化，所以每次都要从截图获取当前总额度、已用额度，来计算本金的变化，并从还款记录计算利息。


## 注意事项

- **金额一律用分**：截图里的 `5000.00` 元 → 传 `500000`。
- **日期**格式 `YYYY-MM-DD`。
- 现金账户 `type="asset"` 且 `name="现金"`，是唯一中转账户，勿手动删改。
- 负债账户 `type="liability"`，余额为正表示欠款。
- 应收 `receivable`（别人欠我）、应付 `payable`（我欠别人），有独立明细表 `receivable_payable_items`。
