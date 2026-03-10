<?php
if (!defined('ABSPATH')) {
    exit;
}

$slug = $runtime['slug'];
$md_file = $runtime['md_file'];
$is_embed = !empty($runtime['is_embed']);
$settings = $runtime['settings'];
$hosted_plugin_list = isset($runtime['hosted_plugin_list']) && is_array($runtime['hosted_plugin_list'])
    ? $runtime['hosted_plugin_list']
    : array();
$plugin_url = $runtime['plugin_url'];
$shared_media_base_url = isset($runtime['shared_media_base_url']) ? (string) $runtime['shared_media_base_url'] : '';

$uploads = wp_upload_dir();
$public_presentation_base = trailingslashit($uploads['baseurl']) . 'revelation-presentations/' . rawurlencode($slug) . '/';
$public_media_base = $public_presentation_base . '_resources/_media';
$shared_media_base = $shared_media_base_url !== '' ? untrailingslashit($shared_media_base_url) : '';

$reveal_remote_url = isset($settings['reveal_remote_url']) ? (string) $settings['reveal_remote_url'] : '';
$reveal_remote_url = untrailingslashit(trim($reveal_remote_url));
$presenter_plugins_public_server = $reveal_remote_url !== '' ? $reveal_remote_url . '/presenter-plugins-socket' : '';
$offline_assets = trailingslashit($plugin_url . 'assets/runtime');
$offline_css = trailingslashit($offline_assets . 'css');
$offline_js = trailingslashit($offline_assets . 'js');
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo esc_html($slug . ' - ' . $md_file); ?></title>
  <base href="<?php echo esc_url($public_presentation_base); ?>" />
  <link rel="stylesheet" href="<?php echo esc_url($offline_css . 'reveal.css'); ?>">
  <link id="theme-stylesheet" rel="stylesheet" href="">
  <style>
    body.hidden { opacity: 0; transition: opacity .8s ease-in-out; background: #000; overflow: hidden; }
  </style>
  <script>
    window.revealRemoteServer = <?php echo wp_json_encode($reveal_remote_url !== '' ? $reveal_remote_url . '/' : ''); ?>;
    window.presenterPluginsPublicServer = <?php echo wp_json_encode($presenter_plugins_public_server); ?>;
    window.__offlinePluginList = <?php echo wp_json_encode($hosted_plugin_list); ?>;
    window.presentationMediaPath = <?php echo wp_json_encode($public_media_base); ?>;
    window.sharedMediaPath = <?php echo wp_json_encode($shared_media_base); ?>;
    window.mediaPath = <?php echo wp_json_encode(!empty($settings['use_shared_media_library']) && $shared_media_base !== '' ? $shared_media_base : $public_media_base); ?>;
    window.splashScreenEnabled = <?php echo !empty($settings['show_splash_screen']) ? 'true' : 'false'; ?>;
    window.exportedAppVersion = <?php echo wp_json_encode(RP_PLUGIN_VERSION); ?>;
    window.__revelationHostedRoute = {
      pathname: window.location.pathname,
      search: window.location.search
    };
    window.__normalizeHostedRevealTarget = function (url) {
      try {
        if (typeof url !== 'string' || !url) return url;
        const route = window.__revelationHostedRoute || {};
        const targetPath = String(route.pathname || '');
        const targetSearch = String(route.search || '');
        if (!targetPath) return url;
        if (url === '#' || url.indexOf('#/') === 0) {
          return `${targetPath}${targetSearch}${url}`;
        }
        return url;
      } catch (_err) {
        return url;
      }
    };
    (function () {
      const historyRef = window.history;
      if (!historyRef) return;
      const originalReplaceState = historyRef.replaceState ? historyRef.replaceState.bind(historyRef) : null;
      const originalPushState = historyRef.pushState ? historyRef.pushState.bind(historyRef) : null;
      if (originalReplaceState) {
        historyRef.replaceState = function (state, unused, url) {
          return originalReplaceState(state, unused, window.__normalizeHostedRevealTarget(url));
        };
      }
      if (originalPushState) {
        historyRef.pushState = function (state, unused, url) {
          return originalPushState(state, unused, window.__normalizeHostedRevealTarget(url));
        };
      }
    })();
  </script>
</head>
<body class="hidden<?php echo $is_embed ? ' rp-embed' : ''; ?>">
<div class="reveal">
  <div class="slides">
    <section id="markdown-container">Loading...</section>
  </div>
</div>
<div id="fixed-overlay-wrapper"></div>
<div id="fixed-ai-wrapper"></div>
<div id="fixed-tint-wrapper"></div>
<audio id="background-audio-player" loop></audio>
<script src="<?php echo esc_url($offline_js . 'translate.js'); ?>"></script>
<script src="<?php echo esc_url($offline_js . 'offline-bundle.js'); ?>"></script>
</body>
</html>
