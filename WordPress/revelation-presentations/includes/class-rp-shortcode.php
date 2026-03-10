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

        $settings = $this->plugin->get_settings();
        $embed_requested = (string) $atts['embed'] !== '0';
        $allow_embed = !empty($settings['allow_embed']);

        $base = trailingslashit(home_url('/_revelation/' . $slug));
        $url = add_query_arg('p', $md, $base);

        if (!$embed_requested || !$allow_embed) {
            return sprintf(
                '<a href="%s">%s</a>',
                esc_url($url),
                esc_html($slug)
            );
        }

        $embed_url = add_query_arg('p', $md, trailingslashit($base . 'embed'));
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
}
