/**
 * custom-ast.js
 * 自定义 AST 混淆规则文件
 * 在这里编写你独有的代码转换逻辑
 */

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types');

function applyCustomRules(code) {
    // 1. 安全检查
    if (!code || typeof code !== 'string') return code;

    try {
        console.log(">>> 正在应用自定义 AST 规则...");

        // 2. 将代码解析为 AST
        const ast = parser.parse(code, {
            sourceType: 'module', // 支持 ES6 模块
            plugins: ['jsx', 'typescript', 'classProperties']
        });

        // 3. 应用自定义规则 (Visitor 模式)
        traverse(ast, {
            // [规则 A]: 数值混淆
            // 效果: 将 123 转换为 (61 + 62)
            NumericLiteral(path) {
                const value = path.node.value;
                // 仅处理大于10的整数，且不在二元表达式中（防止死循环）
                if (Number.isInteger(value) && value > 10 && !path.parentPath.isBinaryExpression()) {
                    const part1 = Math.floor(value / 2);
                    const part2 = value - part1;
                    
                    // 创建二元表达式节点: part1 + part2
                    const binaryExpr = t.binaryExpression('+', t.numericLiteral(part1), t.numericLiteral(part2));
                    
                    // 用表达式 (a+b) 替换原数字
                    path.replaceWith(t.parenthesizedExpression(binaryExpr));
                    path.skip(); // 跳过当前节点，避免重复处理
                }
            },

            // [规则 B]: 布尔值混淆
            // 效果: true -> !0, false -> !1
            BooleanLiteral(path) {
                const value = path.node.value;
                // 创建 !0 或 !1
                const unaryExpr = t.unaryExpression('!', t.numericLiteral(value ? 0 : 1));
                path.replaceWith(unaryExpr);
                path.skip();
            },

            // [规则 C]: 简单的反调试注入 (可选)
            // 效果: 在函数开头插入 var _0x = "CustomGuard";
            FunctionDeclaration(path) {
                // 仅对非空的函数体插入
                if (path.node.body && path.node.body.body) {
                   const id = t.identifier("_" + Math.random().toString(36).substr(2, 4));
                   const guard = t.variableDeclaration("var", [
                       t.variableDeclarator(id, t.stringLiteral("AntiTamper"))
                   ]);
                   // 插入到函数体最前面
                   path.node.body.body.unshift(guard);
                }
            }
        });

        // 4. 生成新代码
        const output = generator(ast, {
            minified: true, // 压缩输出
            comments: false
        });

        return output.code;

    } catch (error) {
        console.error("!!! 自定义 AST 处理失败，将降级使用源码:", error);
        return code; // 保证稳定性：如果出错，返回源码，不中断流程
    }
}

module.exports = applyCustomRules;
