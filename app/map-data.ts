import type { Feature, FeatureCollection, MultiPolygon } from "geojson";

export type MapRegion = "All" | "Africa" | "Americas" | "Asia" | "Europe" | "Oceania";
export type MapProperties = { code: string; label: [number, number] };
export type MapFeature = Feature<MultiPolygon, MapProperties>;
export type WorldMap = FeatureCollection<MultiPolygon, MapProperties>;

// Screen-sized targets keep small countries selectable at every zoom level.
export const markerCodes = new Set([
  "AD", "AG", "BH", "BB", "CV", "KM", "DM", "FJ", "GD", "KI", "LI", "LU", "MV", "MT", "MH", "FM",
  "MC", "NR", "PW", "KN", "LC", "VC", "SM", "ST", "SC", "SG", "TO", "TV", "VA",
]);

// Explicit geographic centers avoid fitting Oceania across the date line.
export const regionViews: Record<MapRegion, { center: [number, number]; zoom: number }> = {
  All: { center: [15, 18], zoom: 1.8 },
  Africa: { center: [20, 2], zoom: 2.5 },
  Americas: { center: [-85, 5], zoom: 1.8 },
  Asia: { center: [95, 30], zoom: 2.2 },
  Europe: { center: [18, 53], zoom: 3 },
  Oceania: { center: [175, -20], zoom: 2.6 },
};
