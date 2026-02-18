/**
 * custom-ast.js (v3.0 Worker 专用稳定版)
 * 优化：防超时设计、保护 fetch 入口、针对性加密 VLESS/UUID
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    // 关键：Worker 入口和常用对象属性白名单，绝对不能加密！
    // 加密这些会导致运行时找不到入口或原型链断裂
    reservedKeys: [
        'fetch', 'scheduled', 'addEventListener', 'handle', 
        'request', 'env', 'ctx', 'waitUntil', 'passThroughOnException',
        'headers', 'method', 'url', 'body', 'cf', 'redirect',
        'window', 'document', 'self', 'globalThis',
        'length', 'toString', 'substring', 'indexOf', 'push', 'join' 
    ],
    
    // 强制加密的敏感关键词 (即使在白名单也强制加密，优先级更高)
    forceEncrypt: ['VLESS', 'VMESS', 'TROJAN', 'UUID', 'uuid', 'port', 'address', 'host'],

    prefix: '_0xW' // W 代表 Worker 专用前缀
};

// 混合加密 (性能优化版)
function encryptString(str) {
    if (!str) return str;
    let result = '';
    // 为了性能，仅对非 ASCII 字符或敏感词进行重度 Unicode 加密
    // 普通字符使用较短的十六进制，减少体积
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 128) {
            result += '\\x' + code.toString(16).padStart(2, '0');
        } else {
            result += '\\u' + code.toString(16).padStart(4, '0');
        }
    }
    return result;
}

// 简单的标识符混淆
function generateWorkerName(index) {
    return CONFIG.prefix + index.toString(36); 
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v3.0] 正在应用 Worker 专用 AST 规则...");
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        let idCounter = 0;

        traverse(ast, {
            // [规则1]: 变量名/函数名重命名
            Scope(path) {
                const bindings = path.scope.bindings;
                Object.keys(bindings).forEach(oldName => {
                    // 跳过特定的全局变量名，虽然 Babel 只有局部作用域，但为了保险
                    if (oldName === 'fetch' || oldName === 'addEventListener') return;
                    
                    const newName = generateWorkerName(idCounter++);
                    try { path.scope.rename(oldName, newName); } catch (e) {}
                });
            },

            // [规则2]: 智能对象键名加密
            ObjectProperty(path) {
                const keyNode = path.node.key;
                if (!t.isIdentifier(keyNode) && !t.isStringLiteral(keyNode)) return;

                const keyName = t.isIdentifier(keyNode) ? keyNode.name : keyNode.value;
                
                // 策略：如果是白名单里的词，绝对不碰
                if (CONFIG.reservedKeys.includes(keyName) && !CONFIG.forceEncrypt.includes(keyName)) {
                    return; 
                }

                // 只有看起来像是敏感配置，或者不在白名单里的，才加密
                // 这样能保留 fetch: function() {...} 的原样，防止 CF 报错
                
                // 转换为字符串节点
                path.node.key = t.stringLiteral(keyName);
                
                // 执行加密
                const encrypted = encryptString(keyName);
                path.node.key.extra = {
                    rawValue: keyName,
                    raw: '"' + encrypted + '"'
                };
            },

            // [规则3]: 字符串加密
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return; // 跳过极短字符串，节省性能

                // 跳过 import 语句
                if (path.parentPath.isImportDeclaration()) return;
                // 跳过对象键名 (规则2已处理)
                if (path.parentPath.isObjectProperty() && path.key === 'key') return;

                // 防止重复
                if (path.node.extra && path.node.extra.raw && path.node.extra.raw.startsWith('\\')) return;

                const encrypted = encryptString(val);
                path.node.extra = {
                    rawValue: val,
                    raw: '"' + encrypted + '"'
                };
            }
        });

        // 生成代码: 启用 compact 模式减少体积
        const output = generator(ast, {
            minified: true,
            compact: true, 
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("Worker AST 规则失败:", error);
        return code;
    }
}

module.exports = applyCustomRules;
