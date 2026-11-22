import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

export interface TransformResult {
  code: string;
  map?: any;
}

/**
 * Transforms JSX in agent-dom components:
 * 1. Auto-injects `data-agent-id` if absent.
 * 2. Wraps dynamic state/signals expressions in getter functions.
 * 3. Transforms JSX into h() function calls.
 */
export function transformAgentDomJsx(sourceCode: string, filename: string): TransformResult {
  if (!sourceCode.includes('defineComponent') && !sourceCode.includes('<')) {
    return { code: sourceCode };
  }

  const ast = parser.parse(sourceCode, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  let needsHImport = false;
  let elementIndex = 0;

  // 1. Process JSX elements and inject data-agent-id
  traverse(ast, {
    JSXElement(path: any) {
      needsHImport = true;
      const opening = path.node.openingElement;

      // Auto-inject data-agent-id if missing
      const hasId = opening.attributes.some(
        (attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'data-agent-id'
      );

      if (!hasId) {
        let tag = 'node';
        if (t.isJSXIdentifier(opening.name)) {
          tag = opening.name.name;
        }
        elementIndex++;
        opening.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-agent-id'),
            t.stringLiteral(`auto:${tag}-${elementIndex}`)
          )
        );
      }

      // 2. Wrap expression children {state.x} into reactive getters {() => state.x}
      path.node.children = path.node.children.map((child: any) => {
        if (t.isJSXExpressionContainer(child)) {
          const expr = child.expression;
          if (
            t.isMemberExpression(expr) ||
            t.isBinaryExpression(expr) ||
            t.isCallExpression(expr) ||
            (t.isIdentifier(expr) && expr.name !== 'undefined')
          ) {
            // If already an arrow function, keep it
            if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
              return child;
            }
            return t.jsxExpressionContainer(
              t.arrowFunctionExpression([], expr)
            );
          }
        }
        return child;
      });
    },
  });

  // 3. Transform JSX to h() calls
  traverse(ast, {
    JSXElement: {
      exit(path: any) {
        const opening = path.node.openingElement;
        let tag: t.Expression;

        if (t.isJSXIdentifier(opening.name)) {
          const name = opening.name.name;
          // Check if capitalized (component identifier) or lower (HTML tag)
          if (/^[A-Z]/.test(name)) {
            tag = t.identifier(name);
          } else {
            tag = t.stringLiteral(name);
          }
        } else {
          tag = t.stringLiteral('div');
        }

        // Build props object
        const propsProperties: t.ObjectProperty[] = [];
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr)) {
            const keyName = t.isJSXIdentifier(attr.name)
              ? attr.name.name
              : 'prop';
            const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(keyName)
              ? t.identifier(keyName)
              : t.stringLiteral(keyName);

            let val: t.Expression;
            if (!attr.value) {
              val = t.booleanLiteral(true);
            } else if (t.isJSXExpressionContainer(attr.value)) {
              val = attr.value.expression as t.Expression;
            } else {
              val = attr.value as t.Expression;
            }

            propsProperties.push(t.objectProperty(key, val));
          }
        }

        // Build children arguments
        const childArgs: t.Expression[] = [];
        for (const child of path.node.children) {
          if (t.isJSXText(child)) {
            const text = child.value.trim();
            if (text) {
              childArgs.push(t.stringLiteral(text));
            }
          } else if (t.isJSXExpressionContainer(child)) {
            if (!t.isJSXEmptyExpression(child.expression)) {
              childArgs.push(child.expression as t.Expression);
            }
          } else if (t.isExpression(child)) {
            childArgs.push(child);
          }
        }

        const hCall = t.callExpression(t.identifier('h'), [
          tag,
          t.objectExpression(propsProperties),
          ...childArgs,
        ]);

        path.replaceWith(hCall);
      },
    },
  });

  // 4. Ensure import { h } from 'tokensafe-ui' or '@agent-dom/core' exists if needed
  if (needsHImport) {
    let hasCoreImport = false;
    let hasHImport = false;

    for (const stmt of ast.program.body) {
      if (
        t.isImportDeclaration(stmt) &&
        (stmt.source.value === 'tokensafe-ui' ||
          stmt.source.value === '@tokensafe-dev/ui' ||
          stmt.source.value === '@agent-dom/core')
      ) {
        hasCoreImport = true;
        if (stmt.specifiers.some((s) => s.local.name === 'h')) {
          hasHImport = true;
        } else {
          stmt.specifiers.push(t.importSpecifier(t.identifier('h'), t.identifier('h')));
          hasHImport = true;
        }
      }
    }

    if (!hasCoreImport && !hasHImport) {
      ast.program.body.unshift(
        t.importDeclaration(
          [t.importSpecifier(t.identifier('h'), t.identifier('h'))],
          t.stringLiteral('tokensafe-ui')
        )
      );
    }
  }

  const output = generate(ast, { sourceMaps: true, sourceFileName: filename }, sourceCode);
  return {
    code: output.code,
    map: output.map,
  };
}
