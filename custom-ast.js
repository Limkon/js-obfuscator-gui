/**
 * custom-ast.js (v6.0 核爆版)
 * 修复：模板字符串漏网、防止 Simplify 自动合并、全量 Unicode
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
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws'
    ],
    // 保护名单 (Worker API)
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join'
    ]
};

// 强力加密：中文转 Unicode，英文转 Hex
function encryptString(str) {
    if (!str) return str;
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        // 策略：所有非标准 ASCII 或者是敏感字符，都强制 4位 Unicode
        if (code > 126 || code < 32) {
             result += '\\u' + code.toString(16).padStart(4, '0');
        } else {
             result += '\\x' + code.toString(16).padStart(2, '0');
        }
    }
    return result;
}

// 核心黑科技：使用 Array.join('') 替代 + 号拼接
// "vless" -> ['\x76\x6c', '\x65\x73\x73'].join('')
// 这种结构极难被后续的混淆器自动合并
function splitAndEncryptToArrayJoin(str) {
    // 1. 如果太短或含中文，整体加密
    if (str.length < 4 || /[\u4e00-\u9fa5]/.test(str)) {
        const enc = encryptString(str);
        const node = t.stringLiteral(str);
        node.extra = { rawValue: str, raw: '"' + enc + '"' };
        return node;
    }

    // 2. 拆分字符串
    const mid = Math.floor(str.length / 2);
    const part1 = str.slice(0, mid);
    const part2 = str.slice(mid);

    // 3. 创建数组元素
    const node1 = t.stringLiteral(part1);
    node1.extra = { rawValue: part1, raw: '"' + encryptString(part1) + '"' };
    
    const node2 = t.stringLiteral(part2);
    node2.extra = { rawValue: part2, raw: '"' + encryptString(part2) + '"' };

    // 4. 构建 ArrayExpression: ['a', 'b']
    const arrayExpr = t.arrayExpression([node1, node2]);

    // 5. 构建 CallExpression: ['a', 'b'].join('')
    const joinMember = t.memberExpression(arrayExpr, t.identifier('join'));
    const callExpr = t.callExpression(joinMember, [t.stringLiteral('')]);
    
    return callExpr;
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v6.0] 正在执行核爆级混淆 (反合并 + 模板字符串覆盖)...");
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        traverse(ast, {
            // [规则1]: 对象属性键名 (vless: ...)
            ObjectProperty(path) {
                let keyNode = path.node.key;
                let keyName = '';

                if (t.isIdentifier(keyNode)) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                if (CONFIG.PROTECTED_KEYS.includes(keyName)) return;

                // 强制加密所有非白名单键名
                path.node.key = t.stringLiteral(keyName);
                path.node.key.extra = {
                    rawValue: keyName,
                    raw: '"' + encryptString(keyName) + '"'
                };
            },

            // [规则2]: 普通字符串 (StringLiteral)
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                if (path.parentPath.isObjectProperty() && path.key === 'key') return; // 已处理
                
                // 检查保护名单
                if (CONFIG.PROTECTED_KEYS.includes(val)) return;

                const lowerVal = val.toLowerCase();
                const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => lowerVal.includes(w));

                // 如果是敏感词 -> 使用 Array.join 拆分技术
                if (isSensitive) {
                    const splitNode = splitAndEncryptToArrayJoin(val);
                    path.replaceWith(splitNode);
                    path.skip();
                    return;
                }

                // 其他字符串 -> 强制 Unicode/Hex
                if (val.length > 2) { // 极短的跳过以防误伤
                    path.node.extra = {
                        rawValue: val,
                        raw: '"' + encryptString(val) + '"'
                    };
                }
            },

            // [规则3]: 模板字符串 (TemplateLiteral) -> `vless://${uuid}`
            // Babel 解析为: quasis (静态部分) + expressions (变量)
            TemplateLiteral(path) {
                const quasis = path.node.quasis;
                
                quasis.forEach(quasi => {
                    if (quasi.value.raw) {
                        const val = quasi.value.raw;
                        // 检测敏感词
                        const isSensitive = CONFIG.SENSITIVE_WORDS.some(w => val.toLowerCase().includes(w));
                        const isChinese = /[\u4e00-\u9fa5]/.test(val);

                        if (isSensitive || isChinese) {
                            // 模板字符串内部无法直接拆分结构，只能做强力 Unicode 编码
                            // 所有的 `vless` 都会变成 `\u0076\u006c...`
                            // 这里的 raw 属性会直接影响输出
                            const enc = encryptString(val);
                            quasi.value.raw = enc;
                            quasi.value.cooked = val; // cooked 保持原样以免逻辑错误
                        }
                    }
                });
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
        console.error("v6.0 混淆失败:", error);
        return code;
    }
}

module.exports = applyCustomRules;
