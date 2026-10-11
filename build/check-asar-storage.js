const fs = require("node:fs");

// Read only the bounded ASAR index; never load the application payload.
function checkAsarStorage(filename) {
  const fd = fs.openSync(filename, "r");
  try {
    const prefix = Buffer.alloc(16);
    if (fs.readSync(fd, prefix, 0, 16, 0) !== 16)
      throw new Error("Truncated ASAR header");
    const size = prefix.readUInt32LE(12);
    if (size < 2 || size > 16 * 1024 * 1024)
      throw new Error("Invalid ASAR index size");
    const index = Buffer.alloc(size);
    if (fs.readSync(fd, index, 0, size, 16) !== size)
      throw new Error("Truncated ASAR index");
    const { files } = JSON.parse(index.toString("utf8"));
    for (const name of ["dist", "release", "artifacts"]) {
      if (files && Object.hasOwn(files, name))
        throw new Error(`Build output embedded in app.asar: ${name}`);
    }
    if (!files?.out?.files?.main?.files?.["index.js"])
      throw new Error("Compiled application entrypoint missing from app.asar");
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { checkAsarStorage };
