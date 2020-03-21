#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as buildozer from '@bazel/buildozer';

// In newly created BUILD files, we set a default visibility for convenience
const default_visibility = '//:__subpackages__';
// Where the ts_project starlark symbol can be loaded from
const ts_project_load = '@npm_bazel_typescript//:index.bzl';

// Walk up the filesystem starting from dir to find a directory containing the Bazel workspace/build file
function locate(dir: string, file: string): string {
    const files = fs.readdirSync(dir);
    for (let i = 0; i < files.length; i++) {
        const basename = path.basename(files[i]);
        if (basename === file || basename === file + '.bazel') {
            return dir;
        }
    }
    if (path.dirname(dir) === dir) {
        throw new Error(`Bazel workspace/package can not be found.
        No parent directory contains a ${file} or ${file}.bazel file.`);
    }
    return locate(path.dirname(dir), file);
}

function locateWorkspace(dir: string) {
    return locate(dir, 'WORKSPACE');
}

function locatePackage(dir: string) {
    try {
        return locate(dir, 'BUILD');
    } catch (e) {
        // If there was no BUILD file up the fs, maybe we are in a new directory
        // and there isn't a BUILD file in the workspace root.
        // In that case our package is the root package
        return locateWorkspace(dir);
    }
}

function toLabel(wksp: string, file: string) {
    const p = locatePackage(path.dirname(file));
    return `//${path.posix.relative(wksp, p)}:${path.posix.relative(p, file)}`;
}

// Create a "comment ..." command with necessary escaping
function escapeComment(comment: string) {
    return comment.replace(/(\s)/g, '\\$1');
}

function translate(wksp: string, dir: string, tsconfigPath: string, sys = ts.sys): buildozer.CommandBatch[] {
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
                `new_load ${ts_project_load} ts_project`,
                `new ts_project ${ruleName}`,
            ],
            targets: [`${pkg}:__pkg__`],
        });
        // Add some helpful comments so users understand what we wrote
        tsTargetCommands.push(
            // TODO: this comment should instruct how to re-generate the BUILD file
            'comment ' + escapeComment('This rule auto-generated and maintained'),
            'comment name ' + escapeComment(`This will use ./${path.basename(tsconfigPath)}`),
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
            tsTargetCommands.push('comment srcs ' + escapeComment(
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
            const s = fs.lstatSync(ref.path);
            if (s.isDirectory()) {
                tsTargetCommands.push(`add deps //${path.posix.relative(wksp, ref.path)}:tsconfig`);
            } else {
                const rel = path.posix.relative(wksp, ref.path);
                tsTargetCommands.push(`add deps //${path.posix.dirname(rel)}:${path.parse(rel).name}`);
            }
        }
    }
    // NB: composite implies declaration
    if (!options.declaration && !options.composite) {
        tsTargetCommands.push('set declaration False');
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

export function main(args: string[]): 0|1 {
    const root = args[0];
    const wksp = locateWorkspace(root);
    const bazelIgnorePaths: string[] = [];
    const buildozerCmds: buildozer.CommandBatch[] = [];
    function ignored(p: string) {
        for (const ignorePath of bazelIgnorePaths) {
            if (!path.relative(ignorePath, p).startsWith('..')) {
                return true;
            }
        }
        return false;
    }

    function walk(dir: string) {
        const join = (p: string) => path.join(dir, p);
        const pkg = '//' + path.posix.relative(wksp, dir);
        const files = fs.readdirSync(dir);
        
        // First process ignore file, so that we honor it while walking subdirs
        if (files.includes('.bazelignore')) {
            const ignoreContent = fs.readFileSync(join('.bazelignore'), 'utf-8');
            bazelIgnorePaths.push(...ignoreContent.split('\n').filter(l => !!l).map(p => path.resolve(dir, p)));
        }

        // Find the tsconfig files that will become ts_project rules.
        const tsconfigs = files.filter(f => f.match(/tsconfig.*\.json/)).map(join).filter(t => !ignored(t));

        // Create new BUILD files in any directory with a tsconfig file
        // Do this before walking into subdirectories so that subpackages can write correct labels
        // when referencing a file in their ancestors.
        if (tsconfigs.length > 0 && !files.includes('BUILD') && !files.includes('BUILD.bazel')) {
            const newFile = path.resolve(wksp, path.join(dir, 'BUILD.bazel'));
            console.error('Creating new Bazel package in ', dir);
            fs.writeFileSync(newFile, '', {encoding: 'utf-8'});
            buildozerCmds.push({commands: [`set default_visibility ${default_visibility}`], targets: [`${pkg}:__pkg__`]});
        }

        // Next walk into subdirectories, so we see their package boundaries from the parent
        // We want to know that subdir/BUILD.bazel will exist so we write labels like
        // subdir:file instead of subdir/file
        files.map(join).filter(f => fs.lstatSync(f).isDirectory()).forEach(walk);
        
        // Finally write BUILD rules for the tsconfig files in this directory.
        tsconfigs.forEach(tsconfig => {
            buildozerCmds.push(...translate(wksp, dir, tsconfig));
        });
    }

    walk(root);
    buildozer.runWithOptions(buildozerCmds, {cwd: wksp});
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main([process.cwd(), ...process.argv.slice(2)]);
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    }
}