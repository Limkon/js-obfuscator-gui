/**
 * custom-ast.js (v4.0 精准平衡版)
 * 目标：中文必混淆、VLESS必隐藏、Worker不超时
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 必杀名单：这些键名必须加密 (不区分大小写) ---
const SENSITIVE_KEYS = [
    'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
    'uuid', 'password', 'ps', 'remark', 'remarks', 'name',
    'address', 'host', 'port', 'sni', 'server', 'ip',
    'alterid', 'security', 'type', 'network', 'grpc', 'ws'
];

// --- 保护名单：这些绝对不能动 (防止 Worker 挂掉) ---
const PROTECTED_KEYS = [
    'fetch', 'scheduled', 'addEventListener', 'handle',
    'env', 'ctx', 'request', 'response', 'headers', 
    'method', 'url', 'cf', 'body', 'redirect', 'status',
    'window', 'document', 'self', 'globalThis',
    'prototype', 'toString', 'length', 'substring', 'indexOf'
];

// 混合加密函数：中文用 Unicode，英文用 Hex
function encryptString(str) {
    if (!str) return str;
    let result = '';
    let hasNonAscii = false;

    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code > 127) {
            hasNonAscii = true;
            result += '\\u' + code.toString(16).padStart(4, '0');
        } else {
            result += '\\x' + code.toString(16).padStart(2, '0');
        }
    }
    return result;
}

// 判断是否包含中文字符 (或其他非 ASCII 字符)
function hasChineseOrSpecial(str) {
    // 只要有字符编码 > 127 (非标准ASCII)，就视为包含特殊字符/中文
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) return true;
    }
    return false;
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v4.0] 正在执行精准混淆 (VLESS隐藏 + 中文强制加密)...");
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        traverse(ast, {
            // [规则1]: 对象键名精准打击
            ObjectProperty(path) {
                const keyNode = path.node.key;
                let keyName = '';

                // 获取键名
                if (t.isIdentifier(keyNode)) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                const lowerKey = keyName.toLowerCase();

                // 1. 如果在保护名单，绝对不动
                if (PROTECTED_KEYS.includes(keyName)) return;

                // 2. 判定是否需要加密
                // 条件A: 在敏感词名单里 (VLESS, UUID 等)
                // 条件B: 包含中文
                const isSensitive = SENSITIVE_KEYS.some(k => lowerKey === k) || 
                                    SENSITIVE_KEYS.some(k => lowerKey.includes(k)); // 模糊匹配，如 "vless_server"
                const isChinese = hasChineseOrSpecial(keyName);

                if (isSensitive || isChinese) {
                    // 强制转为 StringLiteral 并加密
                    path.node.key = t.stringLiteral(keyName);
                    path.node.key.extra = {
                        rawValue: keyName,
                        raw: '"' + encryptString(keyName) + '"'
                    };
                }
            },

            // [规则2]: 字符串全量扫描
            StringLiteral(path) {
                const val = path.node.value;
                if (!val) return;

                // 跳过 import 语句 (import '...' from '...')
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                
                // 跳过作为对象键名的情况 (已经在规则1处理过了，或者是保护名单里的键)
                if (path.parentPath.isObjectProperty() && path.key === 'key') return;

                // 核心判断逻辑
                const isChinese = hasChineseOrSpecial(val);
                const isSensitive = SENSITIVE_KEYS.some(k => val.toLowerCase().includes(k)); // 内容包含 VLESS 等

                // 策略：
                // 1. 如果包含中文 -> 100% 加密
                // 2. 如果包含敏感词 -> 100% 加密
                // 3. 普通短字符串(长度<4) -> 不加密 (节省性能)
                // 4. 普通长字符串 -> 加密
                
                if (isChinese || isSensitive || val.length > 3) {
                    // 防止重复处理
                    if (path.node.extra && path.node.extra.raw && path.node.extra.raw.startsWith('\\')) return;

                    path.node.extra = {
                        rawValue: val,
                        raw: '"' + encryptString(val) + '"'
                    };
                }
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
        console.error("v4.0 混淆规则出错:", error);
        return code;
    }
}

module.exports = applyCustomRules;
