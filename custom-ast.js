/**
 * custom-ast.js (v7.0 终极 CharCode 版)
 * 核心策略：放弃字符串形式，强制转换为 String.fromCharCode(数字...)
 * 效果：源码中彻底消失 vless/中文，变为纯数字调用，混淆器无法还原。
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    // 必杀名单：遇到这些词，强制转换为 String.fromCharCode
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode'
    ],
    // 保护名单：Worker 运行时 API，保持原样以防报错
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'fromCharCode', 'String' // 保护我们自己生成的函数
    ]
};

// 核心转换工具：字符串 -> String.fromCharCode(118, ...)
function stringToCharCodeCall(str) {
    const charCodes = [];
    for (let i = 0; i < str.length; i++) {
        charCodes.push(t.numericLiteral(str.charCodeAt(i)));
    }
    
    // 构建 AST: String.fromCharCode(118, 108, ...)
    const stringIdentifier = t.identifier('String');
    const fromCharCodeIdentifier = t.identifier('fromCharCode');
    const memberExpr = t.memberExpression(stringIdentifier, fromCharCodeIdentifier);
    
    return t.callExpression(memberExpr, charCodes);
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v7.0] 正在执行 CharCode 动态化混淆 (物理消除字符串)...");
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        traverse(ast, {
            // [规则1]: 对象属性键名 (例如 { vless: ... })
            ObjectProperty(path) {
                let keyNode = path.node.key;
                let keyName = '';

                if (t.isIdentifier(keyNode)) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                // 白名单检查
                if (CONFIG.PROTECTED_KEYS.includes(keyName)) return;

                const lowerName = keyName.toLowerCase();
                const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => lowerName.includes(w));
                const isChinese = /[\u4e00-\u9fa5]/.test(keyName);

                // 只有敏感词或中文才处理，避免所有属性都变导致 Worker 性能下降
                if (isSensitive || isChinese) {
                    // 关键操作：将属性改为 "计算属性" (Computed Property)
                    // { vless: 1 }  ===>  { [String.fromCharCode(118...)]: 1 }
                    path.node.computed = true;
                    path.node.key = stringToCharCodeCall(keyName);
                }
            },

            // [规则2]: 字符串字面量
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                
                // 跳过 import/export/对象key(已处理)
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                if (path.parentPath.isObjectProperty() && path.key === 'key') return;

                if (CONFIG.PROTECTED_KEYS.includes(val)) return;

                const lowerVal = val.toLowerCase();
                const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => lowerVal.includes(w));
                const isChinese = /[\u4e00-\u9fa5]/.test(val);

                if (isSensitive || isChinese) {
                    // 替换为 String.fromCharCode(...)
                    const charCodeCall = stringToCharCodeCall(val);
                    path.replaceWith(charCodeCall);
                    path.skip(); // 防止重复处理
                }
            },

            // [规则3]: 模板字符串 (`vless://${uuid}`)
            TemplateLiteral(path) {
                const quasis = path.node.quasis;
                quasis.forEach(quasi => {
                    if (quasi.value.raw) {
                        const val = quasi.value.raw;
                        const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => val.toLowerCase().includes(w));
                        const isChinese = /[\u4e00-\u9fa5]/.test(val);

                        if (isSensitive || isChinese) {
                            // 模板字符串内部只能用 Unicode 转义，无法插入函数调用
                            // 这里回退到强力 Unicode 编码
                            let result = '';
                            for (let i = 0; i < val.length; i++) {
                                result += '\\u' + val.charCodeAt(i).toString(16).padStart(4, '0');
                            }
                            quasi.value.raw = result;
                            quasi.value.cooked = val;
                        }
                    }
                });
            }
        });

        // 生成代码 (minified=false 以便观察结构，交给后续混淆器压缩)
        const output = generator(ast, {
            minified: true,
            compact: true,
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("v7.0 混淆失败:", error);
        return code;
    }
}

module.exports = applyCustomRules;
