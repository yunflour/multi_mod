/**
 * 联机Mod 构建脚本
 * 
 * 从原始 server.js 生成两个版本：
 * 1. dist/standalone/server.js - 独立运行版本
 * 2. dist/plugin/index.js - SillyTavern 插件版本
 * 
 * 使用方法：node build.js
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, 'server.js');
const DIST_DIR = path.join(__dirname, 'dist');
const STANDALONE_DIR = path.join(DIST_DIR, 'standalone');
const PLUGIN_DIR = path.join(DIST_DIR, 'plugin');

// 确保目录存在
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// 读取源文件
function readSource() {
    return fs.readFileSync(SOURCE_FILE, 'utf-8');
}

// 生成独立版本
function buildStandalone(source) {
    let code = source;
    
    // 添加 shebang（如果没有的话）
    if (!code.startsWith('#!/usr/bin/env node')) {
        code = '#!/usr/bin/env node\n' + code;
    }
    
    return code;
}

// 生成插件版本
function buildPlugin() {
    // 使用字符串数组拼接避免模板字符串嵌套问题
    const lines = [];
    
    lines.push('/**');
    lines.push(' * SillyTavern 联机Mod 服务端插件');
    lines.push(' * ');
    lines.push(' * 此文件由 build.js 自动生成，请勿直接编辑！');
    lines.push(' * 如需修改，请编辑 server.js 后运行 node build.js');
    lines.push(' * ');
    lines.push(' * 安装方式：');
    lines.push(' * 1. 将此文件夹复制到 SillyTavern/plugins/ 目录');
    lines.push(' * 2. 在 config.yaml 中设置 enableServerPlugins: true');
    lines.push(' * 3. 重启酒馆');
    lines.push(' */');
    lines.push('');
    lines.push("const WebSocket = require('ws');");
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ 插件信息 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('const pluginInfo = {');
    lines.push("    id: 'multiplayer-mod',");
    lines.push("    name: '联机Mod服务端',");
    lines.push("    description: '为SillyTavern提供多人联机功能的WebSocket服务器',");
    lines.push('};');
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ 配置 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('const DEFAULT_PORT = 2157;');
    lines.push("const PASSWORD = '';  // 插件模式下可在此处设置密码");
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ 状态管理 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('let wss = null;');
    lines.push('const users = new Map();');
    lines.push('let hostId = null;');
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ 工具函数 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('function timestamp() {');
    lines.push("    return new Date().toLocaleTimeString('zh-CN', { ");
    lines.push("        hour: '2-digit', ");
    lines.push("        minute: '2-digit', ");
    lines.push("        second: '2-digit' ");
    lines.push('    });');
    lines.push('}');
    lines.push('');
    lines.push('function log(type, message) {');
    lines.push('    const icons = {');
    lines.push("        info: '📢',");
    lines.push("        join: '✅',");
    lines.push("        leave: '❌',");
    lines.push("        chat: '💬',");
    lines.push("        error: '⚠️',");
    lines.push("        input: '📝',");
    lines.push("        ai: '🤖',");
    lines.push("        host: '👑'");
    lines.push('    };');
    lines.push("    console.log(`[${timestamp()}] ${icons[type] || '•'} ${message}`);");
    lines.push('}');
    lines.push('');
    lines.push('function broadcast(message, excludeWs = null) {');
    lines.push('    if (!wss) return;');
    lines.push('    const data = JSON.stringify(message);');
    lines.push('    wss.clients.forEach(client => {');
    lines.push('        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {');
    lines.push('            client.send(data);');
    lines.push('        }');
    lines.push('    });');
    lines.push('}');
    lines.push('');
    lines.push('function broadcastAll(message) {');
    lines.push('    if (!wss) return;');
    lines.push('    const data = JSON.stringify(message);');
    lines.push('    wss.clients.forEach(client => {');
    lines.push('        if (client.readyState === WebSocket.OPEN) {');
    lines.push('            client.send(data);');
    lines.push('        }');
    lines.push('    });');
    lines.push('}');
    lines.push('');
    lines.push('function sendTo(ws, message) {');
    lines.push('    if (ws.readyState === WebSocket.OPEN) {');
    lines.push('        ws.send(JSON.stringify(message));');
    lines.push('    }');
    lines.push('}');
    lines.push('');
    lines.push('function getUserList() {');
    lines.push('    return Array.from(users.values()).map(u => ({');
    lines.push('        id: u.id,');
    lines.push('        name: u.name,');
    lines.push('        ready: u.ready,');
    lines.push('        isHost: u.id === hostId');
    lines.push('    }));');
    lines.push('}');
    lines.push('');
    lines.push('function broadcastHostChange(newHostId) {');
    lines.push('    const newHost = users.get(newHostId);');
    lines.push('    broadcastAll({');
    lines.push("        type: 'host_change',");
    lines.push("        from: 'server',");
    lines.push("        fromName: '服务器',");
    lines.push('        data: { ');
    lines.push('            hostId: newHostId,');
    lines.push('            hostName: newHost ? newHost.name : null ');
    lines.push('        },');
    lines.push('        timestamp: Date.now()');
    lines.push('    });');
    lines.push('}');
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ 服务器控制 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('function startServer(port = DEFAULT_PORT) {');
    lines.push('    if (wss) {');
    lines.push("        console.log('[联机Mod] 服务器已在运行中');");
    lines.push('        return;');
    lines.push('    }');
    lines.push('    ');
    lines.push('    wss = new WebSocket.Server({ port });');
    lines.push('    ');
    lines.push('    wss.on("connection", (ws, req) => {');
    lines.push('        const clientIp = req.socket.remoteAddress;');
    lines.push('        log("info", `新连接来自 ${clientIp}`);');
    lines.push('        ');
    lines.push('        let userId = null;');
    lines.push('        let userName = null;');
    lines.push('        ');
    lines.push('        ws.on("message", (data) => {');
    lines.push('            try {');
    lines.push('                const message = JSON.parse(data.toString());');
    lines.push('                ');
    lines.push('                switch (message.type) {');
    lines.push('                    case "join":');
    lines.push('                        handleJoin(ws, message);');
    lines.push('                        break;');
    lines.push('                    case "leave":');
    lines.push('                        handleLeave(ws);');
    lines.push('                        break;');
    lines.push('                    case "chat":');
    lines.push('                        handleChat(ws, message);');
    lines.push('                        break;');
    lines.push('                    case "user_input":');
    lines.push('                        handleUserInput(ws, message);');
    lines.push('                        break;');
    lines.push('                    case "ready":');
    lines.push('                        handleReady(ws, message);');
    lines.push('                        break;');
    lines.push('                    case "ai_response":');
    lines.push('                        handleAiResponse(ws, message);');
    lines.push('                        break;');
    lines.push('                    case "transfer_host":');
    lines.push('                        handleTransferHost(ws, message);');
    lines.push('                        break;');
    lines.push('                    default:');
    lines.push('                        const targetUserId = message.data?.targetUserId;');
    lines.push('                        if (targetUserId) {');
    lines.push('                            const targetUser = users.get(targetUserId);');
    lines.push('                            if (targetUser && targetUser.ws && targetUser.ws.readyState === WebSocket.OPEN) {');
    lines.push('                                targetUser.ws.send(JSON.stringify(message));');
    lines.push('                            }');
    lines.push('                        } else {');
    lines.push('                            broadcast(message, ws);');
    lines.push('                        }');
    lines.push('                }');
    lines.push('            } catch (error) {');
    lines.push('                log("error", `消息解析错误: ${error.message}`);');
    lines.push('            }');
    lines.push('        });');
    lines.push('        ');
    lines.push('        function handleJoin(ws, message) {');
    lines.push('            const { name, password } = message.data || {};');
    lines.push('            ');
    lines.push('            if (PASSWORD && password !== PASSWORD) {');
    lines.push('                sendTo(ws, {');
    lines.push('                    type: "error",');
    lines.push('                    from: "server",');
    lines.push('                    fromName: "服务器",');
    lines.push('                    data: { targetId: message.from, message: "密码错误" },');
    lines.push('                    timestamp: Date.now()');
    lines.push('                });');
    lines.push('                log("error", `用户 ${name || message.from} 密码错误，拒绝连接`);');
    lines.push('                ws.close();');
    lines.push('                return;');
    lines.push('            }');
    lines.push('            ');
    lines.push('            userId = message.from;');
    lines.push('            userName = name || message.fromName || `用户${userId.substring(0, 4)}`;');
    lines.push('            ');
    lines.push('            const isFirstUser = users.size === 0;');
    lines.push('            if (isFirstUser) {');
    lines.push('                hostId = userId;');
    lines.push('                log("host", `${userName} 成为房主`);');
    lines.push('            }');
    lines.push('            ');
    lines.push('            users.set(userId, { id: userId, name: userName, ready: false, ws: ws });');
    lines.push('            ');
    lines.push('            log("join", `${userName} (${userId}) 加入了房间`);');
    lines.push('            ');
    lines.push('            broadcast({');
    lines.push('                type: "join",');
    lines.push('                from: userId,');
    lines.push('                fromName: userName,');
    lines.push('                data: { name: userName, isHost: isFirstUser },');
    lines.push('                timestamp: Date.now()');
    lines.push('            }, ws);');
    lines.push('            ');
    lines.push('            sendTo(ws, {');
    lines.push('                type: "sync_state",');
    lines.push('                from: "server",');
    lines.push('                fromName: "服务器",');
    lines.push('                data: { users: getUserList(), hostId: hostId },');
    lines.push('                timestamp: Date.now()');
    lines.push('            });');
    lines.push('            ');
    lines.push('            log("info", `当前在线: ${users.size} 人`);');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleLeave(ws) {');
    lines.push('            if (userId && users.has(userId)) {');
    lines.push('                const user = users.get(userId);');
    lines.push('                const wasHost = userId === hostId;');
    lines.push('                users.delete(userId);');
    lines.push('                ');
    lines.push('                log("leave", `${user.name} (${userId}) 离开了房间`);');
    lines.push('                ');
    lines.push('                if (wasHost && users.size > 0) {');
    lines.push('                    const nextUser = users.values().next().value;');
    lines.push('                    hostId = nextUser.id;');
    lines.push('                    log("host", `房主权限自动转让给 ${nextUser.name}`);');
    lines.push('                    broadcastHostChange(hostId);');
    lines.push('                } else if (users.size === 0) {');
    lines.push('                    hostId = null;');
    lines.push('                }');
    lines.push('                ');
    lines.push('                broadcast({');
    lines.push('                    type: "leave",');
    lines.push('                    from: userId,');
    lines.push('                    fromName: user.name,');
    lines.push('                    data: null,');
    lines.push('                    timestamp: Date.now()');
    lines.push('                });');
    lines.push('                ');
    lines.push('                log("info", `当前在线: ${users.size} 人`);');
    lines.push('            }');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleChat(ws, message) {');
    lines.push('            if (!userId) return;');
    lines.push('            const content = message.data?.content || "";');
    lines.push('            log("chat", `${userName}: ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`);');
    lines.push('            broadcast({ type: "chat", from: userId, fromName: userName, data: { content }, timestamp: Date.now() }, ws);');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleUserInput(ws, message) {');
    lines.push('            if (!userId) return;');
    lines.push('            log("input", `${userName} 提交了输入`);');
    lines.push('            broadcastAll({');
    lines.push('                type: "user_input",');
    lines.push('                from: userId,');
    lines.push('                fromName: userName,');
    lines.push('                data: message.data,');
    lines.push('                timestamp: Date.now()');
    lines.push('            });');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleReady(ws, message) {');
    lines.push('            if (!userId || !users.has(userId)) return;');
    lines.push('            const ready = message.data?.ready || false;');
    lines.push('            users.get(userId).ready = ready;');
    lines.push('            log("info", `${userName} ${ready ? "已准备" : "取消准备"}`);');
    lines.push('            broadcast({ type: "ready", from: userId, fromName: userName, data: { ready }, timestamp: Date.now() }, ws);');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleAiResponse(ws, message) {');
    lines.push('            if (!userId) return;');
    lines.push('            if (userId !== hostId) {');
    lines.push('                log("error", `${userName} 尝试发送AI回复但不是房主`);');
    lines.push('                sendTo(ws, {');
    lines.push('                    type: "error",');
    lines.push('                    from: "server",');
    lines.push('                    fromName: "服务器",');
    lines.push('                    data: { targetId: userId, message: "只有房主可以发送AI回复" },');
    lines.push('                    timestamp: Date.now()');
    lines.push('                });');
    lines.push('                return;');
    lines.push('            }');
    lines.push('            const content = message.data?.content || "";');
    lines.push('            log("ai", `房主广播AI回复 (${content.length} 字符)`);');
    lines.push('            broadcast({ type: "ai_response", from: userId, fromName: userName, data: message.data, timestamp: Date.now() }, ws);');
    lines.push('        }');
    lines.push('        ');
    lines.push('        function handleTransferHost(ws, message) {');
    lines.push('            if (!userId) return;');
    lines.push('            if (userId !== hostId) {');
    lines.push('                log("error", `${userName} 尝试转让房主但不是当前房主`);');
    lines.push('                sendTo(ws, {');
    lines.push('                    type: "error",');
    lines.push('                    from: "server",');
    lines.push('                    fromName: "服务器",');
    lines.push('                    data: { targetId: userId, message: "只有当前房主可以转让权限" },');
    lines.push('                    timestamp: Date.now()');
    lines.push('                });');
    lines.push('                return;');
    lines.push('            }');
    lines.push('            const newHostId = message.data?.targetUserId;');
    lines.push('            if (!newHostId || !users.has(newHostId)) {');
    lines.push('                log("error", "转让目标用户不存在");');
    lines.push('                return;');
    lines.push('            }');
    lines.push('            const newHost = users.get(newHostId);');
    lines.push('            hostId = newHostId;');
    lines.push('            log("host", `${userName} 将房主权限转让给 ${newHost.name}`);');
    lines.push('            broadcastHostChange(hostId);');
    lines.push('        }');
    lines.push('        ');
    lines.push('        ws.on("close", () => handleLeave(ws));');
    lines.push('        ws.on("error", (err) => log("error", `WebSocket错误: ${err.message}`));');
    lines.push('    });');
    lines.push('    ');
    lines.push('    wss.on("listening", () => {');
    lines.push('        log("info", `WebSocket服务器已启动，端口: ${port}`);');
    lines.push('    });');
    lines.push('    ');
    lines.push('    wss.on("error", (err) => {');
    lines.push('        log("error", `服务器错误: ${err.message}`);');
    lines.push('    });');
    lines.push('}');
    lines.push('');
    lines.push('function stopServer() {');
    lines.push('    if (wss) {');
    lines.push('        broadcastAll({');
    lines.push('            type: "server_shutdown",');
    lines.push('            from: "server",');
    lines.push('            fromName: "服务器",');
    lines.push('            data: { message: "服务器正在关闭" },');
    lines.push('            timestamp: Date.now()');
    lines.push('        });');
    lines.push('        wss.close();');
    lines.push('        wss = null;');
    lines.push('        users.clear();');
    lines.push('        hostId = null;');
    lines.push('    }');
    lines.push('}');
    lines.push('');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('// ███ SillyTavern 插件接口 ███');
    lines.push('// ═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('async function init(router) {');
    lines.push("    console.log('\\x1b[36m[联机Mod]\\x1b[0m 插件正在初始化...');");
    lines.push('    ');
    lines.push('    try {');
    lines.push('        startServer(DEFAULT_PORT);');
    lines.push("        console.log('\\x1b[32m[联机Mod]\\x1b[0m WebSocket服务器启动成功！');");
    lines.push('    } catch (error) {');
    lines.push("        console.error('\\x1b[31m[联机Mod]\\x1b[0m 启动失败:', error);");
    lines.push('    }');
    lines.push('    ');
    lines.push("    router.get('/api/multiplayer/status', (req, res) => {");
    lines.push('        res.json({');
    lines.push('            running: wss !== null,');
    lines.push('            port: DEFAULT_PORT,');
    lines.push('            users: users.size,');
    lines.push('            hostId: hostId,');
    lines.push('        });');
    lines.push('    });');
    lines.push('    ');
    lines.push('    return Promise.resolve();');
    lines.push('}');
    lines.push('');
    lines.push('async function exit() {');
    lines.push("    console.log('\\x1b[33m[联机Mod]\\x1b[0m 正在关闭WebSocket服务器...');");
    lines.push('    stopServer();');
    lines.push('    return Promise.resolve();');
    lines.push('}');
    lines.push('');
    lines.push('module.exports = {');
    lines.push('    init,');
    lines.push('    exit,');
    lines.push('    info: pluginInfo,');
    lines.push('};');
    
    return lines.join('\n');
}

// 主构建函数
function build() {
    console.log('🔨 联机Mod 构建脚本');
    console.log('='.repeat(50));
    
    // 检查源文件
    if (!fs.existsSync(SOURCE_FILE)) {
        console.error('❌ 错误: 找不到源文件 server.js');
        process.exit(1);
    }
    
    // 创建目录
    ensureDir(STANDALONE_DIR);
    ensureDir(PLUGIN_DIR);
    
    // 读取源文件
    const source = readSource();
    console.log('📖 读取源文件: ' + SOURCE_FILE);
    
    // 生成独立版本
    const standaloneCode = buildStandalone(source);
    const standalonePath = path.join(STANDALONE_DIR, 'server.js');
    fs.writeFileSync(standalonePath, standaloneCode, 'utf-8');
    console.log('✅ 生成独立版本: ' + standalonePath);
    
    // 生成插件版本
    const pluginCode = buildPlugin();
    const pluginPath = path.join(PLUGIN_DIR, 'index.js');
    fs.writeFileSync(pluginPath, pluginCode, 'utf-8');
    console.log('✅ 生成插件版本: ' + pluginPath);
    
    // 生成插件版本的 package.json
    const pluginPackageJson = {
        name: "multiplayer-mod",
        version: "1.0.0",
        description: "SillyTavern 联机Mod 服务端插件",
        main: "index.js",
        dependencies: {
            ws: "^8.0.0"
        }
    };
    const packageJsonPath = path.join(PLUGIN_DIR, 'package.json');
    fs.writeFileSync(packageJsonPath, JSON.stringify(pluginPackageJson, null, 2), 'utf-8');
    console.log('✅ 生成 package.json: ' + packageJsonPath);
    
    console.log('='.repeat(50));
    console.log('🎉 构建完成！');
    console.log('');
    console.log('使用方法:');
    console.log('  独立版本: node dist/standalone/server.js [端口] [密码]');
    console.log('  插件版本: 将 dist/plugin/ 复制到 SillyTavern/plugins/multiplayer-mod/');
}

// 运行构建
build();
