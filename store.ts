/**
 * SillyTavern 联机Mod 状态管理
 */

import type {
  ChatLogItem,
  ConnectedUser,
  ConnectionMode,
  INetworkManager,
  NetworkMessage,
  OnlineRoom,
} from './types';
import { LocalNetworkManager, WebSocketNetworkManager } from './network';

/** 生成唯一ID */
function generateLogId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

/** 默认在线服务器地址 */
const DEFAULT_ONLINE_SERVER = 'https://room.yufugemini.cloud';
const ONLINE_MODE_KEY = 'st_multiplayer_online_mode';
const ONLINE_SERVER_KEY = 'st_multiplayer_online_server';

export const useMultiplayerStore = defineStore('multiplayer', () => {
  // ============ 状态 ============
  
  /** 连接模式 */
  const mode = ref<ConnectionMode>('disconnected');
  
  /** 是否已连接 */
  const isConnected = ref(false);
  
  /** 用户名称 */
  const userName = ref('');
  
  /** 服务端IP（客户端模式） */
  const serverIp = ref('localhost');
  
  /** 端口号 */
  const port = ref(2157);
  
  /** 房间密码 */
  const roomPassword = ref('');
  
  /** 是否使用WebSocket模式（默认开启） */
  const useWebSocket = ref(true);
  
  // ============ 在线模式状态 ============
  
  /** 是否启用在线模式 */
  const savedOnlineMode = localStorage.getItem(ONLINE_MODE_KEY) === 'true';
  const onlineMode = ref(savedOnlineMode);
  
  /** 在线服务器地址 */
  const savedOnlineServer = localStorage.getItem(ONLINE_SERVER_KEY) || DEFAULT_ONLINE_SERVER;
  const onlineServerUrl = ref(savedOnlineServer);
  
  /** 在线房间列表 */
  const onlineRooms = ref<OnlineRoom[]>([]);
  
  /** 当前在线房间ID */
  const currentOnlineRoomId = ref<string | null>(null);
  
  /** 是否正在加载房间列表 */
  const isLoadingRooms = ref(false);
  
  // 监听在线模式状态变化并保存
  watch(onlineMode, (newVal) => {
    localStorage.setItem(ONLINE_MODE_KEY, String(newVal));
  });
  
  watch(onlineServerUrl, (newVal) => {
    localStorage.setItem(ONLINE_SERVER_KEY, newVal);
  });
  
  /** 连接的用户列表 */
  const users = ref<ConnectedUser[]>([]);
  
  /** 聊天日志 */
  const chatLogs = ref<ChatLogItem[]>([]);
  
  /** 待整合的用户输入（房主用） */
  const pendingInputs = ref<Map<string, { 
    userName: string; 
    content: string;
    messagePrefix?: string;
    messageSuffix?: string;
  }>>(new Map());
  
  /** 待注入的用户设定（房主用） */
  const pendingPersonas = ref<Map<string, {
    userName: string;
    content: string;
    prefix: string;
  }>>(new Map());
  
  /** 是否正在等待AI回复 */
  const isWaitingForAi = ref(false);
  
  /** 是否正在等待用户输入 */
  const isWaitingInput = ref(false);
  
  /** 房主ID */
  const hostId = ref<string | null>(null);
  
  /** 当前网络用户ID（响应式） */
  const currentNetworkUserId = ref<string>('');
  
  /** 变量模式（房主设置）: 'none' = 无变量, 'mvu' = MVU变量, 'apotheosis' = 神化再临 */
  const VARIABLE_MODE_KEY = 'st_multiplayer_variable_mode';
  const savedVariableMode = localStorage.getItem(VARIABLE_MODE_KEY) as 'none' | 'mvu' | 'apotheosis' | null;
  const variableMode = ref<'none' | 'mvu' | 'apotheosis'>(savedVariableMode || 'none');
  
  // 监听variableMode变化并保存到localStorage
  watch(variableMode, (newVal) => {
    localStorage.setItem(VARIABLE_MODE_KEY, newVal);
  });
  
  /** 神化再临同步状态（每个WS连接独立） */
  const acuSyncState = ref({
    fullSynced: false,           // 是否已完成全量同步
    lastSyncTimestamp: 0,        // 上次同步时间戳
    isolationKey: '',            // 当前隔离标签
  });
  
  /** 当前用户ID */
  const currentUserId = computed(() => {
    return currentNetworkUserId.value;
  });
  
  /** 是否是房主 */
  const isHost = computed(() => {
    if (!currentNetworkUserId.value) return false;
    return hostId.value === currentNetworkUserId.value;
  });
  
  /** 所有用户是否都已提交（收集数 = 用户总数） */
  const allUsersSubmitted = computed(() => {
    if (users.value.length === 0) return false;
    return pendingInputs.value.size >= users.value.length;
  });
  
  /** 连接是否稳定（心跳正常） */
  const isConnectionStable = ref(true);
  
  // ============ 网络管理器 ============
  
  let networkManager: INetworkManager | null = null;
  
  // ============ 方法 ============
  
  /** 添加日志 */
  function addLog(type: ChatLogItem['type'], from: string, content: string) {
    const log: ChatLogItem = {
      id: generateLogId(),
      type,
      from,
      content,
      timestamp: Date.now(),
    };
    chatLogs.value.push(log);
    
    // 限制日志数量
    if (chatLogs.value.length > 200) {
      chatLogs.value = chatLogs.value.slice(-150);
    }
  }
  
  /** 初始化网络管理器（每次连接都重新创建以获取新的 userId） */
  function initNetworkManager() {
    // 如果已有 manager，先断开并清理
    if (networkManager) {
      if (networkManager.isConnected) {
        networkManager.disconnect();
      }
      // 不再复用，每次都创建新实例
      networkManager = null;
    }
    
    // 每次都创建新实例以获取新的 userId
    networkManager = useWebSocket.value 
      ? new WebSocketNetworkManager() 
      : new LocalNetworkManager();
    
    networkManager.init({
      onMessage: handleNetworkMessage,
      onUserJoin: handleUserJoin,
      onUserLeave: handleUserLeave,
      onError: handleError,
      onConnectionChange: handleConnectionChange,
    });
    
    // 设置心跳稳定性回调（仅 WebSocket 模式）
    if (useWebSocket.value && (networkManager as any).setStabilityCallback) {
      (networkManager as any).setStabilityCallback((stable: boolean) => {
        isConnectionStable.value = stable;
      });
    }
    
    // 更新响应式的 userId
    currentNetworkUserId.value = networkManager.userId;
  }
  
  /** 启动服务端 */
  async function startServer() {
    try {
      initNetworkManager();
      await networkManager!.startServer({
        port: port.value,
        password: roomPassword.value || undefined,
      });
      
      mode.value = 'server';
      userName.value = '房主';
      addLog('system', '系统', `房间已创建，端口: ${port.value}`);
      
      if (roomPassword.value) {
        addLog('system', '系统', `房间密码: ${roomPassword.value}`);
      }
    } catch (error: any) {
      addLog('error', '系统', `创建房间失败: ${error.message}`);
      throw error;
    }
  }
  
  /** 连接到服务端 */
  async function connectToServer() {
    try {
      initNetworkManager();
      // 在连接前设置用户名
      if (userName.value && networkManager) {
        (networkManager as any).setUserName(userName.value);
      }
      await networkManager!.connect(serverIp.value, port.value, roomPassword.value || undefined);
      
      mode.value = 'client';
      addLog('system', '系统', `正在连接到 ${serverIp.value}:${port.value}...`);
    } catch (error: any) {
      addLog('error', '系统', `连接失败: ${error.message}`);
      throw error;
    }
  }
  
  /** 断开连接 */
  function disconnect() {
    if (networkManager) {
      networkManager.disconnect();
      networkManager = null;
    }
    
    mode.value = 'disconnected';
    isConnected.value = false;
    users.value = [];
    pendingInputs.value.clear();
    isWaitingForAi.value = false;
    hostId.value = null;
    // 重置神化再临同步状态
    acuSyncState.value = { fullSynced: false, lastSyncTimestamp: 0, isolationKey: '' };
    
    addLog('system', '系统', '已断开连接');
  }
  
  /** 发送聊天消息 */
  function sendChat(content: string) {
    if (!networkManager || !isConnected.value || !content.trim()) return;
    
    networkManager.send({
      type: 'chat',
      data: { content: content.trim() },
    });
    
    // 本地也显示
    addLog('chat', userName.value || '我', content.trim());
  }
  
  /** 发送用户输入（准备发送给AI） */
  function sendUserInput(input: string, messagePrefix?: string, messageSuffix?: string) {
    if (!networkManager || !isConnected.value) return;
    
    networkManager.send({
      type: 'user_input',
      data: { 
        content: input,
        messagePrefix: messagePrefix || '[{name}]:',
        messageSuffix: messageSuffix || '',
      },
    });
    
    addLog('system', '我', `已发送输入: ${input.substring(0, 50)}...`);
  }
  
  /** 发送用户设定给房主（客户端用） */
  function sendUserPersona(content: string, prefix: string) {
    if (!networkManager || !isConnected.value) return;
    
    networkManager.send({
      type: 'user_persona',
      data: { 
        content,
        prefix,
      },
    });
    
    addLog('system', '我', `已发送用户设定`);
  }
  
  /** 标记自己已准备 */
  function setReady(ready: boolean) {
    if (!networkManager || !isConnected.value) return;
    
    networkManager.send({
      type: 'ready',
      data: { ready },
    });
  }
  
  /** 广播AI回复（房主用） */
  function broadcastAiResponse(content: string) {
    if (!networkManager || !isHost.value) {
      addLog('error', '系统', '只有房主可以广播AI回复');
      return;
    }
    
    networkManager.broadcast({
      type: 'ai_response',
      data: { 
        content,
        variableMode: variableMode.value,  // 同步房主的变量模式给客户端
      },
    });
    
    addLog('ai', 'AI', content.substring(0, 100) + (content.length > 100 ? '...' : ''));
    isWaitingForAi.value = false;
  }
  
  /** 流式广播AI回复（房主用） */
  function broadcastAiStream(content: string) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.broadcast({
      type: 'ai_stream',
      data: { content },
    });
  }
  
  /** 广播用户消息（让所有客户端创建同样的用户消息） */
  function broadcastUserMessage(content: string) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.broadcast({
      type: 'user_message',
      data: { content },
    });
  }
  
  /** 广播删除最新消息（房主用） */
  function broadcastDeleteLastMessage() {
    if (!networkManager || !isHost.value) return;
    
    networkManager.broadcast({
      type: 'delete_last_message',
      data: {},
    });
    
    addLog('system', '系统', '已广播删除最新消息');
  }
  
  /** 转让房主 */
  function transferHost(targetUserId: string) {
    if (!networkManager || !isHost.value) {
      addLog('error', '系统', '只有房主可以转让权限');
      return;
    }
    
    networkManager.send({
      type: 'transfer_host',
      data: { targetUserId },
    });
  }
  
  /** 获取整合后的用户输入（服务端用） */
  function getCombinedInputs(): string {
    const inputs: string[] = [];
    for (const [userId, data] of pendingInputs.value) {
      inputs.push(`[${data.userName}]: ${data.content}`);
    }
    return inputs.join('\n\n');
  }
  
  /** 清空待整合输入（服务端用） */
  function clearPendingInputs() {
    pendingInputs.value.clear();
    // 重置所有用户的ready状态
    users.value.forEach(user => {
      user.ready = false;
    });
  }
  
  /** 房主请求输入 */
  function requestInput() {
    if (!networkManager || !isHost.value) {
      addLog('error', '系统', '只有房主可以请求输入');
      return;
    }
    
    isWaitingInput.value = true;
    pendingInputs.value.clear();
    
    networkManager.broadcast({
      type: 'request_input',
      data: {},
    });
    
    addLog('system', '系统', '已请求所有用户提交输入');
  }
  
  /** 重置输入状态（广播） */
  function resetInputState() {
    if (!networkManager || !isHost.value) return;
    
    isWaitingInput.value = false;
    pendingInputs.value.clear();
    
    networkManager.broadcast({
      type: 'reset_input',
      data: {},
    });
    
    addLog('system', '系统', '已重置输入状态');
  }
  
  /** 客户端请求同步历史消息 */
  function requestSyncHistory(depth?: number) {
    if (!networkManager || isHost.value) {
      addLog('error', '系统', '只有客户端可以请求同步历史');
      return;
    }
    
    networkManager.send({
      type: 'sync_history_request',
      data: { depth: depth || 0 },  // 0表示全部
    });
    
    addLog('system', '系统', '正在请求同步历史消息...');
  }
  
  /** 房主向指定用户发送历史消息 */
  function sendHistoryToUser(targetUserId: string, messages: Array<{role: string; message: string}>) {
    if (!networkManager || !isHost.value) return;
    
    // 逐条发送历史消息
    for (const msg of messages) {
      networkManager.send({
        type: 'sync_history_data',
        data: { 
          role: msg.role,
          message: msg.message,
          targetUserId,
        },
      });
    }
    
    // 发送完成标志
    networkManager.send({
      type: 'sync_history_data',
      data: { 
        complete: true,
        count: messages.length,
        targetUserId,
      },
    });
    
    addLog('system', '系统', `已发送${messages.length}条历史消息`);
  }

  /** 客户端请求同步正则 */
  function requestSyncRegex() {
    if (!networkManager || isHost.value) {
      addLog('error', '系统', '只有客户端可以请求同步正则');
      return;
    }
    
    networkManager.send({
      type: 'sync_regex_request',
      data: {},
    });
    
    addLog('system', '系统', '正在请求同步正则...');
  }

  /** 房主发送正则给指定用户（房主用） */
  function sendRegexToUser(targetUserId: string, regexes: any[]) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.send({
      type: 'sync_regex_data',
      data: { 
        regexes,
        targetUserId,
      },
    });
    
    addLog('system', '系统', `已发送${regexes.length}条正则`);
  }

  /** 客户端请求同步变量（客户端用） */
  function requestSyncVariables() {
    if (!networkManager || isHost.value) {
      addLog('error', '系统', '只有客户端可以请求同步变量');
      return;
    }
    
    networkManager.send({
      type: 'sync_variables_request',
      data: { 
        variableMode: variableMode.value,  // 发送当前客户端的变量模式
      },
    });
    
    addLog('system', '系统', '正在请求同步变量...');
  }

  /** 
   * 通用变量广播方法（房主用）
   * @param variableType 变量类型标识，如 'mvu', 'custom' 等
   * @param content 变量内容
   */
  function broadcastVariables(variableType: string, content: any) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.send({
      type: 'sync_variables',
      data: { 
        variableType,
        content,
      },
    });
    
    addLog('system', '系统', `[${variableType}] 变量已同步`);
  }

  /**
   * 发送变量给指定用户（房主用）
   * @param targetUserId 目标用户ID
   * @param variableType 变量类型标识
   * @param content 变量内容
   */
  function sendVariablesToUser(targetUserId: string, variableType: string, content: any) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.send({
      type: 'sync_variables',
      data: { 
        variableType,
        content,
        targetUserId,
      },
    });
    
    if (content.error) {
      addLog('system', '系统', `[${variableType}] ${content.error}`);
    } else {
      addLog('system', '系统', `[${variableType}] 变量已发送给用户`);
    }
  }

  /**
   * 神化再临全量同步（房主用，首次同步时调用）
   * @param isolationKey 隔离标签
   * @param tables 完整表格数据
   * @param targetMessageId 目标消息ID（可选）
   */
  function broadcastACUFullSync(isolationKey: string, tables: Record<string, any>, targetMessageId?: number) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.broadcast({
      type: 'acu_full_sync',
      data: { 
        isolationKey,
        tables,
        targetMessageId,
      },
    });
    
    addLog('system', '系统', `[神化再临] 全量同步已发送 (${Object.keys(tables).length} 表)`);
  }

  /**
   * 神化再临增量同步（房主用，后续更新时调用）
   * @param isolationKey 隔离标签
   * @param tables 变更的表格数据
   * @param modifiedKeys 变更的表格键列表
   * @param targetMessageId 目标消息ID（可选）
   */
  function broadcastACUDeltaSync(isolationKey: string, tables: Record<string, any>, modifiedKeys: string[], targetMessageId?: number) {
    if (!networkManager || !isHost.value) return;
    
    networkManager.broadcast({
      type: 'acu_delta_sync',
      data: { 
        isolationKey,
        tables,
        modifiedKeys,
        targetMessageId,
      },
    });
    
    addLog('system', '系统', `[神化再临] 增量同步已发送 (${modifiedKeys.length} 表)`);
  }

  // ============ 网络事件处理 ============
  
  function handleNetworkMessage(msg: NetworkMessage) {
    switch (msg.type) {
      case 'chat':
        addLog('chat', msg.fromName, msg.data.content);
        break;
        
      case 'user_input':
        // 所有用户都存储输入（实现输入同步显示）
        // 如果发送者是房主，使用 'host' 作为 key；否则使用实际的 userId
        const inputKey = (msg.from === hostId.value) ? 'host' : msg.from;
        pendingInputs.value.set(inputKey, {
          userName: msg.fromName,
          content: msg.data.content,
          messagePrefix: msg.data.messagePrefix || '[{name}]:',
          messageSuffix: msg.data.messageSuffix || '',
        });
        addLog('system', msg.fromName, `提交了输入`);
        break;
        
      case 'ready':
        // 更新用户ready状态
        const user = users.value.find(u => u.id === msg.from);
        if (user) {
          user.ready = msg.data.ready;
        }
        break;
        
      case 'ai_response':
        // 非房主收到AI完整回复
        if (!isHost.value) {
          // 同步房主的变量模式设置
          if (msg.data.variableMode) {
            variableMode.value = msg.data.variableMode;
          }
          addLog('ai', 'AI', msg.data.content.substring(0, 100) + '...');
          // 触发事件以便创建本地AI消息
          eventEmit('multiplayer_ai_response', msg.data.content);
        }
        break;
        
      case 'ai_stream':
        // 非房主收到AI流式回复
        if (!isHost.value) {
          // 触发流式更新事件
          eventEmit('multiplayer_ai_stream', msg.data.content);
        }
        break;
        
      case 'user_message':
        // 非房主收到用户消息同步
        if (!isHost.value) {
          // 触发事件让客户端创建用户消息
          eventEmit('multiplayer_user_message', msg.data.content);
        }
        break;
        
      case 'delete_last_message':
        // 非房主收到删除最新消息同步
        if (!isHost.value) {
          // 触发事件让客户端删除最新消息
          eventEmit('multiplayer_delete_last_message');
        }
        break;
        
      case 'host_change':
        // 房主变更
        hostId.value = msg.data.hostId;
        addLog('system', '系统', `${msg.data.hostName || '未知'} 成为了房主`);
        // 更新用户列表中的isHost标记
        users.value.forEach(u => {
          u.isHost = u.id === msg.data.hostId;
        });
        break;
        
      case 'request_input':
        // 非房主收到输入请求
        if (!isHost.value) {
          isWaitingInput.value = true;
          addLog('system', '系统', '房主请求输入，请提交你的回复');
          eventEmit('multiplayer_request_input');
        }
        break;
        
      case 'reset_input':
        // 非房主收到重置请求
        if (!isHost.value) {
          isWaitingInput.value = false;
          pendingInputs.value.clear();  // 清空输入列表
          addLog('system', '系统', '输入已被重置');
          eventEmit('multiplayer_reset_input');
        }
        break;
        
      case 'sync_history_request':
        // 房主收到历史同步请求
        if (isHost.value) {
          addLog('system', msg.fromName, '请求同步历史消息');
          // 触发事件让index.ts处理（传递完整数据）
          eventEmit('multiplayer_sync_history_request', {
            userId: msg.from,
            depth: msg.data?.depth || 0,
          });
        }
        break;
        
      case 'sync_history_data':
        // 非房主收到历史消息数据
        if (!isHost.value) {
          // 触发事件让index.ts处理
          eventEmit('multiplayer_sync_history_data', msg.data);
        }
        break;
        
      case 'sync_regex_request':
        // 房主收到正则同步请求
        if (isHost.value) {
          addLog('system', msg.fromName, '请求同步正则');
          // 触发事件让index.ts处理
          eventEmit('multiplayer_sync_regex_request', msg.from);
        }
        break;
        
      case 'sync_regex_data':
        // 非房主收到正则数据
        if (!isHost.value) {
          // 触发事件让index.ts处理
          eventEmit('multiplayer_sync_regex_data', msg.data);
        }
        break;
        
      case 'sync_variables':
        // 非房主收到变量同步
        if (!isHost.value) {
          const { variableType, content } = msg.data;
          addLog('system', '系统', `[${variableType}] 收到变量同步`);
          // 触发事件让index.ts处理，传递变量类型和内容
          eventEmit('multiplayer_sync_variables', { variableType, content });
        }
        break;
        
      case 'sync_variables_request':
        // 房主收到变量同步请求
        if (isHost.value) {
          addLog('system', msg.fromName, `请求同步变量 (模式: ${msg.data.variableMode})`);
          // 触发事件让index.ts处理
          eventEmit('multiplayer_sync_variables_request', { 
            userId: msg.from, 
            variableMode: msg.data.variableMode 
          });
        }
        break;
        
      case 'acu_full_sync':
        // 非房主收到神化再临全量同步
        if (!isHost.value) {
          addLog('system', '系统', `[神化再临] 收到全量同步 (${Object.keys(msg.data.tables || {}).length} 表)`);
          // 更新同步状态
          acuSyncState.value.fullSynced = true;
          acuSyncState.value.lastSyncTimestamp = Date.now();
          acuSyncState.value.isolationKey = msg.data.isolationKey || '';
          // 触发事件让index.ts处理
          eventEmit('multiplayer_acu_full_sync', msg.data);
        }
        break;
        
      case 'acu_delta_sync':
        // 非房主收到神化再临增量同步
        if (!isHost.value) {
          addLog('system', '系统', `[神化再临] 收到增量同步 (${(msg.data.modifiedKeys || []).length} 表)`);
          acuSyncState.value.lastSyncTimestamp = Date.now();
          // 触发事件让index.ts处理
          eventEmit('multiplayer_acu_delta_sync', msg.data);
        }
        break;
        
      case 'user_persona':
        // 房主收到用户设定
        if (isHost.value) {
          pendingPersonas.value.set(msg.from, {
            userName: msg.fromName,
            content: msg.data.content,
            prefix: msg.data.prefix || `[${msg.fromName}]的设定:`,
          });
          addLog('system', msg.fromName, '已提交用户设定');
        }
        break;
        
      case 'error':
        if (msg.data.targetId === networkManager?.userId) {
          addLog('error', '系统', msg.data.message);
        }
        break;
    }
  }
  
  function handleUserJoin(user: ConnectedUser) {
    if (!users.value.find(u => u.id === user.id)) {
      users.value.push(user);
      const hostLabel = user.isHost ? ' (房主)' : '';
      addLog('system', '系统', `${user.name}${hostLabel} 加入了房间`);
      // 如果这是房主，更新hostId
      if (user.isHost) {
        hostId.value = user.id;
      }
    }
  }
  
  function handleUserLeave(userId: string) {
    const index = users.value.findIndex(u => u.id === userId);
    if (index !== -1) {
      const user = users.value[index];
      users.value.splice(index, 1);
      pendingInputs.value.delete(userId);
      addLog('system', '系统', `${user.name} 离开了房间`);
    }
  }
  
  function handleError(error: string) {
    addLog('error', '系统', error);
  }
  
  function handleConnectionChange(connected: boolean) {
    isConnected.value = connected;
    if (connected) {
      addLog('system', '系统', '连接成功');
    } else {
      // 连接断开时重置所有状态
      mode.value = 'disconnected';
      users.value = [];
      pendingInputs.value.clear();
      isWaitingForAi.value = false;
      isWaitingInput.value = false;
      hostId.value = null;
      addLog('system', '系统', '连接已断开');
    }
  }
  
  // ============ 在线模式方法 ============
  
  /** 获取在线房间列表 */
  async function fetchOnlineRooms() {
    if (!onlineMode.value) return;
    
    isLoadingRooms.value = true;
    try {
      const response = await fetch(`${onlineServerUrl.value}/rooms`);
      if (!response.ok) throw new Error('获取房间列表失败');
      const data = await response.json();
      onlineRooms.value = data.rooms || [];
      addLog('system', '系统', `获取到 ${onlineRooms.value.length} 个在线房间`);
    } catch (error: any) {
      addLog('error', '系统', `获取房间列表失败: ${error.message}`);
      throw error;
    } finally {
      isLoadingRooms.value = false;
    }
  }
  
  /** 创建在线房间 */
  async function createOnlineRoom(roomName: string, password?: string, maxUsers?: number) {
    if (!onlineMode.value) {
      addLog('error', '系统', '请先启用在线模式');
      return null;
    }
    
    try {
      const response = await fetch(`${onlineServerUrl.value}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roomName,
          password: password || undefined,
          maxUsers: maxUsers || 8,
          creatorName: userName.value || '匿名',
        }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建房间失败');
      }
      
      const data = await response.json();
      addLog('system', '系统', `房间 "${data.name}" 创建成功`);
      
      // 创建成功后自动加入
      if (data.id) {
        await joinOnlineRoom(data.id, password);
      }
      
      return data;
    } catch (error: any) {
      addLog('error', '系统', `创建房间失败: ${error.message}`);
      throw error;
    }
  }
  
  /** 加入在线房间 */
  async function joinOnlineRoom(roomId: string, password?: string) {
    if (!onlineMode.value) {
      addLog('error', '系统', '请先启用在线模式');
      return;
    }
    
    try {
      // 先获取房间连接信息
      const response = await fetch(`${onlineServerUrl.value}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '加入房间失败');
      }
      
      const data = await response.json();
      
      // 构建 WebSocket URL
      const wsBaseUrl = onlineServerUrl.value.replace('https://', 'wss://').replace('http://', 'ws://');
      const wsUrl = `${wsBaseUrl}/ws/room/${roomId}`;
      
      addLog('system', '系统', `正在连接到房间 "${data.name}"...`);
      console.log('[联机Mod] WebSocket URL:', wsUrl);
      
      // 初始化网络管理器并连接
      initNetworkManager();
      
      // 设置用户名
      if (userName.value && networkManager) {
        (networkManager as any).setUserName(userName.value);
      }
      
      // 使用 WebSocket URL 连接
      if (networkManager && (networkManager as any).connectToUrl) {
        try {
          await (networkManager as any).connectToUrl(wsUrl, password);
          mode.value = 'client';
          currentOnlineRoomId.value = roomId;
          addLog('system', '系统', `已加入房间 "${data.name}"`);
        } catch (wsError: any) {
          console.error('[联机Mod] WebSocket 连接失败:', wsError);
          addLog('error', '系统', `WebSocket 连接失败: ${wsError.message}`);
          throw wsError;
        }
      } else {
        throw new Error('网络管理器不支持 URL 连接');
      }
    } catch (error: any) {
      addLog('error', '系统', `加入房间失败: ${error.message}`);
      throw error;
    }
  }
  
  /** 离开在线房间 */
  function leaveOnlineRoom() {
    disconnect();
    currentOnlineRoomId.value = null;
  }
  
  // ============ 返回 ============
  
  return {
    // 状态
    mode,
    isConnected,
    userName,
    serverIp,
    port,
    roomPassword,
    useWebSocket,
    users,
    chatLogs,
    pendingInputs,
    pendingPersonas,
    isWaitingForAi,
    isWaitingInput,
    hostId,
    isHost,
    allUsersSubmitted,
    isConnectionStable,
    currentUserId,
    
    // 在线模式状态
    onlineMode,
    onlineServerUrl,
    onlineRooms,
    currentOnlineRoomId,
    isLoadingRooms,
    
    // 方法
    addLog,
    startServer,
    connectToServer,
    disconnect,
    sendChat,
    sendUserInput,
    setReady,
    broadcastAiResponse,
    broadcastAiStream,
    transferHost,
    getCombinedInputs,
    clearPendingInputs,
    sendUserPersona,
    requestInput,
    resetInputState,
    requestSyncHistory,
    sendHistoryToUser,
    broadcastUserMessage,
    broadcastDeleteLastMessage,
    requestSyncRegex,
    requestSyncVariables,
    sendRegexToUser,
    broadcastVariables,
    sendVariablesToUser,
    variableMode,
    // 神化再临同步
    acuSyncState,
    broadcastACUFullSync,
    broadcastACUDeltaSync,
    
    // 在线模式方法
    fetchOnlineRooms,
    createOnlineRoom,
    joinOnlineRoom,
    leaveOnlineRoom,
  };
});

