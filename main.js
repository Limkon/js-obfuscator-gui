const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
// [新增] 引入自定义 AST 处理器
const applyCustomRules = require('./custom-ast'); 

// ★★★ 版本号：CF_WORKER_PATCH_V7_MENU_SUPPORT_AST ★★★
const CURRENT_VERSION = "CF_WORKER_PATCH_V7_MENU_SUPPORT_AST"; 

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

// --- 新增：右键菜单 IPC 监听 ---
ipcMain.on('show-context-menu', (event) => {
    const template = [
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '删除', role: 'delete' }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
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
        console.log("自定义 AST 开关:", options.enableCustomAST); // [新增] 日志

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

        // --- 新增：计算原始体积 ---
        const originalSize = Buffer.byteLength(code, 'utf8');

        // --- [核心变更] 执行自定义 AST 混淆 ---
        if (options.enableCustomAST) {
            console.log(">>> 正在执行自定义 AST 预处理...");
            // 这里将源代码先进行一轮自定义 AST 转换，结果作为下一轮的输入
            code = applyCustomRules(code);
        }

        // --- 1. 配置处理逻辑 ---
        let finalConfig = { ...options, ignoreRequireImports: true };

        // [清理] 删除自定义选项，防止标准混淆器报错或产生警告
        delete finalConfig.enableCustomAST;

        // --- 2. 强制清洗逻辑 ---
        if (finalConfig.target === 'node-pure') {
            console.log(">>> [纯净模式] 强制关闭 StringArray，并准备注入 Worker 补丁");
            finalConfig.target = 'node'; 
            finalConfig.stringArray = false; 
            finalConfig.stringArrayEncoding = [];
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

        // --- 4. [核心修复] 注入 Cloudflare Worker 兼容补丁 (无注释版) ---
        // 修复说明：移除了模板字符串开头的换行符，防止混淆结果出现首行空行
        const cfWorkerPatch = `var window = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : {}));
var document = typeof document !== "undefined" ? document : { createElement: function(){ return { appendChild: function(){}, getContext: function(){} } } };
`;
        obfuscatedCode = cfWorkerPatch + obfuscatedCode;

        // --- 新增：计算混淆后体积 ---
        const obfuscatedSize = Buffer.byteLength(obfuscatedCode, 'utf8');

        // --- 5. 返回结果 ---
        const response = { 
            success: true, 
            code: obfuscatedCode,
            finalConfig: finalConfig,
            stats: {
                originalSize: originalSize,
                obfuscatedSize: obfuscatedSize
            }
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
