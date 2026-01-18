/**
 * SillyTavern 联机Mod 网络通信层
 * 支持 BroadcastChannel（本地多标签页）和 WebSocket（外部服务端）
 */

import type {
  INetworkManager,
  NetworkEventHandlers,
  NetworkMessage,
  RoomConfig,
  ConnectedUser,
} from './types';

/** 生成唯一ID */
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * BroadcastChannel 网络管理器
 * 用于同一浏览器内多标签页通信
 */
export class LocalNetworkManager implements INetworkManager {
  private channel: BroadcastChannel | null = null;
  private handlers: NetworkEventHandlers | null = null;
  private _isServer = false;
  private _isConnected = false;
  private _userId = generateId();
  private userName = '';
  private users: Map<string, ConnectedUser> = new Map();
  private roomPassword = '';

  get isServer() { return this._isServer; }
  get isConnected() { return this._isConnected; }
  get userId() { return this._userId; }

  init(handlers: NetworkEventHandlers): void {
    this.handlers = handlers;
  }

  async startServer(config: RoomConfig): Promise<void> {
    this._isServer = true;
    this.roomPassword = config.password || '';
    this.userName = '房主';
    
    // 使用端口号作为频道名
    const channelName = `st-multiplayer-${config.port}`;
    this.channel = new BroadcastChannel(channelName);
    
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this._isConnected = true;
    this.handlers?.onConnectionChange(true);
    
    // 将自己添加到用户列表
    this.users.set(this._userId, {
      id: this._userId,
      name: this.userName,
      ready: false,
    });
    this.handlers?.onUserJoin(this.users.get(this._userId)!);
  }

  async connect(ip: string, port: number, password?: string): Promise<void> {
    this._isServer = false;
    this.userName = `用户${this._userId.substring(0, 4)}`;
    
    // 对于本地模式，忽略IP，只用端口
    const channelName = `st-multiplayer-${port}`;
    this.channel = new BroadcastChannel(channelName);
    
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this._isConnected = true;
    this.handlers?.onConnectionChange(true);

    // 发送加入消息
    this.send({
      type: 'join',
      data: { name: this.userName, password },
    });
  }

  disconnect(): void {
    if (this._isConnected) {
      this.send({ type: 'leave', data: null });
    }
    
    this.channel?.close();
    this.channel = null;
    this._isConnected = false;
    this._isServer = false;
    this.users.clear();
    this.handlers?.onConnectionChange(false);
  }

  send(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void {
    if (!this.channel || !this._isConnected) return;
    
    const fullMessage: NetworkMessage = {
      ...message,
      from: this._userId,
      fromName: this.userName,
      timestamp: Date.now(),
    };
    
    this.channel.postMessage(fullMessage);
  }

  broadcast(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void {
    this.send(message);
  }

  private handleMessage(msg: NetworkMessage): void {
    // 忽略自己发送的消息
    if (msg.from === this._userId) return;

    switch (msg.type) {
      case 'join':
        this.handleJoin(msg);
        break;
      case 'leave':
        this.handleLeave(msg);
        break;
      case 'sync_state':
        this.handleSyncState(msg);
        break;
      default:
        this.handlers?.onMessage(msg);
    }
  }

  private handleJoin(msg: NetworkMessage): void {
    const { name, password } = msg.data;
    
    // 服务端验证密码
    if (this._isServer && this.roomPassword && password !== this.roomPassword) {
      // 发送错误消息
      this.send({
        type: 'error',
        data: { targetId: msg.from, message: '密码错误' },
      });
      return;
    }

    const newUser: ConnectedUser = {
      id: msg.from,
      name: name || msg.fromName,
      ready: false,
    };
    
    this.users.set(msg.from, newUser);
    this.handlers?.onUserJoin(newUser);

    // 服务端广播当前状态给新用户
    if (this._isServer) {
      this.send({
        type: 'sync_state',
        data: {
          users: Array.from(this.users.values()),
        },
      });
    }
  }

  private handleLeave(msg: NetworkMessage): void {
    this.users.delete(msg.from);
    this.handlers?.onUserLeave(msg.from);
  }

  private handleSyncState(msg: NetworkMessage): void {
    if (this._isServer) return;
    
    const { users } = msg.data;
    for (const user of users) {
      if (!this.users.has(user.id)) {
        this.users.set(user.id, user);
        this.handlers?.onUserJoin(user);
      }
    }
  }

  setUserName(name: string): void {
    this.userName = name;
  }
}

/**
 * WebSocket 客户端网络管理器
 * 用于连接外部 WebSocket 服务端
 */
export class WebSocketNetworkManager implements INetworkManager {
  private ws: WebSocket | null = null;
  private handlers: NetworkEventHandlers | null = null;
  private _isServer = false;  // WebSocket客户端永远不是服务端
  private _isConnected = false;
  private _userId = generateId();
  private userName = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  
  // 心跳相关
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPong = false;
  private missedPongs = 0;
  private _isStable = true;  // 连接是否稳定
  private lastConnectUrl = '';
  private lastConnectPassword: string | undefined;
  private onStabilityChange: ((stable: boolean) => void) | null = null;

  get isServer() { return this._isServer; }
  get isConnected() { return this._isConnected; }
  get userId() { return this._userId; }
  get isStable() { return this._isStable; }

  init(handlers: NetworkEventHandlers): void {
    this.handlers = handlers;
  }
  
  /** 设置连接稳定性变化回调 */
  setStabilityCallback(callback: (stable: boolean) => void): void {
    this.onStabilityChange = callback;
  }

  async startServer(_config: RoomConfig): Promise<void> {
    // WebSocket客户端不支持作为服务端
    throw new Error('WebSocket客户端模式不支持创建服务端，请使用本地模式或运行独立的Node.js服务端');
  }

  async connect(ip: string, port: number, password?: string): Promise<void> {
    const wsUrl = `ws://${ip}:${port}`;
    return this.connectToUrl(wsUrl, password);
  }

  /** 直接连接到 WebSocket URL（用于在线模式） */
  async connectToUrl(wsUrl: string, password?: string): Promise<void> {
    // 保存连接信息用于重连
    this.lastConnectUrl = wsUrl;
    this.lastConnectPassword = password;
    
    // 确保只维持单一连接：先关闭已存在的连接
    if (this.ws) {
      console.log('[联机Mod] 关闭旧连接，准备创建新连接');
      this.stopHeartbeat();
      const oldWs = this.ws;
      this.ws = null;
      try {
        oldWs.close(4005, '被新连接替换');
      } catch (e) {
        // 忽略关闭错误
      }
    }
    
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);
        if (!this.userName) {
          this.userName = `用户${this._userId.substring(0, 4)}`;
        }

        this.ws.onopen = () => {
          this._isConnected = true;
          this._isStable = true;
          this.missedPongs = 0;
          this.handlers?.onConnectionChange(true);
          this.onStabilityChange?.(true);
          
          this.send({
            type: 'join',
            data: { name: this.userName, password },
          });
          
          // 启动心跳
          this.startHeartbeat();
          
          resolve();
        };

        this.ws.onclose = () => {
          this.stopHeartbeat();
          this._isConnected = false;
          this._isStable = false;
          this.handlers?.onConnectionChange(false);
          this.onStabilityChange?.(false);
        };

        this.ws.onerror = (error) => {
          this.handlers?.onError('WebSocket连接错误');
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const msg: NetworkMessage = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (e) {
            console.error('解析消息失败:', e);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /** 启动心跳 */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (!this._isConnected) return;
      
      // 检查上次的 pong 是否收到
      if (this.pendingPong) {
        this.missedPongs++;
        console.log(`[心跳] 未收到 pong 响应 (${this.missedPongs}/3)`);
        
        // 任意一次没收到，标记为不稳定（黄灯）
        if (this._isStable) {
          this._isStable = false;
          this.onStabilityChange?.(false);
        }
        
        // 连续3次失败，软重连
        if (this.missedPongs >= 3) {
          console.log('[心跳] 连续3次失败，尝试软重连...');
          this.softReconnect();
          return;
        }
      }
      
      // 发送新的 ping
      this.pendingPong = true;
      this.send({
        type: 'ping',
        data: { timestamp: Date.now() },
      });
    }, 3000);
  }
  
  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.pendingPong = false;
    this.missedPongs = 0;
  }
  
  /** 软重连：关闭当前连接并重新连接 */
  private async softReconnect(): Promise<void> {
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // 延迟 500ms 后重连
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (this.lastConnectUrl) {
      try {
        console.log('[心跳] 正在重连...');
        await this.connectToUrl(this.lastConnectUrl, this.lastConnectPassword);
        console.log('[心跳] 重连成功');
      } catch (e) {
        console.error('[心跳] 重连失败:', e);
        this.handlers?.onError('重连失败');
      }
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this._isConnected && this.ws) {
      this.send({ type: 'leave', data: null });
    }
    
    this.ws?.close();
    this.ws = null;
    this._isConnected = false;
    this._isStable = false;
    this.handlers?.onConnectionChange(false);
  }

  send(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const fullMessage: NetworkMessage = {
      ...message,
      from: this._userId,
      fromName: this.userName,
      timestamp: Date.now(),
    };
    
    this.ws.send(JSON.stringify(fullMessage));
  }

  broadcast(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void {
    this.send(message);
  }

  private handleMessage(msg: NetworkMessage): void {
    switch (msg.type) {
      case 'pong':
        // 收到心跳响应
        this.pendingPong = false;
        if (this.missedPongs > 0) {
          console.log('[心跳] 连接恢复');
        }
        this.missedPongs = 0;
        if (!this._isStable) {
          this._isStable = true;
          this.onStabilityChange?.(true);
        }
        break;
      case 'error':
        if (msg.data.targetId === this._userId) {
          this.handlers?.onError(msg.data.message);
        }
        break;
      case 'sync_state':
        if (msg.data.users) {
          for (const user of msg.data.users) {
            this.handlers?.onUserJoin(user);
          }
        }
        break;
      case 'join':
        this.handlers?.onUserJoin({
          id: msg.from,
          name: msg.fromName,
          ready: false,
        });
        break;
      case 'leave':
        this.handlers?.onUserLeave(msg.from);
        break;
      default:
        this.handlers?.onMessage(msg);
    }
  }

  setUserName(name: string): void {
    this.userName = name;
  }
}

/**
 * 根据模式获取网络管理器实例
 */
export function createNetworkManager(useWebSocket: boolean = false): INetworkManager {
  return useWebSocket ? new WebSocketNetworkManager() : new LocalNetworkManager();
}
