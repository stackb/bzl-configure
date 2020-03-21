import * as path from 'path';
import * as fs from 'fs';

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

export function locateWorkspace(dir: string) {
    return locate(dir, 'WORKSPACE');
}

export function locatePackage(dir: string) {
    try {
        return locate(dir, 'BUILD');
    } catch (e) {
        // If there was no BUILD file up the fs, maybe we are in a new directory
        // and there isn't a BUILD file in the workspace root.
        // In that case our package is the root package
        return locateWorkspace(dir);
    }
}

export function toLabel(wksp: string, file: string) {
    const p = locatePackage(path.dirname(file));
    return `//${path.posix.relative(wksp, p)}:${path.posix.relative(p, file)}`;
}
