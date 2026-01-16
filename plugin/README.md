# SillyTavern 联机Mod

🎮 为 SillyTavern 提供多人联机功能的插件，支持多用户实时协作角色扮演。

## 功能特性

- **房间系统**：创建/加入房间，支持密码保护
- **实时同步**：WebSocket 实时消息同步
- **输入收集**：房主收集所有玩家输入后合并发送给AI
- **流式同步**：AI回复实时流式广播给所有玩家
- **变量同步**：支持 MVU 等变量模式同步
- **历史同步**：新加入玩家可同步历史消息

## 安装方式

### 方式一：一键安装（推荐）

在 SillyTavern 根目录下运行：

```bash
curl -sSL https://raw.githubusercontent.com/yunflour/multi_mod/main/setup.sh | bash
```

Windows (Git Bash):
```bash
curl -sSL https://raw.githubusercontent.com/yunflour/multi_mod/main/setup.sh | bash
```

### 方式二：手动安装

1. 下载本仓库到 `SillyTavern/plugins/multiplayer-mod/` 目录
2. 编辑 `config.yaml`，设置 `enableServerPlugins: true`
3. 运行 `npm install` 安装依赖
4. 重启 SillyTavern

## 使用说明

1. 安装后重启酒馆，WebSocket服务器会自动在端口 **2157** 启动
2. 在酒馆中加载联机Mod前端脚本（dist/联机mod/index.js）
3. 第一个连接的用户自动成为房主

## 文件结构

```
multiplayer-mod/
├── index.js          # 插件入口 + 服务端代码
├── package.json      # 依赖配置
├── setup.sh          # 安装脚本
└── README.md         # 说明文档
```

## 更新服务端代码

如需更新 `server.js` 的逻辑，直接编辑 `plugins/multiplayer-mod/index.js` 文件中的 `SERVER_CODE_START` 和 `SERVER_CODE_END` 之间的代码即可。

## 配置

默认端口：`2157`

如需修改端口，编辑 `index.js` 中的 `DEFAULT_PORT` 常量。

## API 端点

插件提供以下 HTTP API：

- `GET /api/multiplayer/status` - 获取服务器状态

## 许可证

MIT License
