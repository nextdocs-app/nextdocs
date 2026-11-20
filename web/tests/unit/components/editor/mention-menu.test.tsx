import { createMentionMenuItems } from '../../../../components/editor/mentions/mention-menu';
import { mentionService } from '../../../../services/mention.service';

jest.mock('../../../../services/mention.service', () => ({
  mentionService: {
    search: jest.fn(),
  },
}));

const search = mentionService.search as jest.MockedFunction<typeof mentionService.search>;

function editorAt(blockType: string) {
  return {
    getTextCursorPosition: () => ({ block: { type: blockType } }),
    insertInlineContent: jest.fn(),
  };
}

describe('createMentionMenuItems', () => {
  beforeEach(() => {
    search.mockReset();
  });

  it('inserts the stable user id and the display-name snapshot', async () => {
    search.mockResolvedValue([
      { userId: 'user-1', email: 'alice@example.com', displayName: 'Alice', avatarUrl: null },
      { userId: 'user-2', email: 'bob@example.com', displayName: 'Bob', avatarUrl: null },
    ]);
    const editor = editorAt('paragraph');
    const getItems = createMentionMenuItems(editor as never, {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: true,
    });

    const items = await getItems('al');

    expect(search).toHaveBeenCalledWith('doc-1', 'token', 'al', expect.any(AbortSignal));
    expect(items.map((item) => item.title)).toEqual(['Alice', 'Bob']);
    // The row's second line is the email, as in the share popover.
    expect(items.map((item) => item.subtext)).toEqual(['alice@example.com', 'bob@example.com']);

    items[0].onItemClick();
    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: 'mention', props: { userId: 'user-1', label: 'Alice' } },
      ' ',
    ]);
  });

  it('falls back to the email when a candidate has no display name', async () => {
    search.mockResolvedValue([
      { userId: 'user-1', email: 'alice@example.com', displayName: '', avatarUrl: null },
    ]);
    const items = await createMentionMenuItems(editorAt('paragraph') as never, {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: true,
    })('a');

    // The avatar seed stays the stable id; only its accessible label falls back.
    expect((items[0].icon as { props: { name: string } }).props.name).toBe('alice@example.com');
  });

  it('does not query the API for guests, VIEW-only readers, or code blocks', async () => {
    const config = {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: false,
    };

    expect(await createMentionMenuItems(editorAt('paragraph') as never, config)('a')).toEqual([]);
    expect(search).not.toHaveBeenCalled();

    const enabledConfig = { ...config, enabled: true };
    expect(
      await createMentionMenuItems(editorAt('codeBlock') as never, enabledConfig)('a')
    ).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('still offers mentions when the cursor cannot be read yet', async () => {
    const editor = {
      getTextCursorPosition: () => {
        throw new Error('editor is not mounted');
      },
      insertInlineContent: jest.fn(),
    };
    search.mockResolvedValue([
      { userId: 'user-1', email: 'alice@example.com', displayName: 'Alice', avatarUrl: null },
    ]);
    const getItems = createMentionMenuItems(editor as never, {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: true,
    });

    expect((await getItems('a')).map((item) => item.title)).toEqual(['Alice']);
  });

  it('returns an empty menu before the session has a token', async () => {
    const getItems = createMentionMenuItems(editorAt('paragraph') as never, {
      documentId: 'doc-1',
      getAccessToken: () => null,
      enabled: true,
    });

    expect(await getItems('a')).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('warns and stays empty when the request fails for another reason', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    search.mockRejectedValue(new Error('network down'));
    const getItems = createMentionMenuItems(editorAt('paragraph') as never, {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: true,
    });

    expect(await getItems('a')).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Failed to load mention candidates:', expect.any(Error));
    warn.mockRestore();
  });

  it('returns an empty menu when the request is aborted', async () => {
    search.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const getItems = createMentionMenuItems(editorAt('paragraph') as never, {
      documentId: 'doc-1',
      getAccessToken: () => 'token',
      enabled: true,
    });

    expect(await getItems('a')).toEqual([]);
  });
});
