import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import { countries, Country } from "./countries";

type RegionFilter = "All" | "Africa" | "Americas" | "Asia" | "Europe" | "Oceania";

type MapProperties = {
  code: string;
  label: [number, number];
};

type MapFeature = Feature<MultiPolygon, MapProperties>;
type MapViewport = { x: number; y: number; scale: number };

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
  const [viewport, setViewport] = useState<MapViewport>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const mapFeatures = featureCollection.features as MapFeature[];
  const activeCodes = useMemo(() => new Set(
    countries.filter((item) => region === "All" || item.region === region).map((item) => item.code),
  ), [region]);
  const activeFeatures = useMemo(
    () => mapFeatures.filter((feature) => activeCodes.has(feature.properties.code)),
    [activeCodes, mapFeatures],
  );

  const { path, projection, sphere } = useMemo(() => {
    const projection = geoNaturalEarth1();
    projection.fitExtent([[24, 24], [976, 536]], { type: "FeatureCollection", features: mapFeatures });
    const generator = geoPath(projection);
    return { path: generator, projection, sphere: generator({ type: "Sphere" }) ?? "" };
  }, [mapFeatures]);

  function constrain({ x, y, scale }: MapViewport): MapViewport {
    const boundedScale = Math.min(8, Math.max(1, scale));
    return {
      scale: boundedScale,
      x: Math.min(0, Math.max(1000 - 1000 * boundedScale, x)),
      y: Math.min(0, Math.max(560 - 560 * boundedScale, y)),
    };
  }

  function zoomBy(factor: number, center = { x: 500, y: 280 }) {
    setViewport((current) => {
      const scale = Math.min(8, Math.max(1, current.scale * factor));
      const x = center.x - ((center.x - current.x) / current.scale) * scale;
      const y = center.y - ((center.y - current.y) / current.scale) * scale;
      return constrain({ x, y, scale });
    });
  }

  function resetView() {
    setViewport({ x: 0, y: 0, scale: 1 });
  }

  function focusRegion() {
    if (region === "All") {
      resetView();
      return;
    }
    const [[x0, y0], [x1, y1]] = path.bounds({ type: "FeatureCollection", features: activeFeatures });
    const scale = Math.min(8, (1000 - 120) / Math.max(1, x1 - x0), (560 - 100) / Math.max(1, y1 - y0));
    setViewport(constrain({
      scale,
      x: 500 - scale * ((x0 + x1) / 2),
      y: 280 - scale * ((y0 + y1) / 2),
    }));
  }

  function activate(code: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!answered && activeCodes.has(code)) onAnswer(code);
  }

  return (
    <section className="question-wrap map-question-wrap">
      <div className="question-progress"><span style={{ width: `${((index + (answered ? 1 : 0)) / total) * 100}%` }} /></div>
      <div className="question-kicker"><span>Map study</span><i /><span>{region === "All" ? "World" : region}</span></div>
      <h1>Find <em>{country.name}</em> on the map.</h1>
      <p className="question-hint">Select the country’s location. Scroll or use the controls to zoom, then drag to pan.</p>

      <div className="map-frame">
        <div className="map-controls" role="group" aria-label="Map controls">
          <button onClick={focusRegion}>{region === "All" ? "World view" : `Focus ${region}`}</button>
          <button onClick={() => zoomBy(1 / 1.4)} disabled={viewport.scale === 1} aria-label="Zoom out">−</button>
          <button onClick={resetView} disabled={viewport.scale === 1} aria-label="Reset map view">Reset</button>
          <button onClick={() => zoomBy(1.4)} disabled={viewport.scale === 8} aria-label="Zoom in">+</button>
        </div>
        <svg
          className={`quiz-map ${dragging ? "dragging" : ""}`}
          viewBox="0 0 1000 560"
          role="group"
          aria-label={`Clickable world map; ${region === "All" ? "all countries" : `${region} countries`} are active`}
          onWheel={(event) => {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const center = {
              x: ((event.clientX - bounds.left) / bounds.width) * 1000,
              y: ((event.clientY - bounds.top) / bounds.height) * 560,
            };
            zoomBy(event.deltaY < 0 ? 1.22 : 1 / 1.22, center);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y, moved: false };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const dx = ((event.clientX - drag.x) / bounds.width) * 1000;
            const dy = ((event.clientY - drag.y) / bounds.height) * 560;
            if (Math.abs(dx) + Math.abs(dy) > 4 && !drag.moved) {
              drag.moved = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            setViewport(constrain({ x: drag.originX + dx, y: drag.originY + dy, scale: viewport.scale }));
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (drag?.pointerId === event.pointerId && drag.moved) {
              suppressClickRef.current = true;
              window.setTimeout(() => { suppressClickRef.current = false; }, 0);
            }
            dragRef.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragging(false);
          }}
        >
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            <path className="map-ocean" d={sphere} />
            {mapFeatures.map((feature) => {
            const code = feature.properties.code;
            const mapCountry = countryByCode.get(code);
            if (!mapCountry) return null;
            const active = activeCodes.has(code);
            const correct = answered && code === country.code;
            const wrong = answered && code === selectedCode && !correct;
            const markerPoint = projection(feature.properties.label) ?? path.centroid(feature);
            const useMarker = markerCodes.has(code);
            return (
              <g
                key={code}
                className={`map-country ${active ? "active" : "inactive"} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                role="button"
                tabIndex={answered || !active ? -1 : 0}
                aria-label={mapCountry.name}
                aria-disabled={answered || !active}
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
                  <circle className="map-target" cx={markerPoint[0]} cy={markerPoint[1]} r={6 / viewport.scale} vectorEffect="non-scaling-stroke" />
                )}
              </g>
            );
            })}
          </g>
        </svg>
        <div className="map-legend" aria-hidden="true"><span className="active-swatch" />{region === "All" ? "Quiz countries" : region}<span className="inactive-swatch" />Outside quiz</div>
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
