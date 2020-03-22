import * as fs from 'fs';
import * as path from 'path';
import {ConfigurationPlugin} from './types';
import * as buildozer from '@bazel/buildozer';
import {TsProjectPlugin} from './plugin_ts_project';
import {PkgNpmPlugin} from './plugin_pkg_npm';
import {locateWorkspace} from './util';

// In newly created BUILD files, we set a default visibility for convenience
const default_visibility = '//:__subpackages__';

export function main(args: string[]): 0|1 {
    const root = args[0];
    const plugins: ConfigurationPlugin[] = [new TsProjectPlugin, new PkgNpmPlugin];
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

        const pluginToRelevantFiles: Map<ConfigurationPlugin, Array<string>> = new Map();
        plugins.forEach(p => {
            const relevantFiles = files.map(join).filter(f => !ignored(f)).filter(p.isPackageIndicator);
            if (relevantFiles.length > 0) {
                pluginToRelevantFiles.set(p, relevantFiles);
            }
        });

        // Create new BUILD files in any directory with an indicator file
        // Do this before walking into subdirectories so that subpackages can write correct labels
        // when referencing a file in their ancestors.
        if (pluginToRelevantFiles.size > 0 && !files.includes('BUILD') && !files.includes('BUILD.bazel')) {
            const newFile = path.resolve(wksp, path.join(dir, 'BUILD.bazel'));
            console.log('Creating new Bazel package in ', dir);
            fs.writeFileSync(newFile, '', {encoding: 'utf-8'});
            buildozerCmds.push({commands: [`set default_visibility ${default_visibility}`], targets: [`${pkg}:__pkg__`]});
        }

        // Next walk into subdirectories, so we see their package boundaries from the parent
        // We want to know that subdir/BUILD.bazel will exist so we write labels like
        // subdir:file instead of subdir/file
        files.map(join).filter(f => fs.lstatSync(f).isDirectory()).forEach(walk);
        
        // Finally write BUILD rules for the relevant files in this directory.
        for (const [plugin, relevantFiles] of pluginToRelevantFiles.entries()) {
            relevantFiles.forEach(f => {
                buildozerCmds.push(...plugin.translate(wksp, dir, f));
            });
        }
    }

    // Kick off the recursive walk of subdirectories of the root
    walk(root);

    // Flush all the buildozer batches to disk
    buildozer.runWithOptions(buildozerCmds, {cwd: wksp});
    return 0;
}
