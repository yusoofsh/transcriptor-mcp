const ts = require('typescript');

// Jest still treats this nested ESM package as CommonJS after the static-plugin
// security update. Compile its real code; do not mock or omit route tests.
module.exports = {
  process(source, filename) {
    const result = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        allowJs: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: true,
      },
    });
    return { code: result.outputText, map: result.sourceMapText };
  },
};
