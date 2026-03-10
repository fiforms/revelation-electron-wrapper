<?php

if (!defined('ABSPATH')) {
    exit;
}

class RP_Router
{
    /** @var RP_Plugin */
    private $plugin;

    public function __construct($plugin)
    {
        $this->plugin = $plugin;

        add_action('init', array(__CLASS__, 'register_rewrite_tags_and_rules'));
        add_filter('query_vars', array($this, 'register_query_vars'));
        add_action('template_redirect', array($this, 'maybe_render_presentation'));
    }

    public static function register_rewrite_tags_and_rules()
    {
        add_rewrite_tag('%rp_presentation%', '([^&]+)');
        add_rewrite_tag('%rp_embed%', '([01])');

        add_rewrite_rule(
            '^_revelation/([^/]+)/embed/?$',
            'index.php?rp_presentation=$matches[1]&rp_embed=1',
            'top'
        );
        add_rewrite_rule(
            '^_revelation/([^/]+)/?$',
            'index.php?rp_presentation=$matches[1]',
            'top'
        );
    }

    public function register_query_vars($vars)
    {
        $vars[] = 'rp_presentation';
        $vars[] = 'rp_embed';
        return $vars;
    }

    public function maybe_render_presentation()
    {
        $slug = get_query_var('rp_presentation');
        if (!$slug) {
            return;
        }

        $slug = $this->plugin->storage->sanitize_slug($slug);
        if (!$slug) {
            status_header(404);
            exit;
        }

        $dir = $this->plugin->storage->presentation_dir($slug);
        if (!$dir || !is_dir($dir)) {
            status_header(404);
            exit;
        }

        try {
            $this->plugin->storage->ensure_runtime_assets_for_slug($slug);
        } catch (Throwable $e) {
            // Keep rendering path resilient even if runtime asset sync fails.
        }

        $md_param = isset($_GET['p']) ? wp_unslash($_GET['p']) : 'presentation.md';
        $md_file = $this->plugin->storage->sanitize_markdown_rel_path($md_param);

        $md_files = $this->plugin->storage->collect_markdown_files($dir);
        if (empty($md_files)) {
            status_header(404);
            exit;
        }
        if (!$md_file) {
            $md_file = !empty($md_files) ? $md_files[0] : 'presentation.md';
        }
        if (!in_array($md_file, $md_files, true)) {
            $md_file = $md_files[0];
        }

        $is_embed = (string) get_query_var('rp_embed') === '1';
        $settings = $this->plugin->get_settings();

        nocache_headers();
        status_header(200);

        $runtime = array(
            'slug' => $slug,
            'md_file' => $md_file,
            'is_embed' => $is_embed,
            'settings' => $settings,
            'hosted_plugin_list' => $this->plugin->get_hosted_runtime_plugin_list(),
            'md_files' => $md_files,
            'plugin_url' => RP_PLUGIN_URL,
            'home_url' => home_url('/'),
            'route_base' => trailingslashit(home_url('/_revelation/' . $slug)),
            'current_lang' => isset($_GET['lang']) ? sanitize_text_field((string) wp_unslash($_GET['lang'])) : '',
            'shared_media_base_url' => trailingslashit($this->plugin->storage->shared_media_url()),
        );

        include RP_PLUGIN_DIR . 'templates/presentation.php';
        exit;
    }
}
