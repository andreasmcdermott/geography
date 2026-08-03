import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import { countries, Country } from "./countries";

type RegionFilter = "All" | "Africa" | "Americas" | "Asia" | "Europe" | "Oceania";

type MapProperties = {
  code: string;
  label: [number, number];
};

type MapFeature = Feature<MultiPolygon, MapProperties>;

type MapQuestionCardProps = {
  country: Country;
  index: number;
  total: number;
  selectedCode: string | null;
  region: RegionFilter;
  onAnswer: (code: string) => void;
  onNext: () => void;
};

const countryByCode = new Map(countries.map((country) => [country.code, country]));
const markerCodes = new Set([
  "AD", "AG", "BH", "BB", "CV", "KM", "DM", "GD", "KI", "LI", "LU", "MV", "MT", "MH", "FM",
  "MC", "NR", "PW", "KN", "LC", "VC", "SM", "ST", "SC", "SG", "TO", "TV", "VA",
]);

export default function MapQuestionCard(props: MapQuestionCardProps) {
  const [featureCollection, setFeatureCollection] = useState<FeatureCollection<MultiPolygon, MapProperties> | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/data/world-map.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Map could not be loaded");
        return response.json() as Promise<FeatureCollection<MultiPolygon, MapProperties>>;
      })
      .then(setFeatureCollection)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  if (!featureCollection) {
    return (
      <section className="question-wrap map-question-wrap map-loading" role="status">
        <div className="question-progress"><span style={{ width: "0%" }} /></div>
        <div className="map-loading-card">
          <span aria-hidden="true">◎</span>
          <strong>{loadError ? "The map could not be loaded." : "Charting the map…"}</strong>
          <p>{loadError ? "Exit the quiz and try again." : "Preparing 197 country boundaries."}</p>
        </div>
      </section>
    );
  }

  return <LoadedMapQuestionCard {...props} featureCollection={featureCollection} />;
}

function LoadedMapQuestionCard({ country, index, total, selectedCode, region, onAnswer, onNext, featureCollection }: MapQuestionCardProps & { featureCollection: FeatureCollection<MultiPolygon, MapProperties> }) {
  const answered = selectedCode !== null;
  const isCorrect = selectedCode === country.code;

  const mapFeatures = useMemo(() => {
    if (region === "All") return featureCollection.features as MapFeature[];
    const regionCodes = new Set(countries.filter((item) => item.region === region).map((item) => item.code));
    return featureCollection.features.filter((feature) => regionCodes.has(feature.properties.code)) as MapFeature[];
  }, [featureCollection, region]);

  const { path, projection, sphere } = useMemo(() => {
    const projection = region === "All" ? geoNaturalEarth1() : geoMercator();
    if (region === "Oceania") projection.rotate([-160, 0]);
    projection.fitExtent([[24, 24], [976, 536]], { type: "FeatureCollection", features: mapFeatures });
    const generator = geoPath(projection);
    return { path: generator, projection, sphere: generator({ type: "Sphere" }) ?? "" };
  }, [mapFeatures, region]);

  function activate(code: string) {
    if (!answered) onAnswer(code);
  }

  return (
    <section className="question-wrap map-question-wrap">
      <div className="question-progress"><span style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} /></div>
      <div className="question-kicker"><span>Map study</span><i /><span>{region === "All" ? "World" : region}</span></div>
      <h1>Find <em>{country.name}</em> on the map.</h1>
      <p className="question-hint">Select the country’s location. Tiny countries are shown with a circular target.</p>

      <div className="map-frame">
        <svg className="quiz-map" viewBox="0 0 1000 560" role="group" aria-label={`Clickable ${region === "All" ? "world" : region} map`}>
          <path className="map-ocean" d={sphere} />
          {mapFeatures.map((feature) => {
            const code = feature.properties.code;
            const mapCountry = countryByCode.get(code);
            if (!mapCountry) return null;
            const correct = answered && code === country.code;
            const wrong = answered && code === selectedCode && !correct;
            const markerPoint = projection(feature.properties.label) ?? path.centroid(feature);
            const useMarker = markerCodes.has(code);
            return (
              <g
                key={code}
                className={`map-country ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                role="button"
                tabIndex={answered ? -1 : 0}
                aria-label={mapCountry.name}
                aria-disabled={answered}
                onClick={() => activate(code)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate(code);
                  }
                }}
              >
                <path d={path(feature) ?? ""} vectorEffect="non-scaling-stroke" />
                {useMarker && Number.isFinite(markerPoint[0]) && Number.isFinite(markerPoint[1]) && (
                  <circle className="map-target" cx={markerPoint[0]} cy={markerPoint[1]} r="6" vectorEffect="non-scaling-stroke" />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {answered && (
        <div className={`feedback ${isCorrect ? "success" : "error"}`} role="status">
          <div>
            <strong>{isCorrect ? "That’s the spot." : "Not quite."}</strong>
            <span>{country.name} is highlighted in green.</span>
          </div>
          <button onClick={onNext}>{index === total - 1 ? "See results" : "Next country"} <span>→</span></button>
        </div>
      )}
    </section>
  );
}
