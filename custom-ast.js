/**
 * custom-ast.js (v12.0 简写修复 + 深度粉碎版)
 * 修复核心 BUG：处理对象简写属性 { vless } -> { [Code]: vless }
 * 新增特性：导入/导出变量重命名
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// 默认敏感词库
const DEFAULT_CONFIG = {
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode', 'cdn', 'allowinsecure', 'flow', 'level',
        'fingerprint', 'server_name', 'public_key', 'short_id', 'type'
    ],
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'fromCharCode', 'String', 'Math', 'Date', 'JSON', 'Promise',
        'exports', 'require', 'module', 'import', 'then', 'catch', 'finally',
        'process', 'Buffer'
    ]
};

// 工具：生成随机变量名 (_0x...)
function generateRandomName() {
    return '_0x' + Math.random().toString(36).substring(2, 8);
}

// 工具：生成 String.fromCharCode 节点
function stringToCharCodeCall(str) {
    const charCodes = [];
    for (let i = 0; i < str.length; i++) {
        charCodes.push(t.numericLiteral(str.charCodeAt(i)));
    }
    return t.callExpression(
        t.memberExpression(t.identifier('String'), t.identifier('fromCharCode')),
        charCodes
    );
}

function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v12.0] AST 引擎启动: 简写属性修复 + 深度粉碎");

        // 1. 准备词库
        let activeSensitiveWords = [...DEFAULT_CONFIG.SENSITIVE_WORDS];
        if (options.sensitiveWords && Array.isArray(options.sensitiveWords)) {
            const userWords = options.sensitiveWords
                .map(w => w.toLowerCase().trim())
                .filter(w => w.length > 0);
            if (userWords.length > 0) {
                activeSensitiveWords = [...new Set([...activeSensitiveWords, ...userWords])];
            }
        }

        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        const isSensitive = (name) => {
            if (!name || typeof name !== 'string') return false;
            if (DEFAULT_CONFIG.PROTECTED_KEYS.includes(name)) return false;
            const lower = name.toLowerCase();
            return activeSensitiveWords.some(w => lower.includes(w)) || /[\u4e00-\u9fa5]/.test(name);
        };

        // --- Phase 1: 结构变换 (Object/String/Member) ---
        traverse(ast, {
            // [规则A] 对象属性 (含简写修复)
            // { vless }  -->  { [String.fromCharCode(...)]: vless }
            "ObjectProperty|ClassProperty"(path) {
                const keyNode = path.node.key;
                let keyName = '';

                if (t.isIdentifier(keyNode) && !path.node.computed) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (isSensitive(keyName)) {
                    // ★★★ 核心修复：如果是简写属性 (shorthand)，必须手动拆解 ★★★
                    if (path.node.shorthand) {
                        path.node.shorthand = false; // 关闭简写标记
                        path.node.value = t.identifier(keyName); // 显式设置值为原变量名
                    }

                    path.node.computed = true;
                    path.node.key = stringToCharCodeCall(keyName);
                }
            },

            // [规则B] 属性访问
            // obj.vless --> obj[String.fromCharCode(...)]
            "MemberExpression|OptionalMemberExpression"(path) {
                if (!path.node.computed && t.isIdentifier(path.node.property)) {
                    const propName = path.node.property.name;
                    if (isSensitive(propName)) {
                        path.node.computed = true;
                        path.node.property = stringToCharCodeCall(propName);
                    }
                }
            },

            // [规则C] 字符串字面量
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                // 注意：ObjectProperty 的 key 已经被 规则A 处理，不要重复处理
                if ((path.parentPath.isObjectProperty() || path.parentPath.isClassProperty()) && path.key === 'key') return;

                if (isSensitive(val)) {
                    path.replaceWith(stringToCharCodeCall(val));
                    path.skip();
                }
            },

            // [规则D] 方法定义 vless() {} -> [Code]() {}
            "ObjectMethod|ClassMethod"(path) {
                const keyNode = path.node.key;
                if (t.isIdentifier(keyNode) && !path.node.computed) {
                    const keyName = keyNode.name;
                    if (isSensitive(keyName)) {
                        path.node.computed = true;
                        path.node.key = stringToCharCodeCall(keyName);
                    }
                }
            },

            // [规则E] 导入说明符 import { vless } from ...
            // 不能改 source，但可以改 local 变量名: import { vless as _0x... }
            ImportSpecifier(path) {
                const importedName = t.isIdentifier(path.node.imported) ? path.node.imported.name : path.node.imported.value;
                const localName = path.node.local.name;
                
                // 如果本地变量名是敏感词，且没有被重命名过
                if (isSensitive(localName) && importedName === localName) {
                    const newName = generateRandomName();
                    path.scope.rename(localName, newName);
                }
            }
        });

        // --- Phase 2: 变量重命名 (Scope) ---
        // 放在 Phase 1 之后，确保对象属性已经被转换为 computed，不依赖变量名了
        traverse(ast, {
            Scope(path) {
                const bindings = path.scope.bindings;
                for (const oldName in bindings) {
                    if (isSensitive(oldName)) {
                        const newName = generateRandomName();
                        try {
                            path.scope.rename(oldName, newName);
                        } catch (e) {}
                    }
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
        console.error("AST 引擎错误:", error);
        return code;
    }
}

module.exports = applyCustomRules;
