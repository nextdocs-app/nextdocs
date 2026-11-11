/**
 * Wire types shared by the realtime anchor endpoint and the web client.
 *
 * These are deliberately JSON-only: the browser never sends a Yjs update or a
 * mark attribute, only the thread id and two relative positions.
 */

/** The JSON shape `Y.relativePositionToJSON` produces on the client. */
export type RelativePositionJson = {
  type?: { client: number; clock: number } | null;
  tname?: string | null;
  item?: { client: number; clock: number } | null;
  assoc?: number;
};

export type AnchorSelection = {
  anchor: RelativePositionJson;
  head: RelativePositionJson;
};

export interface AnchorCreateRequest {
  threadId: string;
  selection: AnchorSelection;
}
