"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Incident, ProcessedCall } from "@/lib/types";

const COLORS: Record<string, string> = { P1: "#ff4d4f", P2: "#ffa940", P3: "#40a9ff", P4: "#8c8c8c" };

export default function IncidentMap({
  incidents,
  calls,
  selected,
  onSelect,
  me,
}: {
  incidents: Incident[];
  calls: ProcessedCall[];
  selected: string | null;
  onSelect: (id: string) => void;
  me: { lat: number; lng: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false, attributionControl: false, maxZoom: 16 }).setView([40.7443, -73.9955], 15);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const incOf = new Map(incidents.map((i) => [i.id, i]));
    // individual caller locations, faint, linked to their incident
    for (const c of calls) {
      const inc = c.incidentId ? incOf.get(c.incidentId) : undefined;
      const color = c.decision === "review" ? "#d3adf7" : inc ? COLORS[inc.priority] : "#595959";
      L.circleMarker([c.lat, c.lng], { radius: 3, color, weight: 0, fillOpacity: 0.55 }).addTo(g);
    }
    for (const inc of incidents) {
      const n = inc.callIds.length;
      const m = L.circleMarker([inc.lat, inc.lng], {
        radius: 9 + Math.sqrt(n) * 4,
        color: inc.id === selected ? "#fff" : COLORS[inc.priority],
        weight: inc.id === selected ? 3 : 2,
        fillColor: COLORS[inc.priority],
        fillOpacity: 0.35,
      })
        .bindTooltip(`${inc.id} · ${n} call${n > 1 ? "s" : ""}`, { permanent: true, direction: "top", className: "map-tip" })
        .on("click", () => onSelect(inc.id));
      m.addTo(g);
    }
    if (me)
      L.marker([me.lat, me.lng], { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [14, 14] }) })
        .bindTooltip("You", { permanent: true, direction: "bottom", className: "map-tip" })
        .addTo(g);
  }, [incidents, calls, selected, onSelect, me]);

  // On getting a location, frame the user and their nearest incident together.
  useEffect(() => {
    if (!map.current || !me) return;
    const nearest = incidents[0];
    if (!nearest) return void map.current.setView([me.lat, me.lng], 15);
    map.current.fitBounds(L.latLngBounds([me.lat, me.lng], [nearest.lat, nearest.lng]), { padding: [60, 60], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, incidents[0]?.id]);

  return <div ref={el} className="map" />;
}
