#!/bin/bash

# ==========================================
# SillyTavern 联机Mod 一键安装脚本
# ==========================================

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# 定义仓库地址
REPO_URL="https://github.com/yunflour/multi_mod.git"

# 定义插件路径
PLUGIN_DIR_NAME="multiplayer-mod"
SERVER_PATH="plugins/$PLUGIN_DIR_NAME"

# ------------------------------------------
# 工具函数
# ------------------------------------------

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Git 是否安装
check_git() {
    if ! command -v git &> /dev/null; then
        log_error "未检测到 Git！请先安装 Git 后再运行此脚本。"
        echo "Windows用户请下载: https://git-scm.com/download/win"
        exit 1
    fi
}

# ------------------------------------------
# 目录定位逻辑
# ------------------------------------------

find_root_dir() {
    log_info "正在检测酒馆根目录..."

    if [[ -f "config.yaml" && -d "plugins" ]]; then
        log_success "当前即为酒馆根目录。"
        return 0
    fi

    if [[ -f "../config.yaml" && -d "../plugins" ]]; then
        cd ..
        log_success "在上一级找到酒馆根目录，已切换。"
        return 0
    fi

    log_info "当前目录未找到，正在扫描子目录..."
    TARGET_ROOT=$(find . -maxdepth 2 -name "config.yaml" -type f -print -quit | xargs dirname 2>/dev/null)

    if [[ -n "$TARGET_ROOT" && -d "$TARGET_ROOT/plugins" ]]; then
        cd "$TARGET_ROOT"
        log_success "在子目录 [$(pwd)] 找到酒馆根目录，已切换。"
        return 0
    fi

    log_error "未找到酒馆根目录（必须包含 config.yaml 和 plugins 文件夹）。"
    log_error "请将此脚本放在 SillyTavern 的根目录或其子文件夹内运行。"
    return 1
}

# ------------------------------------------
# 核心功能
# ------------------------------------------

enable_server_plugins() {
    if [ ! -f "config.yaml" ]; then
        log_error "config.yaml 文件不存在！"
        return
    fi

    log_info "正在检查 config.yaml 设置..."
    
    if grep -q "enableServerPlugins: true" config.yaml; then
        log_success "Server Plugins 已经开启，跳过修改。"
    else
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' 's/enableServerPlugins: false/enableServerPlugins: true/g' config.yaml
        else
            sed -i 's/enableServerPlugins: false/enableServerPlugins: true/g' config.yaml
        fi
        
        if grep -q "enableServerPlugins: true" config.yaml; then
            log_success "config.yaml 修改成功：已开启 Server Plugins。"
        else
            log_warn "config.yaml 修改失败，请手动将 enableServerPlugins 设为 true。"
        fi
    fi
}

install_plugin() {
    echo -e "\n------------------------------------------"
    echo -e "${MAGENTA}    🎮 联机Mod 服务端插件安装${NC}"
    echo -e "------------------------------------------\n"
    
    enable_server_plugins

    echo -e "\n>>> 安装联机Mod服务端插件..."
    
    if [ ! -d "plugins" ]; then
        log_error "plugins 目录不存在！这是正常的酒馆目录吗？"
        return 1
    fi
    
    if [ -d "$SERVER_PATH" ]; then
        log_warn "发现已安装的联机Mod插件，正在更新..."
        rm -rf "$SERVER_PATH"
    fi
    
    # 创建临时目录用于克隆
    TEMP_DIR=$(mktemp -d)
    log_info "正在从 GitHub 下载联机Mod..."
    
    if git clone "$REPO_URL" "$TEMP_DIR/repo"; then
        log_success "联机Mod 源码下载成功。"
        
        cd "$TEMP_DIR/repo"
        
        # 检查是否有 build.js（新版构建系统）
        if [ -f "build.js" ]; then
            log_info "检测到构建系统，正在生成插件版本..."
            
            # 安装构建依赖
            if [ -f "package.json" ] && command -v npm &> /dev/null; then
                npm install --production 2>/dev/null
            fi
            
            # 运行构建脚本
            if command -v node &> /dev/null; then
                node build.js
                if [ $? -eq 0 ]; then
                    log_success "构建完成。"
                else
                    log_error "构建失败！"
                    rm -rf "$TEMP_DIR"
                    return 1
                fi
            else
                log_error "未检测到 Node.js！请先安装 Node.js。"
                rm -rf "$TEMP_DIR"
                return 1
            fi
            
            # 复制生成的插件版本到酒馆
            if [ -d "dist/plugin" ]; then
                log_info "正在安装插件..."
                mkdir -p "$OLDPWD/plugins/$PLUGIN_DIR_NAME"
                cp -r dist/plugin/* "$OLDPWD/plugins/$PLUGIN_DIR_NAME/"
                log_success "插件安装完成。"
            else
                log_error "未找到生成的插件文件！"
                rm -rf "$TEMP_DIR"
                return 1
            fi
        # 兼容旧版结构（有 plugin 文件夹）
        elif [ -d "plugin" ]; then
            log_info "检测到旧版结构，正在配置..."
            mkdir -p "$OLDPWD/plugins/$PLUGIN_DIR_NAME"
            cp -r plugin/* "$OLDPWD/plugins/$PLUGIN_DIR_NAME/"
            log_success "插件安装完成。"
        else
            log_error "无法识别的仓库结构！"
            rm -rf "$TEMP_DIR"
            return 1
        fi
        
        # 清理临时目录
        cd "$OLDPWD"
        rm -rf "$TEMP_DIR"
        
        # 进入插件目录安装运行时依赖
        cd "plugins/$PLUGIN_DIR_NAME"
        if [ -f "package.json" ] && command -v npm &> /dev/null; then
            log_info "正在安装插件运行时依赖..."
            npm install --production 2>/dev/null
            if [ $? -eq 0 ]; then
                log_success "依赖安装完成。"
            else
                log_warn "依赖安装失败，WebSocket模块可能需要手动安装: npm install ws"
            fi
        fi
        cd ../..
    else
        log_error "下载失败！请检查网络连接或代理设置。"
        rm -rf "$TEMP_DIR"
        return 1
    fi

    echo -e "\n------------------------------------------"
    echo -e "${GREEN}✅ 联机Mod 安装完成！${NC}"
    echo -e ""
    echo -e "${CYAN}使用说明：${NC}"
    echo -e "  1. 重启 SillyTavern"
    echo -e "  2. WebSocket服务器将自动在端口 2157 启动"
    echo -e "  3. 在酒馆中加载联机Mod前端脚本即可使用"
    echo -e ""
    echo -e "${YELLOW}注意：${NC}如需更新服务端代码，请编辑："
    echo -e "  plugins/$PLUGIN_DIR_NAME/index.js"
    echo -e "------------------------------------------"
}

uninstall_plugin() {
    echo -e "\n------------------------------------------"
    log_info "开始卸载联机Mod..."

    if [ -d "$SERVER_PATH" ]; then
        rm -rf "$SERVER_PATH"
        log_success "联机Mod 插件已删除。"
    else
        log_warn "未找到联机Mod插件，无需卸载。"
    fi

    echo -e "\n${GREEN}✅ 卸载完成。${NC}"
}

update_plugin() {
    echo -e "\n------------------------------------------"
    log_info "开始更新联机Mod..."
    
    if [ ! -d "$SERVER_PATH" ]; then
        log_warn "联机Mod 尚未安装，将执行安装流程。"
        install_plugin
        return
    fi
    
    # 删除旧版本并重新安装
    log_info "正在删除旧版本..."
    rm -rf "$SERVER_PATH"
    
    # 重新安装
    install_plugin
}

# ------------------------------------------
# 主程序
# ------------------------------------------

clear

echo -e "${MAGENTA}"
echo "╔═══════════════════════════════════════════════════════╗"
echo "║                                                       ║"
echo "║     🎮 SillyTavern 联机Mod 一键安装脚本 🎮           ║"
echo "║                                                       ║"
echo "║     多人协作角色扮演 · WebSocket实时同步             ║"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo -e "${NC}"

check_git

if ! find_root_dir; then
    read -n 1 -s -r -p "按任意键退出..." < /dev/tty
    exit 1
fi

while true; do
    echo -e "\n当前工作目录: $(pwd)"
    echo -e "${YELLOW}请选择操作：${NC}"
    echo "1) 安装 / 重新安装"
    echo "2) 更新到最新版本"
    echo "3) 卸载插件"
    echo "0) 退出"
    
    read -p "请输入数字 [1/2/3/0]: " choice < /dev/tty

    case $choice in
        1)
            install_plugin
            break
            ;;
        2)
            update_plugin
            break
            ;;
        3)
            uninstall_plugin
            break
            ;;
        0)
            echo "再见！"
            exit 0
            ;;
        *)
            log_error "输入错误，请输入 1, 2, 3 或 0"
            ;;
    esac
done

echo ""
read -n 1 -s -r -p "按任意键退出脚本..." < /dev/tty
echo ""
