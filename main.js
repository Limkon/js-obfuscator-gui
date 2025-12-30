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

        // 3. 【核心修正】根据环境强行重置危险参数
        if (config.target === 'node-pure') {
            console.log(">>> 激活 Node.js 纯净兼容模式 (Pure Mode) <<<");
            
            // 强制设置为 node 目标
            config.target = 'node';
            
            // [关键] 禁用字符串加密编码
            // rc4 和 base64 在某些 Node 环境下会生成 sha224Hash 导致 window 报错
            // 设置为 [] 表示仅提取字符串到数组，但不进行复杂编码，这是最安全的
            config.stringArrayEncoding = []; 
            
            // 禁用可能引入 global/window 访问的高级保护
            config.domainLock = [];
            delete config.domainLockRedirectUrl;
            
            config.debugProtection = false;
            delete config.debugProtectionInterval; // 彻底删除以防校验报错
            
            config.selfDefending = false; // 自我保护在 Node 下极易报错
            config.splitStrings = false;  // 禁用字符串分割，减少辅助函数
            config.renameGlobals = false; // 不重命名全局变量(如 process, require)
            
            console.log("已屏蔽: 域名锁定, 调试保护, 自我保护, 字符串加密算法");
        } 
        else if (config.target === 'node') {
             // 普通 Node 模式：仅删除域名锁定，保留其他
             config.domainLock = [];
             delete config.domainLockRedirectUrl;
             // 如果是普通 Node 模式，可以使用 base64，比 rc4 兼容性好
             config.stringArrayEncoding = ['base64'];
        } 
        else {
            // 浏览器模式：默认开启 rc4 强加密
             config.stringArrayEncoding = ['rc4'];
        }

        // 清理无效的空配置
        if (config.domainLock && config.domainLock.length === 0) config.domainLock = [];
        if (config.reservedStrings && config.reservedStrings.length === 0) config.reservedStrings = [];
        if (config.reservedNames && config.reservedNames.length === 0) config.reservedNames = [];
        if (!config.domainLockRedirectUrl) delete config.domainLockRedirectUrl;

        // 调试：打印最终生效的配置
        // console.log("Final Config:", JSON.stringify(config, null, 2));

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
