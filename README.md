<p align="center">
  <img src=".github/assets/hazuki.png" alt="Quesuwa" width="160" />
</p>

# Quesuwa

独立部署的问卷与反馈系统，由 DesuwaDev 维护。

Vue 3 + Vite 前端，Node.js / Express 后端，SQLite 数据库，本地文件存储。填写者免登录即可作答和上传附件；问卷只能由工作台成员（管理员账号）创建和管理。

## 功能一览

**问卷设计**

- 19 种题型：单行/多行文本、邮箱、电话、网址、数字、日期、时间、单选、多选、下拉、排序、星级评分、线性量表、NPS、矩阵单选、文件上传，以及结构类的“分页”和“说明文字”。
- 条件逻辑（均可多条件“全部 / 任一”匹配，运算包括“选择了 / 没有选择 / 包含 / 不包含 / 大于 / 小于 / 已作答…”）：
  - 显示条件：题目或整页按前面题目的答案显示或跳过，例如“选了 A 才出现的专属问题”。隐藏的题目不参与必填校验，答案也不会保存。
  - 选项条件：单个选项只在满足条件时出现，例如前面选了 A 就不再提供某些选项；已选中的选项被隐藏时会自动取消，服务端也会拒绝提交被隐藏的选项。
  - 必填条件：选填题在满足条件时自动变为必填。
- 选项增强：“其他（请说明）”、随机排列、多选最少/最多数量、批量编辑和多行粘贴。
- 规则：字符数上下限、数值范围与整数、评分/量表区间与端点标签、附件数量/大小/类型。
- 6 个起步模板（空白、客户满意度、活动报名、问题反馈、培训评估、员工脉搏调研），问卷 JSON 导入导出，问卷/题目复制，拖拽或按钮排序，删除可撤销。
- 编辑器支持 Ctrl/⌘+S 保存、离开前未保存提醒、多人同时编辑的冲突检测，以及电脑/手机两种尺寸的实时预览（可测试校验和跳题）。

**发布与填写**

- 草稿 / 收集中 / 已关闭三态，开放与截止时间、答卷数量上限、公开列表、访问码、每台设备限填一次、自定义提交按钮、同意声明、提交成功与停止收集提示、6 种主题色。
- 分享页提供链接、邀请文案和可下载的二维码。
- 填写端多页分步、进度条、题号开关、草稿自动保存到填写者浏览器、服务端错误自动定位到对应题目、提交回执编号；适配手机、平板、电脑以及横竖屏，支持暗色模式。

**答卷与统计**

- 答卷列表支持全文搜索（答案、备注、附件名、编号）、处理状态、星标、时间范围、排序与分页；详情侧栏可切换状态、写内部备注、标星、键盘翻页（← / →）、打印。
- 批量标记状态、标星、删除到回收站、恢复、永久删除。
- 导出：CSV 宽表（每份答卷一行）、CSV 长表（每个回答一行，保留提交时的题目）、JSON、附件 ZIP（按答卷编号分文件夹），均按当前筛选条件导出。
- 统计：每日趋势、处理状态、平均/中位填写用时，逐题分析（选项分布、其他答案、均值/中位数/极值、分值分布、NPS 净推荐值、矩阵热力表、排序平均名次、最新文本回答），可按时间与状态筛选并打印报告。
- 概览仪表盘：今日/近 7 天/待处理数量、近 30 天趋势、最活跃问卷与最新答卷。

**团队与系统**

- 多成员账号与三种角色：所有者（全部权限，含成员与系统）、编辑者（创建编辑问卷、处理答卷）、查看者（只读，可导出）。至少保留一个启用的所有者。
- 个人账户：显示名称、修改密码、查看并退出其他登录设备；登录可选“保持 30 天”。
- Webhook：每份新答卷 POST JSON 到指定地址，可设置 HMAC-SHA256 签名密钥，提供测试按钮和最近投递记录。
- 系统页：存储用量、数据库大小、运行状态、带操作人的操作日志（保留最近 2000 条）。

## 本机运行

需要 Node.js 24 或以上。

```sh
git clone https://github.com/DesuwaDev/Quesuwa.git
cd Quesuwa
npm ci
npm run setup
npm run build
npm start
```

- 首页：http://127.0.0.1:3100
- 工作台：http://127.0.0.1:3100/admin
- 首次启动会创建所有者账号：用户名为 `.env` 中的 `ADMIN_USERNAME`（默认 `admin`），密码为 `ADMIN_PASSWORD`（`npm run setup` 自动生成）。之后可在“我的账户”中修改，`.env` 不会被改写。
- 开发：`npm run dev`，访问 http://127.0.0.1:5173，API 代理到 3100。
- 修改 `.env` 后需要重启服务。

## 使用流程

1. 登录工作台，点击“新建问卷”，选择模板或空白问卷。
2. 在“题目”页添加和编辑题目；需要跳题时在题目或分页上添加显示条件。
3. 在“设置”页把状态改为“收集中”，按需设置时间、上限、访问码等，保存。
4. 在“分享”页复制链接、邀请文案或下载二维码。
5. 在“答卷”页处理答卷、导出数据；在“统计”页查看分析报告。
6. 需要停止收集时把状态改为“已关闭”，已有答卷全部保留。

每份答卷保存提交时的题目快照，之后修改题目或选项不会改变历史答卷；表单版本变化后，旧页面提交会收到“问卷已更新”提示，填写内容会保留在草稿中。

## 限制

- 每份问卷最多 100 个题目（含分页与说明块）；选择题 2～50 个选项，排序题最多 15 个，矩阵最多 20 行 × 10 列；每题最多 10 条显示条件。
- 每份问卷最多 2 道上传题，每题最多 3 个文件、单个 10 MB；支持 PNG / JPG / WEBP / GIF / PDF / UTF-8 TXT / LOG，类型由服务端按文件内容检测。
- 附件以随机 ID 保存，原始文件名仅作下载名；下载需要登录工作台，图片预览在独立的沙箱 CSP 下返回。
- CSV 对可能被表格软件识别为公式的内容做前缀转义。
- “每台设备限填一次”依赖浏览器 Cookie，是防重复提交的便利措施，不是身份校验。

## 项目结构

```text
shared/            浏览器与服务端共用：题型与常量、问卷结构校验、条件逻辑与答案校验
server/
  app.js           应用装配（安全头、来源校验、路由挂载）
  db.js            SQLite 打开与版本化迁移（PRAGMA user_version）
  auth.js          账号、会话、角色权限
  routes/          account · users · forms · responses · public · system
  services/        forms · responses · statistics · exports · storage · webhooks · audit
  lib/zip.js       流式 ZIP 写入
src/
  lib/             路由、API、主题、格式化、提示与对话框、剪贴板、模板
  components/      通用组件（图标、弹窗、菜单、分页、图表等）
  public/          门户、填写页、各题型渲染组件
  admin/           工作台：概览、问卷列表、问卷工作区（编辑/设置/分享/答卷/统计）、账户、成员、系统
  styles/          设计令牌、基础样式、组件、公开端、工作台、图表、打印
i18n/              核心翻译函数、zh-CN / en 语言包、技术字面量登记
```

## 数据与备份

默认 `data/` 下保存：

- `report.sqlite`（及运行时的 `-wal` / `-shm`）：问卷、答卷、成员、会话、操作日志、Webhook 记录。
- `uploads/`：附件原文件。

备份时先停止服务，再完整复制 `data/` 与 `.env`。恢复时还原整个数据目录后再启动，数据库会自动升级到当前版本。旧版本（单管理员密码）升级后，原管理密码会成为 `admin` 所有者账号的密码，已有问卷、答卷和状态全部保留。

附件总配额默认 1024 MB（`MAX_STORAGE_MB`），回收站中的附件同样占用配额；永久删除会清理附件，清理失败的文件会进入重试队列并在系统页提示。

## 上线部署

```sh
npm ci
npm run build
npm start
```

生产环境必须设置：

```dotenv
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=替换为独立随机长密码
HOST=127.0.0.1
PORT=3100
PUBLIC_ORIGIN=https://feedback.example.com
TRUST_PROXY_HOPS=1
DATA_DIR=/srv/quesuwa-data
MAX_STORAGE_MB=1024
```

`TRUST_PROXY_HOPS=1` 仅适用于**恰好一个可信反向代理**的部署；默认 0 不信任转发头。不要把 Node 端口直接暴露给可绕过代理的访客。

`PUBLIC_ORIGIN` 填浏览器访问的 HTTPS 来源（不含路径），生产启动时会校验，错误则拒绝启动。分享链接使用浏览器当前的来源。目前按独立域名根路径部署，不支持反代到子路径。

HTTPS Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 65m;
    proxy_read_timeout 120s;
}
```

生产模式的登录 Cookie 带 `Secure`，必须使用 HTTPS。内置限流（单进程内存计数，重启重置）：每 IP 每小时 20 次提交、每 15 分钟 10 次登录与 30 次访问码尝试。所有写操作都会校验请求来源。

## Webhook

在问卷“设置 → Webhook 推送”中填写地址。每份新答卷会发送：

```json
{
  "event": "response.created",
  "createdAt": "2026-09-24T08:00:00.000Z",
  "form": { "id": "…", "slug": "…", "title": "…" },
  "data": { "id": "…", "createdAt": "…", "answers": [{ "fieldId": "…", "type": "single", "label": "…", "value": "…" }] }
}
```

设置签名密钥后，请求头 `X-Quesuwa-Signature: sha256=<hex>` 为对原始请求体的 HMAC-SHA256。超时 8 秒，不自动重试；投递结果显示在设置页。

## 维护

忘记所有者密码时：停止服务，在 `.env` 中设置新的 `ADMIN_PASSWORD`（以及要恢复的 `ADMIN_USERNAME`），然后：

```sh
npm run reset-password
npm start
```

该命令会重置对应账号的密码、将其恢复为启用的所有者并退出其全部会话，不影响问卷与答卷。

## Docker 镜像与版本发布

推送版本 tag 时，GitHub Actions（`.github/workflows/release.yml`）会先跑测试，再分别在 amd64 与 arm64 **原生 runner** 上编译（不使用 QEMU 模拟），最后合并为一个多架构镜像推送到 `ghcr.io/desuwadev/quesuwa`。普通提交不会构建镜像。

```sh
git tag v1.2.0
git push origin v1.2.0
```

| tag | 生成的镜像标签 |
|---|---|
| `v1.2.0` | `1.2.0`、`1.2`、`1`、`latest` |
| `v1.3.0-rc.1`（预发布） | 仅 `1.3.0-rc.1` |
| `v0.4.0` | `0.4.0`、`0.4`、`latest`（0.x 不生成主版本标签） |

tag 中的版本号会在构建时注入：页面底部、登录页与工作台侧栏左下角显示 `vX.Y.Z`，系统页显示服务器运行的版本；若浏览器缓存的页面与服务器版本不一致，系统页会提示刷新。本地构建未指定版本时使用 `package.json` 中的版本，开发模式显示 `-dev` 后缀。

镜像特点：运行层基于纯 `alpine`，只从 `node:24-alpine` 复制 `node` 可执行文件（不含 npm / yarn / corepack 和头文件），再加上生产依赖与已构建的前端（两者压缩后约 1.3 MB）；以非 root 的 `node` 用户运行；健康检查使用 Alpine 自带的 busybox `wget`，不会额外启动 Node 进程；构建使用 GitHub Actions 缓存，重复发布更快。

```sh
docker run -d --name quesuwa --restart unless-stopped   --env-file .env -e NODE_ENV=production   -e PUBLIC_ORIGIN=https://feedback.example.com   -p 127.0.0.1:3100:3100 -v quesuwa-data:/app/data   ghcr.io/desuwadev/quesuwa:latest
```

或使用仓库自带的 `docker-compose.yml`（端口默认只绑定 `127.0.0.1:3100`，版本可用 `QUESUWA_VERSION` 指定）：

```sh
npm run setup   # 或手动创建 .env，至少设置 ADMIN_PASSWORD
docker compose up -d
```

生产环境在 `.env` 中设置 `NODE_ENV=production` 与 `PUBLIC_ORIGIN`，并在前面配置 HTTPS 反向代理。

也可以本地自行构建：`docker build --build-arg APP_VERSION=1.2.0 -t quesuwa .`。

容器内忘记密码时（镜像不含 npm，直接用 node 运行脚本）：

```sh
docker exec -e ADMIN_PASSWORD='新的随机长密码' quesuwa node scripts/reset-password.js
```

首次推送后，ghcr 上的包默认是私有的；如需公开拉取，在 GitHub 仓库的 Packages 设置里把可见性改为 Public。

健康检查 `GET /api/health` 仅返回服务状态。请只运行一个实例访问同一数据目录。

## 中英文与硬编码门禁

- 界面支持简体中文和英语，页面右上角切换；优先使用已保存的选择，其次浏览器语言。
- 两份独立语言文件：`i18n/locales/zh-CN.json`、`i18n/locales/en.json`。界面、错误提示、导出表头、模板内容和命令行提示都从这里读取；`key.one` 为可选的单数形式。
- API 按 `Accept-Language` 返回本地化错误文本，同时返回稳定的 `code` 与参数。
- 问卷标题、题目、选项与答案属于用户内容，不随界面语言改变。

```sh
npm run check:i18n
```

检查已加入 `npm test`、`npm run build` 和 CI，覆盖 `src/`、`server/`、`shared/`、`public/` 以及启动脚本、HTML 入口和 Vite 配置：模板文本、可见属性、脚本字符串、CSS 生成内容、两种语言 key 与插值参数一致性、动态 key 来源。API 路径、SQL、题型标识等技术字面量需在 `i18n/technical-literals.json` 中按文件、类型、精确内容和原因登记。

## 验证

```sh
npm test
npm run build
```

测试使用临时数据目录，覆盖：登录与来源校验、角色权限、草稿/发布/关闭、访问码、每设备一次、条件分页、各题型答案校验、版本冲突、伪装文件拒绝、附件权限、题目快照、回收站与永久删除、统计（NPS、排序、其他答案）、CSV/JSON/ZIP 导出、会话与改密、重启持久化、反向代理和语言协商。

Node 24 可能对内置 `node:sqlite` 输出 ExperimentalWarning，不影响功能。
