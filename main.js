const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ★★★ 版本号：请在运行时的控制台寻找此字符串，确保代码生效 ★★★
const CURRENT_VERSION = "FINAL_KILL_SHA224_V1"; 

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
        console.log("正在处理混淆请求...");

        let code = '';
        let inputPath = null;

        // 1. 读取代码
        if (type === 'paste') {
            if (!content || typeof content.trim() !== 'string') throw new Error("代码为空");
            code = content;
        } else {
            if (!content) throw new Error("未选择文件");
            inputPath = content;
            code = fs.readFileSync(inputPath, 'utf8');
        }

        // 2. 配置初始化
        let config = { ...options, ignoreRequireImports: true };

        // 3. ★★★ 绝杀逻辑：针对 Node.js 纯净模式的彻底清洗 ★★★
        if (config.target === 'node-pure') {
            console.log(">>> [纯净模式] 正在执行毁灭性清理...");
            console.log(">>> 目标：彻底根除 sha224Hash 和 window 依赖");

            // 强制指定环境
            config.target = 'node';

            // [核心动作] 彻底关闭字符串数组
            // 只要这个是 true，混淆器就有可能生成 sha224Hash。必须关掉！
            config.stringArray = false; 
            
            // 辅助清理：清空相关参数
            config.stringArrayEncoding = [];
            config.stringArrayThreshold = 0;
            
            // 移除所有校验报错项
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
            delete config.debugProtectionInterval;

            // 关闭其他高风险保护
            config.debugProtection = false;
            config.selfDefending = false;
            config.splitStrings = false;
            config.unicodeEscapeSequence = false;
            
            console.log(">>> [清理完毕] stringArray 已强制设为 false。");
        } 
        else if (config.target === 'node') {
            // 普通 Node 模式：仅删除校验报错项
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
            delete config.debugProtectionInterval;
        }
        else {
            // 浏览器模式：如果用户没填URL，需要删除该key防止校验错误
             if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;
        }

        // 4. 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // 5. [最后一道防线] 检查代码中是否依然包含毒药函数
        if (obfuscatedCode.includes('sha224Hash')) {
            console.error("!!! 严重警告：生成的代码中依然包含 sha224Hash !!!");
            console.error("请检查是否没有重启程序，或 node_modules 版本过低。");
        }

        // 6. 返回结果
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
