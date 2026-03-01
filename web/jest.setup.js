import '@testing-library/jest-dom';

// Suppress Yjs double import warning in Jest environment.
//
// Related: https://github.com/yjs/yjs/issues/438
// This issue is tagged as "wontfix".
// The warning is harmless in tests, so it's better to suppress it.
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Yjs was already imported')) {
    // Suppress yjs double import warning in tests
    return;
  }
  originalError.apply(console, args);
};

// Polyfill structuredClone
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (obj) => {
    if (obj instanceof Uint8Array) {
      return new Uint8Array(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => global.structuredClone(item));
    }
    if (obj && typeof obj === 'object') {
      const cloned = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cloned[key] = global.structuredClone(obj[key]);
        }
      }
      return cloned;
    }
    return obj;
  };
}
