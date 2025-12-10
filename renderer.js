document.addEventListener('DOMContentLoaded', () => {
    
    // --- 核心变量 (默认是粘贴模式) ---
    let currentMode = 'paste'; 
    let selectedFilePath = null;

    // --- DOM 元素获取 ---
    const get = (id) => document.getElementById(id);
    const tabItemPaste = get('tab-item-paste');
    const tabItemFile = get('tab-item-file');
    const tabItemResult = get('tab-item-result');
    const contentPaste = get('tab-paste');
    const contentFile = get('tab-file');
    const contentResult = get('tab-result');

    // --- 1. 强制切换逻辑 ---
    // 专门定义切换函数，确保变量和界面同时更新
    function setMode(mode) {
        // 1. 更新界面样式
        document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

        if (mode === 'paste') {
            tabItemPaste.classList.add('active');
            contentPaste.classList.add('active');
            currentMode = 'paste'; // [关键] 强制更新变量
            console.log("当前模式已切换为: 粘贴文本");
        } 
        else if (mode === 'file') {
            tabItemFile.classList.add('active');
            contentFile.classList.add('active');
            currentMode = 'file'; // [关键] 强制更新变量
            console.log("当前模式已切换为: 文件选择");
        }
        else if (mode === 'result') {
            tabItemResult.classList.add('active');
            contentResult.classList.add('active');
            // 结果页不改变 currentMode，方便用户回去修改
        }
    }

    // 绑定点击事件 (使用ID绑定，最稳)
    if(tabItemPaste) tabItemPaste.addEventListener('click', () => setMode('paste'));
    if(tabItemFile) tabItemFile.addEventListener('click', () => setMode('file'));
    if(tabItemResult) tabItemResult.addEventListener('click', () => setMode('result'));

    // --- 2. 文件选择 ---
    const btnSelectFile = get('btn-select-file');
    if (btnSelectFile) {
        btnSelectFile.addEventListener('click', async () => {
            const path = await window.electronAPI.selectFile();
            if (path) {
                selectedFilePath = path;
                get('file-path-display').innerText = path;
                get('file-path-display').style.display = 'block';
                btnSelectFile.innerText = "已选择 (点击更换)";
            }
        });
    }

    // --- 3. 运行混淆 (重写校验逻辑) ---
    const btnRun = get('btn-run');
    btnRun.addEventListener('click', async () => {
        const statusMsg = get('status-msg');
        const rawCodeInput = get('rawCodeInput');
        
        console.log("点击运行。当前模式:", currentMode); // 调试日志

        // 步骤 A: 准备数据
        let payloadContent = null;
        let payloadType = currentMode;

        if (currentMode === 'paste') {
            payloadContent = rawCodeInput.value;
            // 校验
            if (!payloadContent.trim()) {
                statusMsg.innerText = "错误：粘贴框为空！";
                statusMsg.style.color = "red";
                return;
            }
        } else if (currentMode === 'file') {
            payloadContent = selectedFilePath;
            // 校验
            if (!payloadContent) {
                statusMsg.innerText = "错误：未选择任何文件！";
                statusMsg.style.color = "red";
                return;
            }
        }

        // 步骤 B: 锁定 UI
        btnRun.disabled = true;
        btnRun.innerText = "正在处理...";
        statusMsg.innerText = "";

        // 步骤 C: 收集配置
        const getCheck = (id) => get(id) ? get(id).checked : false;
        const getVal = (id) => get(id) ? get(id).value : '';
        
        const options = {
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

        try {
            // 步骤 D: 发送请求
            const payload = {
                type: payloadType,     // 'paste' 或 'file'
                content: payloadContent, // 代码字符串 或 文件路径
                options: options
            };

            const result = await window.electronAPI.obfuscate(payload);

            if (result.success) {
                statusMsg.innerText = "混淆成功！";
                statusMsg.style.color = "green";
                get('resultOutput').value = result.code || `文件已保存至: ${result.path}`;
                setMode('result'); // 自动跳到结果页
            } else {
                throw new Error(result.message);
            }
        } catch (err) {
            console.error(err);
            statusMsg.innerText = "失败: " + err.message;
            statusMsg.style.color = "red";
        } finally {
            btnRun.disabled = false;
            btnRun.innerText = "混淆加密";
        }
    });

    // 预设逻辑 (保留)
    document.querySelectorAll('input[name="preset"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
             if(e.target.value === 'high') {
                 if(get('controlFlowFlattening')) get('controlFlowFlattening').checked = true;
             }
        });
    });
});