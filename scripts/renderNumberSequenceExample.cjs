const fs = require("fs");
const path = require("path");

const inputPath = path.resolve(__dirname, "../data/examples/number-sequence-labeled-multiline.json");
const outputQuestionPath = path.resolve(
  __dirname,
  "../data/examples/number-sequence-multiline-question.svg"
);
const outputExplanationPath = path.resolve(
  __dirname,
  "../data/examples/number-sequence-multiline-explanation.svg"
);

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const {
  sequence,
  delimiters,
  wrongIndex,
  correctValue,
  operators,
  labels = [],
  explanationLines = [],
  explanationRows = []
} = data;

const paddingX = 40;
const paddingY = 40;
const labelY = 70;
const gapX = 80;
const numberY = 100;
const opY = 160;
const arcY = 125;
const arcHeight = 22;
const barHeight = 60;
const fontFamily = "Inter, Arial, sans-serif";

const width = paddingX * 2 + (sequence.length - 1) * gapX + 40;
const heightQuestion = 180;
const heightExplanation = 380;

const xAt = (i) => paddingX + i * gapX;

const buildSvg = ({ withArrows, height, highlightWrong }) => {
  const svg = [];
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  svg.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  if (withArrows) {
    svg.push(`
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#111827"/>
        </marker>
      </defs>
    `);
  }

  const renderLine = (line, offsetY, highlight) => {
    line.sequence.forEach((num, i) => {
      const x = xAt(i);
      const color = highlight && highlight.index === i ? highlight.color : "#111827";
      svg.push(
        `<text x="${x}" y="${offsetY}" text-anchor="middle" font-size="20" font-family="${fontFamily}" fill="${color}">${num}</text>`
      );
    });

    if (withArrows && Array.isArray(line.operators)) {
      line.operators.forEach((op, i) => {
        const x1 = xAt(i);
        const x2 = xAt(i + 1);
        const mid = (x1 + x2) / 2;
        const d = `M ${x1} ${offsetY + 25} Q ${mid} ${offsetY + 25 + arcHeight} ${x2} ${offsetY + 25}`;
        svg.push(`<path d="${d}" fill="none" stroke="#111827" stroke-width="1.5" marker-end="url(#arrow)"/>`);
        svg.push(
          `<text x="${mid}" y="${offsetY + 60}" text-anchor="middle" font-size="14" font-family="${fontFamily}" fill="#374151">${op}</text>`
        );
      });
    }

    delimiters.forEach((idx) => {
      const x = xAt(idx) + gapX / 2;
      svg.push(`<line x1="${x}" y1="${offsetY - barHeight / 2}" x2="${x}" y2="${offsetY + barHeight / 2}" stroke="#111827" stroke-width="2"/>`);
    });
  };

  // Base line for question
  renderLine(
    { sequence, operators: Array.isArray(operators) ? operators : [] },
    numberY,
    highlightWrong ? { index: wrongIndex, color: "#dc2626" } : null
  );

  labels.forEach((l) => {
    const x = xAt(l.index);
    svg.push(
      `<text x="${x}" y="${labelY}" text-anchor="middle" font-size="16" font-family="${fontFamily}" fill="#111827">${l.label}</text>`
    );
  });

  if (withArrows) {
    let yCursor = opY + 40;
    explanationLines.forEach((line) => {
      const text = `${line.label}: ${line.text}`;
      svg.push(
        `<text x="${paddingX}" y="${yCursor}" font-size="14" font-family="${fontFamily}" fill="#111827">${text}</text>`
      );
      yCursor += 22;
    });

    explanationRows.forEach((row, idx) => {
      const rowY = yCursor + idx * 90;
      renderLine(row, rowY, row.highlight);
    });

    const foot = `Pilihan ${labels.find((l) => l.index === wrongIndex)?.label ?? "-"} adalah salah, karena seharusnya ${correctValue}.`;
    svg.push(
      `<text x="${paddingX}" y="${height - 20}" font-size="14" font-family="${fontFamily}" fill="#111827">${foot}</text>`
    );
  }

  svg.push("</svg>");
  return svg.join("\n");
};

fs.mkdirSync(path.dirname(outputQuestionPath), { recursive: true });
fs.writeFileSync(
  outputQuestionPath,
  buildSvg({ withArrows: false, height: heightQuestion, highlightWrong: false }),
  "utf8"
);
fs.writeFileSync(
  outputExplanationPath,
  buildSvg({ withArrows: true, height: heightExplanation, highlightWrong: true }),
  "utf8"
);

// eslint-disable-next-line no-console
console.log(`[example] Wrote ${outputQuestionPath}`);
// eslint-disable-next-line no-console
console.log(`[example] Wrote ${outputExplanationPath}`);
