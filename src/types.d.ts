import * as buildozer from '@bazel/buildozer';

// Describes a plugin that offers to configure Bazel from a set of source files.
interface ConfigurationPlugin {
    // Whether this file indicates that a package should be created in the directory it's found
    isPackageIndicator: (file: string) => boolean;

    // Create buildozer commands that sync information from one source file into the BUILD file
    translate(wksp: string, dir: string, f: string): buildozer.CommandBatch[];
}
