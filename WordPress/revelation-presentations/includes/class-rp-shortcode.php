<?php

if (!defined('ABSPATH')) {
    exit;
}

class RP_Shortcode
{
    /** @var RP_Plugin */
    private $plugin;

    public function __construct($plugin)
    {
        $this->plugin = $plugin;
        add_shortcode('revelation', array($this, 'render_shortcode'));
    }

    public function render_shortcode($atts)
    {
        $atts = shortcode_atts(array(
            'slug' => '',
            'md' => 'presentation.md',
            // new flag: when set to 1 the handler returns the handout-style
            // HTML inlined rather than an iframe/embed link.  this uses a
            // server-side markdown render so it is good for SEO.
            'inline' => '0',
            'lang' => '',
            'embed' => '1',
            'width' => '100%',
            'height' => '700px',
            'class' => '',
        ), $atts, 'revelation');

        $slug = $this->plugin->storage->sanitize_slug($atts['slug']);
        if (!$slug) {
            return '<!-- revelation shortcode: missing slug -->';
        }

        $md = $this->plugin->storage->sanitize_markdown_rel_path($atts['md']);
        if (!$md) {
            $md = 'presentation.md';
        }
        $lang = $this->sanitize_lang((string) $atts['lang']);

        $settings = $this->plugin->get_settings();
        $inline_requested = (string) $atts['inline'] === '1';
        $embed_requested = (string) $atts['embed'] !== '0';
        $allow_embed = !empty($settings['allow_embed']);

        $base = trailingslashit(home_url('/_revelation/' . $slug));
        $args = array('p' => $md);
        if ($lang !== '') {
            $args['lang'] = $lang;
        }
        $url = add_query_arg($args, $base);

        // inline rendering takes precedence; if we have a markdown file and
        // can read it then produce HTML directly.  fall back to the usual
        // embed behavior if inline wasn't requested or failed.
        if ($inline_requested) {
            $md_content = $this->plugin->storage->read_markdown($slug, $md);
            if ($md_content !== null) {
                require_once RP_PLUGIN_DIR . 'includes/class-rp-markdown-renderer.php';
                $renderer = new RP_Markdown_Renderer($this->plugin->storage, $slug, false);
                return $renderer->render($md_content);
            }
            // if we couldn't load for some reason, continue to the normal
            // fallback so that callers still see a link.
        }

        if (!$embed_requested || !$allow_embed) {
            return sprintf(
                '<a href="%s">%s</a>',
                esc_url($url),
                esc_html($slug)
            );
        }

        $embed_url = add_query_arg($args, trailingslashit($base . 'embed'));
        $width = $this->sanitize_dimension($atts['width'], '100%');
        $height = $this->sanitize_dimension($atts['height'], '700px');
        $class = sanitize_html_class((string) $atts['class']);
        $wrapper_style = sprintf(
            'display:block;width:100%%;max-width:%1$s;margin:1em 0;',
            esc_attr($width)
        );
        $iframe_style = sprintf(
            'display:block;width:100%%;height:%1$s;border:0;box-sizing:border-box;',
            esc_attr($height)
        );

        return sprintf(
            '<div class="%s" style="%s"><iframe src="%s" style="%s" loading="lazy" allowfullscreen></iframe></div>',
            esc_attr($class),
            $wrapper_style,
            esc_url($embed_url),
            $iframe_style
        );
    }

    private function sanitize_dimension($value, $default)
    {
        $raw = strtolower(trim((string) $value));
        if ($raw === '') {
            return $default;
        }

        if (preg_match('/^\d+$/', $raw)) {
            return $raw . 'px';
        }

        if (preg_match('/^\d+(?:\.\d+)?(?:px|%|vw|vh|rem|em|ch)$/', $raw)) {
            return $raw;
        }

        return $default;
    }

    private function sanitize_lang($value)
    {
        $lang = strtolower(trim((string) $value));
        if ($lang === '') {
            return '';
        }
        if (!preg_match('/^[a-z0-9]{2,8}(?:-[a-z0-9]{2,8})*$/', $lang)) {
            return '';
        }
        return $lang;
    }
}
