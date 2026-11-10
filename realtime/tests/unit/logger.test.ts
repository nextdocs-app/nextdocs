import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createLogger } from '../../src/logger.js';

type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error';

const methods: ConsoleMethod[] = ['debug', 'info', 'warn', 'error'];

describe('createLogger', () => {
  const spies = new Map<ConsoleMethod, jest.SpiedFunction<(...args: unknown[]) => void>>();

  function captureConsole() {
    for (const method of methods) {
      spies.set(
        method,
        jest.spyOn(console, method).mockImplementation(() => {}) as jest.SpiedFunction<
          (...args: unknown[]) => void
        >
      );
    }
  }

  afterEach(() => {
    for (const spy of spies.values()) {
      spy.mockRestore();
    }
    spies.clear();
  });

  it('drops lines below the configured level', () => {
    captureConsole();
    const log = createLogger('sweep', 'warn');

    log.debug('debug line');
    log.info('info line');
    log.warn('warn line');
    log.error('error line');

    expect(spies.get('debug')).not.toHaveBeenCalled();
    expect(spies.get('info')).not.toHaveBeenCalled();
    expect(spies.get('warn')).toHaveBeenCalledTimes(1);
    expect(spies.get('error')).toHaveBeenCalledTimes(1);
  });

  it('emits every level at debug', () => {
    captureConsole();
    const log = createLogger('sweep', 'debug');

    log.debug('debug line');
    log.info('info line');

    expect(spies.get('debug')).toHaveBeenCalledWith('[sweep] debug line');
    expect(spies.get('info')).toHaveBeenCalledWith('[sweep] info line');
  });

  it('keeps errors at every level', () => {
    captureConsole();
    const log = createLogger('sweep', 'error');

    log.warn('warn line');
    log.error('error line');

    expect(spies.get('warn')).not.toHaveBeenCalled();
    expect(spies.get('error')).toHaveBeenCalledWith('[sweep] error line');
  });

  it('forwards structured arguments after the message', () => {
    captureConsole();
    const log = createLogger('server', 'info');

    log.info('listening', { port: 1234 });

    expect(spies.get('info')).toHaveBeenCalledWith('[server] listening', { port: 1234 });
  });
});
