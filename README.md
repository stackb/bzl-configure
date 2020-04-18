# bzl-autoconf

This is a tool for Bazel auto-configuration.

Following in the footsteps of https://www.gnu.org/software/autoconf/ we want to improve the Bazel on-ramp by generating configuration files.

## Design principles

- The generated build files should work 100% if the sources follow some reasonable
  conventions, such as declaring all their dependencies (using whatever idiom is used for that language) and if the rules are amenable to it
- When used on existing code, it should do 80% of the work of configuring Bazel,
  including creating/updating the `WORKSPACE` file and helpers, and adding/updating
  rules in BUILD files
- It should be a federated system. Tooling for each language/ecosystem is best written in that language. The tooling to read TypeScript code to produce TypeScript rules is written in TypeScript. Auto-config for Go is written in Go (Gazelle), etc
- In trivial cases, users should be able to set up BUILD file generation without having to write code, for example "every foo file in the repo should get an `exports_files(['foo'])`" 

### Information lives in idiomatic files, BUILD as "bare facts"

Today under Bazel, many rules have settings in the BUILD.bazel file such as `deps`, and generate a configuration for tooling like `tsconfig.json` file.

This project assumes that we will shift all of the responsibility for configuring tools into the native, idiomatic method for that language. This reduces the burden on BUILD files and leverages tooling in that ecosystem for declaring configuration.
It also gives a better escape valve for some engineers who don't want to use Bazel or if the whole org decides to abandon Bazel.
