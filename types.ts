/**
 * SillyTavern 联机Mod 类型定义
 */

/** 网络消息类型 */
export type MessageType =
  | 'join'                  // 加入房间
  | 'leave'                 // 离开房间
  | 'chat'                  // 聊天消息
  | 'user_input'            // 用户对酒馆的输入
  | 'user_message'          // 用户消息同步（让客户端创建同样的用户消息）
  | 'delete_last_message'   // 删除最新消息同步
  | 'ai_response'           // AI回复同步（完整）
  | 'ai_stream'             // AI流式回复（实时）
  | 'ready'                 // 用户准备好发送
  | 'sync_state'            // 状态同步
  | 'host_change'           // 房主变更
  | 'transfer_host'         // 转让房主
  | 'request_input'         // 房主请求输入
  | 'reset_input'           // 重置输入状态
  | 'sync_history_request'  // 请求同步历史
  | 'sync_history_data'     // 历史消息数据
  | 'sync_regex_request'    // 请求同步正则
  | 'sync_regex_data'       // 正则数据
  | 'sync_variables'        // 变量数据同步（通用，如MVU）
  | 'acu_full_sync'         // 神化再临全量同步
  | 'acu_delta_sync'        // 神化再临增量同步
  | 'ping'                  // 心跳请求
  | 'pong'                  // 心跳响应
  | 'error';                // 错误消息

/** 网络消息 */
export interface NetworkMessage {
  type: MessageType;
  from: string;      // 发送者ID
  fromName: string;  // 发送者名称
  data: any;         // 消息数据
  timestamp: number;
}

/** 聊天日志项 */
export interface ChatLogItem {
  id: string;
  type: 'system' | 'chat' | 'error' | 'ai';
  from: string;
  content: string;
  timestamp: number;
}

/** 连接的用户 */
export interface ConnectedUser {
  id: string;
  name: string;
  ready: boolean;
  isHost?: boolean;       // 是否是房主
  inputContent?: string;  // 准备发送的内容
}

/** 连接模式 */
export type ConnectionMode = 'server' | 'client' | 'disconnected';

/** 房间配置 */
export interface RoomConfig {
  port: number;
  password?: string;
  maxUsers?: number;
}

/** 网络管理器事件处理器 */
export interface NetworkEventHandlers {
  onMessage: (msg: NetworkMessage) => void;
  onUserJoin: (user: ConnectedUser) => void;
  onUserLeave: (userId: string) => void;
  onError: (error: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

/** 网络管理器接口 */
export interface INetworkManager {
  readonly isServer: boolean;
  readonly isConnected: boolean;
  readonly userId: string;

  init(handlers: NetworkEventHandlers): void;
  startServer(config: RoomConfig): Promise<void>;
  connect(ip: string, port: number, password?: string): Promise<void>;
  /** 连接到指定的 WebSocket URL */
  connectToUrl?(wsUrl: string, password?: string): Promise<void>;
  disconnect(): void;

  send(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void;
  broadcast(message: Omit<NetworkMessage, 'from' | 'fromName' | 'timestamp'>): void;
}

/** 在线房间信息 */
export interface OnlineRoom {
  id: string;
  name: string;
  hasPassword: boolean;
  maxUsers: number;
  currentUsers: number;
  creatorName: string;
  createdAt: number;
}

/** 在线房间列表响应 */
export interface OnlineRoomsResponse {
  rooms: OnlineRoom[];
  maxRooms: number;
  currentRooms: number;
}

/** 创建房间请求 */
export interface CreateRoomRequest {
  name: string;
  password?: string;
  maxUsers?: number;
  creatorId?: string;
  creatorName?: string;
}

/** 创建/加入房间响应 */
export interface RoomJoinResponse {
  id: string;
  name: string;
  wsUrl?: string;
  maxUsers: number;
  currentUsers: number;
  error?: string;
}
