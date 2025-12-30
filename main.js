const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ★★★ 版本标识：FINAL_COMPAT_V2 ★★★
const CURRENT_VERSION = "FINAL_COMPAT_V2"; 

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

        // --- 配置初始化 ---
        let config = { ...options, ignoreRequireImports: true };

        // ★★★ 核心修改：只要是 Node 环境，统统强制清理 ★★★
        // 不管选的是 'node' 还是 'node-pure'，都执行最严格的安全策略
        if (config.target === 'node' || config.target === 'node-pure') {
            console.log(">>> [Node兼容模式] 正在强制移除浏览器依赖...");
            
            // 1. 统一修正为 node
            config.target = 'node';

            // 2. [绝杀] 强制关闭字符串数组
            // 只要关闭这个，sha224Hash 和 window 依赖就绝对不会生成
            config.stringArray = false; 
            config.stringArrayEncoding = [];
            
            // 3. 删除所有可能报错的校验项
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
            delete config.debugProtectionInterval;

            // 4. 关闭其他风险项
            config.debugProtection = false;
            config.selfDefending = false;
            config.splitStrings = false;
            
            console.log(">>> [安全策略生效] stringArray=false, 已移除所有环境依赖。");
        } 
        else {
            // 浏览器模式：如果用户没填URL，删除该key防止校验错误
            if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;
        }

        // 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // 验证代码
        if (obfuscatedCode.includes('sha224Hash')) {
            console.error("!!! 警告：代码中仍包含 sha224Hash，请检查是否选择了 Browser 模式 !!!");
        }

        if (type === 'paste') {
            return { success: true, code: obfuscatedCode };
        } else {
            const dir = path.dirname(inputPath);
            const ext = path.extname(inputPath);
            const name = path.basename(inputPath, ext);
            const outputPath = path.join(dir, `${name}_obfuscated${ext}`);
            fs.writeFileSync(outputPath, obfuscatedCode, 'utf8');
            return { success: true, path: outputPath, code: obfuscatedCode };
        }

    } catch (error) {
        console.error("后端报错:", error);
        return { success: false, message: "混淆失败: " + error.message };
    }
});
