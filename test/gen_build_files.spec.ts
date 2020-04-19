import * as gen from '../src/gen_build_files';
import * as fs from 'fs';
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';

const isDirectory = (d: string) => fs.lstatSync(d).isDirectory();

const mkdirp = (p: string) => {
    if (!fs.existsSync(p)) {
        mkdirp(path.dirname(p));
        fs.mkdirSync(p);
    }
}

const mktemp = () => {
    // otherwise make a new directory for temp files
    const t = path.join(os.tmpdir(), fs.mkdtempSync('gen_build_files.accept'));
    mkdirp(t);
    return t;
};

function copyFile(src: string, dest: string) {
    const parsed = path.parse(dest);
    mkdirp(path.dirname(dest));
    if (parsed.name === 'BUILD' && parsed.ext === '.in') {
        fs.copyFileSync(src, dest.slice(0, -3) + '.bazel');
    }
    else if (parsed.name === 'BUILD' && parsed.ext === '.bazel') {
        fs.copyFileSync(src, dest.slice(0, -6) + '.golden');
    }
    else {
        fs.copyFileSync(src, dest);    
    }        
}

function copyFixture(input: string, output: string) {
    fs.readdirSync(input).forEach(f => {
        if (isDirectory(path.join(input, f))) {
            copyFixture(path.join(input, f), path.join(output, f));
        } else {
            copyFile(path.join(input, f), path.join(output, f));
        }
    });
}

function doAssertions(dir: string) {
    fs.readdirSync(dir).map(f => path.join(dir, f)).forEach(f => {
        if (isDirectory(f)) {
            doAssertions(f);
        } else {
            const parsed = path.parse(f);
            if (parsed.ext === '.golden') {
                const expected = fs.readFileSync(f, 'utf-8');
                const actualPath = f.slice(0, -'.golden'.length) + '.bazel';
                
                const actual = fs.readFileSync(actualPath, 'utf-8');
                if (actual === expected) return;

                if (acceptGoldens) {
                    const goldenSrcPath = f.replace(tmpDir, wkspDir).replace(/\.golden$/, '.bazel');
                    console.log('Writing updated golden file', goldenSrcPath);
                    fs.writeFileSync(goldenSrcPath, actual);
                } else {
                    const unidiff = require('unidiff');
                    // Generated does not match golden
                    const diff = unidiff.diffLines(expected, actual);
                    let prettyDiff = unidiff.formatLines(diff, {aname: f, bname: actualPath});
                    if (prettyDiff.length > 5000) {
                      prettyDiff = prettyDiff.substr(0, 5000) + '/n...elided...';
                    }
                    throw new Error(`Actual BUILD file doesn't match expected:
              
              ${prettyDiff}
              
    Update the golden file:
    
        bazel run --config=hide_test_packages ${process.env['TEST_TARGET']}.accept
    `);
                }
            }
        }
    });
}

let acceptGoldens: boolean;
let tmpDir: string;
let wkspDir: string;
// Use presence of this env var to indicate we are in `bazel run`
if (process.env['BUILD_WORKING_DIRECTORY'] && process.env['BAZEL_TARGET'] && process.env['BAZEL_TARGET'].endsWith('.accept')) {
    acceptGoldens = true;
    wkspDir = path.join(process.env['BUILD_WORKING_DIRECTORY']);
    tmpDir = mktemp();
} else if (process.env['TEST_TMPDIR'] && process.env['TEST_SRCDIR'] && process.env['BAZEL_WORKSPACE']) {
    acceptGoldens = false;
    tmpDir = process.env['TEST_TMPDIR'];
    wkspDir = path.join(
        process.env['TEST_SRCDIR'],
        process.env['BAZEL_WORKSPACE']);
} else {
    assert.fail('Missing bazel environment variables');
}
const testDir = path.join(wkspDir, 'test');

copyFile(path.join(wkspDir, 'WORKSPACE'), path.join(tmpDir, 'WORKSPACE'));
// NB: all tests will run in the same workspace, we rely on them not having isolation failures by reaching outside the root
fs.readdirSync(testDir).filter(d => isDirectory(path.join(testDir, d))).forEach(pluginDir => {
    fs.readdirSync(path.join(testDir, pluginDir)).filter(d => isDirectory(path.join(testDir, pluginDir, d))).forEach(testcase => {
        console.log('TESTCASE', pluginDir, '/', testcase);
        copyFixture(path.join(testDir, pluginDir), path.join(tmpDir, 'test', pluginDir));
        gen.main([path.join(tmpDir, 'test', pluginDir, testcase)]);
        doAssertions(path.join(tmpDir, 'test', pluginDir, testcase));
    });
});
