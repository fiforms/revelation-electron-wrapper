=== REVELation Presentations ===
Contributors: fiforms
Tags: presentations, slideshow, markdown, revealjs, publishing
Stable tag: 1.0.5
Requires at least: 6.0
Tested up to: 6.9.4
Requires PHP: 8.4
License: MIT
License URI: https://opensource.org/licenses/MIT

Host REVELation presentation ZIP exports in WordPress, render them from clean routes, and optionally publish from the matching REVELation desktop app.

== Description ==

REVELation Presentations lets administrators upload REVELation presentation exports, host them from WordPress routes, and embed them in posts or pages.

This plugin is the WordPress hosting and publishing companion for the broader REVELation Snapshot Presenter software stack. The desktop app is used to build and export presentations, while this plugin receives those exports, hosts them from WordPress, and can pair with the desktop app for incremental publishing and shared media sync.

Major features include:

* Upload and import REVELation ZIP exports from WP Admin.
* Serve hosted presentations from clean routes under `/_revelation/{slug}`.
* Render multiple Markdown entry files per presentation package.
* Embed hosted presentations with the `[revelation]` shortcode.
* Optionally render inline handout-style HTML from Markdown.
* Pair with the REVELation desktop app for incremental publishing and shared media sync.
* Enable selected hosted runtime plugins globally for hosted presentations.

Desktop publishing uses an administrator-approved paired-client trust path rather than a normal interactive WordPress login session. A desktop instance must first request pairing, prove control of its RSA keypair, and be explicitly approved by a WordPress administrator before it can publish.

Project links:

* Project home page: https://snapshots.vrbm.org/revelation-snapshot-presenter/
* Source repository: https://github.com/fiforms/revelation-electron-wrapper
* Related REVELation framework repository: https://github.com/fiforms/revelation

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`, or install the packaged ZIP through the WordPress Plugins screen.
2. Activate the plugin through the `Plugins` screen in WordPress.
3. Visit `REVELation -> Settings` to review the plugin settings.
4. Visit `REVELation -> Presentations` to upload a REVELation ZIP export.
5. Open a hosted presentation at `/_revelation/{slug}` or embed it with the shortcode shown in the admin UI.

== Frequently Asked Questions ==

= Who can manage presentations and settings? =

Access:

* The plugin is intended for administrators.
* Upload, deletion, settings, pairing approval, and paired-client management require `manage_options`.

= How does desktop publishing authenticate? =

Trust model:

* Desktop publishing does not rely on a normal interactive WordPress wp-admin login session.
* A desktop instance must first create a pairing request and prove control of its RSA keypair.
* A WordPress administrator must explicitly approve that pairing request in the plugin settings screen.
* After approval, publish requests are limited to the paired client and require its pairing ID, publish token, RSA request signature, timestamp, nonce, and payload hash validation.

= How do I embed a hosted presentation? =

Usage:

* Use the shortcode shown on the `REVELation -> Presentations` admin page.
* Example:
  `[revelation slug="my-presentation" md="presentation.md" width="640px" height="360px"]`

= Does the plugin contact third-party services by default? =

Default behavior:

* No. Reveal Remote socket integration is disabled by default.
* If an administrator explicitly enables either the public Reveal Remote preset or a custom socket server in `REVELation -> Settings`, hosted presentation pages may connect from the visitor's browser to that configured socket service for remote presentation sync and presenter-plugin socket features.

= What data is sent to the optional Reveal Remote service? =

Data exposure:

* When Reveal Remote is enabled by a site administrator, the visitor browser may connect directly to the configured socket server using websocket or polling transports.
* The exact traffic depends on the enabled presentation features, but can include room or multiplex identifiers and runtime socket messages needed for remote control and presenter-plugin features.
* As with any direct browser connection, the service operator may also receive standard connection metadata such as IP address and user agent.

= Which Reveal Remote services can be configured? =

Available choices:

* Disabled
* `https://revealremote.fiforms.org/` as a public free socket server preset
* A custom administrator-provided URL

Public preset policy:

* `https://revealremote.fiforms.org/privacypolicy.html`

Administrator responsibility:

* Site administrators should review the privacy policy and terms for any configured endpoint before enabling it on a public site.

= Where is the readable source for bundled JavaScript assets? =

Source availability:

* Readable source is included in the plugin package where practical.
* The source/build repository is public.

Examples in the packaged plugin:

* `assets/runtime/js/offline-bundle.js` is the readable hosted runtime bundle.
* `assets/runtime/js/offline-bundle.min.js` is a minified copy generated from that bundle.
* `assets/plugins/highlight/highlight/plugin.bundle.mjs` and `assets/plugins/highlight/highlight/plugin.bundle.js` are readable bundled Highlight plugin files.
* `assets/plugins/highlight/highlight/plugin.bundle.min.js` is the minified Highlight bundle.
* `assets/plugins/revealchart/revealchart/chart.umd.js` is the readable Chart.js bundle copied from the upstream package.
* `assets/plugins/revealchart/revealchart/chart.umd.min.js` is the upstream minified Chart.js bundle.

Build and sync scripts:

* https://github.com/fiforms/revelation-electron-wrapper/blob/main/scripts/copy-plugins.js
* https://github.com/fiforms/revelation-electron-wrapper/blob/main/scripts/wp-sync-runtime-assets.js
* https://github.com/fiforms/revelation-electron-wrapper/blob/main/revelation/vite.config.js

= Which third-party libraries are bundled with the plugin package? =

Examples of bundled upstream libraries:

* Reveal.js
* reveal.js-plugins/chart
* Chart.js
* Highlight.js
* Parsedown
* league/commonmark and its dependencies when bundled in the packaged plugin

Attribution:

* See the bundled license files inside the package and the project `LICENSE.md` for additional attribution details.

== External Services ==

This plugin can optionally connect hosted presentation pages to a remote socket service for Reveal Remote and presenter-plugin features.

Service name: Reveal Remote socket server
Purpose: Remote presentation sync, presenter-plugin socket features, and related live-control functionality for hosted presentations
When used: Only after a site administrator explicitly enables a socket server in `REVELation -> Settings`
Default: Disabled

Supported endpoint choices:

* Public preset: `https://revealremote.fiforms.org/`
* Custom endpoint: administrator-provided URL

Public preset policy URL:

* `https://revealremote.fiforms.org/privacypolicy.html`

Data sent from the visitor browser can include:

* Room or multiplex identifiers
* Runtime websocket or polling messages for enabled remote features
* Standard browser connection metadata normally visible to the service operator

Administrators are responsible for reviewing and approving the privacy policy and terms for the selected service before enabling it.

== Changelog ==

= 1.0.5 =

* Added WordPress.org-style readme documentation for packaging, external services, and bundled asset sources.
* Reveal Remote is disabled by default and can be enabled explicitly from plugin settings.
* Bundled readable JavaScript copies alongside minified assets where available.

== Upgrade Notice ==

= 1.0.5 =

Reveal Remote is now disabled by default. Review `REVELation -> Settings` after upgrading if you previously relied on a configured remote socket server.
