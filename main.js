const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

let mainWindow;

// --- 菜单配置 ---
const createMenu = () => {
    Menu.setApplicationMenu(null); // 简单粗暴：直接隐藏菜单栏 (看起来更像工具软件)
};

// --- 创建窗口 ---
function createWindow() {
    createMenu();
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false // 关闭沙盒以避免部分权限问题
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC 通信逻辑 ---

// 1. 文件选择
ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JavaScript', extensions: ['js', 'mjs'] }]
    });
    if (canceled) return null;
    return filePaths[0];
});

// 2. 核心混淆逻辑 (包含纯净模式修复)
ipcMain.handle('perform-obfuscate', async (event, { type, content, options }) => {
    try {
        console.log("后端收到请求 -> 模式:", type); // 调试日志

        let code = '';
        let inputPath = null;

        // A. 区分数据来源
        if (type === 'paste') {
            // 粘贴模式：content 即源代码
            if (!content || typeof content !== 'string' || !content.trim()) {
                throw new Error("代码内容为空");
            }
            code = content;
        } else {
            // 文件模式：content 即文件路径
            if (!content) throw new Error("未选择文件");
            inputPath = content;
            try {
                code = fs.readFileSync(inputPath, 'utf8');
            } catch (readErr) {
                throw new Error(`读取文件失败: ${readErr.message}`);
            }
        }

        // B. 整理配置
        let config = {
            ...options,
            stringArray: true,
            stringArrayEncoding: ['rc4'],
            ignoreRequireImports: true
        };
        
        // --- [核心修复] 针对 Node.js 纯净模式的强力清洗 ---
        // 目标：确保在 Node 环境运行绝对不会出现 window is not defined
        if (config.target === 'node-pure') {
            console.log("启动 Node.js 纯净模式：强制移除所有浏览器依赖...");
            
            // 1. 修正 target 为标准的 'node' (混淆器库只认 'node')
            config.target = 'node';
            
            // 2. 强制清空域名锁定 (这是导致 window is not defined 的头号原因)
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
            
            // 3. 强制关闭调试保护 (防止生成依赖 window/debugger 的检测代码)
            config.debugProtection = false;
            config.debugProtectionInterval = false;
            
            // 4. (可选) 如果不需要自我保护，也可关闭，提高稳定性
            // config.selfDefending = false; 
        } 
        else if (config.target === 'node') {
            // 普通 Node 模式，也建议清理域名锁定
             delete config.domainLock;
             delete config.domainLockRedirectUrl;
        }

        // 清理空配置 (常规清理)
        if (config.domainLock && config.domainLock.length === 0) delete config.domainLock;
        if (config.reservedStrings && config.reservedStrings.length === 0) delete config.reservedStrings;
        if (config.reservedNames && config.reservedNames.length === 0) delete config.reservedNames;
        if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;

        // C. 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // D. 返回结果
        if (type === 'paste') {
            // 直接返回代码
            return { success: true, code: obfuscatedCode };
        } else {
            // 写入文件
            const dir = path.dirname(inputPath);
            const ext = path.extname(inputPath);
            const name = path.basename(inputPath, ext);
            const outputPath = path.join(dir, `${name}_obfuscated${ext}`);
            
            fs.writeFileSync(outputPath, obfuscatedCode, 'utf8');
            return { success: true, path: outputPath, code: obfuscatedCode };
        }

    } catch (error) {
        console.error("后端混淆错误:", error);
        return { success: false, message: error.message };
    }
});
