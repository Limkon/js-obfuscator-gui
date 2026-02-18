/**
 * custom-ast.js (v11.0 全维覆盖版)
 * 新增特性：
 * 1. 拦截属性访问 (obj.vless -> obj[String.fromCharCode(...)])
 * 2. 拦截对象/类方法 (vless() {} -> [String.fromCharCode...]() {})
 * 3. 拦截正则表达式 (/vless/ -> new RegExp(...))
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// 默认配置
const DEFAULT_CONFIG = {
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode', 'cdn', 'allowinsecure', 'flow', 'level',
        'fingerprint', 'server_name', 'public_key', 'short_id'
    ],
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'fromCharCode', 'String', 'Math', 'Date', 'JSON', 'Promise',
        'exports', 'require', 'module', 'import', 'then', 'catch', 'finally'
    ]
};

// 工具：生成 _0x 随机变量名
function generateRandomName() {
    return '_0x' + Math.random().toString(36).substring(2, 8);
}

// 工具：构造 String.fromCharCode 节点
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
        console.log(">>> [v11.0] AST 引擎启动: 全语法树覆盖模式");

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

        // 敏感词判定函数
        const isSensitive = (name) => {
            if (!name || typeof name !== 'string') return false;
            if (DEFAULT_CONFIG.PROTECTED_KEYS.includes(name)) return false;
            const lower = name.toLowerCase();
            return activeSensitiveWords.some(w => lower.includes(w)) || /[\u4e00-\u9fa5]/.test(name);
        };

        // --- 核心遍历逻辑 ---
        
        // 1. 变量重命名 (Scope)
        traverse(ast, {
            Scope(path) {
                const bindings = path.scope.bindings;
                for (const oldName in bindings) {
                    if (isSensitive(oldName)) {
                        const newName = generateRandomName();
                        try { path.scope.rename(oldName, newName); } catch (e) {}
                    }
                }
            }
        });

        // 2. 深度语法节点替换
        traverse(ast, {
            // [规则A] 属性定义 (对象/类)
            // { vless: 1 } 或 class X { vless() {} }
            "ObjectProperty|ObjectMethod|ClassMethod|ClassProperty"(path) {
                const keyNode = path.node.key;
                let keyName = '';

                // 获取键名
                if (t.isIdentifier(keyNode) && !path.node.computed) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (isSensitive(keyName)) {
                    path.node.computed = true;
                    path.node.key = stringToCharCodeCall(keyName);
                }
            },

            // [规则B] ★★★ 核心新增：属性访问 ★★★
            // config.vless  ->  config[String.fromCharCode(...)]
            "MemberExpression|OptionalMemberExpression"(path) {
                const propNode = path.node.property;
                // 只有当是用点号访问（computed=false）且属性是标识符时才处理
                if (!path.node.computed && t.isIdentifier(propNode)) {
                    const propName = propNode.name;
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
                
                // 跳过 import/export 声明 (无法动态化)
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                // 跳过对象键 (已由规则A处理)
                if ((path.parentPath.isObjectProperty() || path.parentPath.isObjectMethod()) && path.key === 'key') return;

                if (isSensitive(val)) {
                    path.replaceWith(stringToCharCodeCall(val));
                    path.skip();
                }
            },

            // [规则D] 模板字符串
            TemplateLiteral(path) {
                path.node.quasis.forEach(quasi => {
                    if (quasi.value.raw && isSensitive(quasi.value.raw)) {
                        let res = '';
                        const val = quasi.value.raw;
                        for (let i = 0; i < val.length; i++) {
                            res += '\\u' + val.charCodeAt(i).toString(16).padStart(4, '0');
                        }
                        quasi.value.raw = res;
                        quasi.value.cooked = val;
                    }
                });
            },

            // [规则E] 正则表达式 /vless/ -> new RegExp(String.fromCharCode(...))
            RegExpLiteral(path) {
                const pattern = path.node.pattern;
                const flags = path.node.flags;
                if (isSensitive(pattern)) {
                    // 构建 new RegExp(patternCode, flagsCode)
                    const patternNode = stringToCharCodeCall(pattern);
                    const flagsNode = t.stringLiteral(flags);
                    
                    const newRegExp = t.newExpression(t.identifier('RegExp'), [patternNode, flagsNode]);
                    path.replaceWith(newRegExp);
                    path.skip();
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
