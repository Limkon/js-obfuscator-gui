/**
 * custom-ast.js (v2.0 强力混淆版)
 * 修复：中文加密、对象键名隐藏、全量字符串十六进制化
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域 ---
const CONFIG = {
    renameVariables: true,   // 是否重命名变量
    encryptStrings: true,    // 是否加密字符串
    encryptObjectKeys: true, // 是否加密对象键名 (如 { name: 1 } -> { "\x6e...": 1 })
    prefix: '_0x'            // 变量名前缀
};

// 辅助：混合加密函数 (支持中文 Unicode)
function encryptString(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        // 0-127 使用 \xHH (两字符十六进制)
        // 128+  使用 \uHHHH (四字符 Unicode，解决中文乱码问题)
        if (code < 128) {
            result += '\\x' + code.toString(16).padStart(2, '0');
        } else {
            result += '\\u' + code.toString(16).padStart(4, '0');
        }
    }
    return result;
}

// 辅助：生成混淆变量名 (lI0o 风格)
function generateBarcodeName(index) {
    const chars = ['I', 'l', '1', '0', 'O', 'o'];
    let res = '';
    let num = index + 1;
    while (num > 0) {
        res = chars[num % chars.length] + res;
        num = Math.floor(num / chars.length);
    }
    return CONFIG.prefix + res;
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        let idCounter = 0;

        traverse(ast, {
            // [规则1]: 标识符重命名 (变量、函数名)
            Scope(path) {
                if (!CONFIG.renameVariables) return;
                
                const bindings = path.scope.bindings;
                Object.keys(bindings).forEach(oldName => {
                    const newName = generateBarcodeName(idCounter++);
                    try {
                        path.scope.rename(oldName, newName);
                    } catch (e) {}
                });
            },

            // [规则2]: 对象属性键名加密
            // 效果: { VLESS: "ws" }  ->  { "\x56\x4c\x45\x53\x53": "ws" }
            ObjectProperty(path) {
                if (!CONFIG.encryptObjectKeys) return;
                
                const keyNode = path.node.key;
                
                // 如果键是简单的标识符 (如 name: "val")，将其转换为字符串字面量
                if (t.isIdentifier(keyNode) && !path.node.computed) {
                    const keyName = keyNode.name;
                    // 创建一个新的 StringLiteral 替代 Identifier
                    path.node.key = t.stringLiteral(keyName);
                    
                    // 立即加密这个新生成的字符串节点
                    const encrypted = encryptString(keyName);
                    path.node.key.extra = {
                        rawValue: keyName,
                        raw: '"' + encrypted + '"'
                    };
                }
            },

            // [规则3]: 全量字符串加密 (含中文修复)
            StringLiteral(path) {
                if (!CONFIG.encryptStrings) return;

                // 跳过模块导入 import '...'
                if (path.parentPath.isImportDeclaration()) return;
                // 跳过已经是 ObjectProperty key 的情况（因为上面规则2已经处理过了，避免双重处理）
                if (path.parentPath.isObjectProperty() && path.key === 'key') return;
                
                // 防止重复处理
                if (path.node.extra && path.node.extra.raw && (path.node.extra.raw.startsWith('"\\x') || path.node.extra.raw.startsWith('"\\u'))) return;

                const val = path.node.value;
                const encrypted = encryptString(val);
                
                // 强制写入 extra 属性，Babel 生成代码时会优先使用 raw 字段
                path.node.extra = {
                    rawValue: val,
                    raw: '"' + encrypted + '"'
                };
            },

            // [规则4]: 数值拆分 (123 -> 61+62)
            NumericLiteral(path) {
                const value = path.node.value;
                if (Number.isInteger(value) && value > 100 && !path.parentPath.isBinaryExpression()) {
                   // 仅处理大数字，避免代码膨胀过快
                    const p1 = Math.floor(value / 2);
                    const p2 = value - p1;
                    path.replaceWith(t.parenthesizedExpression(
                        t.binaryExpression('+', t.numericLiteral(p1), t.numericLiteral(p2))
                    ));
                    path.skip();
                }
            }
        });

        // 生成代码 (关闭 jsonCompatibleStrings 以允许 \x 转义)
        const output = generator(ast, {
            minified: true,
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("自定义 AST 致命错误:", error);
        return code;
    }
}

module.exports = applyCustomRules;
