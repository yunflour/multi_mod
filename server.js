/**
 * SillyTavern 联机Mod - WebSocket 服务端
 * 
 * 用于支持真正的跨网络联机功能
 * 
 * 使用方法：
 *   node server.js [端口] [密码]
 * 
 * 示例：
 *   node server.js              # 使用默认端口2157，无密码
 *   node server.js 2157         # 使用端口2157，无密码
 *   node server.js 2157 mypass  # 使用端口2157，密码为mypass
 */

const WebSocket = require('ws');

// 配置
const PORT = parseInt(process.argv[2]) || 2157;
const PASSWORD = process.argv[3] || '';

// 用户管理
const users = new Map();

// 房主ID（第一个加入的用户成为房主）
let hostId = null;

// 用户不活跃超时时间（毫秒）
const USER_TIMEOUT = 60000;

// 创建WebSocket服务器
const wss = new WebSocket.Server({ port: PORT });

console.log('='.repeat(50));
console.log('  SillyTavern 联机Mod WebSocket 服务端');
console.log('='.repeat(50));
console.log(`  端口: ${PORT}`);
console.log(`  密码: ${PASSWORD || '(无)'}`);
console.log(`  用户超时: ${USER_TIMEOUT / 1000}秒`);
console.log('='.repeat(50));
console.log('  等待客户端连接...');
console.log('');

// 用户不活跃检测定时器
setInterval(() => {
  const now = Date.now();
  const toRemove = [];
  
  // 先收集需要移除的用户
  users.forEach((user, id) => {
    if (user.lastActivity && now - user.lastActivity > USER_TIMEOUT) {
      toRemove.push({ id, user });
    }
  });
  
  // 然后移除（避免在 forEach 中修改 Map）
  toRemove.forEach(({ id, user }) => {
    log('leave', `${user.name} 因超时被断开 (${Math.floor((now - user.lastActivity) / 1000)}秒无活动)`);
    
    // 从 users 中移除
    users.delete(id);
    
    // 关闭连接
    if (user.ws && user.ws.readyState === WebSocket.OPEN) {
      user.ws.close(4002, '连接超时');
    }
    
    // 处理房主转让
    if (hostId === id && users.size > 0) {
      const newHost = users.values().next().value;
      hostId = newHost.id;
      log('host', `房主权限自动转让给 ${newHost.name}`);
      broadcastAll({
        type: 'host_change',
        from: 'server',
        fromName: '服务器',
        data: { hostId: hostId, hostName: newHost.name },
        timestamp: Date.now()
      });
    } else if (users.size === 0) {
      hostId = null;
    }
    
    // 广播离开消息
    broadcast({
      type: 'leave',
      from: id,
      fromName: user.name,
      data: null,
      timestamp: Date.now()
    });
  });
}, 3000);  // 每3秒检查一次

// 生成时间戳
function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

// 日志输出
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

// 广播消息给所有用户
function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// 发送消息给所有用户（包括发送者）
function broadcastAll(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// 发送消息给特定用户
function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// 获取在线用户列表（包含isHost标记）
function getUserList() {
  return Array.from(users.values()).map(u => ({
    id: u.id,
    name: u.name,
    ready: u.ready,
    isHost: u.id === hostId
  }));
}

// 广播房主变更
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

// 处理连接
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log('info', `新连接来自 ${clientIp}`);
  
  let userId = null;
  let userName = null;

  // 处理消息
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // 更新用户最后活动时间
      if (userId) {
        const user = users.get(userId);
        if (user) {
          user.lastActivity = Date.now();
        }
      }
      
      switch (message.type) {
        case 'join':
          handleJoin(ws, message);
          break;
        case 'leave':
          handleLeave(ws);
          break;
        case 'chat':
          handleChat(ws, message);
          break;
        case 'user_input':
          handleUserInput(ws, message);
          break;
        case 'ready':
          handleReady(ws, message);
          break;
        case 'ai_response':
          handleAiResponse(ws, message);
          break;
        case 'transfer_host':
          handleTransferHost(ws, message);
          break;
        case 'ping':
          // 心跳请求，立即回复 pong
          ws.send(JSON.stringify({
            type: 'pong',
            from: 'server',
            fromName: '服务器',
            data: { timestamp: Date.now() },
            timestamp: Date.now()
          }));
          break;
        default:
          // 检查是否是单播消息（包含targetUserId）
          const targetUserId = message.data?.targetUserId;
          if (targetUserId) {
            // 单播：只发送给目标用户
            const targetUser = users.get(targetUserId);
            if (targetUser && targetUser.ws && targetUser.ws.readyState === WebSocket.OPEN) {
              targetUser.ws.send(JSON.stringify(message));
            }
          } else {
            // 广播：转发给其他所有用户
            broadcast(message, ws);
          }
      }
    } catch (error) {
      log('error', `消息解析错误: ${error.message}`);
    }
  });

  // 处理加入
  function handleJoin(ws, message) {
    const { name, password } = message.data || {};
    
    // 验证密码
    if (PASSWORD && password !== PASSWORD) {
      sendTo(ws, {
        type: 'error',
        from: 'server',
        fromName: '服务器',
        data: { targetId: message.from, message: '密码错误' },
        timestamp: Date.now()
      });
      log('error', `用户 ${name || message.from} 密码错误，拒绝连接`);
      ws.close();
      return;
    }
    
    userId = message.from;
    userName = name || message.fromName || `用户${userId.substring(0, 4)}`;
    
    // 检查是否是重连（同 userId 已存在）
    const existingUser = users.get(userId);
    if (existingUser) {
      log('info', `${userName} 重连，关闭旧连接`);
      // 关闭旧的 WebSocket 连接
      if (existingUser.ws && existingUser.ws !== ws && existingUser.ws.readyState === WebSocket.OPEN) {
        existingUser.ws.close(4005, '被新连接替换');
      }
      // 保留房主身份
      if (hostId === userId) {
        log('host', `${userName} 重连并保留房主身份`);
      }
    }
    
    // 第一个加入的用户成为房主
    const isFirstUser = users.size === 0 && !existingUser;
    if (isFirstUser) {
      hostId = userId;
      log('host', `${userName} 成为房主`);
    }
    
    // 保存用户信息
    users.set(userId, {
      id: userId,
      name: userName,
      ready: false,
      ws: ws,
      lastActivity: Date.now()
    });
    
    log('join', `${userName} (${userId}) 加入了房间`);
    
    // 广播加入消息
    broadcast({
      type: 'join',
      from: userId,
      fromName: userName,
      data: { name: userName, isHost: isFirstUser },
      timestamp: Date.now()
    }, ws);
    
    // 发送当前状态给新用户（包含用户列表和房主信息）
    sendTo(ws, {
      type: 'sync_state',
      from: 'server',
      fromName: '服务器',
      data: { 
        users: getUserList(),
        hostId: hostId
      },
      timestamp: Date.now()
    });
    
    log('info', `当前在线: ${users.size} 人`);
  }

  // 处理离开
  function handleLeave(ws) {
    if (userId && users.has(userId)) {
      const user = users.get(userId);
      const wasHost = userId === hostId;
      users.delete(userId);
      
      log('leave', `${user.name} (${userId}) 离开了房间`);
      
      // 如果房主离开，转让给下一个用户
      if (wasHost && users.size > 0) {
        const nextUser = users.values().next().value;
        hostId = nextUser.id;
        log('host', `房主权限自动转让给 ${nextUser.name}`);
        broadcastHostChange(hostId);
      } else if (users.size === 0) {
        hostId = null;
      }
      
      // 广播离开消息
      broadcast({
        type: 'leave',
        from: userId,
        fromName: user.name,
        data: null,
        timestamp: Date.now()
      });
      
      log('info', `当前在线: ${users.size} 人`);
    }
  }

  // 处理聊天消息
  function handleChat(ws, message) {
    if (!userId) return;
    
    const content = message.data?.content || '';
    log('chat', `${userName}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    
    // 广播聊天消息
    broadcast({
      type: 'chat',
      from: userId,
      fromName: userName,
      data: { content },
      timestamp: Date.now()
    }, ws);
  }

  // 处理用户输入（准备发送给AI）
  function handleUserInput(ws, message) {
    if (!userId) return;
    
    const content = message.data?.content || '';
    const messagePrefix = message.data?.messagePrefix;
    const messageSuffix = message.data?.messageSuffix;
    log('input', `${userName} 提交了输入`);
    
    // 广播用户输入给所有人（特别是房主需要接收）
    broadcastAll({
      type: 'user_input',
      from: userId,
      fromName: userName,
      data: { 
        content,
        messagePrefix,
        messageSuffix,
      },
      timestamp: Date.now()
    });
  }

  // 处理准备状态
  function handleReady(ws, message) {
    if (!userId || !users.has(userId)) return;
    
    const ready = message.data?.ready || false;
    users.get(userId).ready = ready;
    
    log('info', `${userName} ${ready ? '已准备' : '取消准备'}`);
    
    // 广播准备状态
    broadcast({
      type: 'ready',
      from: userId,
      fromName: userName,
      data: { ready },
      timestamp: Date.now()
    }, ws);
  }

  // 处理AI回复（只有房主可以发送）
  function handleAiResponse(ws, message) {
    if (!userId) return;
    
    // 验证是否是房主
    if (userId !== hostId) {
      log('error', `${userName} 尝试发送AI回复但不是房主`);
      sendTo(ws, {
        type: 'error',
        from: 'server',
        fromName: '服务器',
        data: { targetId: userId, message: '只有房主可以发送AI回复' },
        timestamp: Date.now()
      });
      return;
    }
    
    const content = message.data?.content || '';
    log('ai', `房主广播AI回复 (${content.length} 字符)`);
    
    // 广播AI回复给除房主外的所有客户端
    broadcast({
      type: 'ai_response',
      from: userId,
      fromName: userName,
      data: message.data,  // 保留完整data（包含content和variableMode）
      timestamp: Date.now()
    }, ws);
  }

  // 处理房主转让
  function handleTransferHost(ws, message) {
    if (!userId) return;
    
    // 验证是否是当前房主
    if (userId !== hostId) {
      log('error', `${userName} 尝试转让房主但不是当前房主`);
      sendTo(ws, {
        type: 'error',
        from: 'server',
        fromName: '服务器',
        data: { targetId: userId, message: '只有当前房主可以转让权限' },
        timestamp: Date.now()
      });
      return;
    }
    
    const newHostId = message.data?.targetUserId;
    if (!newHostId || !users.has(newHostId)) {
      log('error', `转让目标用户不存在`);
      return;
    }
    
    const newHost = users.get(newHostId);
    hostId = newHostId;
    log('host', `${userName} 将房主权限转让给 ${newHost.name}`);
    
    // 广播房主变更
    broadcastHostChange(hostId);
  }

  // 处理断开连接
  ws.on('close', () => {
    handleLeave(ws);
  });

  // 处理错误
  ws.on('error', (error) => {
    log('error', `WebSocket错误: ${error.message}`);
  });
});

// 处理服务器错误
wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ 错误: 端口 ${PORT} 已被占用！`);
    console.error('   请尝试使用其他端口，例如: node server.js 2158\n');
  } else {
    console.error(`\n❌ 服务器错误: ${error.message}\n`);
  }
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n\n正在关闭服务器...');
  wss.clients.forEach(client => {
    client.close();
  });
  wss.close(() => {
    console.log('服务器已关闭\n');
    process.exit(0);
  });
});

console.log(`\n💡 提示: 第一个连接的用户将成为房主，负责接收AI回复并广播\n`);

