import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

// Handle ESM/CJS default export differences
const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

export type PatchPosition = 'before' | 'after' | 'prepend' | 'append';

export interface AddActionPatch {
  op: 'add_action';
  componentId: string;
  name: string;
  code: string; // e.g. "(s) => ({ ...s, count: 0 })"
}

export interface UpdateStatePatch {
  op: 'update_state';
  componentId: string;
  key: string;
  schemaCode: string; // e.g. "z.string().default('hello')"
}

export interface InsertJsxPatch {
  op: 'insert_jsx';
  targetAgentId: string; // e.g. "counter-card:btn-inc"
  position: PatchPosition;
  jsxCode: string; // e.g. "<button onClick={emit.reset}>Reset</button>"
}

export interface BindEventPatch {
  op: 'bind_event';
  targetAgentId: string;
  event: string; // e.g. "onClick"
  actionName: string; // e.g. "reset" -> binds {emit.reset}
}

export interface ReplaceActionPatch {
  op: 'replace_action';
  componentId: string;
  name: string;
  code: string; // e.g. "(s) => ({ ...s, count: s.count * 2 })"
}

export interface PatchRenderPatch {
  op: 'patch_render';
  componentId: string;
  renderCode: string; // e.g. "({ state, emit }) => h('div', null, state.count)"
}

export interface RemoveActionPatch {
  op: 'remove_action';
  componentId: string;
  name: string;
}

export type ComponentPatch =
  | AddActionPatch
  | UpdateStatePatch
  | InsertJsxPatch
  | BindEventPatch
  | ReplaceActionPatch
  | PatchRenderPatch
  | RemoveActionPatch;

export interface PatchResult {
  success: boolean;
  code: string;
  error?: string;
}

/**
 * Applies a surgical AST patch to an agent-dom component file.
 */
export function applyPatch(sourceCode: string, patch: ComponentPatch): PatchResult {
  try {
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    let patched = false;

    switch (patch.op) {
      case 'add_action': {
        patched = handleAddAction(ast, patch);
        break;
      }
      case 'update_state': {
        patched = handleUpdateState(ast, patch);
        break;
      }
      case 'insert_jsx': {
        patched = handleInsertJsx(ast, patch);
        break;
      }
      case 'bind_event': {
        patched = handleBindEvent(ast, patch);
        break;
      }
      case 'replace_action': {
        patched = handleAddAction(ast, {
          op: 'add_action',
          componentId: patch.componentId,
          name: patch.name,
          code: patch.code,
        });
        break;
      }
      case 'patch_render': {
        patched = handlePatchRender(ast, patch);
        break;
      }
      case 'remove_action': {
        patched = handleRemoveAction(ast, patch);
        break;
      }
    }

    if (!patched) {
      return {
        success: false,
        code: sourceCode,
        error: `Target not found for patch operation: ${patch.op}`,
      };
    }

    const output = generate(ast, { retainLines: false, compact: false }, sourceCode);

    // Validate that generated code parses cleanly
    parser.parse(output.code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });

    return {
      success: true,
      code: output.code,
    };
  } catch (err: any) {
    return {
      success: false,
      code: sourceCode,
      error: `AST Patch failed: ${err.message}`,
    };
  }
}

function handleAddAction(ast: t.File, patch: AddActionPatch): boolean {
  let matched = false;

  traverse(ast, {
    CallExpression(path: any) {
      if (!isDefineComponentCall(path, patch.componentId)) return;

      const configArg = path.node.arguments[0];
      if (!t.isObjectExpression(configArg)) return;

      const actionsProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'actions'
      );

      if (actionsProp && t.isObjectExpression(actionsProp.value)) {
        // Parse the new action handler expression
        const expr = parseExpression(patch.code);
        // Remove existing action if already present
        actionsProp.value.properties = actionsProp.value.properties.filter(
          (p) => !(t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === patch.name)
        );
        actionsProp.value.properties.push(
          t.objectProperty(t.identifier(patch.name), expr)
        );
        matched = true;
        path.stop();
      }
    },
  });

  return matched;
}

function handlePatchRender(ast: t.File, patch: PatchRenderPatch): boolean {
  let matched = false;

  traverse(ast, {
    CallExpression(path: any) {
      if (!isDefineComponentCall(path, patch.componentId)) return;

      const configArg = path.node.arguments[0];
      if (!t.isObjectExpression(configArg)) return;

      const renderProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'render'
      );

      const expr = parseExpression(patch.renderCode);
      if (renderProp) {
        renderProp.value = expr;
        matched = true;
        path.stop();
      } else {
        configArg.properties.push(
          t.objectProperty(t.identifier('render'), expr)
        );
        matched = true;
        path.stop();
      }
    },
  });

  return matched;
}

function handleRemoveAction(ast: t.File, patch: RemoveActionPatch): boolean {
  let matched = false;

  traverse(ast, {
    CallExpression(path: any) {
      if (!isDefineComponentCall(path, patch.componentId)) return;

      const configArg = path.node.arguments[0];
      if (!t.isObjectExpression(configArg)) return;

      const actionsProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'actions'
      );

      if (actionsProp && t.isObjectExpression(actionsProp.value)) {
        const initialLen = actionsProp.value.properties.length;
        actionsProp.value.properties = actionsProp.value.properties.filter(
          (p) => !(t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === patch.name)
        );
        if (actionsProp.value.properties.length < initialLen) {
          matched = true;
          path.stop();
        }
      }
    },
  });

  return matched;
}

function handleUpdateState(ast: t.File, patch: UpdateStatePatch): boolean {
  let matched = false;

  traverse(ast, {
    CallExpression(path: any) {
      if (!isDefineComponentCall(path, patch.componentId)) return;

      const configArg = path.node.arguments[0];
      if (!t.isObjectExpression(configArg)) return;

      const stateProp = configArg.properties.find(
        (p): p is t.ObjectProperty =>
          t.isObjectProperty(p) &&
          t.isIdentifier(p.key) &&
          p.key.name === 'state'
      );

      if (stateProp && t.isObjectExpression(stateProp.value)) {
        const expr = parseExpression(patch.schemaCode);
        stateProp.value.properties = stateProp.value.properties.filter(
          (p) => !(t.isObjectProperty(p) && t.isIdentifier(p.key) && p.key.name === patch.key)
        );
        stateProp.value.properties.push(
          t.objectProperty(t.identifier(patch.key), expr)
        );
        matched = true;
        path.stop();
      }
    },
  });

  return matched;
}

function handleInsertJsx(ast: t.File, patch: InsertJsxPatch): boolean {
  let matched = false;
  const newJsxNode = parseJsxExpression(patch.jsxCode);

  traverse(ast, {
    JSXElement(path: any) {
      if (!hasAgentId(path.node, patch.targetAgentId)) return;

      if (patch.position === 'before') {
        path.insertBefore(newJsxNode);
        matched = true;
        path.stop();
      } else if (patch.position === 'after') {
        path.insertAfter(newJsxNode);
        matched = true;
        path.stop();
      } else if (patch.position === 'prepend') {
        path.node.children.unshift(newJsxNode);
        matched = true;
        path.stop();
      } else if (patch.position === 'append') {
        path.node.children.push(newJsxNode);
        matched = true;
        path.stop();
      }
    },
  });

  return matched;
}

function handleBindEvent(ast: t.File, patch: BindEventPatch): boolean {
  let matched = false;

  traverse(ast, {
    JSXElement(path: any) {
      if (!hasAgentId(path.node, patch.targetAgentId)) return;

      const opening = path.node.openingElement;
      // Filter out existing handler for this event
      opening.attributes = opening.attributes.filter(
        (attr: any) => !(t.isJSXAttribute(attr) && attr.name.name === patch.event)
      );

      // Add new handler: event={emit.actionName}
      opening.attributes.push(
        t.jsxAttribute(
          t.jsxIdentifier(patch.event),
          t.jsxExpressionContainer(
            t.memberExpression(t.identifier('emit'), t.identifier(patch.actionName))
          )
        )
      );

      matched = true;
      path.stop();
    },
  });

  return matched;
}

function isDefineComponentCall(path: any, componentId: string): boolean {
  const callee = path.node.callee;
  const isDefine =
    (t.isIdentifier(callee) && callee.name === 'defineComponent') ||
    (t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property) &&
      callee.property.name === 'defineComponent');

  if (!isDefine || path.node.arguments.length === 0) return false;

  const configArg = path.node.arguments[0];
  if (!t.isObjectExpression(configArg)) return false;

  const idProp = configArg.properties.find(
    (p): p is t.ObjectProperty =>
      t.isObjectProperty(p) &&
      t.isIdentifier(p.key) &&
      p.key.name === 'id' &&
      t.isStringLiteral(p.value) &&
      p.value.value === componentId
  );

  return Boolean(idProp);
}

function hasAgentId(node: t.JSXElement, targetId: string): boolean {
  const opening = node.openingElement;
  for (const attr of opening.attributes) {
    if (
      t.isJSXAttribute(attr) &&
      attr.name.name === 'data-agent-id' &&
      t.isStringLiteral(attr.value) &&
      attr.value.value === targetId
    ) {
      return true;
    }
  }
  return false;
}

function parseExpression(code: string): t.Expression {
  const wrapped = `(${code});`;
  const file = parser.parse(wrapped, { plugins: ['typescript', 'jsx'] });
  const stmt = file.program.body[0] as t.ExpressionStatement;
  return stmt.expression;
}

function parseJsxExpression(code: string): t.JSXElement {
  const wrapped = `const _x = ${code};`;
  const file = parser.parse(wrapped, { plugins: ['typescript', 'jsx'] });
  const decl = file.program.body[0] as t.VariableDeclaration;
  const init = decl.declarations[0].init;
  if (!t.isJSXElement(init)) {
    throw new Error('Provided code does not produce a valid JSXElement');
  }
  return init;
}
