/**
 * SillyTavern 联机Mod 入口文件
 * 
 * 功能：
 * 1. 悬浮窗显示日志和聊天
 * 2. 服务端(S端)主持房间，端口2157
 * 3. 客户端(C端)输入IP加入房间
 * 4. 消息同步：C端发送到S端整合，S端调用AI后同步回复
 */

import MultiplayerPanel from './MultiplayerPanel.vue';
import { useMultiplayerStore } from './store';

// 创建Vue应用
const app = createApp(MultiplayerPanel).use(createPinia());

// 挂载点ID
const CONTAINER_ID = 'st-multiplayer-container';

/** 将样式从iframe/脚本环境传送到主文档head中 */
function teleportStyle() {
  const scriptId = typeof getScriptId === 'function' ? getScriptId() : 'multiplayer-mod';
  if ($(`head > div[script_id="${scriptId}"]`).length > 0) {
    return;
  }
  // 复制当前文档的所有style标签到主文档head
  const $div = $(`<div>`).attr('script_id', scriptId);
  $(`head > style`, document).each(function() {
    $div.append($(this).clone());
  });
  $('head').append($div);
}

/** 移除传送的样式 */
function deteleportStyle() {
  const scriptId = typeof getScriptId === 'function' ? getScriptId() : 'multiplayer-mod';
  $(`head > div[script_id="${scriptId}"]`).remove();
}

/** 设置 ||spoiler|| 遮罩功能 */
function setupSpoilerFeature() {
  // 获取顶层窗口
  const topWindow = window.top || window.parent || window;
  const topDoc = topWindow.document;
  
  // 注入spoiler样式到主文档
  const spoilerStyles = `
    <style id="multiplayer-spoiler-styles">
      .mp-spoiler {
        background-color: #4a4a4a;
        color: transparent;
        cursor: pointer;
        border-radius: 3px;
        padding: 0 4px;
        transition: all 0.2s ease;
        user-select: none;
      }
      .mp-spoiler:hover {
        background-color: #5a5a5a;
      }
      .mp-spoiler.revealed {
        background-color: transparent;
        color: inherit;
        cursor: text;
        user-select: auto;
      }
    </style>
  `;
  
  // 只注入一次到主文档
  if (!topDoc.getElementById('multiplayer-spoiler-styles')) {
    topDoc.head.insertAdjacentHTML('beforeend', spoilerStyles);
  }
  
  // 处理消息中的 ||spoiler|| 语法
  const processSpoilers = (element: HTMLElement) => {
    const walker = topDoc.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent && node.textContent.includes('||')) {
        textNodes.push(node);
      }
    }
    
    textNodes.forEach(textNode => {
      const text = textNode.textContent || '';
      const spoilerRegex = /\|\|(.+?)\|\|/g;
      
      if (spoilerRegex.test(text)) {
        const fragment = topDoc.createDocumentFragment();
        let lastIndex = 0;
        let match;
        
        spoilerRegex.lastIndex = 0;
        while ((match = spoilerRegex.exec(text)) !== null) {
          // 添加匹配前的文本
          if (match.index > lastIndex) {
            fragment.appendChild(topDoc.createTextNode(text.slice(lastIndex, match.index)));
          }
          
          // 创建spoiler元素
          const spoiler = topDoc.createElement('span');
          spoiler.className = 'mp-spoiler';
          spoiler.textContent = match[1];
          spoiler.addEventListener('click', function() {
            this.classList.toggle('revealed');
          });
          fragment.appendChild(spoiler);
          
          lastIndex = match.index + match[0].length;
        }
        
        // 添加剩余文本
        if (lastIndex < text.length) {
          fragment.appendChild(topDoc.createTextNode(text.slice(lastIndex)));
        }
        
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    });
  };
  
  // 监听消息渲染完成事件
  const handleMessageRendered = (message_id: number) => {
    // 延迟处理确保DOM已更新
    setTimeout(() => {
      const messageElement = topDoc.querySelector(`[mesid="${message_id}"] .mes_text`);
      if (messageElement) {
        processSpoilers(messageElement as HTMLElement);
      }
    }, 50);
  };
  
  eventOn(tavern_events.USER_MESSAGE_RENDERED, handleMessageRendered);
  eventOn(tavern_events.CHARACTER_MESSAGE_RENDERED, handleMessageRendered);
  
  // 处理已有消息
  setTimeout(() => {
    topDoc.querySelectorAll('.mes_text').forEach(el => {
      processSpoilers(el as HTMLElement);
    });
  }, 1000);
  
  console.log('[联机Mod] Spoiler遮罩功能已启用');
}

/** 设置酒馆事件监听 */
function setupTavernEventListeners() {
  const store = useMultiplayerStore();
  
  // 跟踪当前流式消息的ID
  let streamingMessageId: number | null = null;

  // 房主监听流式token并广播（流式实时同步）
  eventOn(tavern_events.STREAM_TOKEN_RECEIVED, (text: string) => {
    if (!store.isConnected || !store.isHost) return;
    
    // 广播流式内容给其他用户
    store.broadcastAiStream(text);
  });

  // 监听AI回复事件（房主用于广播完整回复给其他用户）
  eventOn(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
    if (!store.isConnected || !store.isHost) return;
    
    // 获取AI回复的消息
    const messages = getChatMessages(message_id);
    if (messages.length === 0) return;
    
    const message = messages[0];
    
    // 只有assistant角色的消息才是AI回复
    if (message.role !== 'assistant') return;
    
    // 广播完整AI回复（用于流式结束后确认）
    store.broadcastAiResponse(message.message);
    store.addLog('ai', 'AI', `回复已同步: ${message.message.substring(0, 50)}...`);
  });
  
  // 监听AI生成完成事件（房主用于广播MVU变量）
  
  eventOn(tavern_events.GENERATION_ENDED, () => {
    if (!store.isConnected || !store.isHost) return;
    
    // 只在MVU模式下同步变量
    if (store.variableMode !== 'mvu') return;
    
    // 延迟一点确保MVU变量已更新
    setTimeout(() => {
      // 使用getLastMessageId获取正确的消息ID，避免事件参数越界
      const message_id = getLastMessageId();
      if (message_id < 0) return;
      
      const variables = getVariables({ type: 'message', message_id });
      if (variables && variables.stat_data) {
        // 调试日志：打印要同步的MVU数据
        console.log('[联机MOD] AI生成完毕，准备同步MVU变量 (message_id:', message_id, ')');
        console.log('[联机MOD] stat_data:', JSON.stringify(variables.stat_data, null, 2));
        console.log('[联机MOD] display_data:', variables.display_data);
        console.log('[联机MOD] delta_data:', variables.delta_data);
        console.log('[联机MOD] schema:', variables.schema ? '有' : '无');
        
        store.broadcastVariables('mvu', {
          stat_data: variables.stat_data,
          display_data: variables.display_data,
          delta_data: variables.delta_data,
          schema: variables.schema,
        });
      } else {
        console.log('[联机MOD] 没有找到MVU变量，跳过同步 (message_id:', message_id, ')');
        console.log('[联机MOD] variables:', variables);
      }
    }, 500);
  });

  // 房主：监听AI生成前事件，注入联机用户的设定（与原生persona同层）
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, () => {
    if (!store.isConnected || !store.isHost) return;
    if (store.pendingPersonas.size === 0) return;
    
    try {
      // 获取原生persona的深度信息
      const preset = getPreset('in_use');
      const personaPrompt = preset.prompts.find((p: { id: string }) => p.id === 'personaDescription');
      
      let targetDepth = 9999; // 默认使用大深度，确保在聊天开头
      
      if (personaPrompt?.position?.type === 'in_chat' && typeof personaPrompt.position.depth === 'number') {
        targetDepth = personaPrompt.position.depth;
        console.log('[联机Mod] personaDescription使用in_chat类型, depth:', targetDepth);
      } else {
        console.log('[联机Mod] personaDescription使用relative类型或未找到，使用默认大深度:', targetDepth);
      }
      
      // 构建拼接后的用户设定
      const allPersonas: string[] = [];
      
      for (const [, persona] of store.pendingPersonas) {
        const formatted = `${persona.prefix} ${persona.content}`;
        allPersonas.push(formatted);
      }
      
      const combinedPersona = allPersonas.join('\n\n');
      
      // 注入为系统提示词
      injectPrompts([{
        id: 'multiplayer_combined_persona',
        position: 'in_chat',
        depth: targetDepth,
        role: 'system',
        content: `${combinedPersona}`
      }], { once: true });
      
      console.log('[联机Mod] 已注入联机玩家设定, depth:', targetDepth, '玩家数:', store.pendingPersonas.size);
      
      // 清空已注入的用户设定（每次生成都需要重新发送）
      store.pendingPersonas.clear();
    } catch (e) {
      console.error('[联机Mod] 注入用户设定失败:', e);
    }
  });

  // 房主删除消息时广播给客户端
  let lastKnownMessageId = getLastMessageId();
  eventOn(tavern_events.MESSAGE_DELETED, (message_id: number) => {
    if (!store.isConnected || !store.isHost) return;
    
    // 只有删除的是最新消息时才广播
    if (message_id === lastKnownMessageId) {
      store.broadcastDeleteLastMessage();
    }
    // 更新已知的最新消息ID
    lastKnownMessageId = getLastMessageId();
  });

  // 监听新消息更新lastKnownMessageId
  eventOn(tavern_events.MESSAGE_SENT, () => {
    lastKnownMessageId = getLastMessageId();
  });
  eventOn(tavern_events.MESSAGE_RECEIVED, () => {
    lastKnownMessageId = getLastMessageId();
  });

  // 非房主：监听删除最新消息同步
  eventOn('multiplayer_delete_last_message', async () => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      const lastId = getLastMessageId();
      if (lastId >= 0) {
        await deleteChatMessages([lastId]);
        store.addLog('system', '系统', '最新消息已同步删除');
      }
    } catch (error) {
      store.addLog('error', '系统', '删除消息失败');
      console.error('删除消息失败:', error);
    }
  });

  // 非房主：监听流式事件实时更新显示
  eventOn('multiplayer_ai_stream', async (content: string) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      // 如果还没有创建流式消息，先创建一个
      if (streamingMessageId === null) {
        await createChatMessages([{
          role: 'assistant',
          message: content,
        }]);
        // 获取刚创建的消息ID
        streamingMessageId = getLastMessageId();
      } else {
        // 更新现有消息的内容
        await setChatMessages([{
          message_id: streamingMessageId,
          message: content,
        }]);
      }
    } catch (error) {
      console.error('流式更新失败:', error);
    }
  });

  // 非房主：监听完整AI回复（流式结束）
  eventOn('multiplayer_ai_response', async (content: string) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      // MVU模式：添加StatusPlaceHolderImpl（模拟MVU脚本行为）
      let finalContent = content;
      if (store.variableMode === 'mvu') {
        if (!content.includes('<StatusPlaceHolderImpl/>')) {
          finalContent = content + '\n\n<StatusPlaceHolderImpl/>';
        }
      }
      
      if (streamingMessageId !== null) {
        // 更新最终内容
        await setChatMessages([{
          message_id: streamingMessageId,
          message: finalContent,
        }]);
        streamingMessageId = null; // 重置
      } else {
        // 没有流式消息，直接创建完整消息
        await createChatMessages([{
          role: 'assistant',
          message: finalContent,
        }]);
      }
      store.addLog('system', '系统', 'AI回复已同步到本地');
    } catch (error) {
      store.addLog('error', '系统', '同步AI回复失败');
      console.error('同步AI回复失败:', error);
    }
  });

  // 房主：收到历史同步请求
  eventOn('multiplayer_sync_history_request', async (requesterId: string) => {
    const store = useMultiplayerStore();
    if (!store.isHost) return;
    
    try {
      // 获取所有聊天消息
      const lastId = getLastMessageId();
      if (lastId < 0) {
        store.addLog('system', '系统', '没有历史消息可同步');
        return;
      }
      
      const messages = getChatMessages(`0-${lastId}`);
      const historyData = messages.map((msg: { role: string; message: string }) => ({
        role: msg.role,
        message: msg.message,
      }));
      
      // 发送给请求者
      store.sendHistoryToUser(requesterId, historyData);
    } catch (error) {
      store.addLog('error', '系统', '获取历史消息失败');
      console.error('获取历史消息失败:', error);
    }
  });

  // 非房主：收到历史消息数据
  eventOn('multiplayer_sync_history_data', async (data: { role?: string; message?: string; complete?: boolean; count?: number }) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      if (data.complete) {
        store.addLog('system', '系统', `历史同步完成，共${data.count}条消息`);
      } else if (data.role && data.message) {
        // 创建历史消息
        await createChatMessages([{
          role: data.role as 'user' | 'assistant' | 'system',
          message: data.message,
        }]);
      }
    } catch (error) {
      store.addLog('error', '系统', '创建历史消息失败');
      console.error('创建历史消息失败:', error);
    }
  });

  // 非房主：收到用户消息同步
  eventOn('multiplayer_user_message', async (content: string) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      await createChatMessages([{
        role: 'user',
        message: content,
      }]);
      store.addLog('system', '系统', '用户消息已同步');
    } catch (error) {
      store.addLog('error', '系统', '创建用户消息失败');
      console.error('创建用户消息失败:', error);
    }
  });

  // 房主：收到正则同步请求
  eventOn('multiplayer_sync_regex_request', (requestingUserId: string) => {
    const store = useMultiplayerStore();
    if (!store.isHost) return;
    
    try {
      // 获取局部正则
      const regexes = getTavernRegexes({ scope: 'character' });
      store.sendRegexToUser(requestingUserId, regexes);
    } catch (error) {
      store.addLog('error', '系统', '获取正则失败');
      console.error('获取正则失败:', error);
    }
  });

  // 非房主：收到正则数据
  eventOn('multiplayer_sync_regex_data', async (data: any) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      const { regexes } = data;
      if (regexes && Array.isArray(regexes)) {
        await replaceTavernRegexes(regexes, { scope: 'character' });
        store.addLog('system', '系统', `正则同步完成，共${regexes.length}条`);
      }
    } catch (error) {
      store.addLog('error', '系统', '替换正则失败');
      console.error('替换正则失败:', error);
    }
  });

  // 房主：收到变量同步请求
  eventOn('multiplayer_sync_variables_request', async (data: { userId: string; variableMode: string }) => {
    const store = useMultiplayerStore();
    if (!store.isHost) return;
    
    const { userId, variableMode } = data;
    
    try {
      if (variableMode === 'mvu') {
        // 获取MVU变量
        const lastId = getLastMessageId();
        if (lastId < 0) {
          store.addLog('error', '系统', '[MVU] 无法获取消息ID');
          return;
        }
        
        const vars = await getVariables({ type: 'message', message_id: lastId });
        if (!vars || (!vars.stat_data && !vars.display_data && !vars.delta_data)) {
          // 发送错误消息给客户端
          store.sendVariablesToUser(userId, 'mvu', { error: '无MVU变量' });
          return;
        }
        
        // 发送变量给客户端
        store.sendVariablesToUser(userId, 'mvu', {
          stat_data: vars.stat_data,
          display_data: vars.display_data,
          delta_data: vars.delta_data,
          schema: vars.schema,
        });
      } else if (variableMode === 'apotheosis') {
        // 神化再临变量：直接读取并发送
        const topWindow: any = window.top || window.parent || window;
        const context = topWindow.SillyTavern?.getContext?.();
        const chat = context?.chat;
        
        if (!chat || chat.length === 0) {
          store.sendVariablesToUser(userId, 'apotheosis', { error: '无神化再临变量' });
          return;
        }
        
        // 采用与神化再临插件相同的合并策略：从所有消息中收集完整的表格数据
        const mergedTables: Record<string, any> = {};
        const foundSheets: Record<string, boolean> = {};
        let isolationKey = '';
        let targetMessageId: number | undefined;
        
        // 先确定当前的隔离标签（从最新消息开始找）
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          if (msg.TavernDB_ACU_IsolatedData) {
            const keys = Object.keys(msg.TavernDB_ACU_IsolatedData);
            if (keys.length > 0) {
              isolationKey = keys[0];
              break;
            }
          }
          if (msg.TavernDB_ACU_Identity !== undefined) {
            isolationKey = msg.TavernDB_ACU_Identity || '';
            break;
          }
        }
        
        console.log('[联机Mod] 同步变量使用隔离标签:', isolationKey || '(无标签)');
        
        // 从所有消息中收集表格数据
        for (let i = chat.length - 1; i >= 0; i--) {
          const msg = chat[i];
          
          // 新版格式：TavernDB_ACU_IsolatedData
          if (msg.TavernDB_ACU_IsolatedData) {
            // 获取匹配当前隔离标签的数据
            const tagData = msg.TavernDB_ACU_IsolatedData[isolationKey];
            if (tagData && tagData.independentData) {
              Object.keys(tagData.independentData).forEach((sheetKey: string) => {
                if (!foundSheets[sheetKey]) {
                  mergedTables[sheetKey] = JSON.parse(JSON.stringify(tagData.independentData[sheetKey]));
                  foundSheets[sheetKey] = true;
                  if (!targetMessageId) targetMessageId = msg.id;
                }
              });
            }
          }
          
          // 旧版格式：TavernDB_ACU_IndependentData（严格匹配隔离标签）
          if (msg.TavernDB_ACU_IndependentData) {
            const msgIdentity = msg.TavernDB_ACU_Identity || '';
            // 匹配隔离标签
            if (msgIdentity === isolationKey) {
              Object.keys(msg.TavernDB_ACU_IndependentData).forEach((sheetKey: string) => {
                if (!foundSheets[sheetKey]) {
                  mergedTables[sheetKey] = JSON.parse(JSON.stringify(msg.TavernDB_ACU_IndependentData[sheetKey]));
                  foundSheets[sheetKey] = true;
                  if (!targetMessageId) targetMessageId = msg.id;
                }
              });
            }
          }
        }
        
        console.log('[联机Mod] 合并后表格数量:', Object.keys(mergedTables).length, '表名:', Object.keys(mergedTables));
        
        if (Object.keys(mergedTables).length === 0) {
          store.sendVariablesToUser(userId, 'apotheosis', { error: '无神化再临变量' });
          return;
        }
        
        // 发送神化再临全量同步
        store.broadcastACUFullSync(isolationKey, mergedTables, targetMessageId);
        store.addLog('system', '系统', `[神化再临] 已发送全量同步 (${Object.keys(mergedTables).length} 表)`);
      } else {
        store.addLog('error', '系统', `未知变量模式: ${variableMode}`);
        store.sendVariablesToUser(userId, 'unknown', { error: `未知变量模式: ${variableMode}` });
      }
    } catch (error) {
      store.addLog('error', '系统', `变量同步失败: ${error}`);
      console.error('变量同步失败:', error);
    }
  });

  // 非房主：监听变量同步事件
  eventOn('multiplayer_sync_variables', async (data: { variableType: string; content: any }) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    const { variableType, content } = data;
    
    try {
      // 检查是否是错误消息
      if (content.error) {
        store.addLog('system', '系统', `[${variableType}] ${content.error}`);
        return;
      }
      
      // 根据变量类型处理（可复用架构）
      switch (variableType) {
        case 'mvu':
          // MVU变量：更新到最新消息
          const lastId = getLastMessageId();
          if (lastId >= 0 && content) {
            await updateVariablesWith((vars) => {
              if (content.stat_data) vars.stat_data = content.stat_data;
              if (content.display_data) vars.display_data = content.display_data;
              if (content.delta_data) vars.delta_data = content.delta_data;
              if (content.schema) vars.schema = content.schema;
              return vars;
            }, { type: 'message', message_id: lastId });
            store.addLog('system', '系统', '[MVU] 变量同步完成');
          }
          break;
          
        // 其他变量类型可在此扩展
        default:
          console.log(`未知变量类型: ${variableType}`);
      }
    } catch (error) {
      store.addLog('error', '系统', `变量同步失败: ${error}`);
      console.error('变量同步失败:', error);
    }
  });

  // ============ 神化再临同步 ============
  
  // 神化再临同步相关常量
  const ACU_RETRY_MAX = 20;           // 最大重试次数
  const ACU_RETRY_INTERVAL = 3000;    // 重试间隔（毫秒）
  const ACU_DEBOUNCE_MS = 3000;       // 防抖延迟（毫秒）
  const ACU_INIT_DELAY = 2000;        // 初始化延迟（毫秒）
  
  /** 获取顶层窗口（用于访问SillyTavern和神化再临API） */
  const getTopWindow = (): any => {
    try {
      return window.top || window.parent || window;
    } catch (e) {
      return window;
    }
  };
  
  // 房主：注册神化再临更新回调，检测到更新后广播给客户端
  const registerACUCallback = () => {
    const topWindow = getTopWindow();
    
    // 检查神化再临API是否可用
    if (!topWindow.AutoCardUpdaterAPI || !topWindow.AutoCardUpdaterAPI.registerTableUpdateCallback) {
      // 神化再临插件未加载，延迟重试
      const retryCount = (registerACUCallback as any).retryCount || 0;
      if (retryCount < ACU_RETRY_MAX) {
        (registerACUCallback as any).retryCount = retryCount + 1;
        console.log(`[联机Mod] 等待神化再临插件加载... (${retryCount + 1}/${ACU_RETRY_MAX})`);
        setTimeout(registerACUCallback, ACU_RETRY_INTERVAL);
      } else {
        console.log('[联机Mod] 神化再临插件未找到，跳过回调注册');
      }
      return;
    }
    
    // 使用官方API注册回调
    // 防抖变量
    let acuSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    
    const acuSyncCallback = (_tableData: any) => {
      // 检查是否需要同步（房主且神化再临模式）
      const store = useMultiplayerStore();
      if (!store.isConnected || !store.isHost || store.variableMode !== 'apotheosis') {
        return;
      }
      
      if (acuSyncDebounceTimer) {
        clearTimeout(acuSyncDebounceTimer);
      }
      
      acuSyncDebounceTimer = setTimeout(() => {
        acuSyncDebounceTimer = null;
        console.log('[联机Mod] 神化再临表格更新，触发同步');
        
        try {
          const acuData = getACUTableData();
          if (acuData) {
            console.log('[联机Mod] 读取到ACU数据:', {
              isolationKey: acuData.isolationKey,
              tableCount: Object.keys(acuData.tables).length,
              modifiedKeys: acuData.modifiedKeys
            });
            
            // 判断是全量还是增量同步
            if (!store.acuSyncState.fullSynced) {
              // 首次：全量同步
              store.broadcastACUFullSync(acuData.isolationKey, acuData.tables, acuData.targetMessageId);
              store.acuSyncState.fullSynced = true;  // 标记已完成全量同步
              console.log('[联机Mod] 已发送ACU全量同步');
            } else {
              // 后续：增量同步（只发送修改的表格）
              const modifiedTables: Record<string, any> = {};
              for (const key of acuData.modifiedKeys) {
                if (acuData.tables[key] !== undefined) {
                  modifiedTables[key] = acuData.tables[key];
                }
              }
              store.broadcastACUDeltaSync(acuData.isolationKey, modifiedTables, acuData.modifiedKeys, acuData.targetMessageId);
              console.log('[联机Mod] 已发送ACU增量同步');
            }
          } else {
            console.log('[联机Mod] 未能读取到ACU数据');
          }
        } catch (error) {
          console.error('[联机Mod] 神化再临同步失败:', error);
        }
      }, ACU_DEBOUNCE_MS);
    };
    
    // 注册回调
    topWindow.AutoCardUpdaterAPI.registerTableUpdateCallback(acuSyncCallback);
    console.log('[联机Mod] 已注册神化再临表格更新回调');
  };
  
  // 从聊天记录读取神化再临表格数据（采用完整合并策略）
  const getACUTableData = (): { isolationKey: string; tables: Record<string, any>; modifiedKeys: string[]; targetMessageId?: number } | null => {
    const topWindow = getTopWindow();
    
    const context = topWindow.SillyTavern?.getContext?.();
    const chat = context?.chat;
    if (!chat || chat.length === 0) {
      console.log('[联机Mod] getACUTableData: 无法获取chat数据');
      return null;
    }
    
    // 采用与神化再临插件相同的合并策略：从所有消息中收集完整的表格数据
    const mergedTables: Record<string, any> = {};
    const foundSheets: Record<string, boolean> = {};
    let isolationKey = '';
    let targetMessageId: number | undefined;
    let modifiedKeys: string[] = [];
    
    // 先确定当前的隔离标签（从最新消息开始找）
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i];
      if (msg.TavernDB_ACU_IsolatedData) {
        const keys = Object.keys(msg.TavernDB_ACU_IsolatedData);
        if (keys.length > 0) {
          isolationKey = keys[0];
          // 获取最新消息的modifiedKeys
          const tagData = msg.TavernDB_ACU_IsolatedData[isolationKey];
          if (tagData && tagData.modifiedKeys) {
            modifiedKeys = tagData.modifiedKeys;
          }
          break;
        }
      }
      if (msg.TavernDB_ACU_Identity !== undefined) {
        isolationKey = msg.TavernDB_ACU_Identity || '';
        if (msg.TavernDB_ACU_ModifiedKeys) {
          modifiedKeys = msg.TavernDB_ACU_ModifiedKeys;
        }
        break;
      }
    }
    
    // 从所有消息中收集表格数据
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i];
      
      // 新版格式：TavernDB_ACU_IsolatedData
      if (msg.TavernDB_ACU_IsolatedData) {
        const tagData = msg.TavernDB_ACU_IsolatedData[isolationKey];
        if (tagData && tagData.independentData) {
          Object.keys(tagData.independentData).forEach((sheetKey: string) => {
            if (!foundSheets[sheetKey]) {
              mergedTables[sheetKey] = JSON.parse(JSON.stringify(tagData.independentData[sheetKey]));
              foundSheets[sheetKey] = true;
              if (!targetMessageId) targetMessageId = msg.id;
            }
          });
        }
      }
      
      // 旧版格式：TavernDB_ACU_IndependentData（严格匹配隔离标签）
      if (msg.TavernDB_ACU_IndependentData) {
        const msgIdentity = msg.TavernDB_ACU_Identity || '';
        if (msgIdentity === isolationKey) {
          Object.keys(msg.TavernDB_ACU_IndependentData).forEach((sheetKey: string) => {
            if (!foundSheets[sheetKey]) {
              mergedTables[sheetKey] = JSON.parse(JSON.stringify(msg.TavernDB_ACU_IndependentData[sheetKey]));
              foundSheets[sheetKey] = true;
              if (!targetMessageId) targetMessageId = msg.id;
            }
          });
        }
      }
    }
    
    if (Object.keys(mergedTables).length === 0) {
      return null;
    }
    
    return {
      isolationKey,
      tables: mergedTables,
      modifiedKeys,
      targetMessageId,
    };
  };
  
  // 延迟注册回调（等待神化再临插件加载）
  setTimeout(registerACUCallback, ACU_INIT_DELAY);

  // 非房主：收到神化再临全量同步
  eventOn('multiplayer_acu_full_sync', async (data: { isolationKey: string; tables: Record<string, any>; targetMessageId?: number }) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      await applyACUData(data, true);
      store.addLog('system', '系统', '[神化再临] 全量同步完成');
    } catch (error) {
      store.addLog('error', '系统', `[神化再临] 同步失败: ${error}`);
      console.error('[联机Mod] 神化再临全量同步失败:', error);
    }
  });

  // 非房主：收到神化再临增量同步
  eventOn('multiplayer_acu_delta_sync', async (data: { isolationKey: string; tables: Record<string, any>; modifiedKeys: string[]; targetMessageId?: number }) => {
    const store = useMultiplayerStore();
    if (store.isHost) return;
    
    try {
      await applyACUData(data, false);
      store.addLog('system', '系统', '[神化再临] 增量同步完成');
    } catch (error) {
      store.addLog('error', '系统', `[神化再临] 同步失败: ${error}`);
      console.error('[联机Mod] 神化再临增量同步失败:', error);
    }
  });

  // 将接收到的神化再临数据写入本地消息
  const applyACUData = async (data: { isolationKey: string; tables: Record<string, any>; modifiedKeys?: string[]; targetMessageId?: number }, isFullSync: boolean) => {
    const topWindow = getTopWindow();
    
    // 使用神化再临的官方API导入数据
    if (topWindow.AutoCardUpdaterAPI?.importTableAsJson) {
      try {
        // 构建神化再临期望的数据格式
        const importData: Record<string, any> = {
          mate: { type: 'chatSheets', version: 1 }
        };
        
        // 复制所有表格数据
        Object.keys(data.tables).forEach(key => {
          if (key.startsWith('sheet_')) {
            importData[key] = JSON.parse(JSON.stringify(data.tables[key]));
          }
        });
        
        console.log('[联机Mod] 使用 importTableAsJson 导入数据:', {
          tableCount: Object.keys(importData).filter(k => k.startsWith('sheet_')).length,
          isFullSync
        });
        
        // 调用官方API导入
        const success = await topWindow.AutoCardUpdaterAPI.importTableAsJson(JSON.stringify(importData));
        
        if (success) {
          console.log('[联机Mod] 神化再临数据导入成功');
        } else {
          console.warn('[联机Mod] 神化再临数据导入失败');
        }
      } catch (e) {
        console.error('[联机Mod] 调用 importTableAsJson 失败:', e);
      }
    } else {
      // 回退方案：手动写入并刷新
      console.log('[联机Mod] importTableAsJson 不可用，使用手动写入');
      
      const context = topWindow.SillyTavern?.getContext?.();
      const chat = context?.chat;
      if (!chat || chat.length === 0) {
        console.log('[联机Mod] applyACUData: 无法获取chat数据');
        return;
      }
      
      // 找到目标AI消息（使用最后一条AI消息）
      let targetIndex = -1;
      for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) {
          targetIndex = i;
          break;
        }
      }
      
      if (targetIndex === -1) {
        console.warn('[联机Mod] 没有AI消息，无法写入神化再临数据');
        return;
      }
      
      const msg = chat[targetIndex];
      
      // 初始化数据结构
      if (!msg.TavernDB_ACU_IsolatedData) {
        msg.TavernDB_ACU_IsolatedData = {};
      }
      
      if (!msg.TavernDB_ACU_IsolatedData[data.isolationKey]) {
        msg.TavernDB_ACU_IsolatedData[data.isolationKey] = {
          independentData: {},
          modifiedKeys: [],
          updateGroupKeys: []
        };
      }
      
      const tagData = msg.TavernDB_ACU_IsolatedData[data.isolationKey];
      
      if (isFullSync) {
        // 全量同步：完全替换
        tagData.independentData = data.tables;
        tagData.modifiedKeys = Object.keys(data.tables);
      } else {
        // 增量同步：合并数据
        Object.assign(tagData.independentData, data.tables);
        // 更新modifiedKeys（合并）
        if (data.modifiedKeys) {
          data.modifiedKeys.forEach(key => {
            if (!tagData.modifiedKeys.includes(key)) {
              tagData.modifiedKeys.push(key);
            }
          });
        }
      }
      
      // 持久化到服务器：调用SillyTavern的saveChat
      try {
        const contextForSave = topWindow.SillyTavern?.getContext?.();
        if (contextForSave?.saveChat) {
          await contextForSave.saveChat();
          console.log('[联机Mod] 神化再临数据已持久化');
        }
      } catch (e) {
        console.warn('[联机Mod] 持久化神化再临数据失败:', e);
      }
      
      // 触发神化再临刷新（如果可用）
      if (topWindow.AutoCardUpdaterAPI?.refreshMergedDataAndNotify) {
        try {
          await topWindow.AutoCardUpdaterAPI.refreshMergedDataAndNotify();
        } catch (e) {
          console.warn('[联机Mod] 触发神化再临刷新失败:', e);
        }
      }
    }
  };
}

/** 初始化脚本 */
$(() => {
  // 创建挂载容器
  const $container = $(`<div id="${CONTAINER_ID}">`);
  $('body').append($container);
  
  // 传送样式到主文档head
  teleportStyle();
  
  // 挂载Vue应用
  app.mount($container[0]);
  
  // 设置酒馆事件监听
  setupTavernEventListeners();
  
  // 设置Spoiler遮罩功能
  setupSpoilerFeature();
  
  // 提示加载成功
  toastr.success('联机mod已加载！配置悬浮窗开始使用。', '联机');
});

/** 卸载脚本 */
$(window).on('unload', () => {
  // 断开连接
  const store = useMultiplayerStore();
  if (store.isConnected) {
    store.disconnect();
  }
  
  // 卸载Vue应用
  app.unmount();
  
  // 移除传送的样式
  deteleportStyle();
  
  // 移除容器
  $(`#${CONTAINER_ID}`).remove();
});

