const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// --- 版本标识 (用于验证代码是否更新) ---
const CORE_VERSION = "STRICT_FIX_VER_1.0"; 

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
        console.log(`\n========== [后端日志 ${CORE_VERSION}] ==========`);
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

        // --- 核心逻辑：配置清洗 ---
        let config = { ...options, ignoreRequireImports: true };

        // ★★★ 针对 Node.js 纯净模式的严格清洗 ★★★
        if (config.target === 'node-pure') {
            console.log(">>> [纯净模式] 执行严格属性删除...");
            
            // 1. 修正目标环境
            config.target = 'node';

            // 2. [关键修复] 使用 delete 彻底移除不兼容的属性
            // 只要这些 key 存在(哪怕是undefined)，校验器都会报错
            delete config.domainLockRedirectUrl; 
            delete config.debugProtectionInterval; 
            delete config.domainLock;
            
            // 3. 强制关闭不兼容的功能
            config.stringArray = false;           // 关闭字符串数组 (根除 sha224Hash)
            config.stringArrayEncoding = [];      // 禁用编码
            config.debugProtection = false;       // 关闭调试保护
            config.selfDefending = false;         // 关闭自我保护
            config.splitStrings = false;          // 关闭字符串分割
            config.unicodeEscapeSequence = false; // 关闭Unicode转义
            config.renameGlobals = false;         // 关闭全局变量重命名
            config.controlFlowFlattening = false; // 关闭控制流平坦化
            
            console.log(">>> [清洗完成] 已物理删除 domainLockRedirectUrl 和 debugProtectionInterval");
        } 
        else if (config.target === 'node') {
            // 普通 Node 模式：也必须删除 redirectUrl，否则会报同样的错
            delete config.domainLockRedirectUrl;
            delete config.domainLock; 
            
            // 同样删除 interval 防止报错
            delete config.debugProtectionInterval;
        }
        else {
            // 浏览器模式：如果用户没填 redirectUrl，也必须删除该 key，否则会报 URL 格式错误
            if (!config.domainLockRedirectUrl || config.domainLockRedirectUrl.trim() === '') {
                delete config.domainLockRedirectUrl;
            }
        }

        // 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

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
        // 将具体的校验错误信息返回给前端
        return { success: false, message: "混淆失败: " + error.message };
    }
});
