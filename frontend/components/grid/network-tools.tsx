"use client";
import { useEffect } from "react";
import { useNodesInitialized, useReactFlow, useStore } from "@xyflow/react";
import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { ActionButton } from "../ui/action-button";

export function NetworkTools({ disabled }: { disabled: boolean }) {
  const { fitView, zoomIn, zoomOut, getNodes, getNodesBounds, getZoom, setCenter } = useReactFlow();
  const initialized = useNodesInitialized();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (initialized && width && height) void fitView({ padding: .08, minZoom: .2, maxZoom: 1 });
  }, [initialized, width, height, fitView]);
  return <div className="network-tools">
    <ActionButton className="icon-button" aria-label="Fit network" title="Fit network" disabled={disabled} icon={<Maximize />} onClick={() => { void fitView({ padding: .08, minZoom: .2, maxZoom: 1 }); }} variant="ghost" />
    <ActionButton className="icon-button" aria-label="Center network" title="Center network" disabled={disabled} icon={<Crosshair />} onClick={() => { const bounds = getNodesBounds(getNodes()); void setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { zoom: getZoom() }); }} variant="ghost" />
    <ActionButton className="icon-button" aria-label="Zoom out" title="Zoom out" disabled={disabled} icon={<Minus />} onClick={() => { void zoomOut(); }} variant="ghost" />
    <ActionButton className="icon-button" aria-label="Zoom in" title="Zoom in" disabled={disabled} icon={<Plus />} onClick={() => { void zoomIn(); }} variant="ghost" />
  </div>;
}
