const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ★★★ 版本号：FINAL_VERIFICATION_V6 ★★★
const CURRENT_VERSION = "FINAL_VERIFICATION_V6"; 

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

        // --- 2. 根据环境强制清洗 ---
        if (finalConfig.target === 'node-pure') {
            // >>> 纯净模式：强制关闭所有可能报错的项 <<<
            console.log(">>> [纯净模式] 强制关闭 stringArray 和环境依赖");
            finalConfig.target = 'node';
            
            // 【绝杀】强制关闭字符串数组，根除 sha224Hash
            finalConfig.stringArray = false; 
            finalConfig.stringArrayEncoding = [];
            
            // 关闭其他浏览器依赖
            finalConfig.debugProtection = false;
            finalConfig.selfDefending = false;
            finalConfig.splitStrings = false; 
            
            // 物理删除校验报错项
            finalConfig.domainLock = [];
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
        } 
        else if (finalConfig.target === 'node') {
            // >>> 通用 Node 模式：仅清理校验不兼容字段 <<<
            console.log(">>> [通用 Node 模式] 仅清理校验字段");
            delete finalConfig.domainLock;
            delete finalConfig.domainLockRedirectUrl;
            delete finalConfig.debugProtectionInterval;
        }
        else {
            // >>> 浏览器模式 <<<
            if (!finalConfig.domainLockRedirectUrl) delete finalConfig.domainLockRedirectUrl;
        }

        // --- 3. 执行混淆 ---
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, finalConfig);
        let obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // --- 4. [关键] 注入时间戳头信息 ---
        // 这行注释可以帮您确认：您运行的代码到底是新生成的，还是旧的缓存文件
        const timeStr = new Date().toLocaleTimeString();
        const headerInfo = `/* Build Time: ${timeStr} | Target: ${finalConfig.target} | StringArray: ${finalConfig.stringArray} */\n`;
        obfuscatedCode = headerInfo + obfuscatedCode;

        // --- 5. 返回结果 (包含最终配置供调试) ---
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
