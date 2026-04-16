import * as Cesium from "cesium";
import type { RadarSite } from "@nexrad-3d/contracts";

export const DEFAULT_RADAR_VIEW_HEIGHT_M = 280_000;

export function flyCameraToRadarSite(
  viewer: Cesium.Viewer,
  site: Pick<RadarSite, "latitude" | "longitude"> | null | undefined,
  durationSeconds = 1.1
): void {
  if (!site || !Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) {
    return;
  }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      site.longitude,
      site.latitude,
      DEFAULT_RADAR_VIEW_HEIGHT_M
    ),
    duration: durationSeconds,
  });
}

/**
 * Home flies to the current radar site (via ref). Removes listener on returned cleanup.
 */
export function wireHomeButtonToRadarSite(
  viewer: Cesium.Viewer,
  getSite: () => RadarSite | null | undefined
): () => void {
  viewer.homeButton.viewModel.tooltip = "Fly to radar site";
  const onHome = (event: { cancel: boolean }) => {
    event.cancel = true;
    flyCameraToRadarSite(viewer, getSite() ?? undefined);
  };
  viewer.homeButton.viewModel.command.beforeExecute.addEventListener(onHome);
  return () => {
    viewer.homeButton.viewModel.command.beforeExecute.removeEventListener(onHome);
  };
}
