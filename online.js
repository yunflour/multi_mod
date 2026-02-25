#!/usr/bin/env node
/**
 * SillyTavern 联机Mod - 在线房间管理服务器 (单端口版)
 * 
 * 使用单个 WebSocket 端口，通过 URL 路径区分房间
 * 
 * 使用方法：
 *   node online.js [HTTP端口] [WS端口]
 * 
 * 环境变量：
 *   HTTP_PORT - HTTP API 端口（默认 2156）
 *   WS_PORT - WebSocket 端口（默认 2157）
 *   MAX_ROOMS - 最大房间数（默认 10）
 * 
 * 架构：
 *   HTTP API: https://room.yufugemini.cloud/  (端口 2156)
 *   WebSocket: wss://room.yufugemini.cloud:2157/room/{roomId}
 */

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const url = require('url');

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 配置 ███
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    // HTTP API 端口
    httpPort: parseInt(process.argv[2]) || parseInt(process.env.HTTP_PORT) || 2157,
    // WebSocket 端口
    wsPort: parseInt(process.argv[3]) || parseInt(process.env.WS_PORT) || 2158,
    // 最大房间数
    maxRooms: parseInt(process.env.MAX_ROOMS) || 10,
    // 房间空闲超时（毫秒）
    roomIdleTimeout: 60000,
    // 允许的源（CORS）
    allowedOrigins: ['*'],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 房间管理 ███
// ═══════════════════════════════════════════════════════════════════════════════

// 房间类
class Room {
    constructor(options) {
        this.id = options.id || crypto.randomBytes(4).toString('hex');
        this.name = options.name || '未命名房间'
        this.password = options.password || '';
        this.hasPassword = !!options.password;
        this.maxUsers = options.maxUsers || 8;
        this.creatorId = options.creatorId;
        this.creatorName = options.creatorName || '匿名';
        this.createdAt = Date.now();
        
        // 用户管理
        this.users = new Map();
        this.hostId = null;
        
        // 空闲定时器 - 房间创建时启动，用于清理无人加入的房间
        this.idleTimer = null;
        this.startIdleTimer();
        
        // 用户超时定时器（60秒无活动断开）
        this.userTimeoutTimer = setInterval(() => {
            this.checkUserTimeout();
        }, 3000);
    }
    
    // 启动空闲定时器
    startIdleTimer() {
        // 清除现有定时器
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        // 设置新定时器
        this.idleTimer = setTimeout(() => {
            if (this.users.size === 0) {
                log('room', this.id, `房间空闲超时 (${CONFIG.roomIdleTimeout / 1000}秒无人加入)，自动删除`);
                deleteRoom(this.id);
            }
        }, CONFIG.roomIdleTimeout);
    }
    
    // 检查用户超时
    checkUserTimeout() {
        const now = Date.now();
        const timeout = 60000;
        const toRemove = [];
        
        // 先收集需要移除的用户
        this.users.forEach((user, id) => {
            if (user.lastActivity && now - user.lastActivity > timeout) {
                toRemove.push({ id, user });
            }
        });
        
        // 然后移除（避免在 forEach 中修改 Map）
        toRemove.forEach(({ id, user }) => {
            log('leave', this.id, `${user.name} 因超时被断开 (${Math.floor((now - user.lastActivity) / 1000)}秒无活动)`);
            
            // 从 users 中移除
            this.users.delete(id);
            
            // 关闭连接
            if (user.ws && user.ws.readyState === WebSocket.OPEN) {
                user.ws.close(4002, '连接超时');
            }
            
            // 处理房主转让
            if (this.hostId === id && this.users.size > 0) {
                const newHost = this.users.values().next().value;
                this.hostId = newHost.id;
                log('host', this.id, `房主权限自动转让给 ${newHost.name}`);
                this.broadcastAll({
                    type: 'host_change',
                    from: 'server',
                    fromName: '服务器',
                    data: { hostId: this.hostId, hostName: newHost.name },
                    timestamp: Date.now()
                });
            } else if (this.users.size === 0) {
                this.hostId = null;
                // 房间已空，立即删除
                log('room', this.id, '房间已空（超时清理后），立即关闭');
                deleteRoom(this.id);
                return; // 房间已删除，不需要继续广播
            }
            
            // 广播离开消息
            this.broadcast({
                type: 'leave',
                from: id,
                fromName: user.name,
                data: null,
                timestamp: Date.now()
            });
        });
    }
    
    // 更新用户活动时间
    updateUserActivity(userId) {
        const user = this.users.get(userId);
        if (user) {
            user.lastActivity = Date.now();
        }
    }
    
    // 清理房间资源
    destroy() {
        if (this.userTimeoutTimer) {
            clearInterval(this.userTimeoutTimer);
            this.userTimeoutTimer = null;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
    
    get currentUsers() {
        return this.users.size;
    }
    
    // 获取用户列表
    getUserList() {
        return Array.from(this.users.values()).map(u => ({
            id: u.id,
            name: u.name,
            ready: u.ready,
            isHost: u.id === this.hostId
        }));
    }
    
    // 广播消息
    broadcast(message, excludeWs = null) {
        const data = JSON.stringify(message);
        this.users.forEach(user => {
            if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(data);
            }
        });
    }
    
    // 广播给所有人（包括发送者）
    broadcastAll(message) {
        const data = JSON.stringify(message);
        this.users.forEach(user => {
            if (user.ws.readyState === WebSocket.OPEN) {
                user.ws.send(data);
            }
        });
    }
    
    // 发送给特定用户
    sendTo(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    
    // 用户加入
    addUser(ws, userId, userName) {
        // 检查是否是重连（同 userId 已存在）
        const existingUser = this.users.get(userId);
        const isReconnect = !!existingUser;
        
        if (existingUser) {
            // 关闭旧的 WebSocket 连接
            if (existingUser.ws && existingUser.ws !== ws && existingUser.ws.readyState === WebSocket.OPEN) {
                existingUser.ws.close(4005, '被新连接替换');
            }
        }
        
        const isFirstUser = this.users.size === 0 && !isReconnect;
        
        this.users.set(userId, {
            id: userId,
            name: userName,
            ready: false,
            ws: ws,
            lastActivity: Date.now(),
        });
        
        if (isFirstUser) {
            this.hostId = userId;
        }
        
        // 清除空闲定时器
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        
        return isFirstUser;
    }
    
    // 用户离开
    removeUser(userId) {
        const user = this.users.get(userId);
        if (!user) return null;
        
        const wasHost = userId === this.hostId;
        this.users.delete(userId);
        
        // 房主转让
        let newHost = null;
        if (wasHost && this.users.size > 0) {
            newHost = this.users.values().next().value;
            this.hostId = newHost.id;
        } else if (this.users.size === 0) {
            this.hostId = null;
            // 房间变空，启动空闲定时器
            this.startIdleTimer();
        }
        
        return { user, wasHost, newHost };
    }
    
    // 获取公开信息
    getPublicInfo() {
        return {
            id: this.id,
            name: this.name,
            hasPassword: this.hasPassword,
            maxUsers: this.maxUsers,
            currentUsers: this.currentUsers,
            creatorName: this.creatorName,
            createdAt: this.createdAt,
        };
    }
}

// 房间存储
const rooms = new Map();

// 生成时间戳
function timestamp() {
    return new Date().toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

// 日志
function log(type, roomId, message) {
    const icons = {
        info: '📢',
        join: '✅',
        leave: '❌',
        chat: '💬',
        error: '⚠️',
        room: '🏠',
        host: '👑',
    };
    const prefix = roomId ? `[Room:${roomId}]` : '[Server]';
    console.log(`[${timestamp()}] ${icons[type] || '•'} ${prefix} ${message}`);
}

// 创建房间
function createRoom(options) {
    if (rooms.size >= CONFIG.maxRooms) {
        return { error: '房间数量已达上限' };
    }
    
    const room = new Room(options);
    rooms.set(room.id, room);
    
    log('room', room.id, `创建房间: ${room.name}`);
    
    return room.getPublicInfo();
}

// 删除房间
function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { error: '房间不存在' };
    }
    
    // 通知所有用户
    room.broadcastAll({
        type: 'room_closed',
        from: 'server',
        fromName: '服务器',
        data: { message: '房间已关闭' },
        timestamp: Date.now(),
    });
    
    // 关闭所有连接
    room.users.forEach(user => {
        user.ws.close();
    });
    
    // 清理房间资源（定时器等）
    room.destroy();
    
    rooms.delete(roomId);
    log('room', roomId, '房间已删除');
    
    return { success: true };
}

// 获取房间列表
function getRoomList() {
    return Array.from(rooms.values()).map(r => r.getPublicInfo());
}

// ═══════════════════════════════════════════════════════════════════════════════
// ███ WebSocket 服务器 ███
// ═══════════════════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ port: CONFIG.wsPort });

wss.on('connection', (ws, req) => {
    // 解析 URL 获取房间 ID: /room/{roomId}
    const pathname = url.parse(req.url).pathname;
    const match = pathname.match(/^\/room\/([^/]+)$/);
    
    if (!match) {
        ws.close(4000, '无效的房间路径');
        return;
    }
    
    const roomId = match[1];
    const room = rooms.get(roomId);
    
    if (!room) {
        ws.close(4001, '房间不存在');
        return;
    }
    
    const clientIp = req.socket.remoteAddress;
    log('info', roomId, `新连接来自 ${clientIp}`);
    
    let userId = null;
    let userName = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, room, message);
        } catch (error) {
            log('error', roomId, `消息解析错误: ${error.message}`);
        }
    });
    
    function handleMessage(ws, room, message) {
        // 更新用户活动时间
        if (userId) {
            room.updateUserActivity(userId);
        }
        
        switch (message.type) {
            case 'join':
                handleJoin(ws, room, message);
                break;
            case 'leave':
                handleLeave(ws, room);
                break;
            case 'chat':
                handleChat(ws, room, message);
                break;
            case 'user_input':
                handleUserInput(ws, room, message);
                break;
            case 'ready':
                handleReady(ws, room, message);
                break;
            case 'ai_response':
                handleAiResponse(ws, room, message);
                break;
            case 'transfer_host':
                handleTransferHost(ws, room, message);
                break;
            case 'ping':
                // 心跳请求，立即回复 pong
                room.sendTo(ws, {
                    type: 'pong',
                    from: 'server',
                    fromName: '服务器',
                    data: { timestamp: Date.now() },
                    timestamp: Date.now()
                });
                break;
            default:
                // 单播或广播
                const targetUserId = message.data?.targetUserId;
                if (targetUserId) {
                    const targetUser = room.users.get(targetUserId);
                    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
                        targetUser.ws.send(JSON.stringify(message));
                    }
                } else {
                    room.broadcast(message, ws);
                }
        }
    }
    
    function handleJoin(ws, room, message) {
        const { name, password } = message.data || {};
        
        // 验证密码
        if (room.password && password !== room.password) {
            room.sendTo(ws, {
                type: 'error',
                from: 'server',
                fromName: '服务器',
                data: { message: '密码错误' },
                timestamp: Date.now(),
            });
            ws.close(4003, '密码错误');
            return;
        }
        
        // 检查人数
        if (room.currentUsers >= room.maxUsers) {
            room.sendTo(ws, {
                type: 'error',
                from: 'server',
                fromName: '服务器',
                data: { message: '房间已满' },
                timestamp: Date.now(),
            });
            ws.close(4004, '房间已满');
            return;
        }
        
        userId = message.from;
        userName = name || message.fromName || `用户${userId.substring(0, 4)}`;
        
        const isFirstUser = room.addUser(ws, userId, userName);
        
        if (isFirstUser) {
            log('host', roomId, `${userName} 成为房主`);
        }
        
        log('join', roomId, `${userName} (${userId}) 加入房间 [在线: ${room.currentUsers}]`);
        
        // 广播加入消息
        room.broadcast({
            type: 'join',
            from: userId,
            fromName: userName,
            data: { name: userName, isHost: isFirstUser },
            timestamp: Date.now(),
        }, ws);
        
        // 发送当前状态给新用户
        room.sendTo(ws, {
            type: 'sync_state',
            from: 'server',
            fromName: '服务器',
            data: {
                users: room.getUserList(),
                hostId: room.hostId,
                roomName: room.name,
            },
            timestamp: Date.now(),
        });
    }
    
    function handleLeave(ws, room) {
        if (!userId) return;
        
        const result = room.removeUser(userId);
        if (!result) return;
        
        log('leave', roomId, `${result.user.name} 离开房间 [在线: ${room.currentUsers}]`);
        
        // 广播离开消息
        room.broadcast({
            type: 'leave',
            from: userId,
            fromName: result.user.name,
            data: null,
            timestamp: Date.now(),
        });
        
        // 房主转让通知
        if (result.wasHost && result.newHost) {
            log('host', roomId, `房主权限自动转让给 ${result.newHost.name}`);
            room.broadcastAll({
                type: 'host_change',
                from: 'server',
                fromName: '服务器',
                data: { hostId: result.newHost.id, hostName: result.newHost.name },
                timestamp: Date.now(),
            });
        }
        
        // 房间人数为0时立即关闭
        if (room.currentUsers === 0) {
            log('room', roomId, '房间已空，立即关闭');
            deleteRoom(roomId);
        }
    }
    
    function handleChat(ws, room, message) {
        if (!userId) return;
        const content = message.data?.content || '';
        log('chat', roomId, `${userName}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
        room.broadcast({
            type: 'chat',
            from: userId,
            fromName: userName,
            data: { content },
            timestamp: Date.now(),
        }, ws);
    }
    
    function handleUserInput(ws, room, message) {
        if (!userId) return;
        log('info', roomId, `${userName} 提交了输入`);
        room.broadcastAll({
            type: 'user_input',
            from: userId,
            fromName: userName,
            data: message.data,
            timestamp: Date.now(),
        });
    }
    
    function handleReady(ws, room, message) {
        if (!userId) return;
        const user = room.users.get(userId);
        if (!user) return;
        
        const ready = message.data?.ready || false;
        user.ready = ready;
        log('info', roomId, `${userName} ${ready ? '已准备' : '取消准备'}`);
        room.broadcast({
            type: 'ready',
            from: userId,
            fromName: userName,
            data: { ready },
            timestamp: Date.now(),
        }, ws);
    }
    
    function handleAiResponse(ws, room, message) {
        if (!userId) return;
        if (userId !== room.hostId) {
            room.sendTo(ws, {
                type: 'error',
                from: 'server',
                fromName: '服务器',
                data: { message: '只有房主可以发送AI回复' },
                timestamp: Date.now(),
            });
            return;
        }
        const content = message.data?.content || '';
        log('info', roomId, `房主广播AI回复 (${content.length} 字符)`);
        room.broadcast({
            type: 'ai_response',
            from: userId,
            fromName: userName,
            data: message.data,
            timestamp: Date.now(),
        }, ws);
    }
    
    function handleTransferHost(ws, room, message) {
        if (!userId) return;
        if (userId !== room.hostId) {
            room.sendTo(ws, {
                type: 'error',
                from: 'server',
                fromName: '服务器',
                data: { message: '只有当前房主可以转让权限' },
                timestamp: Date.now(),
            });
            return;
        }
        
        const newHostId = message.data?.targetUserId;
        if (!newHostId || !room.users.has(newHostId)) {
            log('error', roomId, '转让目标用户不存在');
            return;
        }
        
        const newHost = room.users.get(newHostId);
        room.hostId = newHostId;
        log('host', roomId, `${userName} 将房主权限转让给 ${newHost.name}`);
        
        room.broadcastAll({
            type: 'host_change',
            from: 'server',
            fromName: '服务器',
            data: { hostId: newHostId, hostName: newHost.name },
            timestamp: Date.now(),
        });
    }
    
    ws.on('close', () => {
        handleLeave(ws, room);
    });
    
    ws.on('error', (err) => {
        log('error', roomId, `WebSocket错误: ${err.message}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ███ HTTP API 服务器 ███
// ═══════════════════════════════════════════════════════════════════════════════

function setCorsHeaders(res, req) {
    const origin = req.headers.origin || '*';
    if (CONFIG.allowedOrigins.includes('*') || CONFIG.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
    });
}

function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

const httpServer = http.createServer(async (req, res) => {
    setCorsHeaders(res, req);
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url);
    const pathname = parsedUrl.pathname;
    
    try {
        // GET /rooms
        if (req.method === 'GET' && pathname === '/rooms') {
            sendJson(res, {
                rooms: getRoomList(),
                maxRooms: CONFIG.maxRooms,
                currentRooms: rooms.size,
                wsPort: CONFIG.wsPort,
            });
            return;
        }
        
        // POST /rooms
        if (req.method === 'POST' && pathname === '/rooms') {
            const body = await parseJson(req);
            const result = createRoom(body);
            
            if (result.error) {
                sendJson(res, { error: result.error }, 400);
            } else {
                // 返回 WebSocket URL
                result.wsPort = CONFIG.wsPort;
                sendJson(res, result, 201);
            }
            return;
        }
        
        // POST /rooms/:id/join
        if (req.method === 'POST' && pathname.match(/^\/rooms\/([^/]+)\/join$/)) {
            const roomId = pathname.match(/^\/rooms\/([^/]+)\/join$/)[1];
            const body = await parseJson(req);
            const room = rooms.get(roomId);
            
            if (!room) {
                sendJson(res, { error: '房间不存在' }, 404);
                return;
            }
            
            if (room.password && room.password !== body.password) {
                sendJson(res, { error: '密码错误' }, 403);
                return;
            }
            
            if (room.currentUsers >= room.maxUsers) {
                sendJson(res, { error: '房间已满' }, 403);
                return;
            }
            
            sendJson(res, {
                id: roomId,
                name: room.name,
                wsPort: CONFIG.wsPort,
                maxUsers: room.maxUsers,
                currentUsers: room.currentUsers,
            });
            return;
        }
        
        // DELETE /rooms/:id
        if (req.method === 'DELETE' && pathname.match(/^\/rooms\/([^/]+)$/)) {
            const roomId = pathname.match(/^\/rooms\/([^/]+)$/)[1];
            const result = deleteRoom(roomId);
            
            if (result.error) {
                sendJson(res, { error: result.error }, 404);
            } else {
                sendJson(res, { success: true });
            }
            return;
        }
        
        // GET /status
        if (req.method === 'GET' && pathname === '/status') {
            sendJson(res, {
                status: 'running',
                rooms: rooms.size,
                maxRooms: CONFIG.maxRooms,
                httpPort: CONFIG.httpPort,
                wsPort: CONFIG.wsPort,
                uptime: process.uptime(),
            });
            return;
        }
        
        sendJson(res, { error: 'Not Found' }, 404);
        
    } catch (error) {
        console.error('API 错误:', error);
        sendJson(res, { error: '服务器内部错误' }, 500);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ███ 启动服务器 ███
// ═══════════════════════════════════════════════════════════════════════════════

httpServer.listen(CONFIG.httpPort, () => {
    console.log('═'.repeat(60));
    console.log('  SillyTavern 联机Mod - 在线房间管理服务器');
    console.log('═'.repeat(60));
    console.log(`  HTTP API 端口: ${CONFIG.httpPort}`);
    console.log(`  WebSocket 端口: ${CONFIG.wsPort}`);
    console.log(`  最大房间数: ${CONFIG.maxRooms}`);
    console.log('═'.repeat(60));
    console.log('  HTTP API:');
    console.log('    GET  /rooms           - 获取房间列表');
    console.log('    POST /rooms           - 创建房间');
    console.log('    POST /rooms/:id/join  - 加入房间（验证密码）');
    console.log('    DELETE /rooms/:id     - 删除房间');
    console.log('    GET  /status          - 服务器状态');
    console.log('');
    console.log('  WebSocket:');
    console.log(`    ws://localhost:${CONFIG.wsPort}/room/{roomId}`);
    console.log('═'.repeat(60));
    console.log('');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    
    for (const [roomId] of rooms) {
        deleteRoom(roomId);
    }
    
    wss.close();
    httpServer.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    process.emit('SIGINT');
});
