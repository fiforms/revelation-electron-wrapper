document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("#tabs button");
  const sections = document.querySelectorAll(".tab");

  const show = id => {
    // Show the matching section
    sections.forEach(s => s.classList.add("hidden"));
    document.getElementById(`tab-${id}`).classList.remove("hidden");

    // Update active button styling
    tabs.forEach(btn =>
      btn.classList.toggle("active", btn.dataset.tab === id)
    );
  };

  // Click handling
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      show(btn.dataset.tab);
    });
  });

  // Default tab
  show("about");

  // External link triggers
  document.querySelectorAll("[data-href]").forEach(btn => {
    btn.addEventListener("click", () => {
      window.electronAPI.openExternalURL(btn.dataset.href);
    });
  });
});
