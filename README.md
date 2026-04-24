# 🤖 ZQ-KeepAction
一款部署在 **Cloudflare Workers** 上的轻量脚本，专门解决 GitHub Action 定时任务因**60天无活动**被自动暂停的问题，全程利用免费资源，无需额外服务器。

## ✨ 核心特性
- 🛡 **精准防暂停**：调用 GitHub 官方 API 手动触发 Workflow，模拟真实活跃行为，合规有效
- 🎲 **随机触发间隔**：支持自定义天数区间（默认40-60天），避免固定规律触发，更贴近真人操作
- 📱 **Telegram 实时通知**：推送脚本运行报告、保活结果及下一次预计运行时间，状态一手掌握
- 💰 **零成本运行**：完全消耗 Cloudflare 免费额度（每日10万次请求），无任何费用支出
- 📝 **轻量低耗**：仅在触发时间执行真实请求，其余时间仅做轻量时间检查，资源占用可忽略
- 🌐 **友好前端界面**：直观的蓝白色管理界面，支持密码保护、多用户管理、实时执行
- 🔒 **密码保护**：首次访问设置密码，确保配置安全
- 👥 **多用户管理**：支持添加多个 GitHub 用户，每个用户可独立配置 Token
- 📦 **多仓库管理**：每个用户可添加多个仓库，配置 Owner、Repo、Workflow、Ref

## 🛠 第一步：准备 GitHub 个人访问令牌（Token）
脚本需通过该 Token 获取触发 Workflow 的权限，步骤如下：
1. 登录 GitHub，点击头像 → **Settings**
2. 左侧菜单栏最下方 → **Developer settings**
3. 选择 **Personal access tokens** → **Tokens (classic)**
4. 点击 **Generate new token (classic)**
5. **Note**：自定义名称（例：`KeepAction`），便于识别
6. **Expiration**：建议选择 **No expiration**（永不过期），避免后续重复配置
7. **Select scopes**（权限勾选，二选一）：
   - 公开仓库：勾选 `public_repo` + `workflow`
   - 私有仓库：勾选 `repo`（包含所有仓库权限） + `workflow`
8. 点击 **Generate token**，复制生成的**ghp_开头**字符串，妥善保存（仅显示一次）

## ☁️ 第二步：部署 Cloudflare Worker
完成基础信息准备后，开始在 Cloudflare 平台部署 Worker 脚本。

### 1. 创建并编写 Worker 代码
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单 → **Workers & Pages**
3. 点击 **Create Application** → **Create Worker** → 先点击**Deploy**创建默认Worker
4. 进入 Worker 编辑页，点击 **Edit code**
5. 将 `_worker.js` 代码**全量复制**，覆盖编辑器中的默认代码
6. 点击右上角 **Deploy** 保存代码

### 2. 创建 KV 存储（用于存储配置和运行时间）
为实现配置持久化和随机运行间隔，需通过 KV 存储持久化配置和时间戳，步骤如下：
1. 回到 Cloudflare 主面板，左侧菜单 → **Storage & Databases** → **KV**
2. 点击 **Create Namespace**
3. 自定义命名空间名称（例：`KeepAction`），点击 **Add** 完成创建

### 3. 配置 Worker 绑定（关键步骤）
回到你的 Worker 页面，点击 **Settings** → **Variables**，配置 KV 绑定：

#### A. 绑定 KV 命名空间（必须配置）
1. 找到 **KV Namespace Bindings** 区域，点击 **Add Binding**
2. **Variable name**：**必须填写 `KeepAction`**（注意大小写！）
3. **KV Namespace**：选择上一步创建的 KV 命名空间（例：`KeepAction`）
4. 点击 **Deploy** 保存绑定

## ⏰ 第三步：设置 Worker 定时触发器（Triggers）
脚本需每日检查「是否到达运行时间」，因此需配置 Cron 触发器实现定时执行，步骤如下：
1. 回到 Worker 页面，点击 **Triggers** 选项卡
2. 找到 **Cron Triggers** 区域，点击 **Add Cron Trigger**
3. **Cron Expression**：建议设置**每天一次**，示例（可自定义时区）：
   ```bash
   0 9 * * *  # 每天上午9点执行（Cloudflare 默认 UTC 时区，需注意本地时间转换）
   ```
4. 点击 **Add Trigger** 完成配置

## 🚀 第四步：访问前端界面
1. 复制 Worker 访问 URL（在 Worker 页面的 **Overview** 标签页）
2. 在浏览器中访问该 URL
3. 首次访问会提示设置密码，输入你想要的密码
4. 进入管理界面后，配置以下内容：
   - **基础配置**：随机触发天数区间（TIME）、Telegram Token（TG_TOKEN）、Telegram 聊天ID（TG_ID）
   - **GitHub 用户**：点击「+ 添加用户」，填写 GitHub 用户名（必须是真实的 GitHub 用户名）和 GitHub Token
   - **仓库配置**：每个用户下点击「+ 添加仓库」，填写 Repo、Workflow、Ref（Owner 会自动使用该 GitHub 用户的名字）
5. 点击「💾 保存配置」保存设置
6. 点击「🚀 立即执行」测试运行



