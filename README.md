# AI 记账工具

一个「为 AI 记账而生」的本地记账工具：Node.js 后端 + SQLite + 网页界面 + 鉴权 API。

核心思路：**一个月记一次总账**，现金账户作为中转枢纽 —— 平账（账户差额归现金）→ 分类记账（全从现金走）→ 平账记录清零现金。

## 快速开始

```bash
npm install
npm start
```

访问 `http://localhost:3000`，默认网页密码 `admin123`（登录后请在「设置」页修改）。

## 功能

- **资产 / 负债 / 应收应付** 三类账户，主页可勾选展示哪些账户，自动汇总总资产、净资产。
- **录入**：收入 / 支出 / 转账，分类图标网格 + 数字键盘（对齐口袋记账风格）。
- **平账**：批量对齐账户余额，差额自动归入现金账户。
- **记账**：所有明细从现金走。
- **平账清零**：一键记一条平账记录，清零现金。
- **周期账**：房贷、利息、停车费等按月/按规则自动记账。
- **账单流水**：按日期分组，点击单条可改金额。
- **邮件备份**：配置 SMTP 后每日把 `.db` 文件发到邮箱。

## 给 AI 用（重要）

后续让 AI 帮你记账时，把 `SKILL.md` 的内容给它，或直接说「按项目里的 SKILL.md 记账」。

核心 API 流程：
1. `POST /api/auth/login` 拿 token
2. `POST /api/accounts/flatten` 平账
3. `POST /api/entries` 逐条记账
4. `POST /api/entries/balance` 清零现金

所有 API 需要 `Authorization: Bearer <token>`，金额单位是「分」。

## 目录结构

```
server.js          入口
src/db.js          SQLite 初始化 + 建表 + 种子数据
src/auth.js        鉴权（网页密码 + API token）
src/domain/        核心域逻辑（账户/平账、记账/清零、周期账、报告）
src/routes/        REST 路由
src/backup.js      SMTP 邮件备份
public/            前端（HTML/CSS/JS，原生实现）
test/              node:test 单元测试
SKILL.md           供 AI 记账调用的操作手册
```

## 数据与备份

- 数据存在 `data/zhangben.db`（单文件）。
- 备份 = 拷贝这个文件，或配置 SMTP 自动发邮箱。
- 首次启动自动建库并写入默认分类 + 现金账户。

## 测试

```bash
npm test
```

覆盖：账户平账方向、现金归零、周期账触发等核心逻辑。

## 技术栈

Node.js 22+、Express、better-sqlite3、nodemailer、原生前端（无构建）。
