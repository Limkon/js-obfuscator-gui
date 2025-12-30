const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// --- 版本标识 (用于验证代码是否更新) ---
const CORE_VERSION = "FIX_VER_2025_FINAL"; 

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
        console.log("收到混淆请求。模式:", type);
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
        // 复制一份配置，防止修改原对象
        let config = { ...options, ignoreRequireImports: true };

        // ★★★ 强力拦截：如果是纯净模式，无视前端其他勾选，强制重置为最简配置 ★★★
        if (config.target === 'node-pure') {
            console.log(">>> [纯净模式激活] 正在执行暴力清洗...");
            
            // 强制覆盖为一个绝对安全的“白名单”配置对象
            // 这会丢弃前端传递的所有可能导致报错的高级参数
            config = {
                target: 'node',               // 强制 Node 环境
                compact: true,                // 允许压缩
                simplify: true,               // 允许简单优化
                
                // --- 下面全是“禁止项”，确保不生成 window 相关代码 ---
                stringArray: false,           // [关键] 彻底关闭字符串数组 (根除 sha224Hash)
                stringArrayEncoding: [],      // [关键] 确保不使用 rc4/base64
                
                domainLock: [],               // 禁止域名锁定
                domainLockRedirectUrl: undefined,
                
                debugProtection: false,       // 禁止调试保护
                debugProtectionInterval: undefined,
                
                selfDefending: false,         // 禁止自我保护
                splitStrings: false,          // 禁止字符串分割
                unicodeEscapeSequence: false, // 禁止 Unicode 转义(有时会导致体积过大)
                renameGlobals: false,         // 禁止重命名全局变量
                controlFlowFlattening: false, // 禁止控制流平坦化(减少体积和环境依赖)
                deadCodeInjection: false      // 禁止死代码注入
            };
            
            console.log(">>> [清洗完成] 已强制关闭 stringArray, rc4, domainLock 等所有危险项。");
        } 
        else if (config.target === 'node') {
            // 普通 Node 模式：仅做最低限度的清理
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
        }

        // console.log("最终使用的配置:", JSON.stringify(config, null, 2)); // 调试用

        // 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // 检查结果中是否意外包含了 sha224Hash (最后的防线)
        if (obfuscatedCode.includes('sha224Hash') || obfuscatedCode.includes('window')) {
             console.warn("⚠️ 警告：生成的代码中仍包含 window 或 sha224Hash，请检查配置！");
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
        return { success: false, message: error.message };
    }
});
