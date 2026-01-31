document.addEventListener('DOMContentLoaded', () => {
    
    // --- 核心变量 ---
    let currentMode = 'paste'; 
    let selectedFilePath = null;

    // --- DOM ---
    const get = (id) => document.getElementById(id);
    const consoleContainer = get('console-container');
    const tabItemPaste = get('tab-item-paste');
    const tabItemFile = get('tab-item-file');
    const tabItemResult = get('tab-item-result');
    const contentPaste = get('tab-paste');
    const contentFile = get('tab-file');
    const contentResult = get('tab-result');
    const sizeStats = get('size-stats'); // 新增

    // --- 工具函数：格式化字节 ---
    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    // --- 日志函数 ---
    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const el = document.createElement('div');
        el.className = `log-${type}`;
        el.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
        consoleContainer.appendChild(el);
        consoleContainer.scrollTop = consoleContainer.scrollHeight;
    }

    // --- 复制日志功能 ---
    const btnCopyLog = get('btn-copy-log');
    if (btnCopyLog) {
        btnCopyLog.addEventListener('click', () => {
            const text = consoleContainer.innerText;
            navigator.clipboard.writeText(text).then(() => {
                const originalText = btnCopyLog.innerText;
                btnCopyLog.innerText = "已复制!";
                setTimeout(() => btnCopyLog.innerText = originalText, 1000);
            }).catch(err => {
                console.error('Copy failed', err);
                log("复制失败，请手动选中复制", "error");
            });
        });
    }

    // --- 新增功能：清空代码按钮 ---
    const btnClearCode = get('btn-clear-code');
    if (btnClearCode) {
        btnClearCode.addEventListener('click', () => {
            const rawCodeInput = get('rawCodeInput');
            if (rawCodeInput) {
                rawCodeInput.value = '';
                rawCodeInput.focus();
                log("操作：已清空源码输入区", "info");
                if(sizeStats) sizeStats.style.display = 'none';
            }
        });
    }

    // --- 新增功能：复制结果按钮 ---
    const btnCopyResult = get('btn-copy-result');
    if (btnCopyResult) {
        btnCopyResult.addEventListener('click', () => {
            const resultOutput = get('resultOutput');
            const text = resultOutput ? resultOutput.value : '';
            
            if (!text) {
                log("复制失败：结果区为空", "warn");
                return;
            }

            navigator.clipboard.writeText(text).then(() => {
                const originalText = btnCopyResult.innerText;
                btnCopyResult.innerText = "✅ 已复制!";
                setTimeout(() => btnCopyResult.innerText = originalText, 1500);
                log("操作：混淆结果已复制到剪贴板", "info");
            }).catch(err => {
                console.error('Copy failed', err);
                log("复制失败: " + err, "error");
            });
        });
    }

    // --- 切换逻辑 ---
    function setMode(mode) {
        document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

        if (mode === 'paste') {
            tabItemPaste.classList.add('active');
            contentPaste.classList.add('active');
            currentMode = 'paste'; 
        } else if (mode === 'file') {
            tabItemFile.classList.add('active');
            contentFile.classList.add('active');
            currentMode = 'file'; 
        } else if (mode === 'result') {
            tabItemResult.classList.add('active');
            contentResult.classList.add('active');
        }
    }

    if(tabItemPaste) tabItemPaste.addEventListener('click', () => setMode('paste'));
    if(tabItemFile) tabItemFile.addEventListener('click', () => setMode('file'));
    if(tabItemResult) tabItemResult.addEventListener('click', () => setMode('result'));

    // --- 文件选择 ---
    const btnSelectFile = get('btn-select-file');
    if (btnSelectFile) {
        btnSelectFile.addEventListener('click', async () => {
            const path = await window.electronAPI.selectFile();
            if (path) {
                selectedFilePath = path;
                get('file-path-display').innerText = path;
                get('file-path-display').style.display = 'block';
                btnSelectFile.innerText = "已选择 (点击更换)";
                log(`已选择文件: ${path}`);
                if(sizeStats) sizeStats.style.display = 'none';
            }
        });
    }

    // --- 预设联动逻辑 ---
    function applyPreset(preset) {
        const setCheck = (id, val) => { if(get(id)) get(id).checked = val; };
        const setVal = (id, val) => { if(get(id)) get(id).value = val; };

        if (preset === 'minimal') {
            setCheck('compact', true);
            setCheck('simplify', true);
            setCheck('selfDefending', false);
            setCheck('debugProtection', false);
            setCheck('disableConsoleOutput', false);
            setCheck('numbersToExpressions', false);
            setCheck('splitStrings', false);
            setCheck('unicodeEscapeSequence', false);
            setCheck('deadCodeInjection', false);
            setCheck('controlFlowFlattening', false);
            setCheck('renameGlobals', false);
            setVal('identifierNamesGenerator', 'mangled');
            log(">>> 已应用：极简模式 (体积最小化配置)", "info");
        } 
        else if (preset === 'high') {
            setCheck('controlFlowFlattening', true);
            setCheck('deadCodeInjection', true);
            setCheck('selfDefending', true);
            setCheck('debugProtection', true);
            setVal('identifierNamesGenerator', 'hexadecimal');
            log(">>> 已应用：高强度混淆", "info");
        }
        else if (preset === 'default') {
            setCheck('compact', true);
            setCheck('controlFlowFlattening', false);
            setCheck('deadCodeInjection', false);
            setCheck('selfDefending', false);
            setVal('identifierNamesGenerator', 'hexadecimal');
            log(">>> 已应用：默认配置", "info");
        }
    }

    document.querySelectorAll('input[name="preset"]').forEach(radio => {
        radio.addEventListener('change', (e) => applyPreset(e.target.value));
    });

    // --- 运行混淆 ---
    const btnRun = get('btn-run');
    btnRun.addEventListener('click', async () => {
        const statusMsg = get('status-msg');
        const rawCodeInput = get('rawCodeInput');
        
        // 重置显示
        if(sizeStats) sizeStats.style.display = 'none';

        // 1. 准备数据
        let payloadContent = null;
        let payloadType = currentMode;

        if (currentMode === 'paste') {
            payloadContent = rawCodeInput.value;
            if (!payloadContent.trim()) {
                statusMsg.innerText = "错误：粘贴框为空！";
                log("错误：尝试混淆但代码为空", "error");
                return;
            }
        } else if (currentMode === 'file') {
            payloadContent = selectedFilePath;
            if (!payloadContent) {
                statusMsg.innerText = "错误：未选择任何文件！";
                log("错误：尝试混淆但未选择文件", "error");
                return;
            }
        }

        // 2. 锁定 UI
        btnRun.disabled = true;
        btnRun.innerText = "正在处理...";
        statusMsg.innerText = "";
        consoleContainer.innerHTML = ""; // 清空日志
        log(">>> 开始混淆流程...");

        // 3. 收集配置
        const getCheck = (id) => get(id) ? get(id).checked : false;
        const getVal = (id) => get(id) ? get(id).value : '';
        const getRadio = (name) => {
            const el = document.querySelector(`input[name="${name}"]:checked`);
            return el ? el.value : null;
        };

        const targetEnv = getRadio('target') || 'browser';
        log(`当前选择的运行环境 (Target): ${targetEnv}`);

        const options = {
            target: targetEnv,
            compact: getCheck('compact'),
            selfDefending: getCheck('selfDefending'),
            debugProtection: getCheck('debugProtection'),
            disableConsoleOutput: getCheck('disableConsoleOutput'),
            numbersToExpressions: getCheck('numbersToExpressions'),
            simplify: getCheck('simplify'),
            splitStrings: getCheck('splitStrings'),
            unicodeEscapeSequence: getCheck('unicodeEscapeSequence'),
            renameGlobals: getCheck('renameGlobals'),
            deadCodeInjection: getCheck('deadCodeInjection'),
            deadCodeInjectionThreshold: parseFloat(getVal('deadCodeInjectionThreshold') || 0.4),
            controlFlowFlattening: getCheck('controlFlowFlattening'),
            controlFlowFlatteningThreshold: parseFloat(getVal('controlFlowFlatteningThreshold') || 0.75),
            identifierNamesGenerator: getVal('identifierNamesGenerator') || 'hexadecimal',
            domainLock: getVal('domainLock').split('\n').filter(l => l.trim()),
            domainLockRedirectUrl: getVal('domainLockRedirectUrl').trim(),
            reservedStrings: getVal('reservedStrings').split('\n').filter(l => l.trim()),
            reservedNames: getVal('reservedNames').split('\n').filter(l => l.trim())
        };

        log("发送给后端的配置参数:\n" + JSON.stringify(options, null, 2));

        try {
            // 4. 发送请求
            const payload = {
                type: payloadType, 
                content: payloadContent, 
                options: options
            };

            const result = await window.electronAPI.obfuscate(payload);

            if (result.success) {
                statusMsg.innerText = "混淆成功！";
                statusMsg.style.color = "green";
                log("后端返回：混淆成功！", "info");
                
                // --- 更新体积统计 ---
                if (result.stats && sizeStats) {
                    const { originalSize, obfuscatedSize } = result.stats;
                    const diff = obfuscatedSize - originalSize;
                    const diffClass = diff >= 0 ? 'diff-up' : 'diff-down';
                    const diffSign = diff >= 0 ? '+' : '';
                    
                    sizeStats.innerHTML = `
                        原始: <span class="highlight">${formatBytes(originalSize)}</span> 
                        → 混淆后: <span class="highlight">${formatBytes(obfuscatedSize)}</span> 
                        (<span class="${diffClass}">${diffSign}${formatBytes(diff)}</span>)
                    `;
                    sizeStats.style.display = 'inline-block';
                    log(`体积统计: ${formatBytes(originalSize)} -> ${formatBytes(obfuscatedSize)}`, "info");
                }

                if (result.finalConfig) {
                   log("后端实际使用的最终配置 (Final Config):\n" + JSON.stringify(result.finalConfig, null, 2));
                }

                get('resultOutput').value = result.code || `文件已保存至: ${result.path}`;
                setMode('result'); 
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            console.error(err);
            statusMsg.innerText = "失败: " + err.message;
            statusMsg.style.color = "red";
            log("后端返回错误: " + err.message, "error");
        } finally {
            btnRun.disabled = false;
            btnRun.innerText = "混淆加密";
        }
    });

    // 初始化联动
    document.querySelectorAll('input[name="preset"]').forEach(radio => {
        if(radio.checked) applyPreset(radio.value);
    });
});
