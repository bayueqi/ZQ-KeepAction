export default {
  async scheduled(event, env, ctx) {
    console.log(`[Start] 唤醒 Worker...`);
    
    const config = await this.loadConfig(env);
    if (!config) {
      console.log("❌ 未找到配置，跳过运行");
      return;
    }
    
    // 检查是否到达运行时间
    if (env.KeepAction) {
      const lastRun = await env.KeepAction.get("next_run_timestamp");
      const now = Date.now();
      
      // 如果有记录，且当前时间 < 计划运行时间，则跳过
      if (lastRun && now < parseInt(lastRun)) {
        const waitMs = parseInt(lastRun) - now;
        const waitDays = (waitMs / (1000 * 60 * 60 * 24)).toFixed(1);
        console.log(`⏳ 还没到时间。计划: ${new Date(parseInt(lastRun)).toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"})} (余 ${waitDays} 天)`);
        return;
      }
      
      console.log("⏰ 时间已到 (或首次运行)，开始干活！");
    }
    
    await this.runKeepAlive(config, env);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === "/api/login" && request.method === "POST") {
      return await this.handleLogin(request, env);
    }
    
    if (path === "/api/config" && request.method === "GET") {
      return await this.getConfig(request, env);
    }
    
    if (path === "/api/config" && request.method === "PUT") {
      return await this.saveConfig(request, env);
    }
    
    if (path === "/api/run" && request.method === "POST") {
      return await this.handleRun(request, env);
    }
    
    return new Response(this.getHTML(), {
      headers: { "Content-Type": "text/html;charset=utf-8" }
    });
  },

  async loadConfig(env) {
    if (!env.KeepAction) return null;
    const configStr = await env.KeepAction.get("config");
    if (!configStr) return null;
    try {
      return JSON.parse(configStr);
    } catch (e) {
      return null;
    }
  },

  async saveConfigToKV(env, config) {
    if (!env.KeepAction) return false;
    await env.KeepAction.put("config", JSON.stringify(config));
    return true;
  },

  async verifyPassword(request, env) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
    
    const token = authHeader.slice(7);
    const config = await this.loadConfig(env);
    if (!config || !config.password) return false;
    
    return token === config.password;
  },

  async handleLogin(request, env) {
    const body = await request.json();
    const { password } = body;
    
    const config = await this.loadConfig(env);
    
    if (!config) {
      const newConfig = {
        password: password,
        time: "40-60",
        tgToken: "",
        tgId: "",
        users: []
      };
      await this.saveConfigToKV(env, newConfig);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (config.password === password) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    return new Response(JSON.stringify({ success: false, message: "密码错误" }), {
      headers: { "Content-Type": "application/json" },
      status: 401
    });
  },

  async getConfig(request, env) {
    const isValid = await this.verifyPassword(request, env);
    if (!isValid) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        headers: { "Content-Type": "application/json" },
        status: 401
      });
    }
    
    const config = await this.loadConfig(env);
    if (config) delete config.password;
    return new Response(JSON.stringify({ success: true, config }), {
      headers: { "Content-Type": "application/json" }
    });
  },

  async saveConfig(request, env) {
    const isValid = await this.verifyPassword(request, env);
    if (!isValid) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        headers: { "Content-Type": "application/json" },
        status: 401
      });
    }
    
    const body = await request.json();
    const currentConfig = await this.loadConfig(env);
    const newConfig = {
      ...currentConfig,
      time: body.time,
      tgToken: body.tgToken,
      tgId: body.tgId,
      users: body.users
    };
    
    await this.saveConfigToKV(env, newConfig);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  },

  async handleRun(request, env) {
    const isValid = await this.verifyPassword(request, env);
    if (!isValid) {
      return new Response(JSON.stringify({ success: false, message: "未授权" }), {
        headers: { "Content-Type": "application/json" },
        status: 401
      });
    }
    
    const config = await this.loadConfig(env);
    if (!config) {
      return new Response(JSON.stringify({ success: false, message: "未配置" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const result = await this.runKeepAlive(config, env);
    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "Content-Type": "application/json" }
    });
  },

  async runKeepAlive(config, env) {
    const report = [];
    let successCount = 0;
    let totalCount = 0;
    
    let minDays = 40;
    let maxDays = 60;
    if (config.time) {
      const parts = config.time.split('-');
      if (parts.length === 2) {
        minDays = parseInt(parts[0]) || 40;
        maxDays = parseInt(parts[1]) || 60;
      }
    }
    
    for (const user of config.users || []) {
      if (!user.token || !user.name) continue;
      
      for (const repo of user.repos || []) {
        totalCount++;
        try {
          const url = `https://api.github.com/repos/${user.name}/${repo.name}/actions/workflows/${repo.workflow}/dispatches`;
          
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${user.token}`,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "CF-Worker-KeepAlive"
            },
            body: JSON.stringify({ ref: repo.ref })
          });

          if (response.status === 204) {
            successCount++;
            report.push(`✅ ${user.name}/${repo.name}: 成功`);
          } else {
            report.push(`❌ ${user.name}/${repo.name}: 失败 (${response.status})`);
          }
        } catch (err) {
          report.push(`❌ ${user.name}/${repo.name}: 错误 - ${err.message}`);
        }
      }
    }
    
    let nextRunDateStr = "未启用随机 (无KV)";
    if (env.KeepAction) {
      const randomDays = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
      const nextRunTime = Date.now() + (randomDays * 24 * 60 * 60 * 1000);
      
      await env.KeepAction.put("next_run_timestamp", nextRunTime.toString());
      nextRunDateStr = new Date(nextRunTime).toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
    }
    
    if (config.tgToken && config.tgId) {
      const message = [
        `🤖 <b>GitHub 保活任务报告</b>`,
        `-----------------------------`,
        ...report,
        `-----------------------------`,
        `📊 <b>统计:</b> 成功 ${successCount} / 总计 ${totalCount}`,
        `📅 <b>下一次:</b> ${nextRunDateStr}`,
        `🎲 <b>区间:</b> ${minDays}-${maxDays} 天`
      ].join("\n");

      await this.sendTelegramMessage(config.tgToken, config.tgId, message);
    }
    
    return { report, successCount, totalCount, nextRunDateStr };
  },

  async sendTelegramMessage(token, chatId, text) {
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });
    } catch (e) {
      console.error("TG 发送失败:", e);
    }
  },

  getHTML() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZQ-KeepAction</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg t='1777024262222' class='icon' viewBox='0 0 1024 1024' version='1.1' xmlns='http://www.w3.org/2000/svg' p-id='5277' width='200' height='200'%3E%3Cpath d='M145.778 128h732.444v170.667L945.778 416V96l-32-32h-800L78.222 96v600.889l35.556 32h248.889l-46.222-67.556H145.778V128z m295.111 600.889l-60.444-92.444 152.889-334.222 60.444-39.111h192l53.333 103.111-53.333 96H896L942.222 576 568.889 960H419.556l96-231.111h-74.667z m0-67.556h181.333L512 917.333l384-387.556H661.333l124.444-199.111h-192L440.889 661.333z m-3.556-266.666h-224v67.556h192l32-67.556z m-60.444 135.111H213.333v67.556h131.556l32-67.556z' p-id='5278'%3E%3C/path%3E%3C/svg%3E">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #e3f2fd 0%, #f5f9ff 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0, 100, 200, 0.08);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #bbdefb 0%, #90caf9 100%);
      padding: 30px;
      text-align: center;
      color: #1565c0;
    }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { color: #1976d2; opacity: 0.9; }
    .content { padding: 30px; }
    .login-form {
      max-width: 400px;
      margin: 50px auto;
      text-align: center;
    }
    .form-group { margin-bottom: 20px; }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-weight: 500;
    }
    .form-group input, .form-group textarea {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #bbdefb;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.3s;
    }
    .form-group input:focus, .form-group textarea:focus {
      outline: none;
      border-color: #64b5f6;
      box-shadow: 0 0 0 3px rgba(100, 181, 246, 0.2);
    }
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      cursor: pointer;
      transition: all 0.3s;
      font-weight: 500;
    }
    .btn-primary {
      background: linear-gradient(135deg, #64b5f6 0%, #42a5f5 100%);
      color: white;
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #42a5f5 0%, #1e88e5 100%);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
    }
    .btn-success {
      background: linear-gradient(135deg, #81c784 0%, #66bb6a 100%);
      color: white;
    }
    .btn-success:hover {
      background: linear-gradient(135deg, #66bb6a 0%, #4caf50 100%);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
    }
    .btn-danger {
      background: linear-gradient(135deg, #e57373 0%, #ef5350 100%);
      color: white;
    }
    .btn-danger:hover {
      background: linear-gradient(135deg, #ef5350 0%, #f44336 100%);
    }
    .btn-sm {
      padding: 8px 16px;
      font-size: 13px;
    }
    .section { margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e3f2fd; }
    .section:last-child { border-bottom: none; margin-bottom: 0; }
    .section-title {
      font-size: 18px;
      color: #1565c0;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .user-card {
      border: 1px solid #bbdefb;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 15px;
      background: #f5f9ff;
    }
    .user-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .repo-item {
      background: white;
      border: 1px solid #e3f2fd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
    }
    .repo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .repo-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .action-bar {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding-top: 20px;
    }
    .hidden { display: none !important; }
    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 25px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    }
    .toast-success { background: #66bb6a; }
    .toast-error { background: #ef5350; }
    @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    .result-box {
      background: #f5f9ff;
      border: 1px solid #bbdefb;
      border-radius: 8px;
      padding: 15px;
      margin-top: 15px;
    }
    .result-box pre {
      white-space: pre-wrap;
      font-size: 13px;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 ZQ-KeepAction</h1>
      <p>轻松管理您的 GitHub Actions 保活任务</p>
    </div>
    <div class="content">
      <div id="loginPage">
        <div class="login-form">
          <div class="form-group">
            <label>请输入密码</label>
            <input type="password" id="loginPassword" placeholder="首次使用将设置此密码">
          </div>
          <button class="btn btn-primary" onclick="login()">进入</button>
        </div>
      </div>
      
      <div id="mainPage" class="hidden">
        <div class="section">
          <h2 class="section-title">⚙️ 基础配置</h2>
          <div class="form-group">
            <label>随机触发天数区间 (TIME)</label>
            <input type="text" id="timeInput" placeholder="40-60">
          </div>
          <div class="form-group">
            <label>Telegram Bot Token (TG_TOKEN)</label>
            <input type="text" id="tgTokenInput" placeholder="123456:ABCdefxxxx">
          </div>
          <div class="form-group">
            <label>Telegram 聊天ID (TG_ID)</label>
            <input type="text" id="tgIdInput" placeholder="12345678">
          </div>
        </div>
        
        <div class="section">
          <h2 class="section-title">👥 GitHub 用户</h2>
          <div id="usersList"></div>
          <button class="btn btn-primary btn-sm" onclick="addUser()">+ 添加用户</button>
        </div>
        
        <div class="action-bar">
          <button class="btn btn-success" onclick="runKeepAlive()">🚀 立即执行</button>
          <button class="btn btn-primary" onclick="saveConfig()">💾 保存配置</button>
        </div>
        
        <div id="resultBox" class="result-box hidden">
          <h3>执行结果</h3>
          <pre id="resultContent"></pre>
        </div>
      </div>
    </div>
  </div>

  <script>
    let token = localStorage.getItem('keepAliveToken');
    let config = null;
    
    async function login() {
      const password = document.getElementById('loginPassword').value;
      if (!password) {
        showToast('请输入密码', 'error');
        return;
      }
      
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      const data = await res.json();
      if (data.success) {
        token = password;
        localStorage.setItem('keepAliveToken', token);
        showMainPage();
      } else {
        showToast(data.message || '密码错误', 'error');
      }
    }
    
    async function showMainPage() {
      document.getElementById('loginPage').classList.add('hidden');
      document.getElementById('mainPage').classList.remove('hidden');
      await loadConfig();
    }
    
    async function loadConfig() {
      const res = await fetch('/api/config', {
        headers: { 'Authorization': \`Bearer \${token}\` }
      });
      
      const data = await res.json();
      if (data.success && data.config) {
        config = data.config;
        renderConfig();
      }
    }
    
    function renderConfig() {
      document.getElementById('timeInput').value = config.time || '40-60';
      document.getElementById('tgTokenInput').value = config.tgToken || '';
      document.getElementById('tgIdInput').value = config.tgId || '';
      renderUsers();
    }
    
    function renderUsers() {
      const container = document.getElementById('usersList');
      container.innerHTML = '';
      
      (config.users || []).forEach((user, userIndex) => {
        const userDiv = document.createElement('div');
        userDiv.className = 'user-card';
        userDiv.innerHTML = \`
          <div class="user-header">
            <div class="form-group" style="margin:0;flex:1;margin-right:15px;">
              <label>用户名</label>
              <input type="text" value="\${user.name || ''}" onchange="updateUser(\${userIndex}, 'name', this.value)">
            </div>
            <button class="btn btn-danger btn-sm" onclick="removeUser(\${userIndex})">删除</button>
          </div>
          <div class="form-group">
            <label>GitHub Token</label>
            <input type="password" value="\${user.token || ''}" placeholder="ghp_xxxxxxxxxx" onchange="updateUser(\${userIndex}, 'token', this.value)">
          </div>
          <div style="margin-top:15px;">
            <h4 style="color:#1565c0;margin-bottom:10px;">📦 仓库列表</h4>
            <div id="repos-\${userIndex}"></div>
            <button class="btn btn-primary btn-sm" onclick="addRepo(\${userIndex})">+ 添加仓库</button>
          </div>
        \`;
        container.appendChild(userDiv);
        renderRepos(userIndex);
      });
    }
    
    function renderRepos(userIndex) {
      const container = document.getElementById(\`repos-\${userIndex}\`);
      container.innerHTML = '';
      
      const user = config.users[userIndex];
      (user.repos || []).forEach((repo, repoIndex) => {
        const repoDiv = document.createElement('div');
        repoDiv.className = 'repo-item';
        repoDiv.innerHTML = \`
          <div class="repo-header">
            <span style="font-weight:500;color:#333;">\${user.name || ''}/\${repo.name || ''}</span>
            <button class="btn btn-danger btn-sm" onclick="removeRepo(\${userIndex}, \${repoIndex})">删除</button>
          </div>
          <div class="repo-grid">
            <div class="form-group" style="margin:0;">
              <label>仓库名称</label>
              <input type="text" value="\${repo.name || ''}" onchange="updateRepo(\${userIndex}, \${repoIndex}, 'name', this.value)">
            </div>
            <div class="form-group" style="margin:0;">
              <label>Workflow 配置文件名</label>
              <input type="text" value="\${repo.workflow || 'main.yml'}" onchange="updateRepo(\${userIndex}, \${repoIndex}, 'workflow', this.value)">
            </div>
            <div class="form-group" style="margin:0;">
              <label>分支名称</label>
              <input type="text" value="\${repo.ref || 'main'}" onchange="updateRepo(\${userIndex}, \${repoIndex}, 'ref', this.value)">
            </div>
          </div>
        \`;
        container.appendChild(repoDiv);
      });
    }
    
    function addUser() {
      if (!config.users) config.users = [];
      config.users.push({ name: '', token: '', repos: [] });
      renderUsers();
    }
    
    function removeUser(index) {
      config.users.splice(index, 1);
      renderUsers();
    }
    
    function updateUser(index, field, value) {
      config.users[index][field] = value;
    }
    
    function addRepo(userIndex) {
      if (!config.users[userIndex].repos) config.users[userIndex].repos = [];
      config.users[userIndex].repos.push({ name: '', workflow: 'main.yml', ref: 'main' });
      renderRepos(userIndex);
    }
    
    function removeRepo(userIndex, repoIndex) {
      config.users[userIndex].repos.splice(repoIndex, 1);
      renderRepos(userIndex);
    }
    
    function updateRepo(userIndex, repoIndex, field, value) {
      config.users[userIndex].repos[repoIndex][field] = value;
    }
    
    async function saveConfig() {
      config.time = document.getElementById('timeInput').value;
      config.tgToken = document.getElementById('tgTokenInput').value;
      config.tgId = document.getElementById('tgIdInput').value;
      
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${token}\`
        },
        body: JSON.stringify(config)
      });
      
      const data = await res.json();
      if (data.success) {
        showToast('保存成功！', 'success');
      } else {
        showToast('保存失败', 'error');
      }
    }
    
    async function runKeepAlive() {
      showToast('正在执行...', 'success');
      
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: {
          'Authorization': \`Bearer \${token}\`
        }
      });
      
      const data = await res.json();
      if (data.success) {
        const resultBox = document.getElementById('resultBox');
        const resultContent = document.getElementById('resultContent');
        resultContent.textContent = data.result.report.join('\\n') + \`\\n\\n统计: 成功 \${data.result.successCount} / 总计 \${data.result.totalCount}\\n下一次: \${data.result.nextRunDateStr}\`;
        resultBox.classList.remove('hidden');
        showToast('执行完成！', 'success');
      } else {
        showToast(data.message || '执行失败', 'error');
      }
    }
    
    function showToast(message, type) {
      const toast = document.createElement('div');
      toast.className = \`toast toast-\${type}\`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    
    if (token) {
      showMainPage();
    }
  </script>
</body>
</html>
    `;
  }
};
