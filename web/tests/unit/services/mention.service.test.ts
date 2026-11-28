import { apiRequest } from '../../../services/api-client';
import { mentionService } from '../../../services/mention.service';

jest.mock('../../../services/api-client', () => ({
  apiRequest: jest.fn(),
}));

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;

/** The picker lists everyone the document can reach, so it asks for the whole page. */
const WHOLE_PAGE = 'limit=50';

describe('mentionService', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue([]);
  });

  it('trims the query into q and sends the bearer token', async () => {
    await mentionService.search('doc 1', 'token-1', '  al ', undefined);

    expect(request).toHaveBeenCalledWith(
      `/api/v1/documents/${encodeURIComponent('doc 1')}/mentionable-users?${WHOLE_PAGE}&q=al`,
      { method: 'GET', headers: { Authorization: 'Bearer token-1' }, signal: undefined }
    );
  });

  it('omits q for a blank query and the header for a share-link guest', async () => {
    await mentionService.search('doc-1', null, '   ');

    expect(request).toHaveBeenCalledWith(
      `/api/v1/documents/doc-1/mentionable-users?${WHOLE_PAGE}`,
      {
        method: 'GET',
        headers: {},
        signal: undefined,
      }
    );
  });

  it('forwards the abort signal so a fast typist never sees a stale list', async () => {
    const controller = new AbortController();

    await mentionService.search('doc-1', 'token-1', 'bo', controller.signal);

    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });
});
