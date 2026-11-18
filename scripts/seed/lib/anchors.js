'use strict';

const { textNodesOf, textOfNode } = require('./markdown');

/**
 * Resolve a fixture quote to Yjs relative positions.
 *
 * The realtime anchor endpoint inserts the BlockNote comment mark from two relative
 * positions, exactly like the browser does. We compute them against the same Y.Doc that
 * was encoded into the create call, never by re-parsing Markdown: the stored document is
 * the encoded one, and its item ids are what the relative positions reference.
 *
 * Only nodes whose length equals their joined text are used. A node containing an inline
 * atom (mention, image) has a length that counts the atom as one, so a character offset
 * computed from the text would drift.
 */
function createAnchorSelection(doc, quote, occurrence, Y) {
  const root = doc.get('blocknote');
  if (!root || root.length === 0) {
    throw new Error('Document has no content to anchor against');
  }

  const wanted = Math.max(1, occurrence || 1);
  let seen = 0;
  for (const node of textNodesOf(root)) {
    const text = textOfNode(node);
    if (node.length !== text.length) continue;

    let from = 0;
    while (from <= text.length - quote.length) {
      const index = text.indexOf(quote, from);
      if (index === -1) break;
      seen += 1;
      if (seen === wanted) {
        const anchor = Y.createRelativePositionFromTypeIndex(node, index);
        const head = Y.createRelativePositionFromTypeIndex(node, index + quote.length);
        // A relative position that cannot be resolved back is not a valid anchor; fail
        // here rather than let the realtime endpoint reject the thread later.
        const absolute = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
        if (!absolute || absolute.index !== index) {
          throw new Error(`Could not resolve a stable position for quote '${quote}'`);
        }
        return {
          anchor: Y.relativePositionToJSON(anchor),
          head: Y.relativePositionToJSON(head),
          text: quote,
        };
      }
      from = index + 1;
    }
  }

  throw new Error(
    `Anchor quote '${quote}' (occurrence ${wanted}) does not occur in the rendered document text`
  );
}

module.exports = { createAnchorSelection };
