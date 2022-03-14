/*
 * Example: parsing object properties from a local set of *.json.gz files.
 * Usage:
 *     node local-svf-props.js <folder with objects_*.json.gz files>
 */

const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { PropDbReader } = require("../lib/common/propdb-reader.js");
const { SvfReader, GltfWriter } = require("../lib");

const FIELDS = {
  I_NAME: 0,
  I_CATEGORY: 1,
  I_TYPE: 2,
  I_UNIT: 3,
  I_DESCRIPTION: 4,
  I_DISPLAYNAME: 5,
  I_FLAGS: 6,
  I_DISPLAYPRECISION: 7,
  I_FORGEPARAMETER: 8,
};

const TYPES = {
  BOOLEAN: 1,
  INTEGER: 2,
  NUMERIC: 3,
  OBJECT_REFERENCE: 4,
  ID_REFERENCE: 11,
  STRING: 20,
  STRING_2: 21,
};

function typeToString(type) {
  switch (type) {
    case TYPES.BOOLEAN:
      return "BOOLEAN";
    case TYPES.INTEGER:
      return "INTEGER";
    case TYPES.NUMERIC:
      return "NUMERIC";
    case TYPES.OBJECT_REFERENCE:
      return "OBJECT_REFERENCE";
    case TYPES.ID_REFERENCE:
      return "ID_REFERENCE";
    case TYPES.STRING:
      return "STRING";
    case TYPES.STRING_2:
      return "STRING2";
    default:
      return "UNKNOWN+" + type;
  }
}

function escapeString(str) {
  if (typeof str === "string" && str.indexOf('"') !== -1) {
    return str.replace(/\"/g, '""');
  }
  return str;
}

async function run(dir, svfPath, outputPath, excludedDbids) {
  const ids = fs.readFileSync(path.join(dir, "objects_ids.json.gz"));
  const offs = fs.readFileSync(path.join(dir, "objects_offs.json.gz"));
  const avs = fs.readFileSync(path.join(dir, "objects_avs.json.gz"));
  const attrs = fs.readFileSync(path.join(dir, "objects_attrs.json.gz"));
  const vals = fs.readFileSync(path.join(dir, "objects_vals.json.gz"));
  const excludedDbidArray = (excludedDbids ? excludedDbids : '').split(',');
  
  const db = new PropDbReader(ids, offs, avs, attrs, vals);

  const reader = await SvfReader.FromFileSystem(svfPath);

  const idsToExport = [];

  for await (const fragment of reader.enumerateFragments()) {
    idsToExport.push(fragment.dbID);
  }

  const exportedBIM = {};
  const rootNodes = [];

  while (idsToExport.length > 0) {
    const dbid = idsToExport.shift();

    if (!exportedBIM[dbid]) {
      const doc = {
        properties: {},
        // references: {},
        categories: {},
        children: [],
        parents: [],
        instanceof: [],
      };

      for (const prop of db.enumerateProperties(dbid)) {
        if (prop.category === "__name__") {
          doc.name = prop.value;
        } else if (prop.category === "__child__") {
          if (exportedBIM[prop.value]) {
            doc.children.push(`${prop.value}`);
          }
        } else if (prop.category === "__parent__") {
          doc.parents.push(`${prop.value}`);
          idsToExport.push(prop.value);
          if (prop.value === 1) {
            rootNodes.push(dbid);
          }
        } else if (prop.category === "__category__") {
          if (doc.categories[prop.name]) {
            console.error(
              "category " + prop.name + " already exists on id " + dbid
            );
          }
          doc.categories[prop.name] = prop.value;
        } else if (prop.category === "__instanceof__") {
          // doc.instanceof.push(`${prop.value}`);
          // idsToExport.push(prop.value);
        } else if (prop.category === "__internalref__") {
          // if (!doc.references[prop.name]) {
          //   doc.references[prop.name] = [];
          // }
          // doc.references[prop.name].push(`${prop.value}`);
          // idsToExport.push(prop.value);
        } else if (!prop.category.startsWith("__")) {
          let p = doc.properties;

          if (!p[prop.category]) {
            p[prop.category] = {};
          }

          if (
            p[prop.category][prop.name] &&
            p[prop.category][prop.name].value !== prop.value
          ) {
            console.error(
              "prop " +
                prop.category +
                ":" +
                prop.name +
                " already exists on id " +
                dbid
            );
          }
          p[prop.category][prop.name] = Object.assign(
            {
              value: prop.value,
            },
            prop.unit ? { unit: prop.unit } : {}
          );
        }
      }

      exportedBIM[dbid] = doc;
    }
  }
  exportedBIM.rootNodes = rootNodes;

  const output = fs.createWriteStream(path.join(outputPath, 'bim.json'));
  output.write(JSON.stringify(exportedBIM, null, 2) + "\n");


  // Create hierarchy related JSONs
  const exportedBIMHierarchy = {};
  const excludedDbidJson = new Set();
  function genKey(nodeKey) {
    return `[DBID: ${nodeKey}] ${exportedBIM[nodeKey].name}`;
  }
  
  function processNode(nodeKey, shouldExclude) {
    const node = exportedBIM[nodeKey];

    if (shouldExclude || excludedDbidArray.includes(nodeKey)) {
      excludedDbidJson.add(nodeKey);
      if (node.children) {
        node.children.forEach(childNodeKey => processNode(childNodeKey, true));
      }
      return undefined; // should exclude
    } else {
      if (node.children) {
        const newChildren = {};
        node.children.forEach(childNodeKey => {
          const nodeName = processNode(childNodeKey, false);
          if (nodeName) {
            newChildren[nodeName] = exportedBIM[childNodeKey];
          }
        });
        node.children = newChildren;
      }

      return genKey(nodeKey); // should not be excluded
    }
  }
  
  function createBimHierarchy() {
    exportedBIM.rootNodes
      .map(rootNodeKey => '' + rootNodeKey) // root node key is number, the rest of keys are string
      .forEach(nodeKey => {
        const nodeName = processNode(nodeKey, false);
        if (nodeName) {
          exportedBIMHierarchy[nodeName] = exportedBIM[nodeKey];
        }
      });
  }
  
  createBimHierarchy();
  const outputHierarchy = fs.createWriteStream(path.join(outputPath, 'bim_hierarchy.json'));
  outputHierarchy.write(JSON.stringify(exportedBIMHierarchy, null, 2) + "\n");

  const outputHierarchyExcludedDbidJson = fs.createWriteStream(path.join(outputPath, 'bim_hierarchy_excluded.json'));
  outputHierarchyExcludedDbidJson.write(JSON.stringify([...excludedDbidJson], null, 2) + "\n");
}

if (process.argv.length >= 4) {
  run(process.argv[2], process.argv[3], process.argv[4], process.argv[5])
    .then(() => {})
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.log("Usage:");
  console.log(
    "  node local-svf-to-bim.js <folder with objects_*.json.gz files> <path to svf> <output path> <excluded dbids>"
  );
}
