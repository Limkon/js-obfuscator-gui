const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 版本号：RESTORE_LOGGING_V5
const CURRENT_VERSION = "RESTORE_LOGGING_V5"; 

let mainWindow;

const createMenu = () => {
    Menu.setApplicationMenu(null); 
};

function createWindow() {
    createMenu();
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JavaScript', extensions: ['js', 'mjs'] }]
    });
    if (canceled) return null;
    return filePaths[0];
});

ipcMain.handle('perform-obfuscate', async (event, { type, content, options }) => {
    try {
        console.log(`\n========== [后端日志: ${CURRENT_VERSION}] ==========`);
        console.log("前端传入 Target:", options.target);

        let code = '';
        let inputPath = null;

        if (type === 'paste') {
            if (!content || typeof content.trim() !== 'string') throw new Error("代码为空");
            code = content;
        } else {
            if (!content) throw new Error("未选择文件");
            inputPath = content;
            code = fs.readFileSync(inputPath, 'utf8');
        }

        // --- 配置处理逻辑 ---
        
        // 1. 复制配置
        let finalConfig = { ...options, ignoreRequireImports: true };

        // 2. 根据不同模式进行不同程度的清洗
        if (finalConfig.target === 'node-pure') {
            // >>> 纯净模式：强制关闭所有可能报错的项 <<<
            console.log(">>> [纯净模式] 强制关闭 stringArray 和环境依赖");
            finalConfig.target = 'node';
            finalConfig.stringArray = false; // 绝杀
            finalConfig.stringArrayEncoding = [];
            finalConfig.debugProtection = false;
            finalConfig.selfDefending = false;
            finalConfig.domainLock = [];
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
        } 
        else if (finalConfig.target === 'node') {
            // >>> 通用 Node 模式：还原正常选项，仅修复校验错误 <<<
            console.log(">>> [通用 Node 模式] 保留用户选项，仅清理不兼容字段");
            
            // 在通用模式下，我们允许 stringArray 为 true (如果用户选了)
            // 但是必须清理 domainLock，因为 Node 不支持 domainLock，会导致 crash 或校验失败
            delete finalConfig.domainLock;
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
            
            // 提示：如果用户开启了 RC4，在 Node 下可能会报错，但这是“通用模式”允许的行为
        }
        else {
            // >>> 浏览器模式 <<<
            // 默认行为，仅清理空字段
            if (!finalConfig.domainLockRedirectUrl) delete finalConfig.domainLockRedirectUrl;
        }

        // 3. 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, finalConfig);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // 4. 返回结果 (包含最终配置供调试)
        const response = { 
            success: true, 
            code: obfuscatedCode,
            finalConfig: finalConfig // 将实际使用的配置发回给前端显示
        };

        if (type === 'file') {
            const dir = path.dirname(inputPath);
            const ext = path.extname(inputPath);
            const name = path.basename(inputPath, ext);
            const outputPath = path.join(dir, `${name}_obfuscated${ext}`);
            fs.writeFileSync(outputPath, obfuscatedCode, 'utf8');
            response.path = outputPath;
        }

        return response;

    } catch (error) {
        console.error("后端报错:", error);
        return { success: false, message: "混淆失败: " + error.message };
    }
});
