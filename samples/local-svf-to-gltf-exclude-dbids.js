/*
 * Example: converting an SVF (without property database) from local file system.
 * Usage:
 *     node local-svf-to-gltf.js <path to svf file> <path to output folder>
 */

const fs = require('fs');
const path = require('path');
const { SvfReader, GltfWriter } = require('../lib');

async function run (filepath, outputDir, excludedDbidsJsonFilePath) {
    let excludedDbidArray = [];
    if (excludedDbidsJsonFilePath) {
        let rawdata = fs.readFileSync(excludedDbidsJsonFilePath);
        excludedDbidArray = JSON.parse(rawdata).map(dbid => parseInt(dbid));
    }

    const defaultOptions = {
        deduplicate: false,
        skipUnusedUvs: false,
        center: true,
        log: console.log,
        filter: (dbid) => {
            console.log('dbid: ', dbid, typeof dbid, excludedDbidArray.includes(dbid));
            return !excludedDbidArray.includes(dbid);
        },
    };

    try {
        const reader = await SvfReader.FromFileSystem(filepath);
        const scene = await reader.read();
        let writer;
        // writer = new GltfWriter(Object.assign({}, defaultOptions));
        // await writer.write(scene, path.join(outputDir, 'gltf-raw'));
        writer = new GltfWriter(Object.assign({}, defaultOptions, { deduplicate: true, skipUnusedUvs: true }));
        await writer.write(scene, path.join(outputDir, 'gltf-dedup'));
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}


console.log("Usage:");
console.log("  node local-svf-to-gltf-exclude-dbids.js <path to svf> <output path> <path to excluded dbids JSON>");
run(process.argv[2], process.argv[3], process.argv[4]);
