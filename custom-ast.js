/**
 * custom-ast.js (v15.0 字典映射版)
 * 核心策略：
 * 1. 提取所有敏感词和中文 -> 存入全局字典 _G
 * 2. 源码中所有出现的地方 -> 替换为 _G.key
 * 3. 字典本身使用 Hex/Unicode 编码，防止被搜索
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    // 敏感词库 (不区分大小写)
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode', 'cdn', 'allowinsecure', 'flow', 'level',
        'fingerprint', 'server_name', 'public_key', 'short_id', 'type', 'alpn',
        'serviceName', 'headerType', 'uTLS'
    ],
    // 保护名单 (Worker API)
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'exports', 'require', 'module', 'import', 'then', 'catch', 'finally',
        'process', 'Buffer', 'map', 'forEach', 'filter', 'push', 'pop',
        'JSON', 'Math', 'Date', 'Promise'
    ],
    // 字典变量名 (极简，防止体积膨胀)
    DICT_VAR: '_D', 
    // 混淆 Key 前缀
    KEY_PREFIX: 'k' 
};

// 简单的字符串转 Hex (用于加密字典内容)
function stringToHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        hex += '\\x' + str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
}

// 生成随机变量名
function generateRandomName() {
    return '_' + Math.random().toString(36).substring(2, 6);
}

function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(`>>> [v15.0] 启动字典映射模式: 敏感词与中文全量提取...`);

        // 1. 合并用户关键词
        let activeSensitiveWords = [...CONFIG.SENSITIVE_WORDS];
        if (options.sensitiveWords && Array.isArray(options.sensitiveWords)) {
            const userWords = options.sensitiveWords
                .map(w => w.toLowerCase().trim())
                .filter(w => w.length > 0);
            if (userWords.length > 0) activeSensitiveWords = [...new Set([...activeSensitiveWords, ...userWords])];
        }

        const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript', 'classProperties'] });

        // 映射表: 真实字符串 -> 字典Key (e.g. "vless" -> "k1")
        const stringMap = new Map();
        let keyCounter = 0;

        // 判定函数：是否需要混淆
        const needObfuscate = (str) => {
            if (!str || str.length < 2) return false;
            if (CONFIG.PROTECTED_KEYS.includes(str)) return false;
            
            // 只要包含中文，必须混淆
            if (/[\u4e00-\u9fa5]/.test(str)) return true;
            
            // 如果是敏感词，必须混淆
            const lower = str.toLowerCase();
            return activeSensitiveWords.some(w => lower.includes(w));
        };

        // 获取或创建字典引用节点 (_D.k1)
        const getDictRef = (str) => {
            let key;
            if (stringMap.has(str)) {
                key = stringMap.get(str);
            } else {
                key = CONFIG.KEY_PREFIX + (keyCounter++).toString(36);
                stringMap.set(str, key);
            }
            return t.memberExpression(t.identifier(CONFIG.DICT_VAR), t.identifier(key));
        };

        // --- Phase 1: 物理重命名变量 (消除 vless 变量定义) ---
        traverse(ast, {
            Scope(path) {
                for (const oldName in path.scope.bindings) {
                    if (needObfuscate(oldName)) {
                        const newName = generateRandomName();
                        try { path.scope.rename(oldName, newName); } catch (e) {}
                    }
                }
            },
            ImportSpecifier(path) {
                const localName = path.node.local.name;
                const importedName = t.isIdentifier(path.node.imported) ? path.node.imported.name : path.node.imported.value;
                if (needObfuscate(localName) && localName === importedName) {
                    const newName = generateRandomName();
                    path.scope.rename(localName, newName);
                }
            }
        });

        // --- Phase 2: 替换所有字符串和属性引用为字典引用 ---
        traverse(ast, {
            // 1. 字符串值 "vless" -> _D.k1
            StringLiteral(path) {
                const val = path.node.value;
                if (!needObfuscate(val)) return;
                
                // 跳过 import/export 声明
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                // 跳过对象键 (由下方规则处理)
                if ((path.parentPath.isObjectProperty() || path.parentPath.isClassProperty()) && path.key === 'key') return;

                path.replaceWith(getDictRef(val));
                path.skip();
            },

            // 2. 对象属性 { vless: ... } -> { [_D.k1]: ... }
            "ObjectProperty|ClassProperty"(path) {
                const keyNode = path.node.key;
                let keyName = '';
                if (t.isIdentifier(keyNode) && !path.node.computed) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (needObfuscate(keyName)) {
                    // 修复简写
                    if (path.node.shorthand) {
                        path.node.shorthand = false;
                        path.node.value = t.identifier(keyName);
                    }
                    path.node.computed = true;
                    path.node.key = getDictRef(keyName);
                }
            },

            // 3. 属性访问 obj.vless -> obj[_D.k1]
            "MemberExpression|OptionalMemberExpression"(path) {
                if (!path.node.computed && t.isIdentifier(path.node.property)) {
                    const propName = path.node.property.name;
                    if (needObfuscate(propName)) {
                        path.node.computed = true;
                        path.node.property = getDictRef(propName);
                    }
                }
            },

            // 4. 方法名 vless() -> [_D.k1]()
            "ObjectMethod|ClassMethod"(path) {
                const keyNode = path.node.key;
                if (t.isIdentifier(keyNode) && !path.node.computed) {
                    if (needObfuscate(keyNode.name)) {
                        path.node.computed = true;
                        path.node.key = getDictRef(keyNode.name);
                    }
                }
            },

            // 5. 模板字符串
            TemplateLiteral(path) {
                 path.node.quasis.forEach(quasi => {
                    if (quasi.value.raw && needObfuscate(quasi.value.raw)) {
                        // 模板字符串无法直接替换为 MemberExpression，只能降级为 Unicode
                         let res = '';
                        const val = quasi.value.raw;
                        for (let i = 0; i < val.length; i++) {
                            res += '\\u' + val.charCodeAt(i).toString(16).padStart(4, '0');
                        }
                        quasi.value.raw = res;
                        quasi.value.cooked = val;
                    }
                });
            }
        });

        // --- Phase 3: 注入字典定义 ---
        // const _D = { k1: "vless", k2: "uuid" };
        if (stringMap.size > 0) {
            const properties = [];
            for (const [str, key] of stringMap.entries()) {
                // 值使用 Hex 编码，防止明文出现在字典里
                const hexVal = stringToHex(str);
                const valNode = t.stringLiteral(str);
                valNode.extra = { rawValue: str, raw: '"' + hexVal + '"' };
                
                properties.push(t.objectProperty(t.identifier(key), valNode));
            }
            
            const dictDeclaration = t.variableDeclaration('var', [
                t.variableDeclarator(
                    t.identifier(CONFIG.DICT_VAR),
                    t.objectExpression(properties)
                )
            ]);

            // 插入到程序最顶端
            const body = ast.program.body;
            body.unshift(dictDeclaration);
        }

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
