import { jest } from '@jest/globals';

// Mock config module before importing logger (ESM)
jest.unstable_mockModule('../../src/config.js', () => ({
  __esModule: true,
  default: {
    logLevel: 'debug', // Default to debug for testing all levels
  },
}));

const { default: logger } = await import('../../src/logger.js');

describe('Logger', () => {
  let consoleSpy: {
    log: any;
    warn: any;
    error: any;
  };

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should format message correctly with timestamp and level', () => {
    logger.info('test message');

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] test message$/
      )
    );
  });

  it('should include meta data in log output', () => {
    logger.info('test message', { foo: 'bar' });

    expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('{"foo":"bar"}'));
  });

  it('should log error messages to console.error', () => {
    logger.error('error message');
    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it('should log warn messages to console.warn', () => {
    logger.warn('warn message');
    expect(consoleSpy.warn).toHaveBeenCalled();
  });

  it('should log info messages to console.log', () => {
    logger.info('info message');
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  it('should log debug messages to console.log', () => {
    logger.debug('debug message');
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  describe('Log Levels', () => {
    it('should not log debug when level is info', async () => {
      jest.resetModules();
      jest.unstable_mockModule('../../src/config.js', () => ({
        __esModule: true,
        default: { logLevel: 'info' },
      }));

      const { default: loggerInfo } = await import('../../src/logger.js');

      loggerInfo.debug('debug message');
      expect(consoleSpy.log).not.toHaveBeenCalled();

      loggerInfo.info('info message');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should not log info when level is warn', async () => {
      jest.resetModules();
      jest.unstable_mockModule('../../src/config.js', () => ({
        __esModule: true,
        default: { logLevel: 'warn' },
      }));
      const { default: loggerWarn } = await import('../../src/logger.js');

      loggerWarn.info('info message');
      expect(consoleSpy.log).not.toHaveBeenCalled();

      loggerWarn.warn('warn message');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should not log warn when level is error', async () => {
      jest.resetModules();
      jest.unstable_mockModule('../../src/config.js', () => ({
        __esModule: true,
        default: { logLevel: 'error' },
      }));
      const { default: loggerError } = await import('../../src/logger.js');

      loggerError.warn('warn message');
      expect(consoleSpy.warn).not.toHaveBeenCalled();

      loggerError.error('error message');
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Safe Serialization', () => {
    it('should handle circular references safely', () => {
      const circular: any = { name: 'circular' };
      circular.self = circular;

      logger.info('circular message', circular);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[Circular]'));
    });

    it('should handle BigInt safely', () => {
      logger.info('bigint message', { value: BigInt(123) });

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('"value":"123n"'));
    });

    it('should handle unserializable errors gracefully', () => {
      // Mock JSON.stringify to throw an error to test the catch block
      const originalStringify = JSON.stringify;
      JSON.stringify = jest.fn(() => {
        throw new Error('Mock error');
      });

      try {
        logger.info('error message', { valid: 'object' });
        expect(consoleSpy.log).toHaveBeenCalledWith(
          expect.stringContaining('[unserializable meta: Mock error]')
        );
      } finally {
        JSON.stringify = originalStringify;
      }
    });
  });
});
