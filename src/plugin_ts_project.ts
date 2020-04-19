import * as path from 'path';
import {ConfigurationPlugin} from './types';
import * as buildozer from './buildozer';
import * as ts from 'typescript';
import {locatePackage, toLabel} from './util';

export class TsProjectPlugin implements ConfigurationPlugin {
    // Where the ts_project starlark symbol can be loaded from
    ts_project_load = '@npm_bazel_typescript//:index.bzl';

    isPackageIndicator(file: string): boolean {
        return path.basename(file).match(/tsconfig.*\.json/) != null;
    }

    translate(wksp: string, dir: string, tsconfigPath: string, sys = ts.sys): buildozer.CommandBatch[] {
        const diagnosticsHost: ts.FormatDiagnosticsHost = {
            getCurrentDirectory: () => sys.getCurrentDirectory(),
            getNewLine: () => sys.newLine,
            // Print filenames including their relativeRoot, so they can be located on
            // disk
            getCanonicalFileName: (f: string) => f
        };

        const {config, error} = ts.readConfigFile(tsconfigPath, sys.readFile);
        if (error) throw new Error(tsconfigPath + ':' + ts.formatDiagnostic(error, diagnosticsHost));
        const {errors, fileNames, projectReferences, options} = ts.parseJsonConfigFileContent(config, sys, dir);
        if (errors && errors.length) throw new Error(tsconfigPath + ':' + ts.formatDiagnostics(errors, diagnosticsHost));

        if (fileNames.length === 0) {
            // We don't write a BUILD file when there are no sources to compile
            return [];
        }
        const pkg = '//' + path.posix.relative(wksp, dir);
        const ruleName = path.parse(tsconfigPath).name;
        const buildozerCmds = [];
        const tsTargetCommands = [];

        const existingTsProjectRules = buildozer.runWithOptions([{
            commands: ['print name'],
            targets: [`${pkg}:%ts_project`],
        }], {cwd: wksp});

        if (!existingTsProjectRules.includes(ruleName)) {
            buildozerCmds.push({
                commands: [
                    // Before we touch load statements, the documentation says to always run this first
                    'fix movePackageToTop',
                    `new_load ${this.ts_project_load} ts_project`,
                    `new ts_project ${ruleName}`,
                ],
                targets: [`${pkg}:__pkg__`],
            });
            // Add some helpful comments so users understand what we wrote
            tsTargetCommands.push(
                // TODO: this comment should instruct how to re-generate the BUILD file
                'comment ' + buildozer.escapeComment('This rule auto-generated and maintained'),
                'comment name ' + buildozer.escapeComment(`This will use ./${path.basename(tsconfigPath)}`),
                // By default, include all third-party deps
                'add deps @npm//:node_modules',
            );
        }
        console.log(`Found tsconfig.json file at ${tsconfigPath}; updating rule ${pkg}:${ruleName}`);

        // first clear the srcs[] list so that removals are synced
        tsTargetCommands.push('set srcs');
        // TODO: warn if the same src appears in more than one project
        // this will cause an error in Bazel if you try to build both projects
        // in the same invocation
        fileNames.forEach(src => {
            // If the source is in the current package, we can produce outputs for it
            if(locatePackage(path.dirname(src)) === dir) {
                tsTargetCommands.push(`add srcs ${toLabel(wksp, src)}`);
            } else {
                tsTargetCommands.push('comment srcs ' + buildozer.escapeComment(
                    `NB: ${path.relative(dir, src)} was omitted since it's in a different package`));
            }
        });

        function addExtends(baseDir:string, extendsStr: string|undefined) {
            if (!extendsStr || extendsStr.length === 0) return;
            const extendsPath = path.resolve(baseDir, extendsStr + (extendsStr.endsWith('.json') ? '' : '.json'));
            const extendsLabel = toLabel(wksp, extendsPath);
            tsTargetCommands.push(`add extends "${extendsLabel}"`);
            // This is a bit wasteful: we parse the tsconfig here even though
            // we also do it when visiting that other tsconfig.
            // However this allows us to avoid visiting the files in a particular order.
            const {config: extendedConfig, error} = ts.readConfigFile(extendsPath, sys.readFile);
            if (error) throw new Error(ts.formatDiagnostic(error, diagnosticsHost));
            // Now recurse to grab any more extended tsconfigs in the chain
            const resolvedBaseDirToExtend = path.resolve(baseDir, path.dirname(extendsStr));
            addExtends(resolvedBaseDirToExtend, extendedConfig.extends);
        }
        addExtends(dir, config.extends);

        if (projectReferences) {
            for (let i=0; i<projectReferences.length; i++) {
                const ref = projectReferences[i];
                
                ts.resolveProjectReferencePath(ref);
                // if (s.isDirectory()) {
                //     tsTargetCommands.push(`add deps //${path.posix.relative(wksp, ref.path)}:tsconfig`);
                // } else {
                //     const rel = path.posix.relative(wksp, ref.path);
                //     tsTargetCommands.push(`add deps //${path.posix.dirname(rel)}:${path.parse(rel).name}`);
                // }
            }
        }

        if (options.declaration) {
            tsTargetCommands.push('set declaration True');
        }
        if (options.composite) {
            tsTargetCommands.push('set composite True');
        }
        if (options.declarationMap) {
            tsTargetCommands.push('set declaration_map True');
        }
        if (options.sourceMap) {
            tsTargetCommands.push('set source_map True');
        }
        if (options.emitDeclarationOnly) {
            tsTargetCommands.push('set emit_declaration_only True');
        }
        buildozerCmds.push({commands: tsTargetCommands, targets: [`${pkg}:${ruleName}`]});
        return buildozerCmds;
    }
}
