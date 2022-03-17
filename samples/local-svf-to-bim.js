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
const writeFileAsync = require('./utils').writeFileAsync;

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

async function run(dir, svfPath, outputPath) {
  const ids = fs.readFileSync(path.join(dir, "objects_ids.json.gz"));
  const offs = fs.readFileSync(path.join(dir, "objects_offs.json.gz"));
  const avs = fs.readFileSync(path.join(dir, "objects_avs.json.gz"));
  const attrs = fs.readFileSync(path.join(dir, "objects_attrs.json.gz"));
  const vals = fs.readFileSync(path.join(dir, "objects_vals.json.gz"));
  
  const db = new PropDbReader(ids, offs, avs, attrs, vals);

  const reader = await SvfReader.FromFileSystem(svfPath);

  const idsToExport = [];

  for await (const fragment of reader.enumerateFragments()) {
    idsToExport.push(fragment.dbID);
  }

  const exportedBIM = {};
  const rootNodes = [];

  // Need 3 mechanism to find rootNodes
  // 1. Find nodes with category "__parent__" and value is 1
  // 2. Find nodes with no parents or parents array is empty
  // 3. Search orphan nodes which can't be accessed from rootNodes from #1 and #2
  // 4. Add the parents or orphan nodes and exclude the previous rootNodes if their parent is the new parent node

  const allDbids = new Set();
  while (idsToExport.length > 0) {
    const dbid = idsToExport.shift();
    allDbids.add('' + dbid);

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
            rootNodes.push('' + dbid);
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

      // for the nodes with no parents, add it as root node
      if (!doc.parents || doc.parents.length === 0) {
        rootNodes.push('' + dbid);
      }

      exportedBIM[dbid] = doc;
    }
  }
  exportedBIM.rootNodes = rootNodes;

  console.log('* rootNodes', rootNodes);
  // 1. Find orphan nodes from rootNodes
  let dbidQueue = [...rootNodes];
  while (dbidQueue.length > 0) {
    const dbid = dbidQueue.splice(0, 1)[0]; // get the first dbid
    allDbids.delete(dbid);
    const children = exportedBIM[dbid].children ? exportedBIM[dbid].children : [];
    children.forEach(childDbid => dbidQueue.push(childDbid));
  }

  console.log('* remaining allDbids', allDbids.size);

  // 2. Find parents of all these orphan nodes and also fix the parent -> child linking
  const newRootNodeSet = new Set();
  function findParents(dbid) {
    const parents = exportedBIM[dbid].parents;
    if (!parents || parents.length === 0) {
      newRootNodeSet.add(dbid);
    } else {
      parents.forEach(parentDbid => {
        // Fix parent -> child linking
        exportedBIM[parentDbid].children = !!exportedBIM[parentDbid].children ? exportedBIM[parentDbid].children : [];
        if (!exportedBIM[parentDbid].children.includes(dbid)) {
          exportedBIM[parentDbid].children.push(dbid);
        }
        findParents(parentDbid);
      });
    }
  }
  allDbids.forEach(findParents);

  // 3. Add parents to rootNodes
  console.log('* rootNodes before adding extra parent', rootNodes);
  [...newRootNodeSet].forEach(dbid => {
    if (!rootNodes.includes(dbid)) {
      rootNodes.push(dbid);
    }
  });

  // 4. Add the parents or orphan nodes and exclude the previous rootNodes if their parent is the new parent node
  [...rootNodes].forEach(dbid => {
    const children = exportedBIM[dbid].children;
    console.log('* children of dbid', typeof dbid, dbid, exportedBIM[dbid].children);
    if (children) {
      children.forEach(childDbid => {
        const index = rootNodes.indexOf(childDbid);
        if (index >= 0) {
          console.log(`* remove ${childDbid} from rootNodes`);
          rootNodes.splice(index, 1);
        }
      })
    }
  });

  writeFileAsync(path.join(outputPath, 'bim.json'), exportedBIM).then(() => console.log('done...'));
}

if (process.argv.length >= 5) {
  run(process.argv[2], process.argv[3], process.argv[4])
    .then(() => {})
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.log("Usage:");
  console.log(
    "  node local-svf-to-bim.js <folder with objects_*.json.gz files> <path to svf> <output path>"
  );
}
