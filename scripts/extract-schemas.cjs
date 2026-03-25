const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT_DIR, '.n8n-cache');
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist/schemas');

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

function extractAllVersionSchemas(mod) {
    for (const key of Object.keys(mod)) {
        const item = mod[key];
        if (typeof item !== 'function' || !item.prototype) continue;

        try {
            const instance = new item();

            if (instance.nodeVersions) {
                const result = {};
                for (const [ver, versionNode] of Object.entries(instance.nodeVersions)) {
                    const desc = versionNode?.description;
                    if (!desc?.name) continue;
                    result[ver] = {
                        name: desc.name,
                        displayName: desc.displayName,
                        properties: desc.properties || [],
                        credentials: desc.credentials || [],
                    };
                }
                if (Object.keys(result).length > 0) return result;
            }

            if (instance.description?.name) {
                const desc = instance.description;
                const ver = Array.isArray(desc.version)
                    ? desc.version[desc.version.length - 1]
                    : (desc.version ?? 1);
                return {
                    [ver]: {
                        name: desc.name,
                        displayName: desc.displayName,
                        properties: desc.properties || [],
                        credentials: desc.credentials || [],
                    },
                };
            }
        } catch {
            // skip
        }
    }
    return null;
}

// --- .d.ts generation ---

function sanitizeVersionName(ver) {
    return `V${String(ver).replace(/\./g, '_')}`;
}

function mapPropertyType(prop) {
    switch (prop.type) {
        case 'string':
        case 'color':
            if (prop.options && prop.options.length > 0) {
                return prop.options.map(o => `'${o.value}'`).join(' | ');
            }
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'options':
            if (prop.options && prop.options.length > 0) {
                return prop.options.map(o => `'${o.value}'`).join(' | ');
            }
            return 'string';
        case 'multiOptions':
            if (prop.options && prop.options.length > 0) {
                return `Array<${prop.options.map(o => `'${o.value}'`).join(' | ')}>`;
            }
            return 'string[]';
        case 'collection':
        case 'fixedCollection':
            return 'Record<string, unknown>';
        case 'json':
            return 'string | object';
        case 'resourceLocator':
            return 'string | { __rl: true; mode: string; value: string }';
        case 'resourceMapper':
            return 'Record<string, unknown>';
        case 'notice':
            return null; // skip, not a real parameter
        case 'filter':
            return 'Record<string, unknown>';
        case 'assignmentCollection':
            return '{ assignments: Array<{ id: string; name: string; value: unknown; type: string }> }';
        default:
            return 'unknown';
    }
}

function generateNamespaceBody(schema, indent) {
    const lines = [];
    lines.push(`${indent}interface Params {`);
    for (const prop of schema.properties) {
        const tsType = mapPropertyType(prop);
        if (tsType === null) continue; // skip notice etc.
        const optional = prop.required ? '' : '?';
        const comment = prop.description
            ? ` /** ${prop.description.replace(/\*\//g, '* /')} */`
            : '';
        const safeName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop.name)
            ? prop.name
            : `'${prop.name}'`;
        if (comment) lines.push(`${indent}  ${comment}`);
        lines.push(`${indent}  ${safeName}${optional}: ${tsType};`);
    }
    lines.push(`${indent}}`);

    if (schema.credentials && schema.credentials.length > 0) {
        lines.push('');
        lines.push(`${indent}type Credentials = ${schema.credentials.map(c => `'${c.name}'`).join(' | ')};`);
    }

    return lines.join('\n');
}

function generateDts(nodeName, versionSchemas) {
    const lines = [];
    lines.push(`// Auto-generated from n8n source. Do not edit manually.`);
    lines.push('');

    const sortedVersions = Object.keys(versionSchemas)
        .map(Number)
        .sort((a, b) => a - b);

    const displayName = Object.values(versionSchemas)[0]?.displayName || nodeName;
    lines.push(`/** ${displayName} */`);
    lines.push(`declare namespace ${nodeName} {`);

    for (const ver of sortedVersions) {
        const schema = versionSchemas[ver];
        if (!schema) continue;
        const nsName = sanitizeVersionName(ver);
        lines.push('');
        lines.push(`  namespace ${nsName} {`);
        lines.push(generateNamespaceBody(schema, '    '));
        lines.push(`  }`);
    }

    lines.push('}');
    lines.push('');
    lines.push(`export = ${nodeName};`);
    lines.push('');

    return lines.join('\n');
}

async function main() {
    const n8nTag = process.argv[2];
    if (!n8nTag) {
        console.error('Usage: node extract-schemas.cjs <n8n-tag>');
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

    // Module paths
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

    // Extract
    console.log('\n=== Extracting schemas ===');
    const scanDirs = [
        path.join(CACHE_DIR, 'packages/nodes-base/dist/nodes'),
        path.join(CACHE_DIR, 'packages/@n8n/nodes-langchain/dist'),
    ];

    const allNodes = {};
    let successCount = 0;
    let errorCount = 0;

    for (const dir of scanDirs) {
        if (!fs.existsSync(dir)) continue;
        const files = findNodeFiles(dir);
        console.log(`Found ${files.length} node files in ${path.basename(path.dirname(dir))}`);

        for (const file of files) {
            try {
                const mod = await loadModule(file);
                const schemas = extractAllVersionSchemas(mod);
                if (schemas) {
                    const nodeName = Object.values(schemas)[0]?.name;
                    if (nodeName && !allNodes[nodeName]) {
                        allNodes[nodeName] = schemas;
                        successCount++;
                    }
                } else {
                    errorCount++;
                }
            } catch {
                errorCount++;
            }
        }
    }

    console.log(`\nExtracted: ${successCount} nodes, Skipped: ${errorCount}`);

    // Generate .d.ts
    console.log('\n=== Generating .d.ts files ===');
    const dtsDir = path.join(OUTPUT_DIR, version);
    fs.mkdirSync(dtsDir, { recursive: true });

    for (const [nodeName, schemas] of Object.entries(allNodes)) {
        const dts = generateDts(nodeName, schemas);
        fs.writeFileSync(path.join(dtsDir, `${nodeName}.d.ts`), dts);
    }

    console.log(`Generated ${Object.keys(allNodes).length} .d.ts files in ${dtsDir}`);

    // Zip for release
    const zipName = `schemas-${version}.zip`;
    run(`cd dist/schemas && zip -r ../../dist/${zipName} ${version}/`);
    console.log(`\nPackaged as dist/${zipName}`);

    // Cleanup
    console.log('\n=== Cleaning up ===');
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
