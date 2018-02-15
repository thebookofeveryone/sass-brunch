/* eslint camelcase: 0 */

'use strict';

const sysPath = require('path');
const libsass = require('node-sass');
const os = require('os');
const nodeSassGlobbing = require('node-sass-globbing');

const isWindows = os.platform() === 'win32';
const sassRe = /\.sass$/;

const formatRe = /(on line \d+ of ([/.\w]+))/;
const formatError = (path, err) => {
  let loc = `L${err.line}:${err.column}`;
  let code = err.formatted.replace(`Error: ${err.message}`, '');
  const match = code.match(formatRe);
  code = code.replace(formatRe, '');
  const erroredPath = match[2];

  loc += erroredPath === path ? ': ' : ` of ${erroredPath}. `;

  const error = new Error(`${loc}\n${err.message} ${code}`);
  error.name = '';
  return error;
};

class SassCompiler {
  constructor(cfg) {
    if (cfg == null) cfg = {};
    this.rootPath = cfg.paths.root;
    this.optimize = cfg.optimize;
    this.config = cfg.plugins && cfg.plugins.sass || {};

    if (this.config.options != null && this.config.options.includePaths != null) {
      this.includePaths = this.config.options.includePaths;
    }

    this.prefix = '';
  }

  _getIncludePaths(path) {
    let includePaths = [this.rootPath, sysPath.dirname(path)];
    if (Array.isArray(this.includePaths)) {
      includePaths = includePaths.concat(this.includePaths);
    }
    return includePaths;
  }

  _nativeCompile(source) {
    return new Promise((resolve, reject) => {
      var debugMode = this.config.debug;
      var hasComments = debugMode === 'comments' && !this.optimize;

      libsass.render({
        file: source.path,
        data: source.data,
        includePaths: this._getIncludePaths(source.path),
        outputStyle: this.optimize ? 'compressed' : 'nested',
        sourceComments: hasComments,
        indentedSyntax: sassRe.test(source.path),
        outFile: 'a.css',
        sourceMap: true,
        sourceMapEmbed: !this.optimize && this.config.sourceMapEmbed,
        importer: nodeSassGlobbing,
      },
      (error, result) => {
        if (error) {
          return reject(formatError(source.path, error));
        }

        const data =
          result.css.toString().replace('/*# sourceMappingURL=a.css.map */', '');

        resolve({data});
      });
    });
  }

  compile(params) {
    // skip empty source files
    if (!params.data.trim().length) return Promise.resolve({data: ''});

    return this._nativeCompile(params);
  }
}

SassCompiler.prototype.brunchPlugin = true;
SassCompiler.prototype.type = 'stylesheet';
SassCompiler.prototype.pattern = /\.s[ac]ss$/;
SassCompiler.prototype._bin = isWindows ? 'sass.bat' : 'sass';

module.exports = SassCompiler;
