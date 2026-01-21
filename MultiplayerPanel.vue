<template>
  <div
    class="multiplayer-panel"
    :class="{ minimized: isMinimized, dragging: isDragging }"
    :style="panelStyle"
    ref="panelRef"
  >
    <!-- 标题栏 -->
    <div class="panel-header" @mousedown="startDrag" @touchstart="startTouchDrag">
      <div class="header-left">
        <span class="title">🎮 联机工具 v0.4</span>
        <span class="status-dot" :class="statusClass"></span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" @click.stop="toggleSettings" title="设置">⚙</button>
        <button class="icon-btn" @click.stop="toggleMinimize" :title="isMinimized ? '展开' : '最小化'">
          {{ isMinimized ? '▢' : '—' }}
        </button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="panel-content" v-show="!isMinimized">
      <!-- 未连接时的设置界面 -->
      <template v-if="store.mode === 'disconnected'">
        <div class="settings-section">
          <div class="setting-row">
            <label>用户名:</label>
            <input v-model="localUserName" placeholder="输入你的名称" class="input-field" />
          </div>
          
          <!-- 在线模式界面 -->
          <template v-if="store.onlineMode">
            <!-- 房间列表 -->
            <div class="online-rooms-section">
              <div class="section-header">
                <span class="section-title">🌐 在线房间</span>
                <button class="refresh-btn" @click="refreshRooms" :disabled="store.isLoadingRooms">
                  {{ store.isLoadingRooms ? '⏳' : '🔄' }}
                </button>
              </div>
              
              <div class="room-list" v-if="store.onlineRooms.length > 0">
                <div 
                  v-for="room in store.onlineRooms" 
                  :key="room.id"
                  class="room-item"
                  @click="selectRoom(room)"
                  :class="{ selected: selectedRoomId === room.id }"
                >
                  <div class="room-info">
                    <span class="room-name">{{ room.name }}</span>
                    <span v-if="room.hasPassword" class="room-lock">🔒</span>
                  </div>
                  <div class="room-meta">
                    <span class="room-users">👥 {{ room.currentUsers }}/{{ room.maxUsers }}</span>
                    <span class="room-creator">by {{ room.creatorName }}</span>
                  </div>
                </div>
              </div>
              <div v-else class="empty-rooms">
                {{ store.isLoadingRooms ? '加载中...' : '暂无房间，点击下方创建' }}
              </div>
              
              <!-- 加入选中房间 -->
              <div v-if="selectedRoomId" class="join-room-section">
                <input 
                  v-model="joinPassword" 
                  type="password" 
                  placeholder="房间密码（如需要）" 
                  class="input-field"
                />
                <button class="action-btn primary" @click="joinSelectedRoom">
                  加入房间
                </button>
              </div>
              
              <!-- 创建新房间 -->
              <div class="create-room-section">
                <div class="section-title">➕ 创建房间</div>
                <input 
                  v-model="newRoomName" 
                  placeholder="房间名称" 
                  class="input-field"
                />
                <div class="create-room-options">
                  <input 
                    v-model="newRoomPassword" 
                    type="password" 
                    placeholder="密码（可选）" 
                    class="input-field small"
                  />
                  <input 
                    v-model.number="newRoomMaxUsers" 
                    type="number" 
                    placeholder="人数"
                    class="input-field tiny"
                    min="2"
                    max="20"
                  />
                </div>
                <button 
                  class="action-btn primary" 
                  @click="createRoom"
                  :disabled="!newRoomName.trim()"
                >
                  创建并加入
                </button>
              </div>
            </div>
          </template>
          
          <!-- 离线模式界面（原有） -->
          <template v-else>
            <div class="setting-row">
              <label>服务端IP:</label>
              <input v-model="store.serverIp" placeholder="localhost" class="input-field" />
            </div>
            
            <div class="setting-row">
              <label>端口:</label>
              <input v-model.number="store.port" type="number" class="input-field small" />
            </div>
            
            <div class="setting-row">
              <label>密码:</label>
              <input v-model="store.roomPassword" type="password" placeholder="可选" class="input-field" />
            </div>
            
            <div class="button-group">
              <button class="action-btn primary" @click="joinRoom" :disabled="!canJoin">
                加入房间
              </button>
            </div>
          </template>
        </div>
      </template>

      <!-- 已连接时的界面 -->
      <template v-else>
        <!-- 用户列表 -->
        <div class="user-list">
          <div class="section-title">
            在线用户 ({{ store.users.length }})
            <span v-if="store.isHost" class="host-badge">你是房主</span>
          </div>
          <div class="user-items">
            <div
              v-for="user in store.users"
              :key="user.id"
              class="user-item"
              :class="{ 
                ready: user.ready, 
                host: user.isHost,
                submitted: hasUserSubmitted(user.id)
              }"
            >
              <span class="user-avatar" :class="{ 'avatar-submitted': hasUserSubmitted(user.id) }">
                <template v-if="hasUserSubmitted(user.id)">✓</template>
                <template v-else>{{ user.name.charAt(0).toUpperCase() }}</template>
              </span>
              <span class="user-name">{{ user.name }}</span>
              <span v-if="user.isHost" class="host-crown">👑</span>
              <span v-if="store.isWaitingInput && !user.isHost && !hasUserSubmitted(user.id)" class="waiting-badge">...</span>
              <button 
                v-if="store.isHost && !user.isHost" 
                class="transfer-btn"
                @click="transferHostTo(user.id)"
                title="转让房主"
              >→</button>
            </div>
          </div>
        </div>

        <!-- 聊天日志 -->
        <div class="chat-logs" ref="logsRef">
          <div
            v-for="log in store.chatLogs"
            :key="log.id"
            class="log-item"
            :class="log.type"
          >
            <span class="log-time">{{ formatTime(log.timestamp) }}</span>
            <span class="log-from">{{ log.from }}:</span>
            <span class="log-content">{{ log.content }}</span>
          </div>
          <div v-if="store.chatLogs.length === 0" class="empty-logs">
            暂无消息
          </div>
        </div>

        <!-- 输入提交区（非房主用） -->
        <div v-if="!store.isHost" class="input-submit-area">
          <div class="section-title">
            提交输入给房主
            <button 
              class="sync-history-btn"
              @click="handleSyncHistory"
              title="同步房主的历史消息"
            >📥 同步历史</button>
          </div>
          <div class="sync-buttons-row">
            <button 
              class="sync-history-btn"
              @click="handleSyncRegex"
              title="同步房主的局部正则"
            >📋 同步正则</button>
            <button 
              class="sync-history-btn"
              @click="handleSyncVariables"
              title="同步房主的变量数据"
            >📊 同步变量</button>
          </div>
          <textarea 
            v-model="userInput"
            placeholder="输入你的回复内容，点击提交发送给房主..."
            class="input-textarea"
            rows="3"
          ></textarea>
          <button 
            class="action-btn primary" 
            @click="submitInput"
            :disabled="!userInput.trim() || hasSubmitted"
          >
            {{ hasSubmitted ? '已提交 ✓' : '提交输入' }}
          </button>
        </div>

        <!-- 房主控制区 -->
        <div v-if="store.isHost" class="host-control-area">
          <div class="section-title">
            收集到的输入 ({{ store.pendingInputs.size }}/{{ totalUserCount }})
            <span v-if="store.allUsersSubmitted && totalUserCount > 0" class="all-submitted">✓ 全部提交</span>
          </div>
          
          <div class="pending-inputs" v-if="store.pendingInputs.size > 0">
            <div 
              v-for="[userId, data] in store.pendingInputs" 
              :key="userId"
              class="pending-input-item"
            >
              <span class="input-user">{{ data.userName }}:</span>
              <span class="input-content" v-if="!settings.hideUserInputContent">{{ data.content.substring(0, 50) }}{{ data.content.length > 50 ? '...' : '' }}</span>
              <span class="input-content hidden-content" v-else>已提交</span>
            </div>
          </div>
          <div v-else class="empty-inputs">
            {{ store.isWaitingInput ? '等待用户提交输入...' : '点击"请求输入"开始收集' }}
          </div>
          
          <div class="host-input-area">
            <textarea 
              v-model="hostInput"
              placeholder="房主输入（可选，会与其他输入合并）..."
              class="input-textarea"
              rows="2"
            ></textarea>
          </div>
          
          <div class="button-group">
            <button 
              class="action-btn secondary" 
              @click="handleResetInput"
              :disabled="store.pendingInputs.size === 0"
            >
              重置
            </button>
            <button 
              class="action-btn primary" 
              @click="handleRequestInput"
              :disabled="!hostInput.trim() || hasHostSubmitted"
            >
              {{ hasHostSubmitted ? '已提交 ✓' : '提交输入' }}
            </button>
            <button 
              class="action-btn primary" 
              @click="sendCombinedToTavern"
              :disabled="store.pendingInputs.size === 0"
            >
              立即发送 ({{ store.pendingInputs.size }})
            </button>
          </div>
        </div>

        <!-- 聊天区（简化为仅用于日志和简单聊天） -->
        <div class="chat-input-area">
          <input
            v-model="chatMessage"
            @keyup.enter="sendChatMessage"
            placeholder="发送聊天消息..."
            class="chat-input"
          />
          <button class="send-btn small" @click="sendChatMessage" :disabled="!chatMessage.trim()">
            💬
          </button>
        </div>

        <!-- 底部操作栏 -->
        <div class="action-bar">
          <button class="action-btn danger" @click="handleDisconnect">
            断开连接
          </button>
        </div>
      </template>
    </div>

    <!-- 设置弹窗 -->
    <div v-if="showSettings" class="settings-modal">
      <div class="settings-modal-content">
        <div class="settings-modal-header">
          <span>⚙ 设置</span>
          <button class="icon-btn" @click="toggleSettings">×</button>
        </div>
        <div class="settings-modal-body">
          <!-- 在线模式设置 -->
          <div class="setting-item toggle-item">
            <label class="toggle-label">
              <span>🌐 在线模式:</span>
              <input 
                type="checkbox"
                v-model="store.onlineMode"
                class="toggle-checkbox"
              />
              <span class="toggle-switch"></span>
            </label>
            <small class="hint">连接到公共服务器创建/加入房间</small>
          </div>
          <div v-if="store.onlineMode" class="setting-item">
            <label>服务器地址:</label>
            <input 
              v-model="store.onlineServerUrl" 
              placeholder="https://room.example.com"
              class="settings-input"
            />
          </div>
          <hr class="settings-divider" />
          
          <div class="setting-item">
            <label>默认用户名:</label>
            <input 
              v-model="settings.defaultUserName" 
              placeholder="设置默认用户名"
              class="settings-input"
              @change="saveSettings"
            />
          </div>
          <div class="setting-item">
            <label>消息前缀格式:</label>
            <input 
              v-model="settings.messagePrefix" 
              placeholder="例如: [{name}]"
              class="settings-input"
              @change="saveSettings"
            />
            <small class="hint">使用 {name} 表示用户名</small>
          </div>
          <div class="setting-item">
            <label>消息后缀:</label>
            <input 
              v-model="settings.messageSuffix" 
              placeholder="例如: desu!!"
              class="settings-input"
              @change="saveSettings"
            />
          </div>
          <div class="setting-item">
            <label>变量模式 (房主设置):</label>
            <select v-model="store.variableMode" class="settings-input">
              <option value="none">无变量</option>
              <option value="mvu">MVU变量</option>
              <option value="apotheosis">神化再临</option>
            </select>
            <small class="hint">支持MVU和神化再临表数据同步</small>
          </div>
          <div class="setting-item toggle-item">
            <label class="toggle-label">
              <span>隐藏用户输入内容:</span>
              <input 
                type="checkbox"
                v-model="settings.hideUserInputContent"
                @change="saveSettings"
                class="toggle-checkbox"
              />
              <span class="toggle-switch"></span>
            </label>
            <small class="hint">开启后房主看不到用户输入的具体内容</small>
          </div>
          <div class="setting-item" v-if="store.isHost">
            <label>限时输入 (秒):</label>
            <input 
              type="number"
              v-model.number="settings.timedInputSeconds"
              min="0"
              max="300"
              class="settings-input"
              @change="saveSettings"
              style="width: 80px;"
            />
            <small class="hint">有人提交后N秒自动发送，0为关闭</small>
          </div>
          <div class="setting-item toggle-item">
            <label class="toggle-label">
              <span>发送用户设定:</span>
              <input 
                type="checkbox"
                v-model="settings.sendUserPersona"
                @change="saveSettings"
                class="toggle-checkbox"
              />
              <span class="toggle-switch"></span>
            </label>
            <small class="hint">开启后提交输入时会将酒馆用户设定同步给房主</small>
          </div>
          <div class="setting-item" v-if="settings.sendUserPersona">
            <label>设定前缀:</label>
            <input 
              v-model="settings.personaPrefix" 
              placeholder="例如: [{name}]的设定:"
              class="settings-input"
              @change="saveSettings"
            />
            <small class="hint">使用 {name} 表示用户名</small>
          </div>
          <div class="preview-box">
            <span class="preview-label">预览:</span>
            <span class="preview-text">{{ formatPreview }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMultiplayerStore } from './store';

const store = useMultiplayerStore();

// ============ 面板状态 ============

const panelRef = ref<HTMLElement | null>(null);
const logsRef = ref<HTMLElement | null>(null);
const isMinimized = ref(false);
const isDragging = ref(false);

const position = reactive({ x: 20, y: 20 });
const dragOffset = reactive({ x: 0, y: 0 });

// ============ 表单状态 ============

const localUserName = ref('');
const chatMessage = ref('');
const userInput = ref('');      // 非房主的输入
const hostInput = ref('');      // 房主的输入
const hasSubmitted = ref(false); // 非房主是否已提交
const showSettings = ref(false); // 是否显示设置面板

// ============ 在线模式相关 ============

const selectedRoomId = ref<string | null>(null);
const joinPassword = ref('');
const newRoomName = ref('');
const newRoomPassword = ref('');
const newRoomMaxUsers = ref(8);

import type { OnlineRoom } from './types';

function selectRoom(room: OnlineRoom) {
  selectedRoomId.value = room.id;
  joinPassword.value = '';
}

async function refreshRooms() {
  try {
    await store.fetchOnlineRooms();
  } catch (e) {
    console.error('刷新房间列表失败:', e);
  }
}

async function joinSelectedRoom() {
  if (!selectedRoomId.value) return;
  try {
    if (localUserName.value.trim()) {
      store.userName = localUserName.value.trim();
    }
    await store.joinOnlineRoom(selectedRoomId.value, joinPassword.value || undefined);
  } catch (e) {
    console.error('加入房间失败:', e);
  }
}

async function createRoom() {
  if (!newRoomName.value.trim()) return;
  try {
    if (localUserName.value.trim()) {
      store.userName = localUserName.value.trim();
    }
    await store.createOnlineRoom(
      newRoomName.value.trim(),
      newRoomPassword.value || undefined,
      newRoomMaxUsers.value
    );
  } catch (e) {
    console.error('创建房间失败:', e);
  }
}

// 在线模式开启时自动刷新房间列表
watch(() => store.onlineMode, (isOnline) => {
  if (isOnline) {
    refreshRooms();
  }
}, { immediate: true });

// ============ 设置相关 ============

const SETTINGS_KEY = 'st_multiplayer_settings';

interface Settings {
  defaultUserName: string;
  messagePrefix: string;
  messageSuffix: string;
  hideUserInputContent: boolean;  // 房主是否隐藏用户输入内容
  sendUserPersona: boolean;       // 是否发送用户设定
  personaPrefix: string;          // 用户设定前缀
  timedInputSeconds: number;      // 限时输入秒数（0为关闭）
}

const defaultSettings: Settings = {
  defaultUserName: '',
  messagePrefix: '[{name}]:',
  messageSuffix: '',
  hideUserInputContent: false,
  sendUserPersona: false,
  personaPrefix: '[{name}]的设定:',
  timedInputSeconds: 0,
};

// 从localStorage加载设置
function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return { ...defaultSettings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
  return { ...defaultSettings };
}

const settings = reactive<Settings>(loadSettings());

// 保存设置到localStorage
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('保存设置失败:', e);
  }
}

// 初始化时应用默认用户名
onMounted(() => {
  if (settings.defaultUserName && !localUserName.value) {
    localUserName.value = settings.defaultUserName;
  }
});

// ============ 限时输入定时器 ============

let timedInputTimer: ReturnType<typeof setTimeout> | null = null;
const timedInputCountdown = ref(0);  // 倒计时显示

// 监听pendingInputs变化，启动限时输入定时器
watch(
  () => store.pendingInputs.size,
  (newSize, oldSize) => {
    // 只有房主且开启了限时输入才处理
    if (!store.isHost || settings.timedInputSeconds <= 0) return;
    
    // 有新用户提交时（从0变成>0或数量增加）
    if (newSize > 0 && (oldSize === 0 || newSize > oldSize)) {
      // 取消之前的定时器
      if (timedInputTimer) {
        clearTimeout(timedInputTimer);
        clearInterval(timedInputTimer);
      }
      
      // 开始倒计时
      timedInputCountdown.value = settings.timedInputSeconds;
      
      // 每秒更新倒计时显示
      const countdownInterval = setInterval(() => {
        timedInputCountdown.value--;
        if (timedInputCountdown.value <= 0) {
          clearInterval(countdownInterval);
        }
      }, 1000);
      
      // 设置主定时器
      timedInputTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        timedInputCountdown.value = 0;
        
        // 自动发送
        if (store.isHost && store.pendingInputs.size > 0) {
          store.addLog('system', '系统', '[限时输入] 时间到，自动发送');
          sendCombinedToTavern();
        }
      }, settings.timedInputSeconds * 1000);
      
      store.addLog('system', '系统', `[限时输入] ${settings.timedInputSeconds}秒后自动发送`);
    }
    
    // pendingInputs被清空时取消定时器
    if (newSize === 0 && timedInputTimer) {
      clearTimeout(timedInputTimer);
      timedInputTimer = null;
      timedInputCountdown.value = 0;
    }
  }
);

function toggleSettings() {
  showSettings.value = !showSettings.value;
}

// ============ 计算属性 ============

const statusClass = computed(() => {
  if (store.isConnected) {
    // 已连接，检查稳定性
    return store.isConnectionStable ? 'connected' : 'unstable';
  }
  if (store.mode !== 'disconnected') return 'connecting';
  return 'disconnected';
});

const panelStyle = computed(() => ({
  left: `${position.x}px`,
  top: `${position.y}px`,
}));

const canJoin = computed(() => store.serverIp.trim() !== '' && store.port > 0);

/** 总用户数量（包含房主） */
const totalUserCount = computed(() => {
  return store.users.length;
});

/** 房主是否已提交 */
const hasHostSubmitted = computed(() => {
  return store.pendingInputs.has('host');
});

/** 格式预览 */
const formatPreview = computed(() => {
  const name = settings.defaultUserName || '用户名';
  const prefix = settings.messagePrefix.replace('{name}', name);
  return `${prefix} 消息内容${settings.messageSuffix}`;
});

/** 格式化用户消息（应用自定义前缀后缀） */
function formatUserMessage(userName: string, content: string, messagePrefix?: string, messageSuffix?: string): string {
  // 如果传入了messagePrefix，说明是客户端消息，已经处理过{name}，直接拼接
  // 如果没有传入，说明是房主消息，需要处理{name}
  let prefix: string;
  if (messagePrefix !== undefined) {
    prefix = messagePrefix; // 客户端消息：直接使用（已处理过{name}）
  } else {
    prefix = settings.messagePrefix.replace('{name}', userName); // 房主消息：处理{name}
  }
  const suffix = messageSuffix !== undefined ? messageSuffix : settings.messageSuffix;
  return `${prefix} ${content}${suffix}`;
}

// ============ 方法 ============

function toggleMinimize() {
  isMinimized.value = !isMinimized.value;
}

function handleClose() {
  if (store.isConnected) {
    store.disconnect();
  }
  // 可以在这里添加隐藏面板的逻辑
}

function startDrag(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.icon-btn')) return;
  
  isDragging.value = true;
  const panel = panelRef.value;
  if (!panel) return;
  
  const rect = panel.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  
  // 使用父窗口的document监听事件（因为脚本运行在iframe中）
  const parentDoc = window.parent?.document || document;
  parentDoc.addEventListener('mousemove', onDrag);
  parentDoc.addEventListener('mouseup', stopDrag);
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  
  const newLeft = e.clientX - dragOffset.x;
  const newTop = e.clientY - dragOffset.y;
  
  position.x = Math.max(0, newLeft);
  position.y = Math.max(0, newTop);
}

function stopDrag() {
  isDragging.value = false;
  
  const parentDoc = window.parent?.document || document;
  parentDoc.removeEventListener('mousemove', onDrag);
  parentDoc.removeEventListener('mouseup', stopDrag);
}

// ============ 触摸事件（手机端拖拽） ============

function startTouchDrag(e: TouchEvent) {
  if ((e.target as HTMLElement).closest('.icon-btn')) return;
  
  const touch = e.touches[0];
  if (!touch) return;
  
  isDragging.value = true;
  const panel = panelRef.value;
  if (!panel) return;
  
  const rect = panel.getBoundingClientRect();
  dragOffset.x = touch.clientX - rect.left;
  dragOffset.y = touch.clientY - rect.top;
  
  const parentDoc = window.parent?.document || document;
  parentDoc.addEventListener('touchmove', onTouchDrag, { passive: false });
  parentDoc.addEventListener('touchend', stopTouchDrag);
}

function onTouchDrag(e: TouchEvent) {
  if (!isDragging.value) return;
  e.preventDefault(); // 阻止页面滚动
  
  const touch = e.touches[0];
  if (!touch) return;
  
  const newLeft = touch.clientX - dragOffset.x;
  const newTop = touch.clientY - dragOffset.y;
  
  position.x = Math.max(0, newLeft);
  position.y = Math.max(0, newTop);
}

function stopTouchDrag() {
  isDragging.value = false;
  
  const parentDoc = window.parent?.document || document;
  parentDoc.removeEventListener('touchmove', onTouchDrag);
  parentDoc.removeEventListener('touchend', stopTouchDrag);
}

async function joinRoom() {
  try {
    if (localUserName.value.trim()) {
      store.userName = localUserName.value.trim();
    }
    await store.connectToServer();
  } catch (error) {
    console.error('加入房间失败:', error);
  }
}

function handleDisconnect() {
  store.disconnect();
}

function sendChatMessage() {
  if (!chatMessage.value.trim()) return;
  store.sendChat(chatMessage.value);
  chatMessage.value = '';
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function transferHostTo(userId: string) {
  if (confirm('确定要将房主权限转让给该用户吗？')) {
    store.transferHost(userId);
  }
}

// ============ 输入提交相关 ============

/** 检查用户是否已提交输入 */
function hasUserSubmitted(userId: string): boolean {
  return store.pendingInputs.has(userId);
}

/** 非房主提交输入 */
function submitInput() {
  if (!userInput.value.trim()) return;
  
  // 客户端发送前先处理{name}替换（用自己的用户名）
  const userName = settings.defaultUserName || store.userName || '用户';
  const processedPrefix = settings.messagePrefix.replace('{name}', userName);
  
  // 如果开启了发送用户设定，先获取并发送用户设定
  if (settings.sendUserPersona) {
    const persona = getPersonaDescription();
    if (persona) {
      const personaPrefixProcessed = settings.personaPrefix.replace('{name}', userName);
      store.sendUserPersona(persona, personaPrefixProcessed);
    }
  }
  
  store.sendUserInput(
    userInput.value.trim(),
    processedPrefix,
    settings.messageSuffix
  );
  hasSubmitted.value = true;
  store.addLog('system', '我', `输入已提交`);
}

/** 获取酒馆原生用户设定 */
function getPersonaDescription(): string {
  try {
    // 尝试从顶层窗口获取
    const topWindow = window.top || window.parent || window;
    
    // 方案：从powerUserSettings获取
    const context = (topWindow as any).SillyTavern?.getContext?.();
    if (context?.powerUserSettings?.persona_description) {
      return context.powerUserSettings.persona_description;
    }
    
    // 回退：从DOM获取
    const textarea = topWindow.document.querySelector('#persona_description') as HTMLTextAreaElement;
    if (textarea?.value) {
      return textarea.value;
    }
    
    return '';
  } catch (e) {
    console.warn('[联机Mod] 获取用户设定失败:', e);
    return '';
  }
}

/** 房主提交自己的输入（加入收集） */
function handleRequestInput() {
  if (!hostInput.value.trim()) {
    store.addLog('error', '系统', '请输入内容');
    return;
  }
  
  // 房主提交前要处理{name}替换
  const userName = settings.defaultUserName || store.userName || '房主';
  const processedPrefix = settings.messagePrefix.replace('{name}', userName);
  
  // 房主的输入也加入到pendingInputs中（使用特殊key 'host'）
  store.pendingInputs.set('host', {
    userName: userName,
    content: hostInput.value.trim(),
    messagePrefix: processedPrefix,
    messageSuffix: settings.messageSuffix,
  });
  
  store.addLog('system', '我', '已提交输入');
}

/** 客户端请求同步历史消息 */
function handleSyncHistory() {
  store.requestSyncHistory();
}

/** 客户端请求同步正则 */
function handleSyncRegex() {
  if (confirm('确定要同步房主的正则吗？这将替换你当前的局部正则。')) {
    store.requestSyncRegex();
  }
}

/** 客户端请求同步变量 */
function handleSyncVariables() {
  store.requestSyncVariables();
}

/** 房主重置输入状态 */
function handleResetInput() {
  store.resetInputState();
  hostInput.value = '';
}

/** 房主将合并的输入发送给酒馆AI */
async function sendCombinedToTavern() {
  // 收集所有输入（包含房主的输入，已在pendingInputs中）
  const inputs: string[] = [];
  
  for (const [, data] of store.pendingInputs) {
    // 使用每个用户自己的格式设置
    inputs.push(formatUserMessage(
      data.userName, 
      data.content, 
      data.messagePrefix, 
      data.messageSuffix
    ));
  }
  
  const combinedInput = inputs.join('\n\n');
  
  if (!combinedInput) {
    store.addLog('error', '系统', '没有可发送的输入');
    return;
  }
  
  store.addLog('system', '系统', `正在发送合并输入给AI (${inputs.length}条)...`);
  
  try {
    // 先创建用户消息，显示合并的输入
    await createChatMessages([{
      role: 'user',
      message: combinedInput,
    }]);
    
    // 广播用户消息给所有客户端（让他们也创建同样的用户消息）
    store.broadcastUserMessage(combinedInput);
    
    // 使用triggerSlash触发原生AI回复（流式显示+停止按钮）
    await triggerSlash('/trigger');
    
    store.addLog('ai', 'AI', '已触发AI回复');
    
    // 清空输入
    store.clearPendingInputs();
    hostInput.value = '';
  } catch (error) {
    store.addLog('error', '系统', '发送失败: ' + (error as Error).message);
    console.error('发送失败:', error);
  }
}

// 监听房主变更时重置提交状态
watch(() => store.hostId, () => {
  hasSubmitted.value = false;
  userInput.value = '';
});

// 监听AI回复完成事件，重置提交状态（让非房主可以再次提交）
onMounted(() => {
  eventOn('multiplayer_ai_response', () => {
    hasSubmitted.value = false;
    userInput.value = '';
  });
  
  // 非房主监听请求输入事件
  eventOn('multiplayer_request_input', () => {
    hasSubmitted.value = false;
    userInput.value = '';
  });
  
  // 非房主监听重置输入事件
  eventOn('multiplayer_reset_input', () => {
    hasSubmitted.value = false;
    userInput.value = '';
  });
});

// 房主：当所有用户都提交后自动发送
watch(
  () => store.allUsersSubmitted,
  (allSubmitted) => {
    if (allSubmitted && store.isHost && totalUserCount.value > 0) {
      store.addLog('system', '系统', '所有用户已提交，自动发送中...');
      sendCombinedToTavern();
    }
  }
);

// ============ 监听日志更新自动滚动 ============

watch(
  () => store.chatLogs.length,
  () => {
    nextTick(() => {
      if (logsRef.value) {
        logsRef.value.scrollTop = logsRef.value.scrollHeight;
      }
    });
  }
);
</script>

<style scoped>
.multiplayer-panel {
  position: fixed;
  width: 320px;
  max-height: calc(100vh - 40px);
  background: linear-gradient(135deg, rgba(30, 30, 45, 0.98) 0%, rgba(20, 20, 35, 0.98) 100%);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
  z-index: 99999;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.3s ease;
}

.multiplayer-panel.minimized {
  width: 180px;
  max-height: 44px;
}

.multiplayer-panel.dragging {
  opacity: 0.9;
  cursor: grabbing;
}

/* 标题栏 */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: linear-gradient(90deg, rgba(80, 60, 180, 0.3) 0%, rgba(60, 80, 180, 0.3) 100%);
  cursor: grab;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-weight: 600;
  font-size: 14px;
  color: #fff;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}

.status-dot.connected {
  background: #4ade80;
  box-shadow: 0 0 8px #4ade80;
}

.status-dot.connecting {
  background: #facc15;
  animation: pulse 1s infinite;
}

.status-dot.unstable {
  background: #facc15;
  animation: pulse 0.5s infinite;
}

.status-dot.disconnected {
  background: #666;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.header-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: background 0.2s;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.6);
}

/* 内容区 */
.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 设置区域 */
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setting-row label {
  min-width: 70px;
  color: #a0a0a0;
  font-size: 12px;
}

.input-field {
  flex: 1;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
}

.input-field:focus {
  border-color: rgba(100, 100, 255, 0.5);
  background: rgba(255, 255, 255, 0.12);
}

.input-field.small {
  max-width: 80px;
}

.input-field.tiny {
  max-width: 60px;
}

/* 在线房间列表 */
.online-rooms-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.refresh-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 150px;
  overflow-y: auto;
}

.room-item {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.room-item:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
}

.room-item.selected {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.5);
}

.room-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.room-name {
  font-weight: 500;
  color: #fff;
}

.room-lock {
  font-size: 12px;
}

.room-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #888;
  margin-top: 4px;
}

.empty-rooms {
  padding: 16px;
  text-align: center;
  color: #666;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.join-room-section {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.create-room-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.create-room-options {
  display: flex;
  gap: 8px;
}

.settings-divider {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 8px 0;
}

.checkbox-row {
  gap: 6px;
}

.checkbox-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #6366f1;
}

.checkbox-row label {
  min-width: auto;
  font-size: 12px;
}

.button-group {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.action-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
}

.action-btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #7c7cf5, #9d6ffa);
  transform: translateY(-1px);
}

.action-btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
}

.action-btn.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.action-btn.danger {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.3);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
}

.divider span {
  color: #666;
  font-size: 11px;
}

/* 用户列表 */
.user-list {
  flex-shrink: 0;
}

.section-title {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.user-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  font-size: 12px;
}

.user-item.ready {
  background: rgba(74, 222, 128, 0.15);
}

.user-item.host {
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.user-item.submitted {
  background: rgba(74, 222, 128, 0.15);
}

.user-avatar.avatar-submitted {
  background: linear-gradient(135deg, #22c55e, #16a34a);
}

.user-avatar {
  width: 20px;
  height: 20px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
}

.user-name {
  color: #e0e0e0;
}

.host-crown {
  font-size: 12px;
}

.host-badge {
  font-size: 10px;
  color: #fbbf24;
  margin-left: 8px;
}

.ready-badge {
  color: #4ade80;
  font-size: 10px;
}

.waiting-badge {
  color: #fbbf24;
  font-size: 10px;
  animation: pulse 1s infinite;
}

.all-submitted {
  color: #4ade80;
  font-size: 10px;
  margin-left: 8px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.sync-history-btn {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid rgba(99, 102, 241, 0.5);
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.sync-history-btn:hover {
  background: rgba(99, 102, 241, 0.4);
  border-color: rgba(99, 102, 241, 0.8);
}

.transfer-btn {
  width: 18px;
  height: 18px;
  padding: 0;
  margin-left: auto;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.transfer-btn:hover {
  background: rgba(100, 100, 255, 0.4);
}

/* 聊天日志 */
.chat-logs {
  flex: 1;
  min-height: 80px;
  max-height: 120px;
  overflow-y: auto;
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.chat-logs::-webkit-scrollbar {
  width: 6px;
}

.chat-logs::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.log-item {
  padding: 4px 0;
  line-height: 1.4;
  word-break: break-word;
}

.log-item.system {
  color: #888;
  font-size: 11px;
}

.log-item.chat {
  color: #e0e0e0;
}

.log-item.error {
  color: #f87171;
}

.log-item.ai {
  color: #a78bfa;
}

.log-time {
  color: #555;
  font-size: 10px;
  margin-right: 6px;
}

.log-from {
  font-weight: 500;
  margin-right: 4px;
}

.log-content {
  color: inherit;
}

.empty-logs {
  text-align: center;
  color: #555;
  padding: 20px;
  font-size: 12px;
}

/* 聊天输入 */
.chat-input-area {
  display: flex;
  gap: 8px;
}

.chat-input {
  flex: 1;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.chat-input:focus {
  border-color: rgba(100, 100, 255, 0.5);
}

.send-btn {
  padding: 10px 16px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #7c7cf5, #9d6ffa);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 底部操作栏 */
.action-bar {
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

/* 输入提交区 */
.input-submit-area,
.host-control-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 8px;
}

.input-textarea {
  width: 100%;
  padding: 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  min-height: 60px;
}

.input-textarea:focus {
  border-color: rgba(100, 100, 255, 0.5);
}

.input-textarea::placeholder {
  color: #666;
}

/* 待处理输入列表 */
.pending-inputs {
  max-height: 100px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.pending-input-item {
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.pending-input-item:last-child {
  border-bottom: none;
}

.input-user {
  color: #a78bfa;
  font-weight: 500;
  margin-right: 6px;
}

.input-content {
  color: #ccc;
}

.empty-inputs {
  text-align: center;
  color: #555;
  font-size: 12px;
  padding: 12px;
}

.host-input-area {
  margin-top: 4px;
}

.send-btn.small {
  padding: 8px 12px;
  font-size: 14px;
}

/* 设置弹窗样式 */
.settings-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 60px;
  z-index: 10000;
}

.settings-modal-content {
  background: linear-gradient(135deg, #1e1e2e, #2a2a3e);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  width: 90%;
  max-width: 300px;
  overflow: hidden;
}

.settings-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-weight: 600;
  color: #fff;
}

.settings-modal-body {
  padding: 16px;
  max-height: 60vh;
  overflow-y: auto;
}

.setting-item {
  margin-bottom: 16px;
}

.setting-item label {
  display: block;
  font-size: 12px;
  color: #a0a0a0;
  margin-bottom: 6px;
}

.settings-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 13px;
}

.settings-input:focus {
  outline: none;
  border-color: rgba(99, 102, 241, 0.6);
}

.hint {
  display: block;
  font-size: 10px;
  color: #888;
  margin-top: 4px;
}

.preview-box {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  padding: 10px;
  margin-top: 8px;
}

.preview-label {
  font-size: 11px;
  color: #888;
  margin-right: 8px;
}

.preview-text {
  font-size: 12px;
  color: #4ade80;
}

/* 开关样式 */
.toggle-item {
  margin-bottom: 16px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 12px;
  color: #a0a0a0;
}

.toggle-checkbox {
  display: none;
}

.toggle-switch {
  display: inline-block;
  position: relative;
  width: 40px;
  height: 20px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  transition: background 0.3s;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.3s;
}

.toggle-checkbox:checked + .toggle-switch {
  background: #4ade80;
}

.toggle-checkbox:checked + .toggle-switch::after {
  transform: translateX(20px);
}

/* 隐藏内容样式 */
.hidden-content {
  color: #888;
  font-style: italic;
}
</style>
