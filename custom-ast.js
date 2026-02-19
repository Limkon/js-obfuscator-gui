/**
 * custom-ast.js (v14.0 外科手术式 XOR 版)
 * 特点：
 * 1. 体积极小：只对敏感词做 Hex+XOR 处理，不膨胀代码。
 * 2. 彻底隐藏：自定义解密函数，混淆器无法还原。
 * 3. 变量重命名：物理消除 vless 变量名。
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    // 敏感词库
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode', 'cdn', 'allowinsecure', 'flow', 'level',
        'fingerprint', 'server_name', 'public_key', 'short_id', 'type', 'alpn'
    ],
    // 保护名单
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'exports', 'require', 'module', 'import', 'then', 'catch', 'finally',
        'process', 'Buffer', 'map', 'forEach', 'filter', 'push', 'pop'
    ],
    // 解密函数名 (随机短名称，节省体积)
    DECODER_NAME: '_' + Math.random().toString(36).substring(2, 5),
    // 简单的 XOR 密钥 (单字符即可，节省体积)
    XOR_KEY: Math.floor(Math.random() * 9) + 1 // 1-9 之间的数字
};

// 1. XOR 加密逻辑 (编译时运行)
function xorEncrypt(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        // 异或运算
        let code = str.charCodeAt(i) ^ CONFIG.XOR_KEY;
        hex += code.toString(16).padStart(2, '0');
    }
    return hex;
}

// 2. 构造解密函数 AST (注入到代码头部)
// function _rx(h) { var s=''; for(var i=0;i<h.length;i+=2) s+=String.fromCharCode(parseInt(h.substr(i,2),16)^KEY); return s; }
function createDecoderFunction() {
    const hexParam = t.identifier('h');
    const strVar = t.identifier('s');
    const loopVar = t.identifier('i');
    
    return t.functionDeclaration(
        t.identifier(CONFIG.DECODER_NAME),
        [hexParam],
        t.blockStatement([
            t.variableDeclaration('var', [t.variableDeclarator(strVar, t.stringLiteral(''))]),
            t.forStatement(
                t.variableDeclaration('var', [t.variableDeclarator(loopVar, t.numericLiteral(0))]),
                t.binaryExpression('<', loopVar, t.memberExpression(hexParam, t.identifier('length'))),
                t.assignmentExpression('+=', loopVar, t.numericLiteral(2)),
                t.blockStatement([
                    t.expressionStatement(
                        t.assignmentExpression('+=', strVar,
                            t.callExpression(
                                t.memberExpression(t.identifier('String'), t.identifier('fromCharCode')),
                                [
                                    t.binaryExpression('^', 
                                        t.callExpression(t.identifier('parseInt'), [
                                            t.callExpression(t.memberExpression(hexParam, t.identifier('substr')), [loopVar, t.numericLiteral(2)]),
                                            t.numericLiteral(16)
                                        ]),
                                        t.numericLiteral(CONFIG.XOR_KEY)
                                    )
                                ]
                            )
                        )
                    )
                ])
            ),
            t.returnStatement(strVar)
        ])
    );
}

// 3. 生成调用节点: _rx("加密的Hex")
function createDecoderCall(originalStr) {
    const encrypted = xorEncrypt(originalStr);
    return t.callExpression(
        t.identifier(CONFIG.DECODER_NAME),
        [t.stringLiteral(encrypted)]
    );
}

// 生成随机变量名
function generateRandomName() {
    return '_' + Math.random().toString(36).substring(2, 6);
}

function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(`>>> [v14.0] 启动轻量级混淆: XOR[Key=${CONFIG.XOR_KEY}] + 变量清洗`);

        // 合并用户关键词
        let activeSensitiveWords = [...CONFIG.SENSITIVE_WORDS];
        if (options.sensitiveWords && Array.isArray(options.sensitiveWords)) {
            const userWords = options.sensitiveWords
                .map(w => w.toLowerCase().trim())
                .filter(w => w.length > 0);
            if (userWords.length > 0) activeSensitiveWords = [...new Set([...activeSensitiveWords, ...userWords])];
        }

        const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript', 'classProperties'] });

        const isSensitive = (name) => {
            if (!name || typeof name !== 'string') return false;
            if (CONFIG.PROTECTED_KEYS.includes(name)) return false;
            const lower = name.toLowerCase();
            return activeSensitiveWords.some(w => lower.includes(w)) || /[\u4e00-\u9fa5]/.test(name);
        };

        let hasInjected = false;

        // --- Phase 1: 变量物理重命名 (解决 vless 变量残留) ---
        traverse(ast, {
            Scope(path) {
                for (const oldName in path.scope.bindings) {
                    if (isSensitive(oldName)) {
                        const newName = generateRandomName();
                        try { path.scope.rename(oldName, newName); } catch (e) {}
                    }
                }
            },
            // 处理 import { vless } 别名
            ImportSpecifier(path) {
                const localName = path.node.local.name;
                const importedName = t.isIdentifier(path.node.imported) ? path.node.imported.name : path.node.imported.value;
                if (isSensitive(localName) && localName === importedName) {
                    const newName = generateRandomName();
                    path.scope.rename(localName, newName);
                }
            }
        });

        // --- Phase 2: 字符串与属性加密 (解决关键字残留) ---
        traverse(ast, {
            // 1. 对象/类属性
            "ObjectProperty|ClassProperty"(path) {
                const keyNode = path.node.key;
                let keyName = '';
                if (t.isIdentifier(keyNode) && !path.node.computed) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (isSensitive(keyName)) {
                    // [关键] 修复简写属性 { vless } -> { vless: vless }
                    if (path.node.shorthand) {
                        path.node.shorthand = false;
                        path.node.value = t.identifier(keyName); 
                    }
                    path.node.computed = true;
                    path.node.key = createDecoderCall(keyName);
                }
            },
            // 2. 属性访问 obj.vless
            "MemberExpression|OptionalMemberExpression"(path) {
                if (!path.node.computed && t.isIdentifier(path.node.property)) {
                    const propName = path.node.property.name;
                    if (isSensitive(propName)) {
                        path.node.computed = true;
                        path.node.property = createDecoderCall(propName);
                    }
                }
            },
            // 3. 字符串值
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                if ((path.parentPath.isObjectProperty() || path.parentPath.isClassProperty()) && path.key === 'key') return;

                if (isSensitive(val)) {
                    path.replaceWith(createDecoderCall(val));
                    path.skip();
                }
            },
            // 4. 方法名
            "ObjectMethod|ClassMethod"(path) {
                const keyNode = path.node.key;
                if (t.isIdentifier(keyNode) && !path.node.computed) {
                    if (isSensitive(keyNode.name)) {
                        path.node.computed = true;
                        path.node.key = createDecoderCall(keyNode.name);
                    }
                }
            },
            // 5. 注入解密函数
            Program: {
                exit(path) {
                    if (!hasInjected) {
                        path.node.body.unshift(createDecoderFunction());
                        hasInjected = true;
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
