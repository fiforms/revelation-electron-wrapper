/**
 * Adventist Hymns Plugin for REVELation
 * Scrapes hymn slides from adventisthymns.com and inserts them as Markdown
 */

export const plugin = {
  name: "adventisthymns",
  clientHookJS: 'client.js',
  priority: 60,
  AppContext: null,
  register(AppContext) {
    AppContext.log('[adventisthymns-plugin] Registered!');
    this.AppContext = AppContext;
  }

};

// ---------------- Helper Function ---------------- //

async function fetchHymnSlides(number) {
  // Follow redirects from /s/ to /slides/
  const base = `https://adventisthymns.com/en/1985/s/${number}`;
  const res = await fetch(base, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sections = [...doc.querySelectorAll(".reveal .slides section")];

  if (!sections.length) throw new Error("No slides found in hymn page.");

  const slides = sections.map((sec) => {
    const title = sec.querySelector(".post__title")?.textContent.trim() ?? "";
    const subtitle = sec.querySelector(".line-type")?.textContent.trim() ?? "";
    const lyrics = (sec.querySelector("p")?.innerHTML || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    return `# ${title}${subtitle ? " — " + subtitle : ""}\n${lyrics}\n\n***\n`;
  });

  return slides.join("\n");
}
