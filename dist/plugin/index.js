/**
 * SillyTavern 联机Mod 服务端插件
 * 
 * 此文件由 build.js 自动生成，请勿直接编辑！
 * 如需修改，请编辑 server.js 后运行 node build.js
 * 
 * 安装方式：
 * 1. 将此文件夹复制到 SillyTavern/plugins/ 目录
 * 2. 在 config.yaml 中设置 enableServerPlugins: true
 * 3. 重启酒馆
 */

const WebSocket = require('ws');

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 插件信息 ███
// ═══════════════════════════════════════════════════════════════════════════════

const pluginInfo = {
    id: 'multiplayer-mod',
    name: '联机Mod服务端',
    description: '为SillyTavern提供多人联机功能的WebSocket服务器',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 配置 ███
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_PORT = 2157;
const PASSWORD = '';  // 插件模式下可在此处设置密码

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 状态管理 ███
// ═══════════════════════════════════════════════════════════════════════════════

let wss = null;
const users = new Map();
let hostId = null;

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 工具函数 ███
// ═══════════════════════════════════════════════════════════════════════════════

function timestamp() {
    return new Date().toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

function log(type, message) {
    const icons = {
        info: '📢',
        join: '✅',
        leave: '❌',
        chat: '💬',
        error: '⚠️',
        input: '📝',
        ai: '🤖',
        host: '👑'
    };
    console.log(`[${timestamp()}] ${icons[type] || '•'} ${message}`);
}

function broadcast(message, excludeWs = null) {
    if (!wss) return;
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function broadcastAll(message) {
    if (!wss) return;
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function sendTo(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function getUserList() {
    return Array.from(users.values()).map(u => ({
        id: u.id,
        name: u.name,
        ready: u.ready,
        isHost: u.id === hostId
    }));
}

function broadcastHostChange(newHostId) {
    const newHost = users.get(newHostId);
    broadcastAll({
        type: 'host_change',
        from: 'server',
        fromName: '服务器',
        data: { 
            hostId: newHostId,
            hostName: newHost ? newHost.name : null 
        },
        timestamp: Date.now()
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 服务器控制 ███
// ═══════════════════════════════════════════════════════════════════════════════

function startServer(port = DEFAULT_PORT) {
    if (wss) {
        console.log('[联机Mod] 服务器已在运行中');
        return;
    }
    
    wss = new WebSocket.Server({ port });
    
    wss.on("connection", (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        log("info", `新连接来自 ${clientIp}`);
        
        let userId = null;
        let userName = null;
        
        ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                switch (message.type) {
                    case "join":
                        handleJoin(ws, message);
                        break;
                    case "leave":
                        handleLeave(ws);
                        break;
                    case "chat":
                        handleChat(ws, message);
                        break;
                    case "user_input":
                        handleUserInput(ws, message);
                        break;
                    case "ready":
                        handleReady(ws, message);
                        break;
                    case "ai_response":
                        handleAiResponse(ws, message);
                        break;
                    case "transfer_host":
                        handleTransferHost(ws, message);
                        break;
                    default:
                        const targetUserId = message.data?.targetUserId;
                        if (targetUserId) {
                            const targetUser = users.get(targetUserId);
                            if (targetUser && targetUser.ws && targetUser.ws.readyState === WebSocket.OPEN) {
                                targetUser.ws.send(JSON.stringify(message));
                            }
                        } else {
                            broadcast(message, ws);
                        }
                }
            } catch (error) {
                log("error", `消息解析错误: ${error.message}`);
            }
        });
        
        function handleJoin(ws, message) {
            const { name, password } = message.data || {};
            
            if (PASSWORD && password !== PASSWORD) {
                sendTo(ws, {
                    type: "error",
                    from: "server",
                    fromName: "服务器",
                    data: { targetId: message.from, message: "密码错误" },
                    timestamp: Date.now()
                });
                log("error", `用户 ${name || message.from} 密码错误，拒绝连接`);
                ws.close();
                return;
            }
            
            userId = message.from;
            userName = name || message.fromName || `用户${userId.substring(0, 4)}`;
            
            const isFirstUser = users.size === 0;
            if (isFirstUser) {
                hostId = userId;
                log("host", `${userName} 成为房主`);
            }
            
            users.set(userId, { id: userId, name: userName, ready: false, ws: ws });
            
            log("join", `${userName} (${userId}) 加入了房间`);
            
            broadcast({
                type: "join",
                from: userId,
                fromName: userName,
                data: { name: userName, isHost: isFirstUser },
                timestamp: Date.now()
            }, ws);
            
            sendTo(ws, {
                type: "sync_state",
                from: "server",
                fromName: "服务器",
                data: { users: getUserList(), hostId: hostId },
                timestamp: Date.now()
            });
            
            log("info", `当前在线: ${users.size} 人`);
        }
        
        function handleLeave(ws) {
            if (userId && users.has(userId)) {
                const user = users.get(userId);
                const wasHost = userId === hostId;
                users.delete(userId);
                
                log("leave", `${user.name} (${userId}) 离开了房间`);
                
                if (wasHost && users.size > 0) {
                    const nextUser = users.values().next().value;
                    hostId = nextUser.id;
                    log("host", `房主权限自动转让给 ${nextUser.name}`);
                    broadcastHostChange(hostId);
                } else if (users.size === 0) {
                    hostId = null;
                }
                
                broadcast({
                    type: "leave",
                    from: userId,
                    fromName: user.name,
                    data: null,
                    timestamp: Date.now()
                });
                
                log("info", `当前在线: ${users.size} 人`);
            }
        }
        
        function handleChat(ws, message) {
            if (!userId) return;
            const content = message.data?.content || "";
            log("chat", `${userName}: ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`);
            broadcast({ type: "chat", from: userId, fromName: userName, data: { content }, timestamp: Date.now() }, ws);
        }
        
        function handleUserInput(ws, message) {
            if (!userId) return;
            log("input", `${userName} 提交了输入`);
            broadcastAll({
                type: "user_input",
                from: userId,
                fromName: userName,
                data: message.data,
                timestamp: Date.now()
            });
        }
        
        function handleReady(ws, message) {
            if (!userId || !users.has(userId)) return;
            const ready = message.data?.ready || false;
            users.get(userId).ready = ready;
            log("info", `${userName} ${ready ? "已准备" : "取消准备"}`);
            broadcast({ type: "ready", from: userId, fromName: userName, data: { ready }, timestamp: Date.now() }, ws);
        }
        
        function handleAiResponse(ws, message) {
            if (!userId) return;
            if (userId !== hostId) {
                log("error", `${userName} 尝试发送AI回复但不是房主`);
                sendTo(ws, {
                    type: "error",
                    from: "server",
                    fromName: "服务器",
                    data: { targetId: userId, message: "只有房主可以发送AI回复" },
                    timestamp: Date.now()
                });
                return;
            }
            const content = message.data?.content || "";
            log("ai", `房主广播AI回复 (${content.length} 字符)`);
            broadcast({ type: "ai_response", from: userId, fromName: userName, data: message.data, timestamp: Date.now() }, ws);
        }
        
        function handleTransferHost(ws, message) {
            if (!userId) return;
            if (userId !== hostId) {
                log("error", `${userName} 尝试转让房主但不是当前房主`);
                sendTo(ws, {
                    type: "error",
                    from: "server",
                    fromName: "服务器",
                    data: { targetId: userId, message: "只有当前房主可以转让权限" },
                    timestamp: Date.now()
                });
                return;
            }
            const newHostId = message.data?.targetUserId;
            if (!newHostId || !users.has(newHostId)) {
                log("error", "转让目标用户不存在");
                return;
            }
            const newHost = users.get(newHostId);
            hostId = newHostId;
            log("host", `${userName} 将房主权限转让给 ${newHost.name}`);
            broadcastHostChange(hostId);
        }
        
        ws.on("close", () => handleLeave(ws));
        ws.on("error", (err) => log("error", `WebSocket错误: ${err.message}`));
    });
    
    wss.on("listening", () => {
        log("info", `WebSocket服务器已启动，端口: ${port}`);
    });
    
    wss.on("error", (err) => {
        log("error", `服务器错误: ${err.message}`);
    });
}

function stopServer() {
    if (wss) {
        broadcastAll({
            type: "server_shutdown",
            from: "server",
            fromName: "服务器",
            data: { message: "服务器正在关闭" },
            timestamp: Date.now()
        });
        wss.close();
        wss = null;
        users.clear();
        hostId = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ███ SillyTavern 插件接口 ███
// ═══════════════════════════════════════════════════════════════════════════════

async function init(router) {
    console.log('\x1b[36m[联机Mod]\x1b[0m 插件正在初始化...');
    
    try {
        startServer(DEFAULT_PORT);
        console.log('\x1b[32m[联机Mod]\x1b[0m WebSocket服务器启动成功！');
    } catch (error) {
        console.error('\x1b[31m[联机Mod]\x1b[0m 启动失败:', error);
    }
    
    router.get('/api/multiplayer/status', (req, res) => {
        res.json({
            running: wss !== null,
            port: DEFAULT_PORT,
            users: users.size,
            hostId: hostId,
        });
    });
    
    return Promise.resolve();
}

async function exit() {
    console.log('\x1b[33m[联机Mod]\x1b[0m 正在关闭WebSocket服务器...');
    stopServer();
    return Promise.resolve();
}

module.exports = {
    init,
    exit,
    info: pluginInfo,
};