const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
const applyCustomRules = require('./custom-ast'); // 引入自定义规则

// ★★★ 版本号：v8.0_FORCE_FIX ★★★
const CURRENT_VERSION = "v8.0_FORCE_FIX"; 

let mainWindow;

const createMenu = () => { Menu.setApplicationMenu(null); };

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

        const originalSize = Buffer.byteLength(code, 'utf8');

        // --- 1. 执行自定义 AST (v8.0) ---
        // 注意：这是第一道工序，彻底抹除明文
        if (options.enableCustomAST) {
            console.log(">>> [Phase 1] 执行自定义 AST 混淆...");
            try {
                code = applyCustomRules(code);
            } catch (astErr) {
                console.error("AST处理异常:", astErr);
            }
        }

        // --- 2. 配置处理与强制修正 ---
        let finalConfig = { ...options, ignoreRequireImports: true };

        // ★★★ 核心修复：强制覆盖危险配置 ★★★
        if (options.enableCustomAST) {
            console.log(">>> [安全策略] 检测到自定义AST，强制关闭 Simplify 以防止代码还原");
            finalConfig.simplify = false; // 必须关闭！否则 String.fromCharCode 会被还原成字符串
        }

        delete finalConfig.enableCustomAST;

        // --- 3. 针对 Node-Pure (Worker) 的特殊清洗 ---
        if (finalConfig.target === 'node-pure') {
            console.log(">>> [纯净模式] 优化配置适配 Cloudflare Worker");
            finalConfig.target = 'node'; 
            
            // Worker 环境建议关闭 StringArray 以减少体积和 CPU 消耗
            // 但如果你非常在意混淆度，可以在 GUI 开启，这里只做兼容性调整
            finalConfig.debugProtection = false;
            finalConfig.selfDefending = false;
            finalConfig.splitStrings = false; 
            
            // 确保不包含浏览器特有的锁定
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

        // --- 4. 执行通用混淆 ---
        console.log(">>> [Phase 2] 执行通用混淆...");
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, finalConfig);
        let obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // --- 5. 注入补丁 ---
        const cfWorkerPatch = `var window = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : {}));
var document = typeof document !== "undefined" ? document : { createElement: function(){ return { appendChild: function(){}, getContext: function(){} } } };
`;
        obfuscatedCode = cfWorkerPatch + obfuscatedCode;

        const obfuscatedSize = Buffer.byteLength(obfuscatedCode, 'utf8');

        // --- 6. 返回结果 ---
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
