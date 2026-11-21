import { t } from './types.js';

export const SERVER_ACTION_SOURCES = new Set([
  'what-framework/server',
  'what-server',
  'what-server/actions',
]);

function stableActionHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

export function normalizeActionFilename(filename, projectRoot) {
  const clean = String(filename || '<unknown>')
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '');
  const root = String(projectRoot || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (root && clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
  return clean.replace(/^\.\//, '');
}

function actionBindingName(callPath) {
  const parent = callPath.parentPath;
  if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
    return parent.node.id.name;
  }
  if (parent?.isAssignmentExpression() && t.isIdentifier(parent.node.left)) {
    return parent.node.left.name;
  }
  if (parent?.isExportDefaultDeclaration()) return 'default';
  if (parent?.isObjectProperty() && !parent.node.computed) {
    if (t.isIdentifier(parent.node.key)) return parent.node.key.name;
    if (t.isStringLiteral(parent.node.key)) return parent.node.key.value;
  }
  return null;
}

function isServerActionCall(callPath, state) {
  const callee = callPath.node.callee;
  if (t.isIdentifier(callee)) return state.serverActionBindings.has(callee.name);
  return t.isMemberExpression(callee)
    && !callee.computed
    && t.isIdentifier(callee.object)
    && t.isIdentifier(callee.property, { name: 'action' })
    && state.serverActionNamespaces.has(callee.object.name);
}

function staticActionId(optionsNode) {
  if (!t.isObjectExpression(optionsNode)) return { property: null, value: null };
  for (const property of optionsNode.properties) {
    if (!t.isObjectProperty(property)) continue;
    const key = t.isIdentifier(property.key) && !property.computed ? property.key.name
      : t.isStringLiteral(property.key) ? property.key.value
        : null;
    if (key !== 'id') continue;
    if (t.isStringLiteral(property.value)) return { property, value: property.value.value };
    if (t.isTemplateLiteral(property.value) && property.value.expressions.length === 0) {
      return { property, value: property.value.quasis[0]?.value.cooked || '' };
    }
    return { property, value: null };
  }
  return { property: null, value: null };
}

function registerActionId(callPath, state, id, bindingName, relativeFilename) {
  const loc = callPath.node.loc?.start || { line: 0, column: 0 };
  const source = `${relativeFilename}:${loc.line}:${loc.column + 1}`;
  const key = `${relativeFilename}#${bindingName}`;
  const existing = state.serverActionIds.get(id);
  if (existing) {
    throw Object.assign(callPath.buildCodeFrameError(
      `Duplicate server action ID "${id}". ` +
      `First declared by "${existing.bindingName}" at ${existing.source}; ` +
      `conflicts with "${bindingName}" at ${source}.`
    ), { code: 'ERR_DUPLICATE_ACTION_ID', loc });
  }
  const metadata = { id, key, bindingName, filename: relativeFilename, source, loc };
  state.serverActionIds.set(id, metadata);
  if (typeof state.opts?.onActionId === 'function') {
    try {
      state.opts.onActionId(metadata);
    } catch (error) {
      throw Object.assign(callPath.buildCodeFrameError(error instanceof Error ? error.message : String(error)), { code: error?.code, loc });
    }
  }
}

export function transformServerAction(callPath, state) {
  if (!isServerActionCall(callPath, state)) return;

  const bindingName = actionBindingName(callPath);
  if (!bindingName) {
    if (!state.opts?.production) {
      console.warn(
        `[what-compiler] Could not derive a stable server action ID at ` +
        `${state.serverActionFilename}:${callPath.node.loc?.start.line || 0}. ` +
        'Assign action(...) to a named local or export, or pass { id } explicitly.'
      );
    }
    return;
  }

  const optionsNode = callPath.node.arguments[1];
  const explicit = staticActionId(optionsNode);
  if (explicit.property) {
    if (explicit.value !== null) {
      registerActionId(callPath, state, explicit.value, bindingName, state.serverActionFilename);
    }
    return;
  }

  const id = `wa1_${stableActionHash(`${state.serverActionFilename}#${bindingName}`)}`;
  registerActionId(callPath, state, id, bindingName, state.serverActionFilename);
  const idProperty = t.objectProperty(t.identifier('id'), t.stringLiteral(id));

  if (!optionsNode) {
    callPath.node.arguments.push(t.objectExpression([idProperty]));
  } else if (t.isObjectExpression(optionsNode)) {
    optionsNode.properties.unshift(idProperty);
  } else {
    // Put the generated default before the caller's dynamic options so a
    // runtime `options.id` remains authoritative.
    callPath.node.arguments[1] = t.objectExpression([
      idProperty,
      t.spreadElement(optionsNode),
    ]);
  }
}

