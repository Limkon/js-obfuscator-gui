/**
 * custom-ast.js (v5.0 终极碎片化版)
 * 核心功能：敏感词拆分拼接、非白名单全量加密、防止后续工具还原
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    // 1. 敏感词：遇到这些词，必须拆分 + 加密！(防止被还原)
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws'
    ],

    // 2. 保护名单：Worker 运行时必需的 API，绝对不能动
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'console', 'log', 'error', 'warn', 'info'
    ]
};

// 混合加密函数
function encryptString(str) {
    if (!str) return str;
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        // 策略：为了防止被还原，尽量使用 \u (4位)，虽然体积大但更安全
        if (code < 128) {
             result += '\\x' + code.toString(16).padStart(2, '0');
        } else {
             result += '\\u' + code.toString(16).padStart(4, '0');
        }
    }
    return result;
}

// 核心：敏感词拆分器
// 输入: "vless" -> BinaryExpression: "\x76\x6c" + "\x65\x73\x73"
function splitAndEncrypt(str) {
    // 如果字符串太短，或者包含中文，直接整体加密
    if (str.length < 4 || /[\u4e00-\u9fa5]/.test(str)) {
        const enc = encryptString(str);
        const literal = t.stringLiteral(str);
        literal.extra = { rawValue: str, raw: '"' + enc + '"' };
        return literal;
    }

    // 拆分逻辑：拦腰切断
    const mid = Math.floor(str.length / 2);
    const part1 = str.slice(0, mid);
    const part2 = str.slice(mid);

    // 加密左半部分
    const leftNode = t.stringLiteral(part1);
    leftNode.extra = { rawValue: part1, raw: '"' + encryptString(part1) + '"' };

    // 加密右半部分
    const rightNode = t.stringLiteral(part2);
    rightNode.extra = { rawValue: part2, raw: '"' + encryptString(part2) + '"' };

    // 返回拼接表达式 (part1 + part2)
    return t.binaryExpression('+', leftNode, rightNode);
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v5.0] 执行终极混淆：敏感词拆分 + 全量覆盖...");
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        traverse(ast, {
            // [规则1]: 对象属性 (处理键名)
            ObjectProperty(path) {
                let keyNode = path.node.key;
                let keyName = '';

                // 1.1 获取键名
                if (t.isIdentifier(keyNode)) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                // 1.2 保护检查
                if (CONFIG.PROTECTED_KEYS.includes(keyName)) return;

                // 1.3 敏感词判定
                const lowerName = keyName.toLowerCase();
                const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => lowerName.includes(w));
                
                // 策略：敏感词必杀，其他非保护词也杀
                // 强制转换为 StringLiteral 并加密
                path.node.key = t.stringLiteral(keyName);
                path.node.key.extra = {
                    rawValue: keyName,
                    raw: '"' + encryptString(keyName) + '"'
                };
            },

            // [规则2]: 字符串字面量 (处理值)
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;

                // 跳过 import/export 语句
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                // 跳过对象键名 (规则1已处理)
                if (path.parentPath.isObjectProperty() && path.key === 'key') return;

                // 检查是否包含敏感词
                const lowerVal = val.toLowerCase();
                const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => lowerVal.includes(w));

                // 如果是敏感词 (如 "vless://...") -> 执行拆分加密！
                if (isSensitive) {
                    // console.log("发现敏感词，执行拆分:", val);
                    const splitNode = splitAndEncrypt(val);
                    path.replaceWith(splitNode);
                    path.skip(); // 跳过新生成的节点，防止死循环
                    return;
                }

                // 普通字符串 -> 只要不在保护名单，且包含特殊字符或长度够长，就加密
                // 检查是否在保护名单 (防止 env.KEY 这种取值被加密)
                if (CONFIG.PROTECTED_KEYS.includes(val)) return;

                // 执行普通加密
                path.node.extra = {
                    rawValue: val,
                    raw: '"' + encryptString(val) + '"'
                };
            }
        });

        const output = generator(ast, {
            minified: true,
            compact: true,
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("v5.0 混淆失败:", error);
        return code;
    }
}

module.exports = applyCustomRules;
