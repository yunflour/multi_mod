# SillyTavern 联机Mod

一个用于 SillyTavern 的多人联机模块，支持真正的跨网络联机功能。

## 功能特性

- 🌐 **跨网络联机** - 支持多用户通过 WebSocket 连接到同一服务器
- 👑 **房主系统** - 第一个加入的用户成为房主，负责AI回复的广播
- 💬 **实时聊天** - 支持用户之间的实时消息交流
- 🔒 **密码保护** - 可选的房间密码保护功能
- 🔄 **状态同步** - 自动同步用户列表和准备状态
- 🎯 **房主转让** - 支持房主权限的主动转让

## 项目结构

```
联机mod/
├── server.js          # WebSocket 服务端主程序
├── build.js           # 构建脚本
├── setup.sh           # 安装脚本
├── index.ts           # 插件入口
├── network.ts         # 网络通信模块
├── store.ts           # 状态管理
├── types.ts           # TypeScript 类型定义
├── MultiplayerPanel.vue   # 联机面板 Vue 组件
└── dist/              # 构建输出目录
```

## 快速开始

### 独立服务器模式

1. 确保已安装 Node.js
2. 运行服务器：

```bash
# 使用默认端口 2157，无密码
node server.js

# 指定端口
node server.js 2158

# 指定端口和密码
node server.js 2157 mypassword
```

### 作为 SillyTavern 插件

使用提供的安装脚本：

```bash
./setup.sh
```

## 消息类型

服务器支持以下消息类型：

| 类型 | 描述 |
|------|------|
| `join` | 用户加入房间 |
| `leave` | 用户离开房间 |
| `chat` | 聊天消息 |
| `user_input` | 用户输入（发送给AI） |
| `ready` | 准备状态变更 |
| `ai_response` | AI回复（仅房主可发送） |
| `transfer_host` | 房主权限转让 |
| `sync_state` | 状态同步 |
| `host_change` | 房主变更通知 |

## 配置选项

| 参数 | 默认值 | 描述 |
|------|--------|------|
| 端口 | 2157 | WebSocket 服务器端口 |
| 密码 | (空) | 可选的房间密码 |

## 开发

### 构建

```bash
node build.js
```

### 依赖

- Node.js >= 14
- ws (WebSocket 库)

## 协议

本项目采用 [MIT License](./LICENSE) 开源协议。

## 贡献

欢迎提交 Issue 和 Pull Request！
