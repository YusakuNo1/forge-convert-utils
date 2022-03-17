const fse = require('fs-extra');
const JsonStreamStringify = require('json-stream-stringify');

module.exports = {
  writeFileSync: function (gltfPath, json) {
    const outputStream = fse.createWriteStream(gltfPath);
    const jsonStream = new JsonStreamStringify(json);
    jsonStream.once('error', (err) => console.error('Error', err));
    jsonStream.pipe(outputStream);
  },
  writeFileAsync: function (gltfPath, json) {
    return new Promise((resolve, reject) => {
      const outputStream = fse.createWriteStream(gltfPath);
      const jsonStream = new JsonStreamStringify(json);
      jsonStream.once('error', (err) => {
        console.error('Error', err);
        reject(err);
      });
      outputStream.on('finish', () => {
        resolve();
      });
      jsonStream.pipe(outputStream);
    });
  },
}

