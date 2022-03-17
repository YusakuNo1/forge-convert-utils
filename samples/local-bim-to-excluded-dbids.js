'use strict';

const path = require("path");
const fs = require('fs');
const fse = require('fs-extra');
const es = require('event-stream');
const bigJson = require('big-json');
 
const JSONStream = require('JSONStream');
const JsonStreamStringify = require('json-stream-stringify');
const writeFileAsync = require('./utils').writeFileAsync;

async function run(inputFilePath, outputPath, excludedDbids) {
  const exportedBIMHierarchy = {};
  const excludedDbidJson = new Set();
  const excludedDbidArray = (excludedDbids ? excludedDbids : '').split(',');

  function genKey(exportedBIM, nodeKey) {
    return `[DBID: ${nodeKey}] ${exportedBIM[nodeKey].name}`;
  }
  
  function processNode(exportedBIM, nodeKey, shouldExclude) {
    const node = exportedBIM[nodeKey];

    (Object.keys(node)).forEach(key => {
      if (key !== 'children' && key !== 'childrenNodes' && key !== 'name') {
        // console.log('* * key is', key);
        delete node[key]; // TODO: remove it later!
      }
    });

    if (shouldExclude || excludedDbidArray.includes(nodeKey)) {
      excludedDbidJson.add(nodeKey);
      if (node.children) {
        node.children.forEach(childNodeKey => processNode(exportedBIM, childNodeKey, true));
        delete node.children;
      }
      return undefined; // should exclude
    } else {
      if (node.children) {
        const childrenNodes = {};
        // console.log('node.children', nodeKey, node.children);
        node.children.forEach(childNodeKey => {
          const nodeName = processNode(exportedBIM, childNodeKey, false);
          if (nodeName) {
            childrenNodes[nodeName] = exportedBIM[childNodeKey];
          }
        });

        if (Object.keys(childrenNodes).length > 0) {
          node.childrenNodes = childrenNodes;
        }

        delete node.children;
      }

      return genKey(exportedBIM, nodeKey); // should not be excluded
    }
  }
  
  function createBimHierarchy(exportedBIM) {
    exportedBIM.rootNodes
      .map(rootNodeKey => '' + rootNodeKey) // root node key is number, the rest of keys are string
      .forEach(nodeKey => {
        const nodeName = processNode(exportedBIM, nodeKey, false);
        if (nodeName) {
          exportedBIMHierarchy[nodeName] = exportedBIM[nodeKey];
        }
      });
  }
  
  async function readFile() {
    return new Promise((resolve) => {
      const readStream = fs.createReadStream(inputFilePath);
      const parseStream = bigJson.createParseStream();
      parseStream.on('data', resolve);
      readStream.pipe(parseStream);
    });
  }

  let json = await readFile();

  // Process
  createBimHierarchy(json);

  writeFileAsync(path.join(outputPath, 'bim_hierarchy.json'), exportedBIMHierarchy).then(() => {
    writeFileAsync(path.join(outputPath, 'bim_hierarchy_excluded.json'), [...excludedDbidJson]);
    console.log('done...');
  });
}

if (process.argv.length === 4 || process.argv.length === 5) {
  run(process.argv[2], process.argv[3], process.argv[4])
    .then(() => {})
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.log("Usage:");
  console.log(
    "  node local-bim-to-excluded-dbids.js <input file path> <output path> <excluded dbids separated by comma>"
  );
}
