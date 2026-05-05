"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
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
  // Store the HTML element for pause/resume animation control
  const dotElRef = useRef<HTMLDivElement | null>(null);
  // Store the Mapbox Marker object so we can call setLngLat() on updates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerObjRef = useRef<any>(null);

  // ── Init map (runs once) ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!TOKEN) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let map: any;

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
        // ── Route source + layer ─────────────────────────────────
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [] },
            properties: {},
          },
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

        // ── Pulsing dot marker ───────────────────────────────────
        const el = document.createElement("div");
        el.style.cssText = `
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #2563eb;
          border: 3px solid white;
          box-shadow: 0 0 0 0 rgba(37,99,235,0.6);
          animation: af-pulse 1.5s infinite;
        `;
        dotElRef.current = el;

        const startLng = currentPosition?.lon ?? 34.78;
        const startLat = currentPosition?.lat ?? 32.07;

        // Store the Marker object — we need it to update position later
        const marker = new mapboxgl.default.Marker({ element: el })
          .setLngLat([startLng, startLat])
          .addTo(map);
        markerObjRef.current = marker;
      });
    });

    return () => {
      map?.remove();
      mapRef.current = null;
      markerObjRef.current = null;
      dotElRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init once

  // ── Update route polyline on each GPS tick ────────────────────
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

  // ── Update marker position + pan to follow runner ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPosition) return;

    const lngLat: [number, number] = [currentPosition.lon, currentPosition.lat];

    // Pan map to follow
    map.easeTo({ center: lngLat, duration: 800 });

    // Update marker position — this was previously a no-op
    if (markerObjRef.current) {
      markerObjRef.current.setLngLat(lngLat);
    }
  }, [currentPosition]);

  // ── Pause: stop dot pulsing ───────────────────────────────────
  useEffect(() => {
    const el = dotElRef.current;
    if (!el) return;
    el.style.animation = isRunning ? "af-pulse 1.5s infinite" : "none";
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
        @keyframes af-pulse {
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
