/* eslint camelcase: 0 */

'use strict';

const cp = require('child_process'), spawn = cp.spawn, exec = cp.exec;
const sysPath = require('path');
const progeny = require('progeny');
const libsass = require('node-sass');
const os = require('os');
const anymatch = require('anymatch');
const promisify = require('micro-promisify');
const nodeSassGlobbing = require('node-sass-globbing');

const postcss = require('postcss');
const postcssModules = require('postcss-modules');

const cssModulify = (path, data, map, options) => {
  let json = {};
  const getJSON = (_, _json) => json = _json; // eslint-disable-line

  return postcss([postcssModules(Object.assign({}, {getJSON}, options))])
    .process(data, {from: path, map}).then(x => {
      const exports = `module.exports = ${JSON.stringify(json)};`;
      return {
        exports,
        data: x.css,
        map: x.map,
      };
    });
};

const isWindows = os.platform() === 'win32';
const compassRe = /compass/;
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

const promiseSpawnAndPipe = (cmd, args, env, data) => {
  let result = '';
  let error;

  return new Promise((resolve, reject) => {
    const sass = spawn(cmd, args, env);
    sass.stdout.on('data', buffer => {
      result += buffer.toString();
    });
    sass.stderr.on('data', buffer => {
      if (error == null) error = '';
      error += buffer.toString();
    });
    sass.on('close', () => {
      if (error) return reject(error);
      resolve(result);
    });
    if (sass.stdin.write(data)) {
      sass.stdin.end();
    } else {
      sass.stdin.on('drain', () => {
        sass.stdin.end();
      });
    }
  });
};

class SassCompiler {
  constructor(cfg) {
    if (cfg == null) cfg = {};
    this.rootPath = cfg.paths.root;
    this.optimize = cfg.optimize;
    this.config = cfg.plugins && cfg.plugins.sass || {};
    this.modules = this.config.modules || this.config.cssModules;

    if (this.modules && this.modules.ignore) {
      this.isIgnored = anymatch(this.modules.ignore);
      delete this.modules.ignore;
    } else {
      this.isIgnored = anymatch([]);
    }

    delete this.config.modules;
    delete this.config.cssModules;
    this.mode = this.config.mode;
    if (this.config.options != null && this.config.options.includePaths != null) {
      this.includePaths = this.config.options.includePaths;
    }

    this.env = {};
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
        precision: this.config.precision,
        includePaths: this._getIncludePaths(source.path),
        outputStyle: this.optimize ? 'compressed' : 'nested',
        sourceComments: hasComments,
        indentedSyntax: sassRe.test(source.path),
        outFile: 'a.css',
        functions: this.config.functions,
        sourceMap: true,
        sourceMapEmbed: !this.optimize && this.config.sourceMapEmbed,
        importer: nodeSassGlobbing,
      },
      (error, result) => {
        if (error) {
          return reject(formatError(source.path, error));
        }
        const data = result.css.toString().replace('/*# sourceMappingURL=a.css.map */', '');
        const map = JSON.parse(result.map.toString());
        resolve({data, map});
      });
    });
  }

  get getDependencies() {
    return progeny({
      rootPath: this.rootPath,
      altPaths: this.includePaths,
      reverseArgs: true,
      globDeps: true,
    });
  }

  compile(params) {
    const data = params.data;
    const path = params.path;

    // skip empty source files
    if (!data.trim().length) return Promise.resolve({data: ''});

    const source = {
      data,
      path
    };

    this._nativeCompile(source).then(params => {
      if (this.modules && !this.isIgnored(path)) {
        const moduleOptions = this.modules === true ? {} : this.modules;
        return cssModulify(path, params.data, params.map, moduleOptions);
      }

      console.log(source.path);

      return params;
    });
  }
}

SassCompiler.prototype.brunchPlugin = true;
SassCompiler.prototype.type = 'stylesheet';
SassCompiler.prototype.pattern = /\.s[ac]ss$/;
SassCompiler.prototype._bin = isWindows ? 'sass.bat' : 'sass';
SassCompiler.prototype._compass_bin = isWindows ? 'compass.bat' : 'compass';

module.exports = SassCompiler;
