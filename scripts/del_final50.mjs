import fs from "fs";
import path from "path";

const keepListPath = "scripts/curated_hdr_final50.txt";
const keepSet = new Set(fs.readFileSync(keepListPath, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean));
let deleted = 0, failed = 0, remaining = 0;
const failedPaths = [];
const roots = ["public/assets/hdri/dosch", "public/assets/hdri/hdrimaps"];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const dp of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    // recursive returns relative paths as strings not Dirent? With withFileTypes:true recursive returns strings? Actually Node returns string[] with recursive true (ignores withFileTypes). Use manual.
  }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else if (entry.name.toLowerCase().endsWith(".hdr")) {
      if (keepSet.has(abs)) remaining++;
      else {
        try { fs.unlinkSync(abs); deleted++; }
        catch (e) { failed++; failedPaths.push(abs + ": " + (e.message || e)); }
      }
    }
  }
}
for (const root of roots) walk(root);
console.log(JSON.stringify({ keepSetSize: keepSet.size, deleted, failed, remaining, failedPaths: failedPaths.slice(0, 5) }, null, 2));
