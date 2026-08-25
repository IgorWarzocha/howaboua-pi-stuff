import { evalStr } from './evaluate.mjs';

function shouldShowAxNode(node, compact = false) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  if (compact && role === 'InlineTextBox') return false;
  return role !== 'none' && role !== 'generic' && !(name === '' && (value === '' || value == null));
}

function formatAxNode(node, depth) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  const indent = '  '.repeat(Math.min(depth, 10));
  let line = `${indent}[${role}]`;
  if (name !== '') line += ` ${name}`;
  if (!(value === '' || value == null)) line += ` = ${JSON.stringify(value)}`;
  return line;
}

function orderedAxChildren(node, nodesById, childrenByParent) {
  const children = [];
  const seen = new Set();
  for (const childId of node.childIds || []) {
    const child = nodesById.get(childId);
    if (child && !seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  for (const child of childrenByParent.get(node.nodeId) || []) {
    if (!seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  return children;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option',
  'menuitemcheckbox', 'menuitemradio', 'radio', 'searchbox', 'slider',
  'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
]);
const SNAPSHOT_LIMITS = { short: 60, medium: 140, long: 300 };
const NEXT_ELEMENT_IDS = new WeakMap();

function normalizeSnapshotText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitSnapshotText(value, max = 700) {
  const text = normalizeSnapshotText(value);
  if (!text) return [];
  const parts = [];
  for (let start = 0; start < text.length; start += max) parts.push(text.slice(start, start + max));
  return parts;
}

async function snapshotData(cdp, sid, elementRefs, options = {}) {
  const lineno = positiveInteger(options.lineno ?? '1', 'line cursor');
  const responseLength = snapshotResponseLength(options.responseLength);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, sid);
  const nodesById = new Map(nodes.map(node => [node.nodeId, node]));
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node);
  }

  elementRefs.clear();
  const lines = [];
  const elements = [];
  const visited = new Set();
  function nextElementId() {
    const id = NEXT_ELEMENT_IDS.get(elementRefs) ?? 1;
    if (!Number.isSafeInteger(id)) throw new Error('Element id limit reached; restart the tab bridge');
    NEXT_ELEMENT_IDS.set(elementRefs, id + 1);
    return id;
  }
  function addLine(text, element, kind = 'text') {
    for (const part of splitSnapshotText(text)) {
      const line = { line: lines.length + 1, text: part, kind };
      if (element) line.element_id = element.id;
      lines.push(line);
    }
  }
  function addStaticText(text) {
    const normalized = normalizeSnapshotText(text);
    if (!normalized) return;
    const previous = lines.at(-1);
    if (previous?.kind === 'text' && previous.text.length + normalized.length + 1 <= 700) {
      previous.text += ` ${normalized}`;
      return;
    }
    addLine(normalized);
  }
  function visit(node, depth, parentName = '') {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    const role = node.role?.value || '';
    const name = normalizeSnapshotText(node.name?.value ?? '');
    const value = node.value?.value;
    let renderedName = parentName;
    if (!node.ignored && shouldShowAxNode(node, true)) {
      const interactive = INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId;
      if (interactive) {
        const element = {
          id: nextElementId(),
          role,
          ...(name ? { name } : {}),
          ...(value === '' || value == null ? {} : { value }),
        };
        elementRefs.set(element.id, node.backendDOMNodeId);
        elements.push(element);
        addLine(`[${element.id}] ${role}${name ? ` ${name}` : ''}${value === '' || value == null ? '' : ` = ${JSON.stringify(value)}`}`, element, 'interactive');
        renderedName = name;
      } else if (role === 'StaticText') {
        if (name && name !== parentName) addStaticText(name);
      } else if (role === 'heading' || role === 'image') {
        if (name) addLine(`${role}: ${name}`, undefined, role);
        renderedName = name || parentName;
      }
    }
    for (const child of orderedAxChildren(node, nodesById, childrenByParent)) {
      visit(child, depth + 1, renderedName);
    }
  }

  const roots = nodes.filter(node => !node.parentId || !nodesById.has(node.parentId));
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);

  const metadata = JSON.parse(await evalStr(cdp, sid, '({title: document.title, url: location.href})'));
  const pattern = options.pattern?.toLowerCase();
  const matching = pattern
    ? lines.filter(line => line.text.toLowerCase().includes(pattern))
    : lines;
  const start = lineno - 1;
  const limit = SNAPSHOT_LIMITS[responseLength];
  const content = matching.slice(start, start + limit).map(({ kind: _kind, ...line }) => line);
  const visibleIds = new Set(content.map(line => line.element_id).filter(Boolean));
  const visibleElements = elements.filter(element => visibleIds.has(element.id));
  const hasMore = start + content.length < matching.length;
  return {
    ref_id: options.refId,
    title: metadata.title,
    url: metadata.url,
    lineno: start + 1,
    content,
    elements: visibleElements,
    ...(pattern ? { pattern: options.pattern } : {}),
    ...(hasMore ? { next_lineno: start + content.length + 1 } : {}),
  };
}

async function snapshotStr(cdp, sid, elementRefs, refId, lineno, responseLength) {
  return JSON.stringify(await snapshotData(cdp, sid, elementRefs, {
    refId,
    lineno: positiveInteger(lineno ?? '1', 'line cursor'),
    responseLength: snapshotResponseLength(responseLength),
  }));
}

async function findStr(cdp, sid, elementRefs, refId, pattern, lineno, responseLength) {
  if (!pattern) throw new Error('pattern required');
  return JSON.stringify(await snapshotData(cdp, sid, elementRefs, {
    refId,
    pattern,
    lineno: positiveInteger(lineno ?? '1', 'line cursor'),
    responseLength: snapshotResponseLength(responseLength),
  }));
}

function positiveInteger(value, label) {
  const source = String(value);
  if (!/^[1-9]\d*$/.test(source)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe positive integer`);
  return parsed;
}

function snapshotResponseLength(value) {
  const resolved = value ?? 'medium';
  if (!Object.hasOwn(SNAPSHOT_LIMITS, resolved)) {
    throw new Error(`response length must be one of: ${Object.keys(SNAPSHOT_LIMITS).join(', ')}`);
  }
  return resolved;
}

export { findStr, positiveInteger, snapshotData, snapshotResponseLength, snapshotStr };
