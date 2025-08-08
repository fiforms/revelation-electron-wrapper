// plugins/test/client.js
// Example plugin implementation: client (browser) side js code attaching to hooks in Revelation Presentation Framework pages
// when run inside Electron

(function () {
  window.RevelationPlugins['test'] = {
    name: 'test',


    // Triggered whenever the plugin is loaded into the browser.
    // context.page identifies which page the plugin is initialized in
    init(context) {
      this.context = context,
      console.log(`[test plugin] init with`, context);
      // window.alert(`[test plugin] init in ${context.page}`);
    },

    // Called by presentationlist.js, this hook allows adding menu items
    // to the context menu in the presentation listing.
    getListMenuItems(presentation) {
      return [
        {
          label: 'Test Plugin: Alert',
          action: () => alert(`Hello from test plugin: ${presentation.slug}/${presentation.md}`)
        }
      ];
    },

    // Called by contextmenu.js in presentation view, this hook allows adding context menu
    // items in the reveal.js presentation view itself.
    
    getPresentationMenuItems(revealDeck) {
      const total = revealDeck.getTotalSlides();
      const past = revealDeck.getSlidePastCount();
      return [
        {
          label: 'Test Plugin: Wave Hello',
          action: () => showOverlayHello()
        },
        {
          label: `Test Plugin: Slide Info (${past + 1} of ${total})`,
          action: () => showSlideInfo(revealDeck)
        }
      ];
    },
    getMediaMenuItems(mediaItem) {
      return [
        {
          label: 'Test Plugin: Examine Media',
          action: () => alert(`Examine: ${mediaItem.original_filename}`)
        }
      ];
    }
  };

  function showSlideInfo(Reveal) {
    const indices = Reveal.getIndices();
    window.alert(JSON.stringify(indices));
  }

  function showOverlayHello() {
    const existing = document.getElementById('plugin-overlay');
    if (existing) existing.remove(); // Remove any existing one

    const overlay = document.createElement('div');
    overlay.id = 'plugin-overlay';
    overlay.textContent = '👋 Hello from Test Plugin!';
    overlay.style = `
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(30, 30, 30, 0.9);
        color: white;
        padding: 1.5rem 2rem;
        border-radius: 12px;
        font-size: 1.2rem;
        font-family: sans-serif;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
    `;

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });

    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    }, 3000); // Auto-dismiss after 3 seconds
    }

})();
