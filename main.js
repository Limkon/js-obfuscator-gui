const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');
// 引入自定义 AST 处理逻辑
const applyCustomRules = require('./custom-ast'); 

const CURRENT_VERSION = "v9.0_UI_CONTROL"; 

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

// 右键菜单
ipcMain.on('show-context-menu', (event) => {
    const template = [
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '剪切', role: 'cut' },
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

        // --- 1. 执行自定义 AST 混淆 (Phase 1) ---
        if (options.enableCustomAST) {
            console.log(">>> [Phase 1] 执行自定义 AST 混淆...");
            
            // 构建配置对象，传入用户定义的关键词
            const customConfig = {
                sensitiveWords: options.astKeywords || []
            };
            
            try {
                // 调用 custom-ast.js
                code = applyCustomRules(code, customConfig);
            } catch (astErr) {
                console.error("!!! AST处理异常，降级使用源码:", astErr);
            }
        }

        // --- 2. 配置清洗与处理 ---
        let finalConfig = { ...options, ignoreRequireImports: true };

        // 提示信息：如果开启了 Simplify，可能会影响 AST 混淆的效果
        if (options.enableCustomAST && options.simplify) {
            console.log(">>> [提示] 检测到 Simplify 开启。如果 vless 等关键词被还原，请在前端关闭 '优化代码结构'。");
        }

        // 移除不属于 javascript-obfuscator 的自定义参数
        delete finalConfig.enableCustomAST;
        delete finalConfig.astKeywords;

        // --- 3. 针对 Node-Pure / Worker 的特殊适配 ---
        if (finalConfig.target === 'node-pure') {
            console.log(">>> [模式] 适配 Cloudflare Worker (Node-Pure)");
            finalConfig.target = 'node'; 
            
            // 强制关闭导致 Worker 超时的选项
            finalConfig.debugProtection = false;
            finalConfig.selfDefending = false;
            finalConfig.splitStrings = false; 
            
            // 清理浏览器相关配置
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
            // browser 模式
            if (!finalConfig.domainLockRedirectUrl) delete finalConfig.domainLockRedirectUrl;
        }

        // --- 4. 执行通用混淆 (Phase 2) ---
        console.log(">>> [Phase 2] 执行通用混淆...");
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, finalConfig);
        let obfuscatedCode = obfuscationResult.getObfuscatedCode();

        // --- 5. 注入 Cloudflare Worker 兼容补丁 ---
        // 解决 window/document 未定义的问题
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
