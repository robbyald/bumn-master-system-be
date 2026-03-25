import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const inputPath = "/Users/robi/Documents/Robi/explore/bumn-master/data/number-sequence.pdf";
const outputPath = "/Users/robi/Documents/Robi/explore/bumn-master/data/number-sequence.txt";

const dataBuffer = fs.readFileSync(inputPath);
const data = await pdf(dataBuffer);

fs.writeFileSync(outputPath, data.text || "", "utf-8");
console.log(`[pdf] extracted ${data.numpages} pages to ${outputPath}`);
