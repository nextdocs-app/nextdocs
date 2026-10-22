import { SyntaxHighlightingExtension } from '@blocknote/core/extensions';
import { createBundledHighlighter } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';

// Bundled Shiki grammars: everything `@blocknote/code-block` ships, plus the
// extra languages used in our documents (http, go, dockerfile, ...) — see
// EXTRA_CODE_LANGUAGES in EditorContent.tsx. Without an entry here Shiki
// throws `ShikiError: Language <x> is not included in this bundle` for those
// code blocks.
const bundledHighlighter = createBundledHighlighter({
  langs: {
    c: () => import('@shikijs/langs-precompiled/c'),
    cpp: () => import('@shikijs/langs-precompiled/cpp'),
    'c++': () => import('@shikijs/langs-precompiled/cpp'),
    css: () => import('@shikijs/langs-precompiled/css'),
    glsl: () => import('@shikijs/langs-precompiled/glsl'),
    graphql: () => import('@shikijs/langs-precompiled/graphql'),
    gql: () => import('@shikijs/langs-precompiled/graphql'),
    haml: () => import('@shikijs/langs-precompiled/haml'),
    html: () => import('@shikijs/langs-precompiled/html'),
    java: () => import('@shikijs/langs-precompiled/java'),
    javascript: () => import('@shikijs/langs-precompiled/javascript'),
    js: () => import('@shikijs/langs-precompiled/javascript'),
    json: () => import('@shikijs/langs-precompiled/json'),
    jsonc: () => import('@shikijs/langs-precompiled/jsonc'),
    jsonl: () => import('@shikijs/langs-precompiled/jsonl'),
    jsx: () => import('@shikijs/langs-precompiled/jsx'),
    julia: () => import('@shikijs/langs-precompiled/julia'),
    jl: () => import('@shikijs/langs-precompiled/julia'),
    less: () => import('@shikijs/langs-precompiled/less'),
    markdown: () => import('@shikijs/langs-precompiled/markdown'),
    md: () => import('@shikijs/langs-precompiled/markdown'),
    mdx: () => import('@shikijs/langs-precompiled/mdx'),
    php: () => import('@shikijs/langs-precompiled/php'),
    postcss: () => import('@shikijs/langs-precompiled/postcss'),
    pug: () => import('@shikijs/langs-precompiled/pug'),
    jade: () => import('@shikijs/langs-precompiled/pug'),
    python: () => import('@shikijs/langs-precompiled/python'),
    py: () => import('@shikijs/langs-precompiled/python'),
    r: () => import('@shikijs/langs-precompiled/r'),
    regexp: () => import('@shikijs/langs-precompiled/regexp'),
    regex: () => import('@shikijs/langs-precompiled/regexp'),
    sass: () => import('@shikijs/langs-precompiled/sass'),
    scss: () => import('@shikijs/langs-precompiled/scss'),
    shellscript: () => import('@shikijs/langs-precompiled/shellscript'),
    bash: () => import('@shikijs/langs-precompiled/shellscript'),
    sh: () => import('@shikijs/langs-precompiled/shellscript'),
    shell: () => import('@shikijs/langs-precompiled/shellscript'),
    zsh: () => import('@shikijs/langs-precompiled/shellscript'),
    sql: () => import('@shikijs/langs-precompiled/sql'),
    svelte: () => import('@shikijs/langs-precompiled/svelte'),
    typescript: () => import('@shikijs/langs-precompiled/typescript'),
    ts: () => import('@shikijs/langs-precompiled/typescript'),
    vue: () => import('@shikijs/langs-precompiled/vue'),
    'vue-html': () => import('@shikijs/langs-precompiled/vue-html'),
    wasm: () => import('@shikijs/langs-precompiled/wasm'),
    wgsl: () => import('@shikijs/langs-precompiled/wgsl'),
    xml: () => import('@shikijs/langs-precompiled/xml'),
    yaml: () => import('@shikijs/langs-precompiled/yaml'),
    yml: () => import('@shikijs/langs-precompiled/yaml'),
    tsx: () => import('@shikijs/langs-precompiled/tsx'),
    typescriptreact: () => import('@shikijs/langs-precompiled/tsx'),
    haskell: () => import('@shikijs/langs-precompiled/haskell'),
    hs: () => import('@shikijs/langs-precompiled/haskell'),
    'c#': () => import('@shikijs/langs-precompiled/csharp'),
    csharp: () => import('@shikijs/langs-precompiled/csharp'),
    cs: () => import('@shikijs/langs-precompiled/csharp'),
    latex: () => import('@shikijs/langs-precompiled/latex'),
    lua: () => import('@shikijs/langs-precompiled/lua'),
    mermaid: () => import('@shikijs/langs-precompiled/mermaid'),
    mmd: () => import('@shikijs/langs-precompiled/mermaid'),
    ruby: () => import('@shikijs/langs-precompiled/ruby'),
    rb: () => import('@shikijs/langs-precompiled/ruby'),
    rust: () => import('@shikijs/langs-precompiled/rust'),
    rs: () => import('@shikijs/langs-precompiled/rust'),
    scala: () => import('@shikijs/langs-precompiled/scala'),
    swift: () => import('@shikijs/langs-precompiled/swift'),
    kotlin: () => import('@shikijs/langs-precompiled/kotlin'),
    kt: () => import('@shikijs/langs-precompiled/kotlin'),
    kts: () => import('@shikijs/langs-precompiled/kotlin'),
    'objective-c': () => import('@shikijs/langs-precompiled/objective-c'),
    objc: () => import('@shikijs/langs-precompiled/objective-c'),
    // Extra languages (kept in sync with EXTRA_CODE_LANGUAGES).
    http: () => import('@shikijs/langs-precompiled/http'),
    go: () => import('@shikijs/langs-precompiled/go'),
    golang: () => import('@shikijs/langs-precompiled/go'),
    dockerfile: () => import('@shikijs/langs-precompiled/dockerfile'),
    docker: () => import('@shikijs/langs-precompiled/docker'),
    'docker-compose': () => import('@shikijs/langs-precompiled/docker'),
    compose: () => import('@shikijs/langs-precompiled/docker'),
    diff: () => import('@shikijs/langs-precompiled/diff'),
    patch: () => import('@shikijs/langs-precompiled/diff'),
    toml: () => import('@shikijs/langs-precompiled/toml'),
    ini: () => import('@shikijs/langs-precompiled/ini'),
    properties: () => import('@shikijs/langs-precompiled/ini'),
    prop: () => import('@shikijs/langs-precompiled/ini'),
    cfg: () => import('@shikijs/langs-precompiled/ini'),
    conf: () => import('@shikijs/langs-precompiled/ini'),
    config: () => import('@shikijs/langs-precompiled/ini'),
    env: () => import('@shikijs/langs-precompiled/ini'),
    dotenv: () => import('@shikijs/langs-precompiled/ini'),
    nginx: () => import('@shikijs/langs-precompiled/nginx'),
    'nginx-conf': () => import('@shikijs/langs-precompiled/nginx'),
    apache: () => import('@shikijs/langs-precompiled/apache'),
    apacheconf: () => import('@shikijs/langs-precompiled/apache'),
    htaccess: () => import('@shikijs/langs-precompiled/apache'),
    powershell: () => import('@shikijs/langs-precompiled/powershell'),
    ps1: () => import('@shikijs/langs-precompiled/powershell'),
    psm1: () => import('@shikijs/langs-precompiled/powershell'),
    psd1: () => import('@shikijs/langs-precompiled/powershell'),
    dart: () => import('@shikijs/langs-precompiled/dart'),
    proto: () => import('@shikijs/langs-precompiled/proto'),
    protobuf: () => import('@shikijs/langs-precompiled/proto'),
    bat: () => import('@shikijs/langs-precompiled/bat'),
    batch: () => import('@shikijs/langs-precompiled/bat'),
    cmd: () => import('@shikijs/langs-precompiled/bat'),
    elixir: () => import('@shikijs/langs-precompiled/elixir'),
    ex: () => import('@shikijs/langs-precompiled/elixir'),
    exs: () => import('@shikijs/langs-precompiled/elixir'),
    clojure: () => import('@shikijs/langs-precompiled/clojure'),
    clj: () => import('@shikijs/langs-precompiled/clojure'),
    cljs: () => import('@shikijs/langs-precompiled/clojure'),
    cljc: () => import('@shikijs/langs-precompiled/clojure'),
    groovy: () => import('@shikijs/langs-precompiled/groovy'),
    gvy: () => import('@shikijs/langs-precompiled/groovy'),
    gradle: () => import('@shikijs/langs-precompiled/groovy'),
    perl: () => import('@shikijs/langs-precompiled/perl'),
    pl: () => import('@shikijs/langs-precompiled/perl'),
    pm: () => import('@shikijs/langs-precompiled/perl'),
    solidity: () => import('@shikijs/langs-precompiled/solidity'),
    sol: () => import('@shikijs/langs-precompiled/solidity'),
    vim: () => import('@shikijs/langs-precompiled/vim'),
    viml: () => import('@shikijs/langs-precompiled/vim'),
    vimscript: () => import('@shikijs/langs-precompiled/vim'),
    matlab: () => import('@shikijs/langs-precompiled/matlab'),
    octave: () => import('@shikijs/langs-precompiled/matlab'),
  },
  themes: {
    'github-dark': () => import('@shikijs/themes/github-dark'),
    'github-light': () => import('@shikijs/themes/github-light'),
  },
  engine: () => createJavaScriptRegexEngine(),
});

// Drop-in replacement for `@blocknote/code-block`'s `syntaxHighlighter` with
// the extended language set above (same github-dark/light dual themes).
//
// The `loadLanguage` wrapper converts Shiki's *synchronous* throw for
// languages outside the bundle (e.g. "" from a bare ``` + Enter, or a typo)
// into a rejected promise, which BlockNote already handles via
// `.catch(() => ignore)` and renders as plain text. Without it the sync throw
// escapes as an uncaught ShikiError.
export const syntaxHighlighter = SyntaxHighlightingExtension({
  createHighlighter: async () => {
    const highlighter = await bundledHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [],
    });
    const loadLanguage = highlighter.loadLanguage.bind(highlighter);
    highlighter.loadLanguage = (async (...args: Parameters<typeof loadLanguage>) => {
      try {
        return await loadLanguage(...args);
      } catch {
        return Promise.reject(new Error(`Language is not included in this bundle`));
      }
    }) as typeof loadLanguage;
    return highlighter;
  },
});
