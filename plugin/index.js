/**
 * SillyTavern 联机Mod 服务端插件
 * 
 * 此插件会在酒馆启动时自动启动WebSocket服务器
 * 
 * 安装方式：
 * 1. 将此文件夹复制到 SillyTavern/plugins/ 目录
 * 2. 在 config.yaml 中设置 enableServerPlugins: true
 * 3. 重启酒馆
 */

const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 插件信息 ███
// ═══════════════════════════════════════════════════════════════════════════════

const pluginInfo = {
    id: 'multiplayer-mod',
    name: '联机Mod服务端',
    description: '为SillyTavern提供多人联机功能的WebSocket服务器',
};

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 服务端代码开始 - 请将 server.js 的内容粘贴到下方 ███
// ═══════════════════════════════════════════════════════════════════════════════
// 
// 【使用说明】
// 1. 打开你的 server.js 文件
// 2. 复制全部内容
// 3. 粘贴到下面的 "SERVER_CODE_START" 和 "SERVER_CODE_END" 之间
// 4. 保存文件并重启酒馆
//
// ═══════════════════════════════════════════════════════════════════════════════

// ══════════════════ SERVER_CODE_START ══════════════════
// 请将 server.js 的内容粘贴到这里（替换这行注释）
// 注意：不要包含 server.js 开头的 shebang (#!/usr/bin/env node)
//
// 粘贴后，需要做以下修改：
// 1. 将最后的 wss.on('listening', ...) 部分的 console.log 改为使用下方的 logInfo
// 2. 确保没有调用 process.exit()

const WebSocket = require('ws');

// ══════════════════ 以下是默认的示例代码，请用你的server.js替换 ══════════════════

const DEFAULT_PORT = 2157;

let wss = null;
const users = new Map();
let hostId = null;

function log(type, message) {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const prefix = {
        'info': '\x1b[36m[INFO]\x1b[0m',
        'user': '\x1b[32m[USER]\x1b[0m', 
        'chat': '\x1b[33m[CHAT]\x1b[0m',
        'ai': '\x1b[35m[AI]\x1b[0m',
        'error': '\x1b[31m[ERROR]\x1b[0m',
        'host': '\x1b[33m[HOST]\x1b[0m',
    }[type] || '[LOG]';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

function broadcast(message, excludeWs = null) {
    const msgStr = JSON.stringify(message);
    users.forEach((user) => {
        if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(msgStr);
        }
    });
}

function sendTo(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function startServer(port = DEFAULT_PORT) {
    if (wss) {
        log('info', '服务器已在运行中');
        return;
    }
    
    wss = new WebSocket.Server({ port });
    
    wss.on('connection', (ws) => {
        let userId = null;
        let userName = null;
        
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                switch (message.type) {
                    case 'join':
                        userId = message.from;
                        userName = message.data?.name || message.fromName || `用户${userId?.substring(0, 4)}`;
                        
                        const isFirstUser = users.size === 0;
                        users.set(userId, { id: userId, name: userName, ws, ready: false, isHost: isFirstUser });
                        
                        if (isFirstUser) {
                            hostId = userId;
                            log('host', `${userName} 成为房主`);
                        }
                        
                        log('user', `${userName} (${userId}) 加入房间 [在线: ${users.size}]`);
                        
                        const userList = Array.from(users.values()).map(u => ({
                            id: u.id, name: u.name, ready: u.ready, isHost: u.id === hostId
                        }));
                        
                        sendTo(ws, {
                            type: 'sync_state',
                            from: 'server',
                            fromName: '服务器',
                            data: { users: userList, hostId },
                            timestamp: Date.now()
                        });
                        
                        broadcast({
                            type: 'join',
                            from: userId,
                            fromName: userName,
                            data: { name: userName, isHost: userId === hostId },
                            timestamp: Date.now()
                        }, ws);
                        break;
                        
                    case 'leave':
                        if (userId) {
                            users.delete(userId);
                            log('user', `${userName} 离开房间 [在线: ${users.size}]`);
                            broadcast({ type: 'leave', from: userId, fromName: userName, timestamp: Date.now() });
                            
                            if (userId === hostId && users.size > 0) {
                                const newHost = users.values().next().value;
                                hostId = newHost.id;
                                newHost.isHost = true;
                                log('host', `房主转移给 ${newHost.name}`);
                                broadcast({
                                    type: 'host_change',
                                    from: 'server',
                                    fromName: '服务器',
                                    data: { hostId: newHost.id, hostName: newHost.name },
                                    timestamp: Date.now()
                                });
                            }
                        }
                        break;
                        
                    case 'chat':
                        log('chat', `${userName}: ${message.data?.content?.substring(0, 50)}...`);
                        broadcast(message);
                        break;
                        
                    default:
                        const targetUserId = message.data?.targetUserId;
                        if (targetUserId) {
                            const targetUser = users.get(targetUserId);
                            if (targetUser && targetUser.ws?.readyState === WebSocket.OPEN) {
                                targetUser.ws.send(JSON.stringify(message));
                            }
                        } else {
                            broadcast(message, ws);
                        }
                }
            } catch (e) {
                log('error', `消息处理错误: ${e.message}`);
            }
        });
        
        ws.on('close', () => {
            if (userId) {
                users.delete(userId);
                log('user', `${userName} 断开连接 [在线: ${users.size}]`);
                broadcast({ type: 'leave', from: userId, fromName: userName, timestamp: Date.now() });
                
                if (userId === hostId && users.size > 0) {
                    const newHost = users.values().next().value;
                    hostId = newHost.id;
                    newHost.isHost = true;
                    broadcast({
                        type: 'host_change',
                        from: 'server',
                        fromName: '服务器',
                        data: { hostId: newHost.id, hostName: newHost.name },
                        timestamp: Date.now()
                    });
                }
            }
        });
        
        ws.on('error', (err) => {
            log('error', `WebSocket错误: ${err.message}`);
        });
    });
    
    wss.on('listening', () => {
        log('info', `联机Mod WebSocket服务器已启动，端口: ${port}`);
    });
    
    wss.on('error', (err) => {
        log('error', `服务器错误: ${err.message}`);
    });
}

// ══════════════════ SERVER_CODE_END ══════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// ███ SillyTavern 插件接口 ███
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 插件初始化函数 - 酒馆启动时调用
 */
async function init(router) {
    console.log('\x1b[36m[联机Mod]\x1b[0m 插件正在初始化...');
    
    // 启动WebSocket服务器
    try {
        startServer(DEFAULT_PORT);
        console.log('\x1b[32m[联机Mod]\x1b[0m WebSocket服务器启动成功！');
    } catch (error) {
        console.error('\x1b[31m[联机Mod]\x1b[0m 启动失败:', error);
    }
    
    // 可选：添加HTTP API端点
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

/**
 * 插件退出函数 - 酒馆关闭时调用
 */
async function exit() {
    console.log('\x1b[33m[联机Mod]\x1b[0m 正在关闭WebSocket服务器...');
    
    if (wss) {
        // 通知所有用户服务器关闭
        broadcast({
            type: 'server_shutdown',
            from: 'server',
            fromName: '服务器',
            data: { message: '服务器正在关闭' },
            timestamp: Date.now()
        });
        
        wss.close();
        wss = null;
        users.clear();
        hostId = null;
    }
    
    return Promise.resolve();
}

module.exports = {
    init,
    exit,
    info: pluginInfo,
};
