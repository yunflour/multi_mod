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

  get isServer() { return this._isServer; }
  get isConnected() { return this._isConnected; }
  get userId() { return this._userId; }

  init(handlers: NetworkEventHandlers): void {
    this.handlers = handlers;
  }

  async startServer(_config: RoomConfig): Promise<void> {
    // WebSocket客户端不支持作为服务端
    throw new Error('WebSocket客户端模式不支持创建服务端，请使用本地模式或运行独立的Node.js服务端');
  }

  async connect(ip: string, port: number, password?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `ws://${ip}:${port}`;
        this.ws = new WebSocket(wsUrl);
        // 只有在用户名为空时才使用默认用户名
        if (!this.userName) {
          this.userName = `用户${this._userId.substring(0, 4)}`;
        }

        this.ws.onopen = () => {
          this._isConnected = true;
          this.handlers?.onConnectionChange(true);
          
          // 发送加入消息
          this.send({
            type: 'join',
            data: { name: this.userName, password },
          });
          
          resolve();
        };

        this.ws.onclose = () => {
          this._isConnected = false;
          this.handlers?.onConnectionChange(false);
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

  disconnect(): void {
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
