const THREE = require("three");

function getCameraPosLocally(matrix) {
  // matrix is projectionMatrix * viewMatrix * modelMatrix
  // The camera position in local space is the origin in view space (0,0,0,1).
  // But wait, projection * (0,0,0,1) isn't 0.
  // Actually, the camera position is where the depth is zero? No.
  // We can just query MapLibre for mercator coords!
}
