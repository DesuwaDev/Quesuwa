# Quesuwa

独立部署的自定义问卷与反馈系统，由 DesuwaDev 维护。

Vue 3 + Vite 前端，Node.js / Express 后端，SQLite 数据库，本地文件存储。填写者免登录，可以直接上传附件；管理员使用单独的管理密码。

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

- 问卷首页：http://127.0.0.1:3100
- 管理后台：http://127.0.0.1:3100/admin
- 管理密码：`npm run setup` 自动生成的 `.env` 文件中的 `ADMIN_PASSWORD`。初始化命令不会覆盖已有配置。
- 开发：`npm run dev`，访问 http://127.0.0.1:5173，API 代理到 3100。先关闭占用 3100 的其他实例。
- 修改 `.env` 后需要重启服务。不要同时运行生产和开发服务器。

## 使用流程

1. 登录管理后台。首次启动会创建一份**草稿状态**的 Bug 反馈问卷。
2. 编辑已有问卷，或者新建空白问卷、使用 Bug 反馈模板。
3. 自定义标题、说明、提交成功提示，以及每道题的题型、标题、说明、选项、必填状态和顺序。
4. 点击“预览问卷”检查效果。预览不会提交答卷。
5. 将问卷状态切换为“发布 · 开放填写”，保存后复制填写链接。
6. 将链接放在公告中。用户无需 Google 账号或本系统账号，即可填答和上传附件。
7. 在“查看答卷”中查看完整内容、下载附件、标记处理状态、填写内部备注或导出 CSV。
8. 需要停止收集时，把问卷改为“关闭”并保存。答卷仍保留。

## 自定义范围

- 多份问卷，每份问卷有独立 `/f/链接标识` 地址。
- 单行文本、多行文本、单选、多选、下拉、文件上传。
- 每份最多 30 道题；选择题 2～30 个选项；最多 2 道上传题。
- 每道上传题最多 3 个附件、单个 10 MB。支持 PNG / JPG / WEBP / GIF / PDF / UTF-8 TXT / LOG。
- 文件类型由服务端检测，文件以随机 ID 保存，原始文件名仅作下载名；附件下载需要管理登录。
- 现有答卷保存题目快照，因此改标题、选项、删除题目不会改变历史答卷。
- 修改后旧填写页提交会得到版本冲突提示，避免按错误题目保存。
- 发布后修改链接标识会让旧链接失效；建议保持不变。
- CSV 为“一行一道回答”，包含答卷编号、时间、状态、提交时的题目与答案。对可能被表格识别为公式的文本做前缀转义。
- 管理会话 8 小时有效，重启服务后需重新登录。

首版不包含跳题逻辑、多人管理员、邮件通知、公开结果页面及附件批量 ZIP 下载。问卷采用关闭归档方式，不提供永久删除按钮。

## 数据与备份

默认 `data/` 下保存：

- `report.sqlite`：问卷、答卷、状态、备注和附件元数据。
- `report.sqlite-wal` / `report.sqlite-shm`：SQLite 运行时文件。
- `uploads/`：附件原文件。

备份时建议先停止服务，再完整复制 `data/`。不要只在运行时复制单个 SQLite 文件。恢复时还原整个数据目录。`.env` 应单独安全保存，不要提交到 Git。

没有自动过期或清理用户上传文件的任务；需根据站点实际容量管理存储。

## 上线部署

```sh
npm ci
npm run build
npm start
```

生产环境必须设置：

```dotenv
NODE_ENV=production
ADMIN_PASSWORD=替换为独立随机长密码
HOST=127.0.0.1
PORT=3100
PUBLIC_ORIGIN=https://feedback.example.com
TRUST_PROXY_HOPS=1
DATA_DIR=/srv/quesuwa-data
```

`TRUST_PROXY_HOPS=1` 仅适用于**恰好一个可信反向代理**的部署。若链路不同，应按实际配置调整；不要把 Node 端口直接暴露给可绕过代理的访客。默认值 0 不信任转发头。

HTTPS Nginx 示例（证书配置沿用你的站点设置）：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 65m;
    proxy_read_timeout 120s;
}
```

生产模式管理 Cookie 带 `Secure`，请使用 HTTPS；纯 HTTP 下不能正常保持管理登录。公开来源校验需要 `PUBLIC_ORIGIN` 与浏览器访问地址一致。

内置基础提交限流：每个 IP 每小时最多 12 次提交尝试；管理员登录每 IP 每 15 分钟最多 10 次尝试。它们是单进程内存计数，重启会重置，不能替代大规模站点的网关防刷措施。多人共用出口 IP 时，需按实际情况调整 `server/app.js` 中的额度。当前设计面向单实例部署。

请自行确定问卷用途、附件内容和数据保留时间，并在问卷说明中写清。不要将 `.env`、`data/` 作为静态目录提供下载。

## 验证

```sh
npm test
npm run build
```

集成测试使用临时数据库及附件目录，验证：管理登录、来源校验、草稿不可访问、发布/关闭、必填和选项校验、版本冲突、伪装文件拒绝、匿名带附件提交、附件访问权限、历史题目快照、备注状态、CSV 公式转义、重启后数据保留。测试结束后清理临时数据，不改动真实答卷。

Node 24.14 可能对内置 `node:sqlite` 输出 ExperimentalWarning；这是运行时提示，不影响当前已验证功能。

## 中英文与硬编码门禁

- 界面支持简体中文和英语，页面右上角可切换。优先使用已保存的选择，其次浏览器语言，未支持的浏览器语言回退为简体中文。
- 两份独立语言文件：`i18n/locales/zh-CN.json`、`i18n/locales/en.json`。界面、错误提示、模板、CSV 表头和启动提示均从这里读取。
- `DEFAULT_LOCALE=zh-CN` 或 `en` 控制后端默认语言和首次生成的模板。更改后重启；如需更新初始 HTML 元信息，同时重新构建。
- API 按 `Accept-Language` 返回本地化错误文本，同时返回稳定的 `code` 和参数。CSV 下载链接携带当前界面语言。
- 问卷标题、题目、选项、成功提示及用户答案是自定义内容，不会因切换界面语言而被改写。新建模板按当时选择的语言生成。
- 状态使用 `pending / inProgress / resolved / needsInfo` 固定代码保存，显示时翻译。启动时自动迁移旧中文状态，保留答卷和题目快照。

```sh
npm run check:i18n
```

该检查已加入 `npm test`、`npm run build` 和 GitHub CI。检查失败时测试、构建或 CI 会直接停止。合并是否强制等待 CI 通过，由仓库分支保护中的 required status checks 控制。

检查范围包括 `src/`、`server/`、`public/` 下的 JS/TS、Vue、HTML、SVG、CSS、JSON，以及启动配置脚本、HTML 入口和 Vite 配置：

- Vue 文本、可见属性、表达式、JS 字符串及模板字符串中的中英文文案。
- 新增运行时代码文件自动纳入扫描。
- 两种语言 key 是否齐全、值是否为空、插值参数是否一致、引用 key 是否存在。
- CSS 生成内容、HTML 页面标题/描述、SVG 文本。
- 新的动态翻译 key 必须先显式登记其来源，避免无法静态验证的任意拼接。

API 路径、SQL、协议标识等技术字面量通过 `i18n/technical-literals.json` 按**文件、字面量类型、精确内容和原因**登记，不允许整文件忽略。不要将用户可见文案加入这个例外表；新增文案应增加两种语言的 key。文档、测试样本、检查工具自身的开发者诊断、依赖、构建产物和用户数据不参与运行时文案扫描。`i18n/legacy-statuses.json` 仅用于历史数据迁移。

回归测试会故意注入中英文按钮、属性、脚本文案、CSS 文案、未知 key、缺失插值参数等错误，验证门禁确实能拒绝它们。
