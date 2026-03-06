const fs = require("fs");
const { parse } = require("csv-parse/sync");

function csvToJson(inputPath, outputPath) {
  const csvText = fs.readFileSync(inputPath, "utf8");

  const records = parse(csvText, {
    columns: true,           // first row becomes object keys
    skip_empty_lines: true,
    trim: true
  });

  const cleaned = records.map((row) => {
    const obj = {};

    for (const [key, value] of Object.entries(row)) {
      if (value !== "") {
        obj[key] = value;
      }
    }

    return obj;
  });

  fs.writeFileSync(outputPath, JSON.stringify(cleaned, null, 2), "utf8");
}

const input = process.argv[2];
const output = process.argv[3] || "output.json";

if (!input) {
  console.error("Usage: node convert-csv.js input.csv [output.json]");
  process.exit(1);
}

csvToJson(input, output);
console.log(`Converted ${input} -> ${output}`);
