/*
 * Example: converting an SVF (without property database) from local file system.
 * Usage:
 *     node local-svf-to-gltf.js <path to svf file> <path to output folder>
 */

const path = require('path');
const { SvfReader, GltfWriter } = require('../lib');

async function run (filepath, outputDirBase, startDbId, endDbId) {
    const defaultOptions = {
        deduplicate: false,
        skipUnusedUvs: false,
        center: true,
        log: console.log,
        // filter: (dbid) => (dbid >= 200001 && dbid <= 300000) // only output objects with dbIDs between X and Y
        filter: (dbid) => (dbid >= startDbId && dbid <= endDbId) // only output objects with dbIDs between X and Y
    };

    console.log(`startDbId: ${startDbId} endDbId: ${endDbId}`);

    try {
        const startTime = Date.now();

        const outputDir = `${outputDirBase}-${startDbId}-${endDbId}`;
        console.log(`outputDir: ${outputDir}`);

        const reader = await SvfReader.FromFileSystem(filepath);
        const scene = await reader.read();
        let writer;
        writer = new GltfWriter(Object.assign({}, defaultOptions));
        await writer.write(scene, path.join(outputDir, 'gltf-raw'));
        writer = new GltfWriter(Object.assign({}, defaultOptions, { deduplicate: true, skipUnusedUvs: true }));
        await writer.write(scene, path.join(outputDir, 'gltf-dedup'));

        const endTime = Date.now();
        console.log('Time: ', endTime - startTime);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}

if (process.argv.length !== 6) {
    console.log('how to use: node local-svf-to-gltf-params.js [filepath] [outputDirBase] [startDbId] [endDbId]');
    return;
}

run(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
