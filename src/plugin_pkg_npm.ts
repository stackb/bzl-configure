import * as path from 'path';
import {ConfigurationPlugin} from './types';
import * as buildozer from './buildozer';
import * as ts from 'typescript';
import {locatePackage, toLabel} from './util';

export class PkgNpmPlugin implements ConfigurationPlugin {
    // Where the pkg_npm starlark symbol can be loaded from
    load_location = '@build_bazel_rules_nodejs//:index.bzl';

    isPackageIndicator(file: string): boolean {
        return path.basename(file).match(/package\.json/) != null;
    }

    translate(wksp: string, dir: string, packageJsonPath: string, sys = ts.sys): buildozer.CommandBatch[] {
        const buildozerCmds = [];
        const packageContents = JSON.parse(require('fs').readFileSync(packageJsonPath));
        const pkg = '//' + path.posix.relative(wksp, dir);

        buildozerCmds.push({
            commands: [
                // Before we touch load statements, the documentation says to always run this first
                'fix movePackageToTop',
                `new_load ${this.load_location} pkg_npm`,
                `new pkg_npm ${packageContents.name}`,
            ],
            targets: [`${pkg}:__pkg__`],
        });
        return buildozerCmds;
    }
}