const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

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
        console.log("后端收到请求 -> 模式:", type); 

        let code = '';
        let inputPath = null;

        if (type === 'paste') {
            if (!content || typeof content !== 'string' || !content.trim()) {
                throw new Error("代码内容为空");
            }
            code = content;
        } else {
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
            stringArrayEncoding: ['rc4'], // 默认使用强加密
            ignoreRequireImports: true
        };
        
        // --- [核心修复] Node.js 纯净模式：核弹级清理 ---
        if (config.target === 'node-pure') {
            console.log(">>> 启动 Node.js 纯净模式 <<<");
            console.log("正在移除所有可能导致 window 报错的选项...");

            // 1. 修正 target
            config.target = 'node';
            
            // 2. 彻底删除域名锁定 (window报错的主因)
            delete config.domainLock;
            delete config.domainLockRedirectUrl;
            
            // 3. 彻底删除调试保护 (数字校验报错的主因)
            config.debugProtection = false;
            delete config.debugProtectionInterval; 
            
            // 4. [新增] 强制关闭自我保护 (Node环境下极易导致死循环或报错)
            config.selfDefending = false;

            // 5. [新增] 降级字符串加密 (RC4算法有时会生成依赖环境的代码，降级为base64更安全)
            config.stringArrayEncoding = ['base64'];
            
            // 6. [新增] 关闭字符串分割 (减少生成的辅助代码量)
            config.splitStrings = false;
        } 
        else if (config.target === 'node') {
             // 普通 Node 模式也建议清理域名锁定
             delete config.domainLock;
             delete config.domainLockRedirectUrl;
        }

        // 常规清理：删除空数组配置
        if (config.domainLock && config.domainLock.length === 0) delete config.domainLock;
        if (config.reservedStrings && config.reservedStrings.length === 0) delete config.reservedStrings;
        if (config.reservedNames && config.reservedNames.length === 0) delete config.reservedNames;
        if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;

        // 打印最终配置 (调试用)
        // console.log("Final Config:", JSON.stringify(config, null, 2));

        // C. 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // D. 返回结果
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
        console.error("后端混淆错误:", error);
        return { success: false, message: error.message };
    }
});
