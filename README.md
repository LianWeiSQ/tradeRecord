# 期货/期权交易记录系统

本项目是一个本地运行的交易记录系统，面向单用户使用，主要用于记录开仓、维护仓位事件、做估值、保存复盘，并支持从固定格式 Excel 导入历史记录。

当前版本已经完成一次重要架构调整：

- 前端：`React + TypeScript + Vite`
- 后端：`Python + FastAPI`
- 自动行情：`AkShare`
- 后端存储：`SQLite`
- 前端职责：页面展示、表单交互、实时估值视图计算
- 后端职责：交易数据持久化、业务写入、备份恢复、自动行情接口、收盘快照落库

这意味着前端和数据存储已经解耦，后续如果要接入别的 Python 模块、桌面端、脚本任务或者其他前端，都可以继续复用当前后端。

## 1. 项目定位

这个系统不是通用券商终端，也不是完整量化平台，而是一个偏交易日志 / 复盘工作台的本地系统。

它主要解决这些问题：

- 记录一笔交易的首次开仓
- 在同一笔记录里继续追加加仓、减仓、平仓、移仓
- 保存持仓明细
- 自动读取期货腿和标的合约行情
- 手动补录期权估值
- 保存正式估值快照
- 保存结果、复盘结论和标签
- 从固定模板 Excel 导入历史数据
- 导出和恢复完整数据

## 2. 当前功能

### 开仓

- 新建一笔交易记录
- 录入账户、品种、标的合约、交易名称、开仓日期、标签
- 录入 1 条或多条持仓明细
- 支持期货和期权混合录入

### 仓位事件

- 在详情页继续追加：
  - `加仓`
  - `减仓`
  - `平仓`
  - `移仓`
- 不允许再创建第二次“开仓事件”

### 估值

- 自动读取：
  - 标的合约价格
  - 期货持仓明细价格
- 手动补录：
  - 期权价格
  - 自动缺失的价格
- 手动保存正式估值快照
- 工作日 `15:05` 自动生成收盘正式快照

### 首页看板

- 展示未平仓数
- 展示当前实时浮盈亏
- 展示已实现盈亏
- 展示最近正式估值
- 展示自动估值覆盖情况
- 展示最近记录和当前持仓摘要

### Excel 导入

- 仅支持当前固定模板
- 先解析，再预览，再保存
- 导入后统一进入后端数据库
- 无法可靠结构化的内容会进入提醒和附注

### 数据管理

- 导出 `JSON`
- 从 `JSON` 恢复
- 清空全部后端数据

## 3. 当前架构

### 前端

前端主要位于 [src](C:\coding\vibe\trade-record\src)。

核心职责：

- 页面展示
- 用户交互
- 调用后端 API
- 组合实时行情和正式估值，计算当前显示用的收益视图

关键文件：

- [App.tsx](C:\coding\vibe\trade-record\src\App.tsx)
- [TradeDataProvider.tsx](C:\coding\vibe\trade-record\src\components\TradeDataProvider.tsx)
- [LiveQuotesProvider.tsx](C:\coding\vibe\trade-record\src\components\LiveQuotesProvider.tsx)
- [tradeApi.ts](C:\coding\vibe\trade-record\src\services\tradeApi.ts)
- [quoteApi.ts](C:\coding\vibe\trade-record\src\services\quoteApi.ts)

### 后端

后端主要位于 [quote_service](C:\coding\vibe\trade-record\quote_service)。

核心职责：

- 提供交易数据 CRUD 接口
- 提供自动行情接口
- 持久化交易数据到 SQLite
- 保存自动收盘快照
- 提供备份恢复接口

关键文件：

- [main.py](C:\coding\vibe\trade-record\quote_service\main.py)
- [storage.py](C:\coding\vibe\trade-record\quote_service\storage.py)
- [schemas.py](C:\coding\vibe\trade-record\quote_service\schemas.py)

## 4. 启动方式

## 环境要求

- Node.js 18+
- npm 9+
- Python 3.11+  
  当前本机已验证 `Python 3.14.3`

## 第一次启动

先安装前端依赖：

```bash
npm install
```

再安装 Python 后端依赖：

```bash
npm run backend:install
```

## 启动后端

```bash
npm run backend:start
```

默认启动地址：

```text
http://127.0.0.1:8765
```

## 启动前端

新开一个终端执行：

```bash
npm run dev
```

Vite 会输出本地地址，通常是：

```text
http://127.0.0.1:5173
```

## 推荐启动顺序

1. 先启动后端：`npm run backend:start`
2. 再启动前端：`npm run dev`
3. 打开浏览器进入 Vite 输出地址

## 老命令兼容

下面两个命令仍然可用，它们只是后端命令的别名：

```bash
npm run quotes:install
npm run quotes:start
```

## 5. 常用开发命令

```bash
npm run dev
npm run build
npm run test
npm run lint
npm run backend:start
npm run backend:install
```

## 6. 当前后端接口

### 交易数据接口

- `GET /api/trades/bundle`
  - 获取当前全部交易数据
- `POST /api/trades/positions`
  - 新建开仓记录
- `POST /api/trades/events`
  - 新增仓位事件
- `POST /api/trades/snapshots`
  - 保存正式估值
- `PUT /api/trades/reviews/{position_id}`
  - 保存复盘
- `POST /api/trades/import`
  - 导入解析后的批量记录
- `GET /api/trades/backup`
  - 导出 JSON
- `POST /api/trades/restore`
  - 恢复 JSON
- `DELETE /api/trades/all`
  - 清空全部数据

### 行情接口

- `GET /health`
  - 查看后端与行情源状态
- `GET /quotes/open-positions`
  - 获取当前缓存的未平仓行情
- `POST /quotes/refresh`
  - 立即刷新一轮行情
- `POST /quotes/snapshot/close`
  - 手动补跑一次收盘快照

## 7. 数据流说明

当前主链路是：

1. 前端表单提交数据
2. 前端调用 FastAPI 接口
3. Python 后端写入 SQLite
4. 前端重新拉取 `bundle`
5. 首页 / 详情页 / 估值页重新刷新

自动估值链路是：

1. 前端请求 `/quotes/refresh`
2. Python 后端读取未平仓记录
3. 后端调用 AkShare 获取价格
4. 前端读取行情缓存并做实时收益展示
5. 手动保存或 `15:05` 自动生成正式快照

## 8. 目录说明

```text
trade-record/
├─ src/
│  ├─ components/          前端组件与 provider
│  ├─ pages/               页面
│  ├─ services/            前端 API 与视图逻辑
│  ├─ test/                前端单元测试
│  └─ types/               TypeScript 类型
├─ quote_service/
│  ├─ main.py              FastAPI 入口
│  ├─ storage.py           SQLite 持久化与业务写入
│  ├─ schemas.py           Pydantic 数据模型
│  ├─ requirements.txt     Python 依赖
│  └─ runtime/             运行时数据目录
├─ package.json
└─ README.md
```

## 9. 运行时数据位置

后端运行后的 SQLite 和行情缓存位于：

- [quote_service](C:\coding\vibe\trade-record\quote_service)
- `quote_service/runtime/trade_record.db`
- `quote_service/runtime/quote_state.json`

这两份文件属于本地运行数据。

## 10. 测试与验证

当前已验证通过：

```bash
npm run build
npm run test
python -m compileall quote_service
```

## 11. 当前限制

当前版本仍有这些明确边界：

- 只支持本地单用户，不支持登录和多用户
- 自动行情只覆盖 `期货腿 + 标的`
- 期权腿仍需手动估值
- Excel 导入解析仍在前端完成，解析后再提交到后端
- 只支持当前固定 Excel 模板
- 默认只做日盘 `15:05` 自动收盘快照，不处理夜盘正式快照

## 12. 建议的下一步

如果继续往下做，建议按这个顺序推进：

1. 把 Excel 解析迁到 Python 后端
2. 删除前端遗留的 Dexie / IndexedDB 旧代码
3. 为后端补独立测试
4. 给后端增加更清晰的模块边界：
   - `trades`
   - `quotes`
   - `imports`
   - `backups`
5. 为后续其他模块接入预留统一认证或模块注册能力
