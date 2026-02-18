/**
 * custom-ast.js
 * 高级 AST 混淆规则：包含自定义标识符重命名
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

// --- 配置区域：你可以在这里自定义名字生成逻辑 ---
const RENAME_SETTINGS = {
    enabled: true,           // 是否开启重命名
    prefix: '_0x',           // 变量前缀，防止与原生API冲突
    mode: 'barcode'          // 模式: 'barcode' (lI1o0), 'random' (随机字符), 'counter' (var_1, var_2)
};

// 工具：名字生成器
function generateName(index) {
    if (RENAME_SETTINGS.mode === 'counter') {
        return `${RENAME_SETTINGS.prefix}var_${index}`;
    }
    
    if (RENAME_SETTINGS.mode === 'random') {
        return RENAME_SETTINGS.prefix + Math.random().toString(36).substring(2, 8);
    }

    // [默认] 条形码模式：使用 l, I, 1, 0, O, o 组成难以辨认的字符
    const chars = ['l', 'I', '1', '0', 'O', 'o'];
    let res = '';
    let num = index + 1; // 避免0
    while (num > 0) {
        res = chars[num % chars.length] + res;
        num = Math.floor(num / chars.length);
    }
    return RENAME_SETTINGS.prefix + res;
}

function applyCustomRules(code) {
    if (!code || typeof code !== 'string') return code;

    try {
        const ast = parser.parse(code, {
            sourceType: 'module',
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        // 计数器，用于生成唯一名字
        let idCounter = 0;

        traverse(ast, {
            // --- 规则 1: 标识符重命名 (核心逻辑) ---
            Scope(path) {
                if (!RENAME_SETTINGS.enabled) return;

                // 获取当前作用域下定义的所有变量/函数 (bindings)
                const bindings = path.scope.bindings;

                Object.keys(bindings).forEach(oldName => {
                    // 1. 生成新名字
                    const newName = generateName(idCounter++);

                    // 2. 安全重命名 (Babel 会自动更新所有引用位置)
                    // 注意：重命名会修改 AST，path.scope.rename 是最安全的方法
                    try {
                        path.scope.rename(oldName, newName);
                    } catch (e) {
                        // 忽略重命名失败的情况（极少数情况会发生）
                    }
                });
            },

            // --- 规则 2: 数值混淆 (保留原有功能) ---
            NumericLiteral(path) {
                const value = path.node.value;
                if (Number.isInteger(value) && value > 10 && !path.parentPath.isBinaryExpression()) {
                    const part1 = Math.floor(value / 2);
                    const part2 = value - part1;
                    path.replaceWith(t.parenthesizedExpression(
                        t.binaryExpression('+', t.numericLiteral(part1), t.numericLiteral(part2))
                    ));
                    path.skip();
                }
            },
            
            // --- 规则 3: 字符串简单加密 (示例) ---
            // 将 "hello" 变成 "\x68\x65\x6c\x6c\x6f"
            StringLiteral(path) {
                // 跳过 import 语句中的字符串 和 对象属性key
                if (path.parentPath.isImportDeclaration() || path.key === 'key') return;
                
                // 仅处理未被处理过的
                if (path.node.extra && path.node.extra.raw && path.node.extra.raw.startsWith('\\x')) return;

                const value = path.node.value;
                // 简单的只针对短字符串演示，避免体积爆炸
                if (value.length > 0 && value.length < 20) {
                    let hex = '';
                    for (let i = 0; i < value.length; i++) {
                        hex += '\\x' + value.charCodeAt(i).toString(16).padStart(2, '0');
                    }
                    path.node.extra = { raw: `"${hex}"`, rawValue: hex };
                }
            }
        });

        const output = generator(ast, {
            minified: true,
            comments: false,
            jsonCompatibleStrings: false 
        });

        return output.code;

    } catch (error) {
        console.error("自定义 AST 规则执行出错:", error);
        return code; // 报错则降级返回源码
    }
}

module.exports = applyCustomRules;
