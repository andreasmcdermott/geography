import { useEffect, useRef, useState } from "react";
import type { Map as GlobeMap, ExpressionSpecification } from "maplibre-gl";
import { markerCodes, regionViews } from "./map-data";
import type { MapRegion, WorldMap } from "./map-data";
import "maplibre-gl/dist/maplibre-gl.css";

type QuizGlobeProps = {
  data: WorldMap;
  activeCodes: Set<string>;
  region: MapRegion;
  selectedCode: string | null;
  correctCode: string | null;
  onAnswer: (code: string) => void;
  onUnavailable: () => void;
};

const satelliteTiles = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
const state = (key: string): ExpressionSpecification => ["boolean", ["feature-state", key], false];
const color: ExpressionSpecification = ["case", state("correct"), "#83bd71", state("wrong"), "#e88967", state("hover"), "#dcf48b", "#fbfaf6"];

function viewForRegion(region: MapRegion, container: HTMLDivElement | null) {
  const view = regionViews[region];
  const size = container ? Math.max(1, Math.min(container.clientWidth, container.clientHeight)) : 580;
  return { ...view, zoom: Math.max(0, view.zoom + Math.log2(Math.min(1, size / 580))) };
}

export default function QuizGlobe(props: QuizGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GlobeMap | null>(null);
  const latestRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [borders, setBorders] = useState(true);
  const [imageryFailed, setImageryFailed] = useState(false);
  const [zoom, setZoom] = useState(regionViews[props.region].zoom);
  // Event handlers must see the current question without recreating the globe.
  useEffect(() => { latestRef.current = props; });

  useEffect(() => {
    let disposed = false;
    let map: GlobeMap | undefined;
    let observer: ResizeObserver | undefined;
    let hovered: string | null = null;

    void import("maplibre-gl").then((gl) => {
      if (disposed || !containerRef.current) return;
      const current = latestRef.current;
      map = new gl.Map({
        container: containerRef.current,
        ...viewForRegion(current.region, containerRef.current),
        minZoom: 0,
        maxZoom: 8,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        canvasContextAttributes: { antialias: true },
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            satellite: {
              type: "raster", tiles: [satelliteTiles], tileSize: 256, maxzoom: 8,
              attribution: 'Imagery: <a href="https://earthobservatory.nasa.gov/features/BlueMarble" target="_blank" rel="noopener noreferrer">NASA Blue Marble</a>',
            },
            countries: { type: "geojson", data: current.data, promoteId: "code", attribution: "Boundaries: Natural Earth" },
            targets: {
              type: "geojson", promoteId: "code",
              data: {
                type: "FeatureCollection",
                features: current.data.features.filter((feature) => markerCodes.has(feature.properties.code)).map((feature) => ({
                  type: "Feature", properties: { code: feature.properties.code },
                  geometry: { type: "Point", coordinates: feature.properties.label },
                })),
              },
            },
          },
          layers: [
            { id: "ocean", type: "background", paint: { "background-color": "#0e254c" } },
            { id: "satellite", type: "raster", source: "satellite" },
            // Transparent fills still receive clicks when borders are hidden.
            { id: "country-fill", type: "fill", source: "countries", paint: {
              "fill-color": color,
              "fill-opacity": ["case", state("correct"), 0.7, state("wrong"), 0.7, state("hover"), 0.4, state("active"), 0, 0.3],
            } },
            { id: "country-borders", type: "line", source: "countries", paint: {
              "line-color": "#ebf3da", "line-width": 0.8, "line-opacity": 0.65,
            } },
            { id: "answer-borders", type: "line", source: "countries", paint: {
              "line-color": color, "line-width": 2.5,
              "line-opacity": ["case", ["any", state("correct"), state("wrong"), state("hover")], 1, 0],
            } },
            { id: "island-targets", type: "circle", source: "targets", paint: {
              "circle-radius": 6, "circle-color": color,
              "circle-opacity": ["case", ["any", state("active"), state("correct"), state("wrong")], 0.85, 0.25],
              "circle-stroke-color": "#183932", "circle-stroke-width": 1,
            } },
          ],
        },
      });
      mapRef.current = map;
      setZoom(map.getZoom());
      map.touchZoomRotate.disableRotation();
      const globe = map;
      globe.getCanvas().setAttribute("aria-label", "Interactive globe. Drag to rotate; scroll or pinch to zoom. Use the flat map for keyboard country selection.");
      globe.getCanvas().style.cursor = "grab";
      globe.on("load", () => { if (!disposed) setReady(true); });
      // Slow satellite requests must not block country selection or navigation.
      globe.on("sourcedata", (event) => {
        if (!disposed && (event.sourceId === "countries" || event.sourceId === "targets")
          && globe.isSourceLoaded("countries") && globe.isSourceLoaded("targets")) setReady(true);
      });
      globe.on("zoom", () => { if (!disposed) setZoom(globe.getZoom()); });
      globe.on("error", (event) => {
        if (disposed) return;
        const sourceId = "sourceId" in event ? event.sourceId : undefined;
        if (sourceId === "satellite") {
          setImageryFailed(true);
          globe.setLayoutProperty("satellite", "visibility", "none");
          globe.setPaintProperty("country-fill", "fill-opacity", ["case", state("active"), 0.9, 0.4]);
        } else {
          latestRef.current.onUnavailable();
        }
      });
      globe.getCanvas().addEventListener("webglcontextlost", () => {
        if (!disposed) latestRef.current.onUnavailable();
      });
      function codeAt(point: { x: number; y: number }) {
        const hits = globe.queryRenderedFeatures([point.x, point.y], { layers: ["island-targets", "country-fill"] });
        return hits.map((hit) => String(hit.properties.code)).find((code) => latestRef.current.activeCodes.has(code)) ?? null;
      }
      function highlight(code: string | null) {
        if (hovered === code) return;
        for (const source of ["countries", "targets"]) {
          if (hovered) globe.setFeatureState({ source, id: hovered }, { hover: false });
          if (code) globe.setFeatureState({ source, id: code }, { hover: true });
        }
        hovered = code;
        globe.getCanvas().style.cursor = code ? "pointer" : "grab";
      }
      globe.on("mousemove", (event) => {
        highlight(latestRef.current.selectedCode === null && !globe.isMoving() ? codeAt(event.point) : null);
      });
      globe.on("mouseout", () => highlight(null));
      globe.on("movestart", () => highlight(null));
      globe.on("click", (event) => {
        const code = codeAt(event.point);
        if (code && latestRef.current.selectedCode === null) latestRef.current.onAnswer(code);
      });
      observer = new ResizeObserver(() => globe.resize());
      observer.observe(containerRef.current);
    }).catch(() => {
      if (!disposed) latestRef.current.onUnavailable();
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const feature of props.data.features) {
      const code = feature.properties.code;
      const nextState = {
        active: props.activeCodes.has(code), correct: code === props.correctCode,
        wrong: code === props.selectedCode && code !== props.correctCode, hover: false,
      };
      map.setFeatureState({ source: "countries", id: code }, nextState);
      if (markerCodes.has(code)) map.setFeatureState({ source: "targets", id: code }, nextState);
    }
  }, [ready, props.data, props.activeCodes, props.selectedCode, props.correctCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (props.correctCode) {
      const target = props.data.features.find((feature) => feature.properties.code === props.correctCode);
      if (target) map.flyTo({ center: target.properties.label, zoom: Math.max(3, map.getZoom()), duration: 900 });
    }
  }, [ready, props.data, props.correctCode]);

  useEffect(() => {
    if (ready) mapRef.current?.setLayoutProperty("country-borders", "visibility", borders ? "visible" : "none");
  }, [borders, ready]);

  function focusRegion() {
    mapRef.current?.flyTo({ ...viewForRegion(props.region, containerRef.current), duration: 700 });
  }

  return (
    <div className="globe-frame">
      <div className="quiz-globe" ref={containerRef} />
      {!ready && <div className="globe-status" role="status">Loading the globe…</div>}
      {imageryFailed && <div className="globe-notice" role="status">Satellite imagery is unavailable. Country shapes are still selectable.</div>}
      <div className="map-controls globe-controls" role="group" aria-label="Globe controls">
        <button onClick={focusRegion} disabled={!ready}>{props.region === "All" ? "World view" : `Focus ${props.region}`}</button>
        <button onClick={() => setBorders((current) => !current)} aria-pressed={borders} disabled={!ready}>Borders {borders ? "on" : "off"}</button>
        <button onClick={() => mapRef.current?.zoomOut()} disabled={!ready || zoom <= 0} aria-label="Zoom out">−</button>
        <button onClick={() => mapRef.current?.flyTo({ ...viewForRegion("All", containerRef.current), duration: 700 })} disabled={!ready} aria-label="Reset globe view">Reset</button>
        <button onClick={() => mapRef.current?.zoomIn()} disabled={!ready || zoom >= 8} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
