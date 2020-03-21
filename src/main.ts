#!/usr/bin/env node
// CLI entry point for the build file generator

try {
    process.exitCode = require('./gen_build_files').main([process.cwd(), ...process.argv.slice(2)]);
} catch (e) {
    console.error(e);
    process.exitCode = 1;
}
