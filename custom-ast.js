/**
 * custom-ast.js (v9.0 UI 联动版)
 * 特性：接收前端自定义关键词 + 动态 CharCode 混淆 + 对抗 Simplify
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// 默认配置 (内置兜底策略)
const DEFAULT_CONFIG = {
    // 内置敏感词 (不区分大小写)
    SENSITIVE_WORDS: [
        'vless', 'vmess', 'trojan', 'shadowsocks', 'ss',
        'uuid', 'password', 'ps', 'remark', 'address', 'host', 'port', 
        'sni', 'server', 'ip', 'alterid', 'security', 'network', 'grpc', 'ws',
        'path', 'servicename', 'mode', 'cdn', 'allowinsecure'
    ],
    // 保护名单 (Worker 运行时 API，绝对不能动)
    PROTECTED_KEYS: [
        'fetch', 'scheduled', 'addEventListener', 'handle',
        'env', 'ctx', 'request', 'response', 'headers', 
        'method', 'url', 'cf', 'body', 'redirect', 'status', 'ok',
        'window', 'document', 'self', 'globalThis', 'console',
        'prototype', 'toString', 'length', 'substring', 'indexOf', 'split', 'join',
        'fromCharCode', 'String'
    ]
};

// 工具：构造 String.fromCharCode(118, 108...) 调用节点
function stringToCharCodeCall(str) {
    const charCodes = [];
    for (let i = 0; i < str.length; i++) {
        // 直接生成数字字面量
        charCodes.push(t.numericLiteral(str.charCodeAt(i)));
    }
    
    const stringIdentifier = t.identifier('String');
    const fromCharCodeIdentifier = t.identifier('fromCharCode');
    const memberExpr = t.memberExpression(stringIdentifier, fromCharCodeIdentifier);
    
    return t.callExpression(memberExpr, charCodes);
}

/**
 * 执行自定义 AST 混淆
 * @param {string} code - 源代码
 * @param {object} options - 配置项 { sensitiveWords: [] }
 * @returns {string} - 处理后的代码
 */
function applyCustomRules(code, options = {}) {
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> [v9.0] AST 引擎启动: 动态关键词模式");

        // 1. 合并敏感词库
        let activeSensitiveWords = [...DEFAULT_CONFIG.SENSITIVE_WORDS];
        
        if (options.sensitiveWords && Array.isArray(options.sensitiveWords)) {
            // 转小写、去空、合并
            const userWords = options.sensitiveWords
                .map(w => w.toLowerCase().trim())
                .filter(w => w.length > 0);
            
            if (userWords.length > 0) {
                // 合并并去重
                activeSensitiveWords = [...new Set([...activeSensitiveWords, ...userWords])];
                console.log(`>>> [AST] 已加载用户关键词 (${userWords.length}个)，当前生效词库总数: ${activeSensitiveWords.length}`);
            }
        }

        // 2. 解析 AST
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        // 3. 遍历修改
        traverse(ast, {
            // [规则1] 对象键名 { vless: ... } -> { [String.fromCharCode(...)]: ... }
            ObjectProperty(path) {
                let keyNode = path.node.key;
                let keyName = '';

                // 获取键名
                if (t.isIdentifier(keyNode)) keyName = keyNode.name;
                else if (t.isStringLiteral(keyNode)) keyName = keyNode.value;
                else return;

                // 检查保护名单
                if (DEFAULT_CONFIG.PROTECTED_KEYS.includes(keyName)) return;

                // 检查敏感性
                const lowerName = keyName.toLowerCase();
                const isSensitive = activeSensitiveWords.some(w => lowerName.includes(w));
                const isChinese = /[\u4e00-\u9fa5]/.test(keyName);

                // 只要是中文或敏感词，强制转为计算属性 + CharCode调用
                if (isSensitive || isChinese) {
                    path.node.computed = true;
                    path.node.key = stringToCharCodeCall(keyName);
                }
            },

            // [规则2] 字符串字面量 "vless" -> String.fromCharCode(...)
            StringLiteral(path) {
                const val = path.node.value;
                if (!val || val.length < 2) return;
                
                // 跳过特定父节点
                if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return;
                if (path.parentPath.isObjectProperty() && path.key === 'key') return; // 已由规则1处理

                if (DEFAULT_CONFIG.PROTECTED_KEYS.includes(val)) return;

                const lowerVal = val.toLowerCase();
                const isSensitive = activeSensitiveWords.some(w => lowerVal.includes(w));
                const isChinese = /[\u4e00-\u9fa5]/.test(val);

                if (isSensitive || isChinese) {
                    path.replaceWith(stringToCharCodeCall(val));
                    path.skip(); // 防止死循环
                }
            },

            // [规则3] 模板字符串 - 降级为 Unicode 转义 (模板内无法直接插入函数调用)
            TemplateLiteral(path) {
                path.node.quasis.forEach(quasi => {
                    if (quasi.value.raw) {
                        const val = quasi.value.raw;
                        const isSensitive = activeSensitiveWords.some(w => val.toLowerCase().includes(w));
                        const isChinese = /[\u4e00-\u9fa5]/.test(val);

                        if (isChinese || isSensitive) {
                            let res = '';
                            for (let i = 0; i < val.length; i++) {
                                res += '\\u' + val.charCodeAt(i).toString(16).padStart(4, '0');
                            }
                            quasi.value.raw = res;
                            quasi.value.cooked = val;
                        }
                    }
                });
            }
        });

        // 4. 生成代码
        const output = generator(ast, {
            minified: true,
            compact: true,
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("AST 引擎错误:", error);
        return code; // 出错返回原代码
    }
}

module.exports = applyCustomRules;
