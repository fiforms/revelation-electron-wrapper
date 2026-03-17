<?php

if (!defined('ABSPATH')) {
    exit;
}

// This renderer is used by the shortcode when the `inline` flag is set.  It
// performs a minimal conversion of the REVelation-style markdown used by
// presentations into plain HTML that can be dropped in a WordPress post
// or page.  The goal is to replicate the behaviour of the "handout view"
// without involving reveal.js, and to rewrite any relative media URLs so
// that the output is SEO-friendly and styled by the current theme.

class RP_Markdown_Renderer
{
    /** @var RP_Storage */
    private $storage;

    /** @var string */
    private $slug;

    /** @var string public base URL for the presentation */
    private $base_url;

    /** @var bool */
    private $use_slide_breaks;

    /** @var string */
    private $current_md;

    /** @var string */
    private $inline_base_url;

    /** @var string */
    private $inline_query_param;

    /** @var string */
    private $inline_anchor;

    public function __construct($storage, $slug, $use_slide_breaks = true, $options = array())
    {
        $this->storage = $storage;
        $this->slug = $storage->sanitize_slug($slug);
        $uploads = wp_upload_dir();
        $this->base_url = trailingslashit($uploads['baseurl']) . 'revelation-presentations/' . rawurlencode($this->slug) . '/';
        $this->use_slide_breaks = (bool) $use_slide_breaks;
        $this->current_md = $storage->sanitize_markdown_rel_path(isset($options['current_md']) ? $options['current_md'] : '') ?: 'presentation.md';
        $this->inline_base_url = isset($options['inline_base_url']) ? esc_url_raw((string) $options['inline_base_url']) : '';
        $this->inline_query_param = sanitize_key(isset($options['inline_query_param']) ? (string) $options['inline_query_param'] : '');
        $this->inline_anchor = sanitize_html_class(isset($options['inline_anchor']) ? (string) $options['inline_anchor'] : '');
    }

    /**
     * Render a raw markdown string to HTML.
     *
     * @param string $markdown
     * @return string HTML (unsafe; caller should escape if embedding in attributes)
     */
    public function render($markdown)
    {
        // normalise line endings so the splitting logic behaves the same on
        // all platforms.
        $md = str_replace(array("\r\n", "\r"), "\n", $markdown);

        // strip YAML front matter if present; we don't need it in the output
        $md = $this->strip_frontmatter($md);

        // remove any {{macros}} that the JS preprocessor would handle.  these
        // are typically used for dynamic content and aren't useful in an
        // inline handout.
        $md = preg_replace('/\{\{[^}]*\}\}/', '', $md);

        // split into slides using the same rules as the handout JS.
        $slides = $this->split_slides($md);
        // note delimiter either "Notes:" or the legacy ":note:" marker.
        $note_separator = '/^\s*(?:Notes:|:note:)\s*$/mi';

        // obtain a markdown converter; league/commonmark is the "common"
        // library used in WP ecosystem.  We'll lazily instantiate it so that a
        // missing dependency doesn't fatal the whole plugin.
        $converter = $this->get_converter();

        $output_parts = array();
        $slide_count = 0;

        foreach ($slides as $slide) {
            $slide_count++;

            $raw = $slide['content'];
            if ($this->slide_should_be_hidden_for_handout($raw)) {
                continue;
            }
            list($content, $notes) = $this->split_content_and_notes($raw, $note_separator);
            $clean = trim($this->strip_separators_outside_code($content));
            $clean_notes = trim($this->strip_separators_outside_code($notes));

            // skip slides that produce no visible output
            if ($clean === '' && $clean_notes === '') {
                continue;
            }

            $html = '<section class="rp-slide">';
            if ($clean !== '') {
                // allow two-column markup before converting; the helper will
                // either produce HTML using the converter or escape properly
                $clean = $this->transform_columns($clean, $converter);
                if ($converter) {
                    if (method_exists($converter, 'convertToHtml')) {
                        $html .= $converter->convertToHtml($clean);
                    } else {
                        // Parsedown
                        $html .= $converter->text($clean);
                    }
                } else {
                    $html .= nl2br(esc_html($clean));
                }
            }
            if ($clean_notes !== '') {
                // notes are shown in a collapsible box for inline view
                $html .= '<details class="rp-note"><summary>Notes</summary>';
                $clean_notes = $this->transform_columns($clean_notes, $converter);
                if ($converter) {
                    if (method_exists($converter, 'convertToHtml')) {
                        $html .= $converter->convertToHtml($clean_notes);
                    } else {
                        $html .= $converter->text($clean_notes);
                    }
                } else {
                    $html .= nl2br(esc_html($clean_notes));
                }
                $html .= '</details>';
            }
            $html .= '</section>';

            if (!$this->use_slide_breaks && !empty($output_parts)) {
                $output_parts[] = '<hr class="rp-slide-break" />';
            }

            $output_parts[] = $html;
        }

        $final = implode("\n", $output_parts);

        // prepend some minimal CSS so columns behave even if the theme doesn't
        // supply styles.  Duplicating this block on multiple shortcodes is
        // harmless.
        $css = '<style>.rp-columns{display:flex;flex-wrap:wrap;gap:1rem}.rp-col{flex:1 1 50%}.rp-inline-video{display:block;max-width:100%;height:auto}@media(max-width:600px){.rp-columns{flex-direction:column}.rp-col{flex:1 1 100%}}</style>';
        return $css . $this->postprocess_rendered_html($this->rewrite_urls($final));
    }

    private function get_converter()
    {
        // prefer the CommonMark library if available (bundled or via composer)
        // Note: CommonMark classes are loaded manually in revelation-presentations.php
        if (class_exists('League\CommonMark\CommonMarkConverter')) {
            try {
                return new \League\CommonMark\CommonMarkConverter(array(
                    'html_input' => 'allow',
                    'allow_unsafe_links' => false,
                ));
            } catch (\Throwable $e) {
                error_log(
                    'REVELation Presentations: CommonMark unavailable, falling back to Parsedown. ' .
                    $e->getMessage()
                );
            }
        }

        // fall back to Parsedown if that library has been installed via
        // composer or bundled
        // Note: Parsedown is loaded manually in revelation-presentations.php
        if (class_exists('Parsedown')) {
            $p = new Parsedown();
            $p->setBreaksEnabled(true);
            return $p;
        }

        return null;
    }

    private function strip_frontmatter($markdown)
    {
        if (preg_match('/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/', $markdown, $m)) {
            return substr($markdown, strlen($m[0]));
        }
        return $markdown;
    }

    private function transform_columns($text, $converter)
    {
        // look for the simple double-pipe column syntax used by authors:
        // ||\nleft\n||\nright\n||
        return preg_replace_callback(
            '/\|\|\s*\n([\s\S]*?)\n\|\|\s*\n([\s\S]*?)\n\|\|/s',
            function ($m) use ($converter) {
                $left = trim($m[1]);
                $right = trim($m[2]);
                if ($converter) {
                    if (method_exists($converter, 'convertToHtml')) {
                        $left_html = $converter->convertToHtml($left);
                        $right_html = $converter->convertToHtml($right);
                    } else {
                        $left_html = $converter->text($left);
                        $right_html = $converter->text($right);
                    }
                } else {
                    $left_html = nl2br(esc_html($left));
                    $right_html = nl2br(esc_html($right));
                }
                return '<div class="rp-columns"><div class="rp-col">' .
                    $left_html . '</div><div class="rp-col">' .
                    $right_html . '</div></div>';
            },
            $text
        );
    }

    private function split_slides($markdown)
    {
        $lines = preg_split('/\n/', $markdown);
        $slides = array();
        $current = array();
        $inside = false;
        $fence = '';
        $breakType = 'start';

        foreach ($lines as $line) {
            if (preg_match('/^\s{0,3}((`{3,}|~{3,}))/',$line,$m)) {
                $f = $m[1];
                $c = $f[0];
                $len = strlen($f);
                if (!$inside) {
                    $inside = true;
                    $fence = $f;
                } elseif ($fence && $c === $fence[0] && strlen($fence) <= $len) {
                    $inside = false;
                    $fence = '';
                }
                $current[] = $line;
                continue;
            }

            $trim = trim($line);
            if (!$inside && ($trim === '---' || $trim === '***')) {
                $slides[] = array('content' => implode("\n", $current), 'breakType' => $breakType);
                $current = array();
                $breakType = $trim === '---' ? 'vertical' : 'horizontal';
                continue;
            }
            $current[] = $line;
        }
        $slides[] = array('content' => implode("\n", $current), 'breakType' => $breakType);
        return $slides;
    }

    private function split_content_and_notes($raw, $note_sep_regex)
    {
        $lines = preg_split('/\n/', $raw);
        $inside = false;
        $fence = '';
        $note_index = -1;

        foreach ($lines as $i => $line) {
            if (preg_match('/^\s{0,3}((`{3,}|~{3,}))/',$line,$m)) {
                $f = $m[1];
                $c = $f[0];
                $len = strlen($f);
                if (!$inside) {
                    $inside = true;
                    $fence = $f;
                } elseif ($fence && $c === $fence[0] && strlen($fence) <= $len) {
                    $inside = false;
                    $fence = '';
                }
                continue;
            }
            if (!$inside && preg_match($note_sep_regex, $line)) {
                $note_index = $i;
                break;
            }
        }
        if ($note_index < 0) {
            return array($raw, '');
        }
        $content = implode("\n", array_slice($lines, 0, $note_index));
        $notes = implode("\n", array_slice($lines, $note_index + 1));
        return array($content, $notes);
    }

    private function strip_separators_outside_code($markdown)
    {
        $lines = preg_split('/\n/', $markdown);
        $kept = array();
        $inside = false;
        $fence = '';

        foreach ($lines as $line) {
            if (preg_match('/^\s{0,3}((`{3,}|~{3,}))/',$line,$m)) {
                $f = $m[1];
                $c = $f[0];
                $len = strlen($f);
                if (!$inside) {
                    $inside = true;
                    $fence = $f;
                } elseif ($fence && $c === $fence[0] && strlen($fence) <= $len) {
                    $inside = false;
                    $fence = '';
                }
                $kept[] = $line;
                continue;
            }
            if (!$inside && preg_match('/^\s*(\*\*\*|---)\s*$/',$line)) {
                continue;
            }
            $kept[] = $line;
        }
        return implode("\n", $kept);
    }

    private function slide_should_be_hidden_for_handout($markdown)
    {
        $lines = preg_split('/\n/', (string) $markdown);
        $inside = false;
        $fence = '';

        foreach ($lines as $line) {
            if (preg_match('/^\s{0,3}((`{3,}|~{3,}))/', $line, $m)) {
                $f = $m[1];
                $c = $f[0];
                $len = strlen($f);
                if (!$inside) {
                    $inside = true;
                    $fence = $f;
                } elseif ($fence && $c === $fence[0] && strlen($fence) <= $len) {
                    $inside = false;
                    $fence = '';
                }
                continue;
            }

            if ($inside) {
                continue;
            }

            if (!preg_match('/^\s*:hide(?::(handout|slideshow))?:\s*$/i', $line, $m)) {
                continue;
            }

            $target = isset($m[1]) ? strtolower(trim($m[1])) : '';
            return $target === '' || $target === 'handout';
        }

        return false;
    }

    private function rewrite_urls($html)
    {
        // rewrite relative src/href values to point back at the presentation
        // directory.  this is deliberately simple because we just need SEO
        // friendly (absolute-ish) links; the front end will still attempt to
        // fetch the same paths as if the markdown were being served normally.

        return preg_replace_callback(
            '/\b(src|href)=(["\'])([^"\']+)\2/i',
            function ($m) {
                $attr = $m[1];
                $quote = $m[2];
                $url = $m[3];
                if ($url === '' || $url[0] === '#') {
                    return $m[0];
                }
                if (preg_match('#^(?:[a-z][a-z0-9+.-]*:|//|/)#i', $url)) {
                    // absolute or protocol-relative: leave alone
                    return $m[0];
                }
                $new = $this->rewrite_relative_url($attr, $url);
                return sprintf('%s=%s%s%s', $attr, $quote, esc_url($new), $quote);
            },
            $html
        );
    }

    private function rewrite_relative_url($attr, $url)
    {
        $resolved = $this->resolve_relative_path($url, $this->current_md);
        if ($attr === 'href' && $this->is_markdown_path($resolved)) {
            $inline_url = $this->build_inline_markdown_url($resolved);
            if ($inline_url !== null) {
                return $inline_url;
            }
        }

        return $this->base_url . ltrim($resolved, '/');
    }

    private function build_inline_markdown_url($md_path)
    {
        if ($this->inline_base_url === '' || $this->inline_query_param === '') {
            return null;
        }

        $parts = wp_parse_url(html_entity_decode((string) $md_path, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $target_md = $this->storage->sanitize_markdown_rel_path(isset($parts['path']) ? (string) $parts['path'] : '');
        if (!$target_md) {
            return null;
        }

        $url = remove_query_arg($this->inline_query_param, $this->inline_base_url);
        $url = add_query_arg($this->inline_query_param, $target_md, $url);
        if ($this->inline_anchor !== '') {
            $url .= '#' . $this->inline_anchor;
        }

        return $url;
    }

    private function resolve_relative_path($url, $current_md)
    {
        $parts = wp_parse_url(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $path = isset($parts['path']) ? (string) $parts['path'] : '';
        $query = isset($parts['query']) ? (string) $parts['query'] : '';
        $fragment = isset($parts['fragment']) ? (string) $parts['fragment'] : '';

        $base_dir = '';
        if ($current_md !== '') {
            $base_dir = trim(str_replace('\\', '/', dirname($current_md)), './');
            if ($base_dir === '.') {
                $base_dir = '';
            }
        }

        $combined = $base_dir !== '' ? $base_dir . '/' . ltrim($path, '/') : ltrim($path, '/');
        $normalized = $this->normalize_relative_path($combined);
        if ($query !== '') {
            $normalized .= '?' . $query;
        }
        if ($fragment !== '') {
            $normalized .= '#' . $fragment;
        }

        return $normalized;
    }

    private function normalize_relative_path($path)
    {
        $path = str_replace('\\', '/', (string) $path);
        $query = '';
        $fragment = '';

        $hash_pos = strpos($path, '#');
        if ($hash_pos !== false) {
            $fragment = substr($path, $hash_pos);
            $path = substr($path, 0, $hash_pos);
        }

        $query_pos = strpos($path, '?');
        if ($query_pos !== false) {
            $query = substr($path, $query_pos);
            $path = substr($path, 0, $query_pos);
        }

        $segments = explode('/', $path);
        $clean = array();
        foreach ($segments as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($clean);
                continue;
            }
            $clean[] = $segment;
        }

        $normalized = implode('/', $clean);
        return $normalized . $query . $fragment;
    }

    private function is_markdown_path($path)
    {
        $raw_path = strtok((string) $path, '?#');
        return is_string($raw_path) && preg_match('/\.md$/i', $raw_path);
    }

    private function postprocess_rendered_html($html)
    {
        $html = preg_replace_callback(
            '/<img\b[^>]*>/i',
            function ($m) {
                $tag = $m[0];
                $alt = $this->get_html_attribute($tag, 'alt');
                if ($alt !== null && $this->is_suppressed_background_alt($alt)) {
                    return '';
                }

                $src = $this->get_html_attribute($tag, 'src');
                if ($src === null || !$this->is_video_url($src)) {
                    return $tag;
                }

                $poster = $this->get_html_attribute($tag, 'data-poster');
                $attrs = array(
                    'class="rp-inline-video"',
                    'controls',
                    'playsinline',
                    'preload="metadata"',
                    'src="' . esc_url($src) . '"',
                );

                if ($poster !== null && $poster !== '') {
                    $attrs[] = 'poster="' . esc_url($poster) . '"';
                }

                $alt_text = $alt !== null ? trim(html_entity_decode($alt, ENT_QUOTES | ENT_HTML5, 'UTF-8')) : '';
                if ($alt_text !== '') {
                    $attrs[] = 'aria-label="' . esc_attr($alt_text) . '"';
                }

                return '<video ' . implode(' ', $attrs) . '></video>';
            },
            $html
        );

        return preg_replace('/<p>\s*<\/p>/i', '', $html);
    }

    private function get_html_attribute($tag, $name)
    {
        if (preg_match('/\b' . preg_quote($name, '/') . '=(["\'])(.*?)\1/i', $tag, $m)) {
            return $m[2];
        }

        return null;
    }

    private function is_video_url($url)
    {
        $path = wp_parse_url(html_entity_decode($url, ENT_QUOTES | ENT_HTML5, 'UTF-8'), PHP_URL_PATH);
        if (!is_string($path) || $path === '') {
            return false;
        }

        return (bool) preg_match('/\.(mp4|m4v|webm|ogv|ogg|mov)$/i', $path);
    }

    private function is_suppressed_background_alt($alt)
    {
        $decoded = trim(html_entity_decode($alt, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $normalized = trim($decoded, "[] \t\n\r\0\x0B");

        return $normalized === 'background' || $normalized === 'background:sticky';
    }
}
