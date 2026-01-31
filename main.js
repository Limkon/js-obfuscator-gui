const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ★★★ 版本号：CF_WORKER_PATCH_V7 ★★★
const CURRENT_VERSION = "CF_WORKER_PATCH_V7"; 

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

        // --- 1. 配置处理逻辑 ---
        let finalConfig = { ...options, ignoreRequireImports: true };

        // --- 2. 强制清洗逻辑 ---
        if (finalConfig.target === 'node-pure') {
            console.log(">>> [纯净模式] 强制关闭 StringArray，并准备注入 Worker 补丁");
            finalConfig.target = 'node'; // 保持 node 目标以避免 excessive DOM code
            
            // 强制关闭导致报错的加密项
            finalConfig.stringArray = false; 
            finalConfig.stringArrayEncoding = [];
            
            // 关闭其他
            finalConfig.debugProtection = false;
            finalConfig.selfDefending = false;
            finalConfig.splitStrings = false; 
            
            finalConfig.domainLock = [];
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
        } 
        else if (finalConfig.target === 'node') {
            delete finalConfig.domainLock;
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
        }
        else {
            if (!finalConfig.domainLockRedirectUrl) delete finalConfig.domainLockRedirectUrl;
        }

        // --- 3. 执行混淆 ---
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, finalConfig);
        let obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // --- 4. [核心修复] 注入 Cloudflare Worker 兼容补丁 ---
        // 这段代码会在混淆代码运行前执行，手动定义 window 对象，防止报错
        
        // 修改说明：已移除注释信息，保留功能性代码
        const cfWorkerPatch = `
var window = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : {}));
var document = typeof document !== "undefined" ? document : { createElement: function(){ return { appendChild: function(){}, getContext: function(){} } } };
`;
        // 将补丁拼接到代码最前面
        obfuscatedCode = cfWorkerPatch + obfuscatedCode;

        // --- 5. 返回结果 ---
        const response = { 
            success: true, 
            code: obfuscatedCode,
            finalConfig: finalConfig 
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
