# ts_composite

This is an experiment to re-build the Bazel TypeScript support on plain tsc, following the design of [Project References](https://www.typescriptlang.org/docs/handbook/project-references.html). The basic principle is to make Bazel a very thin layer on top of TypeScript semantics.

The ts_library rule in current rules_nodejs is too complex and not compatible with all code. It is also hard to change because it is used internally at Google by a very large codebase with complicated interactions with surrounding build tooling.

## Design principles

- All TS configuration in the BUILD file should be trivially derivable from tsconfig.json files. Not only should it be possible to have a BUILD file generator from the beginning, but that generator should not need complex resolution logic. If TypeScript sees a project reference to a tsconfig file path, it should be trivial to reliably map that to a Bazel target name.
- Bazel should have no opinions at all. Users completely control the build with tsconfig.json settings. Note that this is a tradeoff; some aspects of the `ts_library` design are there to reduce sharp corners at the expense of customizability.
- Some users could use `tsc --build` on their codebase and opt-out from Bazel. This is a good strategy in orgs where some developers want to stay on their current tooling, and the Bazel migration is done mostly for CI benefits.
- It should be possible to use the `tsc` compiler from TypeScript, not require a custom binary like `tsc_wrapped`
  - We might want to publish an alternative compiler binary to add features from `tsc_wrapped` like Worker mode, DiagnosticPlugin like tsetse and lit_plugin but these should be optional, and if you use plain `tsc` it should degrade gracefully
- The on-boarding changes required in your code, like enabling `--declaration`, should be part of opting-in to Project References. Once your code works with `tsc --build` it should also work with Bazel.
  - Ryan Cavenaugh (TS TL) thinks it makes sense to build tooling to help users with big TS projects to break them up into composite projects. This should be independent of Bazel and would presumably have a wide adoption.
  - TS should have built-in Code Actions to fix diagnostics like "could not be named" that happen when you turn on `--declaration` - and some command-line runner that gathers Code Actions from the language service to apply them (think of it like `tsc --fix`)
- It should be impossible to observe a bug or wrong behavior under Bazel that you can't reproduce under `tsc --build`

Want to preserve good behavior:

- interop with old `ts_library` rule using `DeclarationInfo` provider.
- inputs to each action include only .d.ts, not .js, to limit cascading re-builds

## Questions from discussion with Greg

- should there be adapter rule to DeclarationInfo - gives better error when you put wrong thing in deps - or should we accept all files like filegroup of .d.ts in the deps
    - you could put your .d.ts files in the srcs for that matter - make sure they are propagated
- Want to ship with 2.0, in the `@bazel/typescript` named `ts_project`
- load from `@npm//@bazel/typescript:index.bzl`
- declarations optional, declaration maps, sourcemaps optional, can sync these from tsconfig
- where should npm deps go? use a //keep comment
- should produce JsModuleInfo (should the module format be in here? might give better error messaging if you try to pass ts_project -> ts_devserver)
- when the action runs we can validate the tsconfig is in sync with BUILD
- we should allow any file that TS allows as an input - like .json - maybe no constraint at all
- should you dep on `@npm//foo` or `@npm//@types/foo` - the former makes runtime easier, no separate place to declare that. `@npm//foo` should have a DeclarationInfo that provides the `@types/foo`
- what should be the ts_project dependencies on third-party - reading the tsconfig.json doesn't tell us - so we always add `@npm//:node_modules` to the deps of a ts_project - if the user overrides this with fine-grained deps we preserve that.
- should we ship with custom binary? so we get worker mode and such
  - you could just run `tsc --build --watch` if you want the fastness

### Information lives in tsconfig.json

Today under Bazel, we have settings in the BUILD.bazel file such as `deps`, and generate a tsconfig.json file.
To work with all TS code, we have to accept users tsconfig files (they might have settings like include/exclude which must be paths relative to the location where the tsconfig file was read).

One option (likely needed in Google-internal) is to continue generating the tsconfig file, but make it appear to TS as if it was read from the source directory (maybe by hacking the compilerHost in a custom tsc compiler).

Another option is that whatever tooling helps to keep BUILD.bazel files up-to-date also helps with tsconfig.json files. For example, every tsconfig needs "composite": true or must extend from a tsconfig that has such a setting.

## Missing features

- Worker mode
- Strict dependencies - belongs in TS itself https://github.com/microsoft/TypeScript/issues/36743
- Diagnostic plugins like tsetse and lit-plugin
- Emit plugins like angular
- Producing devmode and prodmode JS outputs from a single target
- goog.module and tsickle-typed emit for interop with Closure Compiler

## Problems

### Resolving from outdir

TypeScript needs to know to resolve `.d.ts` inputs from the output directory. It has the built-in feature `rootDirs` that allows you to overlay the physical input and output directories as a single logical layer, so that relative imports work from .ts files in the sources to  .d.ts files in the output. However, this setting has to go in the `tsconfig.json` file, and it has a platform-specific bit (e.g. `bazel-out/darwin-fastbuild/bin`)
