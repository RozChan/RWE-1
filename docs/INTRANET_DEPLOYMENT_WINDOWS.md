# RWE-1 Windows 工作站内网部署

本文说明如何把当前 Windows 工作站作为公司内网服务器运行 RWE-1。该方案只面向可信公司内网，不是公网部署方案。

## 1. 架构

```text
同事浏览器
  -> http://<工作站内网 IPv4 或主机名>:3000
  -> Next.js 生产服务（0.0.0.0:3000）
  -> 同源 /api/* 代理
  -> FastAPI（127.0.0.1:8000）
  -> Mock / DeepSeek 服务
```

浏览器只访问前端的 `/api/*` 同源路径。Next.js Route Handler 在服务器进程内读取 `BACKEND_INTERNAL_URL`，再把请求转发到 FastAPI。浏览器不会请求访问者电脑上的 `localhost:8000`，也不会获得 DeepSeek Key。只需向公司内网开放 TCP 3000；不要开放 8000。

## 2. 前置条件

- Windows 10/11 工作站持续开机并连接公司内网；
- Node.js LTS（包含 `node.exe` 和 `npm.cmd`）；
- Python 3.12 和 Windows Python Launcher `py.exe`；
- 有权从 npm/Python 包源安装依赖；
- 如使用 DeepSeek，确认公司网络和数据合规政策允许访问该服务。

## 3. 首次安装与生产构建

在项目根目录双击：

```cmd
setup-intranet.cmd
```

该脚本会：

1. 检查 Node、npm 和 Python 3.12；
2. 在根目录创建或复用 `.venv`；
3. 安装 FastAPI 生产依赖；
4. 使用 `npm ci` 安装锁定版本的前端依赖；
5. 执行 `npm run build` 生成 Next.js 生产构建；
6. 缺少时创建 `.env.intranet` 和 `backend/.env`。

依赖安装和构建只在 setup 或代码更新时执行；`start-intranet.cmd` 不会重复执行 `npm install`。

## 4. 环境变量

首次 setup 会从 `.env.intranet.example` 创建未提交的 `.env.intranet`：

```env
BACKEND_INTERNAL_URL=http://127.0.0.1:8000
FRONTEND_HOST=0.0.0.0
FRONTEND_PORT=3000
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
```

默认值适合推荐架构，通常无需修改。`BACKEND_INTERNAL_URL` 只进入 Next.js 服务端进程，不要改成 `NEXT_PUBLIC_*`。脚本启动后端时会让内部 URL 与 `BACKEND_PORT` 保持一致。

模型配置仍放在未提交的 `backend/.env`。Mock 模式不需要密钥；使用 DeepSeek 时只在服务器工作站填写：

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=请在工作站本地填写真实密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
```

不要把 `.env.intranet`、`backend/.env`、API Key 或密码提交到 Git，也不要放入任何 `NEXT_PUBLIC_*` 变量。

## 5. 一键启动

双击：

```cmd
start-intranet.cmd
```

脚本会检查 PID 文件和端口占用，后台启动不带 `--reload` 的 FastAPI，等待 `/api/health` 成功，再启动 Next.js 生产服务。重复运行不会静默创建第二套服务。成功后会显示：

```text
Local:    http://localhost:3000
Intranet: http://<内网IPv4>:3000
```

如果只检测到 `169.254.x.x`，脚本会警告这是链路本地地址，通常不代表正常公司内网连接；请检查网线、Wi-Fi、VPN 和 DHCP。

## 6. 停止服务

双击：

```cmd
stop-intranet.cmd
```

脚本只读取 `logs/frontend.pid` 和 `logs/backend.pid`，并停止对应项目进程树；不会终止系统中所有 `node.exe` 或 `python.exe`。停止后 PID 文件会被删除。

## 7. 查看状态

双击：

```cmd
check-intranet.cmd
```

检查内容包括：

- TCP 3000 和 8000 是否正在监听；
- FastAPI `/api/health` 是否返回 `ok`；
- 本机首页是否返回成功状态；
- 当前可用内网 IPv4 和访问地址；
- 日志文件位置。

也可以在服务器浏览器访问：

```text
http://localhost:3000/api/health
```

预期只返回：

```json
{"status":"ok"}
```

## 8. 日志与 PID 文件

运行数据位于项目根目录的 `logs`，该目录不提交 Git：

- `logs/backend.log`：FastAPI/Uvicorn 标准输出和错误；
- `logs/frontend.log`：Next.js 标准输出和错误；
- `logs/backend.pid`：本项目后端启动包装进程 PID；
- `logs/frontend.pid`：本项目前端启动包装进程 PID。

目前应用代码没有主动把上传文档全文、模型密钥写入日志，但框架错误可能包含请求错误上下文。日志仍应按公司敏感数据规范保护、留存和清理。

## 9. 查看内网 IP 和同事访问方式

在服务器工作站运行：

```cmd
ipconfig
```

找到正在使用的网卡下正常公司内网 IPv4，例如 `10.x.x.x`、`172.16-31.x.x` 或 `192.168.x.x`。同事浏览器输入：

```text
http://<服务器IPv4>:3000
```

如果公司 DNS/NetBIOS 支持主机名解析，也可尝试：

```text
http://<计算机名>:3000
```

服务器 IP 变化时无需重新构建前端，因为浏览器使用当前页面同源 `/api`，后端始终经服务器环回地址访问。只需把新的 IPv4/主机名告诉同事。

## 10. Windows 防火墙

仅允许 TCP 3000 入站。不要开放 TCP 8000，因为 FastAPI 只监听 `127.0.0.1`。

下面仅是参考命令，**需要管理员权限，并且必须先向公司 IT 确认安全规范、网段范围和审批要求**：

```powershell
New-NetFirewallRule `
  -DisplayName "RWE-1 Intranet 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow
```

脚本不会自动修改防火墙。如果 IT 要求限制来源网段，应由 IT 在规则中增加相应的 `RemoteAddress`。

## 11. 多人访问现状与待确认项

当前版本没有登录、账号、角色或权限系统。任何能访问 TCP 3000 的内网用户都能调用同源 API，并可能产生模型费用。因此只应部署在经 IT 确认的可信网段。

当前数据流的隔离特点：

- 页面文档、summary、Agent plan、分析进度等 Zustand 状态位于每个浏览器页面内存，不是后端模块级共享工作区；
- workspace 通过浏览器下载/上传 `.rwe.json` 文件保存，没有后端共享 workspace 或数据库；
- 上传文件由 FastAPI 直接读取内存并关闭，不使用固定临时文件名，不会因同名文件覆盖服务器文件；
- 每次分析、Agent 和输出请求都携带自己的上下文；后端没有保存“当前用户文档”或共享进度变量；
- 后端模块级复用一个 LLM provider 实例。当前 provider 没有按用户保存文档状态，但模型服务的并发额度、速率限制和费用仍是所有访问者共享的；
- Uvicorn 当前使用单进程，耗时模型请求会受工作线程和上游模型并发能力影响。正式多人规模、超时、限流和队列策略需要压测后确认；
- 没有服务端持久化、审计、配额或恢复机制。关闭页面、工作站休眠或服务重启不会提供服务端工作区恢复。

本次没有增加账号系统或数据库。若公司要求用户鉴权、部门隔离、审计、模型配额或服务端历史记录，应作为后续独立安全设计，不宜通过小改动临时实现。

## 12. 常见问题

### 同事无法打开页面

1. 在服务器运行 `check-intranet.cmd`；
2. 确认服务器没有休眠、关机或断网；
3. 用 `ipconfig` 确认 IP 没变化；
4. 确认 Windows 防火墙只放行了 TCP 3000；
5. 确认同事与服务器在允许互访的公司网段；
6. 联系 IT 检查客户端隔离、VLAN、VPN、EDR 或端口策略。

### 后端健康检查失败

查看 `logs/backend.log`，确认 `.venv`、`backend/.env` 和模型配置正确。不要为了绕过问题把后端改为监听 `0.0.0.0`。

### 页面打开但 API 返回 502

Next.js 已运行但 FastAPI 不可用。运行 `check-intranet.cmd`，查看 `logs/backend.log`，再用 `stop-intranet.cmd` 和 `start-intranet.cmd` 完整重启。

### 端口已占用

启动脚本会明确拒绝启动。先确认占用者；若是旧的本项目实例，运行 `stop-intranet.cmd`。不要直接结束所有 Node/Python 进程。

### 工作站休眠或关机

工作站休眠、关机、重启、退出公司网络时，服务都会不可用。应配置符合公司 IT 策略的电源设置；重启后再次运行 `start-intranet.cmd`。

## 13. 更新代码后的步骤

在服务器工作站更新代码后：

```cmd
stop-intranet.cmd
setup-intranet.cmd
start-intranet.cmd
check-intranet.cmd
```

`setup-intranet.cmd` 会重新安装锁定依赖并执行生产构建。不要用 `npm run dev` 代替正式服务。

## 14. 手动生产命令（故障排查）

后端真实入口是 `backend/app/main.py` 中的 `app`：

```cmd
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

前端：

```cmd
cd frontend
npm run build
npm run start:intranet
```

生产运行不使用 `next dev`、Uvicorn `--reload`、Docker、Nginx 或公网服务。
