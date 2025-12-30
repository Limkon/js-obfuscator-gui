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
        console.log("------------------------------------------------");
        console.log("后端收到请求 -> 模式:", type); 
        console.log("用户选择的环境 target:", options.target); // 打印前端传来的选项

        let code = '';
        let inputPath = null;

        // 1. 获取源代码
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

        // 2. 初始化配置
        let config = {
            ...options,
            ignoreRequireImports: true
        };

        // 3. 【核心修正】强制清洗逻辑
        if (config.target === 'node-pure') {
            console.log("\n>>> 触发纯净模式: 已禁用所有不兼容选项 <<<");
            
            // 强制修正为 node
            config.target = 'node';
            
            // [核弹级修复] 直接关闭字符串数组
            // 只要 stringArray 开启，rc4 算法就有可能生成 sha224Hash 导致报错
            // 为了保证绝对运行成功，我们在纯净模式下直接关闭它
            config.stringArray = false; 
            config.stringArrayEncoding = [];
            
            // 关闭其他所有可能引发错误的保护
            config.domainLock = [];
            delete config.domainLockRedirectUrl;
            
            config.debugProtection = false;
            delete config.debugProtectionInterval; 
            
            config.selfDefending = false; 
            config.splitStrings = false;  
            config.renameGlobals = false;
            config.controlFlowFlattening = false; // 控制流有时也会引入环境依赖，建议关闭或降低

            console.log("已执行: stringArray=false, debugProtection=false, domainLock=[]\n");
        } 
        else if (config.target === 'node') {
             // 普通 Node 模式：清理域名锁定
             config.domainLock = [];
             delete config.domainLockRedirectUrl;
             // 普通模式允许 base64
             config.stringArray = true;
             config.stringArrayEncoding = ['base64'];
        } 
        else {
            // 浏览器模式：开启强力混淆
             config.stringArray = true;
             config.stringArrayEncoding = ['rc4'];
        }

        // 清理无效配置
        if (config.domainLock && config.domainLock.length === 0) config.domainLock = [];
        if (config.reservedStrings && config.reservedStrings.length === 0) config.reservedStrings = [];
        if (config.reservedNames && config.reservedNames.length === 0) config.reservedNames = [];
        if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;

        // 4. 执行混淆
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        const obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // 5. 输出结果
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
