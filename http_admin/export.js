document.addEventListener('DOMContentLoaded', () => {
  const formatRadios = document.querySelectorAll('input[name="format"]');
  const imgOptions = document.getElementById('images-options');
  const zipOptions = document.getElementById('zip-options');
  const exportBtn = document.getElementById('export-btn');
  const exportStatus = document.getElementById('export-status');
  const defaultExportCaption = exportBtn.textContent;
  let unsubscribeExportStatus = null;

  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');
  const mdFile = urlParams.get('md') || 'presentation.md';

  formatRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      imgOptions.style.display = radio.value === 'images' ? 'block' : 'none';
      zipOptions.style.display = radio.value === 'zip' ? 'block' : 'none';
    });
  });

  const setWorking = (message = 'Working, please wait...') => {
    exportBtn.disabled = true;
    exportStatus.textContent = message;
  };

  const resetWorking = () => {
    exportBtn.textContent = defaultExportCaption;
    exportBtn.disabled = false;
    exportStatus.textContent = '';
    if (unsubscribeExportStatus) {
      unsubscribeExportStatus();
      unsubscribeExportStatus = null;
    }
  };

  exportBtn.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="format"]:checked').value;
    const includeMedia = document.getElementById('include-media').checked;
    const showSplashscreen = document.getElementById('show-splashscreen').checked;
    let shouldReset = true;

    try {
      if (selected === 'zip') {
        // 🧳 ZIP EXPORT 
        setWorking('Working, please wait...');
        if (!unsubscribeExportStatus) {
          unsubscribeExportStatus = window.electronAPI.onExportStatus((status) => {
            if (status === 'exporting') {
              exportStatus.textContent = 'Working, please wait...';
            }
          });
        }
        const result = await window.electronAPI.exportPresentation(slug, includeMedia, showSplashscreen);
        if (result?.success) {
          alert(`✅ Exported ZIP to: ${result.filePath}`);
          shouldReset = false;
          window.close();
        } else if (!result?.canceled) {
          alert(`❌ Export failed: ${result?.error || 'Unknown error'}`);
        }
      }

      else if (selected === 'pdf') {
        setWorking('Working, please wait...');
        await window.electronAPI.exportPresentationPDF(slug, mdFile);

        /*

        // 🧾 PDF EXPORT — open external browser for Reveal.js print-pdf
        const appConfig = await window.electronAPI.getAppConfig();
        const url = `http://${appConfig.hostURL || 'localhost'}:${appConfig.viteServerPort}/presentations_${appConfig.key}/${slug}/index.html?print-pdf&p=${mdFile}`;
        await window.electronAPI.openExternalURL(url);
        alert('📄 Opening in browser for PDF export...');
        */
        shouldReset = false;
        window.close();
      }

      else if (selected === 'images') {
        setWorking('Working, please wait...');
        const width = parseInt(document.getElementById('img-width').value);
        const height = parseInt(document.getElementById('img-height').value);
        const delay = parseInt(document.getElementById('img-delay').value);
        const result = await window.electronAPI.exportImages(slug, mdFile, width, height, delay, false);
        if (result?.success && !result.canceled) {
          alert(`✅ Exported images to: ${result.filePath}`);
          shouldReset = false;
          window.close();
        } else if (!result?.canceled) {
          alert(`❌ Image export failed: ${result.error || 'Unknown error'}`);
        }
      }

    } catch (err) {
      console.error(err);
      alert(`❌ ${err.message}`);
    } finally {
      if (shouldReset) {
        resetWorking();
      }
    }
  });
});
