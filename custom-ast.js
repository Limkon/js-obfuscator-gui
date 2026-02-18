/**
 * custom-ast.js (全量加密壳版)
 * 策略：将源码整体加密为字符串，运行时动态解密执行 (eval/Function)
 * 效果：源码中彻底找不到任何关键字，只有密文。
 */
const Terser = require('terser');

// 简单的 XOR 加密算法 (轻量、混淆后难以识别)
function xorEncrypt(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    // 转为 Base64 防止字符集问题
    return Buffer.from(result).toString('base64');
}

// 生成随机密钥
function generateKey(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * @param {string} code 源代码
 * @param {object} options 配置
 */
function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    console.log(">>> [Packer] 正在执行全量代码加密壳模式...");

    try {
        // 1. 先进行极度压缩 (去掉空格、换行、注释)
        // 这一步是为了让 vless 等关键字跟周围代码挤在一起，且减小体积
        let minified = code;
        try {
            // 尝试使用 terser 压缩，如果失败则降级使用原代码
            const minifyResult = require('terser').minify(code, {
                compress: { passes: 2 },
                mangle: false // 不重命名，防止破坏 Worker 某些特定变量
            });
            if (minifyResult.code) minified = minifyResult.code;
        } catch (e) {
            console.warn("压缩失败，将使用未压缩代码加密:", e.message);
        }

        // 2. 生成随机密钥
        const key = generateKey(10 + Math.floor(Math.random() * 10));

        // 3. 加密源代码
        const encryptedCode = xorEncrypt(minified, key);

        // 4. 生成加载器代码 (Loader)
        // 这段代码负责在运行时解密并运行
        // 注意：我们使用 new Function 而不是 eval，兼容性更好
        const loaderCode = `
(function(c, k) {
    var b = function(s) {
        // Base64 Decode (兼容 Node 和 Browser)
        if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('binary');
        else return atob(s);
    };
    var x = function(t, k) {
        var r = '';
        var d = b(t);
        for (var i = 0; i < d.length; i++) {
            r += String.fromCharCode(d.charCodeAt(i) ^ k.charCodeAt(i % k.length));
        }
        return r;
    };
    var s = x(c, k);
    // 核心：动态执行
    // 这里的 console.log 是为了证明它跑起来了，生产环境可以去掉
    var f = new Function(s);
    return f();
})("${encryptedCode}", "${key}");
        `;

        console.log(`>>> [Packer] 加密完成。原始大小: ${code.length}, 加密后 payload: ${encryptedCode.length}`);
        
        return loaderCode;

    } catch (error) {
        console.error("Packer 致命错误:", error);
        return code;
    }
}

module.exports = applyCustomRules;
