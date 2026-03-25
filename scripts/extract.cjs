const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT_DIR, '.n8n-cache');
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist');

function run(command, cwd = ROOT_DIR) {
    console.log(`> ${command}`);
    execSync(command, { cwd, stdio: 'inherit' });
}

function findNodeFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findNodeFiles(fullPath));
        } else if (entry.name.endsWith('.node.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

async function loadModule(fullPath) {
    try {
        return require(fullPath);
    } catch (err) {
        if (err.code === 'ERR_REQUIRE_ESM' || err.code === 'ERR_REQUIRE_ASYNC_MODULE') {
            const { pathToFileURL } = require('url');
            const ns = await import(pathToFileURL(fullPath).href);
            if (ns.default && typeof ns.default === 'object') {
                return { ...ns, ...ns.default };
            }
            return ns;
        }
        throw err;
    }
}

function extractNodeInfo(mod) {
    for (const key of Object.keys(mod)) {
        const item = mod[key];
        if (typeof item !== 'function' || !item.prototype) continue;

        try {
            const instance = new item();

            if (instance.nodeVersions) {
                const versions = Object.keys(instance.nodeVersions)
                    .map(Number)
                    .sort((a, b) => a - b);
                const latestKey = instance.defaultVersion
                    ?? versions[versions.length - 1];
                const latest = instance.nodeVersions[latestKey];
                const desc = latest?.description;
                if (!desc?.name) continue;

                return {
                    name: desc.name,
                    displayName: desc.displayName,
                    typeVersions: versions,
                    latestTypeVersion: latestKey,
                };
            }

            if (instance.description?.name) {
                const desc = instance.description;
                const version = Array.isArray(desc.version)
                    ? desc.version
                    : [desc.version ?? 1];

                return {
                    name: desc.name,
                    displayName: desc.displayName,
                    typeVersions: version.sort((a, b) => a - b),
                    latestTypeVersion: version[version.length - 1],
                };
            }
        } catch {
            // skip
        }
    }
    return null;
}

async function main() {
    const n8nTag = process.argv[2];
    if (!n8nTag) {
        console.error('Usage: node extract.cjs <n8n-tag>');
        console.error('Example: node extract.cjs n8n@2.13.2');
        process.exit(1);
    }

    const version = n8nTag.replace(/^n8n@/, '');

    // Clone
    console.log(`\n=== Cloning n8n@${version} ===`);
    if (fs.existsSync(CACHE_DIR)) {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }
    execFileSync('git', [
        'clone', '--depth', '1', '--branch', n8nTag,
        'https://github.com/n8n-io/n8n.git', '.n8n-cache',
    ], { cwd: ROOT_DIR, stdio: 'inherit' });

    // Build
    console.log('\n=== Installing dependencies ===');
    run('pnpm install', CACHE_DIR);

    console.log('\n=== Building nodes-base ===');
    run('pnpm build --filter n8n-nodes-base...', CACHE_DIR);

    console.log('\n=== Building nodes-langchain ===');
    run('pnpm build --filter @n8n/n8n-nodes-langchain', CACHE_DIR);

    // Extract
    console.log('\n=== Extracting node metadata ===');
    const scanDirs = [
        path.join(CACHE_DIR, 'packages/nodes-base/dist/nodes'),
        path.join(CACHE_DIR, 'packages/@n8n/nodes-langchain/dist'),
    ];

    // Add module paths for require resolution
    const modulePaths = [
        path.join(CACHE_DIR, 'node_modules'),
        path.join(CACHE_DIR, 'packages/nodes-base/node_modules'),
        path.join(CACHE_DIR, 'packages/@n8n/nodes-langchain/node_modules'),
    ];
    for (const mp of modulePaths) {
        if (fs.existsSync(mp) && !module.paths.includes(mp)) {
            module.paths.push(mp);
        }
    }

    const nodes = {};
    let successCount = 0;
    let errorCount = 0;

    for (const dir of scanDirs) {
        if (!fs.existsSync(dir)) {
            console.warn(`Directory not found, skipping: ${dir}`);
            continue;
        }

        const files = findNodeFiles(dir);
        console.log(`Found ${files.length} node files in ${path.basename(path.dirname(dir))}`);

        for (const file of files) {
            try {
                const mod = await loadModule(file);
                const info = extractNodeInfo(mod);
                if (info) {
                    // Deduplicate: keep the one with more typeVersions
                    const existing = nodes[info.name];
                    if (!existing || info.typeVersions.length > existing.typeVersions.length) {
                        nodes[info.name] = info;
                    }
                    if (!existing) successCount++;
                } else {
                    errorCount++;
                }
            } catch {
                errorCount++;
            }
        }
    }

    console.log(`\nExtracted: ${successCount} nodes, Skipped: ${errorCount}`);

    // Output
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const output = {
        n8nVersion: version,
        generatedAt: new Date().toISOString(),
        nodeCount: Object.keys(nodes).length,
        nodes,
    };

    const outPath = path.join(OUTPUT_DIR, `nodes-${version}.json`);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nSaved to ${outPath}`);

    // Cleanup
    console.log('\n=== Cleaning up ===');
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
