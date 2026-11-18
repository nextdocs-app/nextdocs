'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { createRequire } = require('module');
const { ROOT, warn } = require('../../lib/proc');

/**
 * Markdown -> BlockNote -> Y.Doc -> base64.
 *
 * BlockNote is imported from the exact dependency graph `web` builds with: the editor
 * owns the schema, so a seeder that pinned its own copy could quietly write a document
 * the editor cannot read. `jsdom` supplies the browser globals BlockNote expects; Node
 * exposes `navigator` as a getter, so it has to be installed with defineProperty.
 */
let converter = null;

function setupDom() {
  if (globalThis.window && globalThis.document) return;
  let jsdom;
  try {
    jsdom = require('jsdom');
  } catch {
    throw new Error(
      'The seed needs jsdom to load the BlockNote editor. Run `npm ci` from the repo root, then retry.'
    );
  }
  const dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  for (const name of [
    'HTMLElement',
    'Element',
    'Node',
    'DOMParser',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'DocumentFragment',
    'Text',
    'Comment',
    'XMLSerializer',
    'NodeFilter',
    'Event',
    'CustomEvent',
    'KeyboardEvent',
    'MouseEvent',
    'File',
    'Blob',
    'FileReader',
    'DataTransfer',
    'DragEvent',
    'ClipboardEvent',
    'InputEvent',
    'FocusEvent',
    'SVGElement',
    'Image',
  ]) {
    if (dom.window[name] !== undefined) globalThis[name] = dom.window[name];
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
}

async function getConverter() {
  if (converter) return converter;
  setupDom();

  let requireWeb;
  try {
    requireWeb = createRequire(path.join(ROOT, 'web', 'package.json'));
    requireWeb.resolve('@blocknote/core');
    requireWeb.resolve('@blocknote/core/y');
    requireWeb.resolve('@y/y');
  } catch (err) {
    throw new Error(
      `The seed resolves BlockNote, @y/y and jsdom through web/package.json, and one is missing (${err.message}). ` +
        'Run `npm ci` from the repo root, then retry.'
    );
  }

  const load = (request) => import(pathToFileURL(requireWeb.resolve(request)).href);
  const BlockNote = await load('@blocknote/core');
  const yBridge = await load('@blocknote/core/y');
  const Y = await load('@y/y');

  // One editor instance is enough: parsing is pure, and creating a new editor per
  // document would rebuild the schema thousands of times for the large profile.
  const editor = BlockNote.BlockNoteEditor.create();
  converter = { editor, blocksToYDoc: yBridge.blocksToYDoc, yDocToBlocks: yBridge.yDocToBlocks, Y };
  return converter;
}

/**
 * Convert Markdown to a BlockNote document and its encoded Yjs update.
 *
 * `extraBlocks` carries what Markdown cannot express — attachment file blocks — and is
 * appended after the parsed prose, in the order the blocks were added.
 */
async function compileMarkdown(markdown, extraBlocks = []) {
  const { editor, blocksToYDoc, Y } = await getConverter();
  const blocks = [...editor.tryParseMarkdownToBlocks(markdown), ...extraBlocks];
  if (blocks.length === 0) {
    throw new Error('Markdown produced no blocks');
  }
  const doc = blocksToYDoc(editor, blocks, 'blocknote');
  const update = Y.encodeStateAsUpdate(doc);
  return {
    blocks,
    doc,
    update,
    base64: Buffer.from(update).toString('base64'),
    text: plainTextOf(doc, Y),
  };
}

function decodeUpdate(base64, Y) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(base64, 'base64'));
  return doc;
}

/** Depth-first walk over the Y.Node tree, yielding every node that holds text. */
function textNodesOf(root) {
  const nodes = [];
  const walk = (node) => {
    if (!node || typeof node.toArray !== 'function') return;
    const children = node.toArray();
    const strings = children.filter((child) => typeof child === 'string');
    if (strings.length > 0) nodes.push(node);
    for (const child of children) {
      if (child && typeof child.toArray === 'function') walk(child);
    }
  };
  walk(root);
  return nodes;
}

function textOfNode(node) {
  return node
    .toArray()
    .filter((child) => typeof child === 'string')
    .join('');
}

function plainTextOf(doc, Y) {
  const root = doc.get('blocknote');
  if (!root || root.length === 0) return '';
  return textNodesOf(root).map(textOfNode).join('\n');
}

/** Thread ids referenced by BlockNote comment marks anywhere in the document. */
function commentThreadIdsOf(doc) {
  const root = doc.get('blocknote');
  if (!root || root.length === 0) return new Set();
  const ids = new Set();
  const walk = (node) => {
    if (!node || typeof node.toArray !== 'function') return;
    const delta = node.toDelta ? node.toDelta() : null;
    for (const op of delta?.children ?? []) {
      if (!op.format) continue;
      for (const [key, value] of Object.entries(op.format)) {
        if (!/^comment(?:--[A-Za-z0-9+/=]{8})?$/.test(key)) continue;
        const threadId = value && typeof value === 'object' ? value.threadId : null;
        if (typeof threadId === 'string') ids.add(threadId);
      }
    }
    for (const child of node.toArray()) {
      if (child && typeof child.toArray === 'function') walk(child);
    }
  };
  walk(root);
  return ids;
}

module.exports = {
  getConverter,
  compileMarkdown,
  decodeUpdate,
  plainTextOf,
  commentThreadIdsOf,
  textNodesOf,
  textOfNode,
  setupDom,
};
