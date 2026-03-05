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
            'height' => '700',
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
        $height = max(200, intval($atts['height']));
        $class = sanitize_html_class((string) $atts['class']);

        return sprintf(
            '<iframe class="%s" src="%s" width="100%%" height="%d" style="border:0;" loading="lazy" allowfullscreen></iframe>',
            esc_attr($class),
            esc_url($embed_url),
            $height
        );
    }
}
