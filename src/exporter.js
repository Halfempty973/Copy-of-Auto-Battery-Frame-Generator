// STEP / STL blob export with a file:// friendly download.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke a tick later so the download can start first.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSTEP(shape, filename = "battery-frame.step") {
  downloadBlob(shape.blobSTEP(), filename);
}

export function exportSTL(shape, filename = "battery-frame.stl") {
  downloadBlob(shape.blobSTL(), filename);
}
