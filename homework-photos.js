/* Фото декодируются и заново сохраняются как JPEG: EXIF/GPS не отправляются. */
(function (root) {
  'use strict';
  var maxFiles = 4, maxInput = 20 * 1024 * 1024, maxOutput = 5 * 1024 * 1024;
  function validateFile(file) {
    if (!file || !file.size || file.size > maxInput) throw new Error('Выберите фото размером до 20 МБ.');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) {
      throw new Error('Поддерживаются JPEG, PNG и WebP. Снимки HEIC можно выбрать, если их открывает ваш браузер.');
    }
  }
  async function prepare(file) {
    validateFile(file);
    var source = URL.createObjectURL(file);
    try {
      var img = new Image();
      img.src = source;
      await img.decode();
      if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 80000000) {
        throw new Error('Слишком большое разрешение снимка. Выберите уменьшенную копию.');
      }
      var ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', .88); });
      if (!blob || blob.type !== 'image/jpeg' || blob.size > maxOutput) {
        throw new Error('Не удалось уменьшить фото до 5 МБ. Выберите другой снимок.');
      }
      return blob;
    } catch (error) {
      if (error.name === 'EncodingError') throw new Error('Браузер не открыл фото. Сохраните его в JPEG или выберите другой снимок.');
      throw error;
    } finally { URL.revokeObjectURL(source); }
  }
  var api = { prepare: prepare, validateFile: validateFile, maxFiles: maxFiles };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SchoolPhotos = api;
})(typeof window === 'object' ? window : globalThis);
