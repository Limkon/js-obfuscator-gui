/**
 * custom-ast.js (v13.0 黑盒运行时解密版)
 * 核心策略：
 * 1. 在代码头部注入一个自定义的解密函数 (Runtime Decoder)。
 * 2. 将所有敏感词转换为 Hex 编码，并替换为对该函数的调用。
 * 3. 混淆器无法理解自定义函数逻辑，因此无法还原明文。
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
        'fingerprint', 'server_name', 'public_key', 'short_id', 'type',
        'alpn', 'serviceName', 'headerType', 'uTLS', 'names'
    ],
    // 保护名单
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'fromCharCode', 'String', 'Math', 'Date', 'JSON', 'Promise',
        'exports', 'require', 'module', 'import', 'then', 'catch', 'finally',
        'process', 'Buffer', 'map', 'forEach', 'filter', 'push', 'pop'
    ],
    // 注入的解密函数名 (随机化防止冲突)
    DECODER_NAME: '_$hex_' + Math.random().toString(36).substring(2, 6)
};

// 1. 将字符串转换为 Hex (e.g. "vless" -> "766c657373")
function stringToHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
}

// 2. 构造解密函数 AST
// function _$hex_xxxx(hex) {
//     var str = '';
//     for (var i = 0; i < hex.length; i += 2)
//         str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
//     return str;
// }
function createDecoderFunction(name) {
    const hexParam = t.identifier('h');
    const strVar = t.identifier('s');
    const iterVar = t.identifier('i');
    
    return t.functionDeclaration(
        t.identifier(name),
        [hexParam],
        t.blockStatement([
            t.variableDeclaration('var', [
                t.variableDeclarator(strVar, t.stringLiteral(''))
            ]),
            t.forStatement(
                t.variableDeclaration('var', [
                    t.variableDeclarator(iterVar, t.numericLiteral(0))
                ]),
                t.binaryExpression('<', iterVar, t.memberExpression(hexParam, t.identifier('length'))),
                t.assignmentExpression('+=', iterVar, t.numericLiteral(2)),
                t.blockStatement([
                    t.expressionStatement(
                        t.assignmentExpression('+=', strVar, 
                            t.callExpression(
                                t.memberExpression(t.identifier('String'), t.identifier('fromCharCode')),
                                [
                                    t.callExpression(t.identifier('parseInt'), [
                                        t.callExpression(t.memberExpression(hexParam, t.identifier('substr')), [iterVar, t.numericLiteral(2)]),
                                        t.numericLiteral(16)
                                    ])
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

// 3. 生成调用节点: _$hex_xxxx("766c657373")
function createDecoderCall(name, originalStr) {
    const hex = stringToHex(originalStr);
    return t.callExpression(
        t.identifier(name),
        [t.stringLiteral(hex)]
    );
}

function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(`>>> [v13.0] AST 引擎启动: 注入黑盒解密函数 [${CONFIG.DECODER_NAME}]`);

        // 合并用户关键词
        let activeSensitiveWords = [...CONFIG.SENSITIVE_WORDS];
        if (options.sensitiveWords && Array.isArray(options.sensitiveWords)) {
            const userWords = options.sensitiveWords
                .map(w => w.toLowerCase().trim())
                .filter(w => w.length > 0);
            if (userWords.length > 0) activeSensitiveWords = [...new Set([...activeSensitiveWords, ...userWords])];
        }

        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        // 敏感性检查
        const isSensitive = (name) => {
            if (!name || typeof name !== 'string') return false;
            if (CONFIG.PROTECTED_KEYS.includes(name)) return false;
            const lower = name.toLowerCase();
            return activeSensitiveWords.some(w => lower.includes(w)) || /[\u4e00-\u9fa5]/.test(name);
        };

        let hasInjected = false;

        // 遍历并替换
        traverse(ast, {
            // [规则1] 对象属性 (key: value)
            "ObjectProperty|ClassProperty"(path) {
                const keyNode = path.node.key;
                let keyName = '';

                if (t.isIdentifier(keyNode) && !path.node.computed) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (isSensitive(keyName)) {
                    // 修复简写属性 { vless } -> { vless: vless }
                    if (path.node.shorthand) {
                        path.node.shorthand = false;
                        path.node.value = t.identifier(keyName); 
                    }
                    // 转换为计算属性: { [_decode("hex")]: ... }
                    path.node.computed = true;
                    path.node.key = createDecoderCall(CONFIG.DECODER_NAME, keyName);
                }
            },

            // [规则2] 属性访问 (obj.vless)
            "MemberExpression|OptionalMemberExpression"(path) {
                if (!path.node.computed && t.isIdentifier(path.node.property)) {
                    const propName = path.node.property.name;
                    if (isSensitive(propName)) {
                        path.node.computed = true;
                        path.node.property = createDecoderCall(CONFIG.DECODER_NAME, propName);
                    }
                }
            },

            // [规则3] 字符串值 ("vless")
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                if ((path.parentPath.isObjectProperty() || path.parentPath.isClassProperty()) && path.key === 'key') return;

                if (isSensitive(val)) {
                    path.replaceWith(createDecoderCall(CONFIG.DECODER_NAME, val));
                    path.skip();
                }
            },

            // [规则4] 方法名
            "ObjectMethod|ClassMethod"(path) {
                const keyNode = path.node.key;
                if (t.isIdentifier(keyNode) && !path.node.computed) {
                    const keyName = keyNode.name;
                    if (isSensitive(keyName)) {
                        path.node.computed = true;
                        path.node.key = createDecoderCall(CONFIG.DECODER_NAME, keyName);
                    }
                }
            },
            
            // [规则5] 导入变量名重命名 (import { vless } ...)
            ImportSpecifier(path) {
                const localName = path.node.local.name;
                const importedName = t.isIdentifier(path.node.imported) ? path.node.imported.name : path.node.imported.value;
                if (isSensitive(localName) && localName === importedName) {
                    const newName = '_' + Math.random().toString(36).substr(2, 6);
                    path.scope.rename(localName, newName);
                }
            },

            // [规则6] 变量重命名 (Scope)
            Scope(path) {
                for (const oldName in path.scope.bindings) {
                    if (isSensitive(oldName)) {
                        const newName = '_' + Math.random().toString(36).substr(2, 6);
                        try { path.scope.rename(oldName, newName); } catch (e) {}
                    }
                }
            },

            // [规则7] 注入解密函数 (只在 Program 根节点注入一次)
            Program: {
                exit(path) {
                    if (!hasInjected) {
                        const decoderFunc = createDecoderFunction(CONFIG.DECODER_NAME);
                        // 插入到代码最前面
                        path.node.body.unshift(decoderFunc);
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
