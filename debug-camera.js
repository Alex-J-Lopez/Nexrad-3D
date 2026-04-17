const THREE = require("three");

// Create a perspective camera
const cam = new THREE.PerspectiveCamera(45, 1, 1, 100);
cam.position.set(10, 20, 30);
cam.lookAt(0,0,0);
cam.updateMatrixWorld();
cam.updateProjectionMatrix();

// Create PV
const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

// Invert it
const inv = pv.clone().invert();

// Extract 3rd column
const x = inv.elements[8]; // elements is column-major: 0..3 is col0, 4..7 is col1, 8..11 is col2
const y = inv.elements[9];
const z = inv.elements[10];
const w = inv.elements[11];

console.log("Expected:", cam.position);
console.log("Calculated:", x/w, y/w, z/w);
