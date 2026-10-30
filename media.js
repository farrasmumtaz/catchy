export function releaseMedia(connection, elements) {
  const tracks = new Set(connection?.getSenders().map(sender => sender.track).filter(Boolean));
  for (const element of elements) {
    element.srcObject?.getTracks().forEach(track => tracks.add(track));
    element.srcObject = null;
  }
  tracks.forEach(track => track.stop());
}

export const cameraConstraints = deviceId => ({
  width: { ideal: 1280 }, height: { ideal: 720 },
  ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
});

export async function captureCamera(deviceId, devices = globalThis.navigator?.mediaDevices) {
  if (!devices?.getUserMedia) throw new Error('Kamera memerlukan HTTPS atau localhost dan browser yang mendukung akses kamera.');
  try { return await devices.getUserMedia({ audio: false, video: cameraConstraints(deviceId) }); }
  catch (error) {
    const messages = {
      NotAllowedError: 'Izin kamera ditolak. Izinkan kamera pada pengaturan situs browser, lalu coba lagi.',
      NotFoundError: 'Kamera tidak ditemukan pada perangkat ini.',
      NotReadableError: 'Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.',
      OverconstrainedError: 'Kamera yang dipilih tidak tersedia. Pilih kamera lain.',
    };
    throw new Error(messages[error.name] || 'Tidak dapat menyalakan kamera. Periksa perangkat dan izin browser.');
  }
}

export async function replaceVideoTrack(connection, track) {
  const sender = connection?.getSenders().find(sender => sender.track?.kind === 'video');
  if (!sender) { track.stop(); throw new Error('Ganti kamera hanya tersedia pada video call.'); }
  const previous = sender.track;
  track.enabled = previous.enabled;
  try { await sender.replaceTrack(track); }
  catch { track.stop(); throw new Error('Kamera tidak dapat diganti saat ini. Kamera sebelumnya tetap digunakan.'); }
  previous.stop();
}
