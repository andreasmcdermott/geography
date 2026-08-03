import { readFile, writeFile } from "node:fs/promises";

const input = process.argv[2];
const output = process.argv[3] ?? "public/data/world-map.json";

if (!input) {
  throw new Error("Usage: node scripts/build-map-data.mjs <Natural Earth GeoJSON> [output]");
}

const countrySource = await readFile("app/countries.ts", "utf8");
const countryCodes = new Set([...countrySource.matchAll(/code: "([A-Z]{2})"/g)].map((match) => match[1]));
const source = JSON.parse(await readFile(input, "utf8"));
const grouped = new Map();

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function codeFor(properties) {
  for (const key of ["ISO_A2", "ISO_A2_EH", "WB_A2"]) {
    const value = properties[key];
    if (countryCodes.has(value)) return value;
  }
  return null;
}

function distanceToSegmentSquared(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
    dx = point[0] - x;
    dy = point[1] - y;
  }

  return dx * dx + dy * dy;
}

function simplifyLine(points, toleranceSquared) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = toleranceSquared;
    let index = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = distanceToSegmentSquared(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        index = i;
        maxDistance = distance;
      }
    }
    if (index) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function simplifyRing(ring) {
  const rounded = ring.map(([longitude, latitude]) => [round(longitude), round(latitude)]);
  const simplified = simplifyLine(rounded, 0.0025);
  if (simplified.length < 4) return rounded;
  const first = simplified[0];
  const last = simplified[simplified.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) simplified.push(first);
  return simplified;
}

for (const feature of source.features) {
  const code = codeFor(feature.properties);
  if (!code) continue;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const record = grouped.get(code) ?? {
    type: "Feature",
    properties: {
      code,
      label: [round(feature.properties.LABEL_X), round(feature.properties.LABEL_Y)],
    },
    geometry: { type: "MultiPolygon", coordinates: [] },
  };
  record.geometry.coordinates.push(...polygons.map((polygon) => polygon.map(simplifyRing)));
  grouped.set(code, record);
}

const missing = [...countryCodes].filter((code) => !grouped.has(code));
if (missing.length) throw new Error(`Natural Earth is missing: ${missing.join(", ")}`);

const collection = {
  type: "FeatureCollection",
  source: "Natural Earth ne_50m_admin_0_countries, public domain",
  features: [...countryCodes].map((code) => grouped.get(code)),
};

await writeFile(output, `${JSON.stringify(collection)}\n`);
console.log(`Wrote ${collection.features.length} countries to ${output}`);
