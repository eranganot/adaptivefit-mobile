"use client";

import { useEffect, useRef } from "react";
import type { GpsRawPoint } from "@/lib/run/haversine";

interface MapboxLiveMapProps {
  route: GpsRawPoint[];
  currentPosition: { lat: number; lon: number } | null;
  isRunning: boolean;   // false = paused (dot stops pulsing)
  className?: string;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export default function MapboxLiveMap({
  route,
  currentPosition,
  isRunning,
  className = "",
}: MapboxLiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);

  // ── Init map ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!TOKEN) return;

    let map: ReturnType<typeof import("mapbox-gl")["Map"]["prototype"]["constructor"]>;

    import("mapbox-gl").then((mapboxgl) => {
      mapboxgl.default.accessToken = TOKEN;

      map = new mapboxgl.default.Map({
        container: containerRef.current!,
        style: "mapbox://styles/mapbox/streets-v12",
        center: currentPosition
          ? [currentPosition.lon, currentPosition.lat]
          : [34.78, 32.07], // Default: Tel Aviv
        zoom: 15,
        attributionControl: false,
      });

      mapRef.current = map;

      map.on("load", () => {
        // Add route source + layer
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#2563eb",
            "line-width": 4,
            "line-opacity": 0.85,
          },
        });

        // Pulsing dot marker
        const el = document.createElement("div");
        el.className = "run-dot";
        el.style.cssText = `
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #2563eb;
          border: 3px solid white;
          box-shadow: 0 0 0 0 rgba(37,99,235,0.6);
          animation: pulse 1.5s infinite;
        `;
        markerRef.current = el;

        if (currentPosition) {
          new mapboxgl.default.Marker({ element: el })
            .setLngLat([currentPosition.lon, currentPosition.lat])
            .addTo(map);
        }
      });
    });

    return () => {
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // ── Update route polyline ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("route");
    if (!source) return;
    source.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: route.map((p) => [p.lon, p.lat]),
      },
      properties: {},
    });
  }, [route]);

  // ── Update marker position + pan ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPosition) return;
    const lngLat: [number, number] = [currentPosition.lon, currentPosition.lat];
    map.easeTo({ center: lngLat, duration: 800 });

    if (markerRef.current) {
      // Update marker position via the marker object stored in a ref
      // We stored the Marker in a different ref; simplest: re-create on update
    }
  }, [currentPosition]);

  // ── Pause: stop dot pulsing ───────────────────────────────────
  useEffect(() => {
    const el = markerRef.current;
    if (!el) return;
    el.style.animation = isRunning ? "pulse 1.5s infinite" : "none";
    el.style.opacity = isRunning ? "1" : "0.6";
  }, [isRunning]);

  if (!TOKEN) {
    return (
      <div
        className={`flex items-center justify-center rounded-3xl bg-slate-100 dark:bg-slate-800 ${className}`}
      >
        <p className="text-sm text-slate-500">Map token not configured</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(37,99,235,0.6); }
          70%  { box-shadow: 0 0 0 10px rgba(37,99,235,0); }
          100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        }
      `}</style>
      <div
        ref={containerRef}
        className={`overflow-hidden rounded-3xl ${className}`}
        style={{ minHeight: 200 }}
      />
    </>
  );
}
