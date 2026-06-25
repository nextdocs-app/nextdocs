import toastsReducer, { addToast, removeToast } from '../../../../stores/toasts/toasts.slice';

describe('toasts slice', () => {
  it('should return the initial state', () => {
    expect(toastsReducer(undefined, { type: 'unknown' })).toEqual({
      toasts: [],
    });
  });

  it('should handle addToast and assign a random id', () => {
    const initialState = { toasts: [] };
    const state = toastsReducer(initialState, addToast({ message: 'Success!', type: 'success' }));

    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].message).toBe('Success!');
    expect(state.toasts[0].type).toBe('success');
    expect(state.toasts[0].id).toBeDefined();
    expect(state.toasts[0].duration).toBe(4000);
  });

  it('should handle removeToast', () => {
    const initialState = {
      toasts: [
        { id: '1', message: 'Hello', type: 'info' as const, duration: 4000 },
        { id: '2', message: 'World', type: 'success' as const, duration: 4000 },
      ],
    };
    const state = toastsReducer(initialState, removeToast('1'));

    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].id).toBe('2');
  });
});
