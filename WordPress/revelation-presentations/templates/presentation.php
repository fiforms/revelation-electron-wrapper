<?php
if (!defined('ABSPATH')) {
    exit;
}

$slug = $runtime['slug'];
$md_file = $runtime['md_file'];
$markdown = $runtime['markdown'];
$is_embed = !empty($runtime['is_embed']);
$settings = $runtime['settings'];
$plugin_url = $runtime['plugin_url'];
$route_base = $runtime['route_base'];
$md_files = is_array($runtime['md_files']) ? $runtime['md_files'] : array();

$uploads = wp_upload_dir();
$public_presentation_base = trailingslashit($uploads['baseurl']) . 'revelation-presentations/' . rawurlencode($slug) . '/';
$public_media_base = $public_presentation_base . '_resources/_media';

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
    body.rp-embed .revelation-toolbar { display: none; }
    .revelation-toolbar {
      position: fixed; z-index: 9999; top: 12px; right: 12px; font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: rgba(0,0,0,.55); color: #fff; padding: 8px 10px; border-radius: 8px; backdrop-filter: blur(2px);
    }
    .revelation-toolbar select { margin-left: 8px; }
  </style>
  <script>
    window.revealRemoteServer = <?php echo wp_json_encode($reveal_remote_url !== '' ? $reveal_remote_url . '/' : ''); ?>;
    window.presenterPluginsPublicServer = <?php echo wp_json_encode($presenter_plugins_public_server); ?>;
    window.__offlinePluginList = {};
    window.mediaPath = <?php echo wp_json_encode($public_media_base); ?>;
    window.splashScreenEnabled = true;
    window.exportedAppVersion = <?php echo wp_json_encode(RP_PLUGIN_VERSION); ?>;
  </script>
</head>
<body class="hidden<?php echo $is_embed ? ' rp-embed' : ''; ?>">
<?php if (!$is_embed && count($md_files) > 1) : ?>
  <div class="revelation-toolbar">
    Presentation:
    <select onchange="if(this.value){window.location.href=this.value;}">
      <?php foreach ($md_files as $candidate) :
        $target = add_query_arg('p', $candidate, $route_base);
        ?>
        <option value="<?php echo esc_url($target); ?>" <?php selected($candidate, $md_file); ?>><?php echo esc_html($candidate); ?></option>
      <?php endforeach; ?>
    </select>
  </div>
<?php endif; ?>

<div class="reveal">
  <div class="slides">
    <section id="markdown-container">Loading...</section>
  </div>
</div>
<div id="fixed-overlay-wrapper"></div>
<div id="fixed-ai-wrapper"></div>
<div id="fixed-tint-wrapper"></div>
<audio id="background-audio-player" loop></audio>

<textarea id="revelation-offline-markdown" style="display:none;"><?php echo esc_textarea($markdown); ?></textarea>
<script>
  (function () {
    const md = document.getElementById('revelation-offline-markdown');
    if (md) {
      window.offlineMarkdown = md.textContent || '';
      md.remove();
    }
  })();
</script>
<script src="<?php echo esc_url($offline_js . 'translate.js'); ?>"></script>
<script src="<?php echo esc_url($offline_js . 'offline-bundle.js'); ?>"></script>
</body>
</html>
