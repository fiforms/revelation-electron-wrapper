<?php
/**
 * Validation for uploaded SVG files.
 *
 * SVGs are served from the site's own origin, so an SVG opened directly (or
 * framed) runs any script it contains with the site's privileges. Rather than
 * rewrite files, uploads are refused when they contain anything that can run
 * script: script/foreignObject elements, event-handler attributes, script
 * URLs, attribute-rewriting animations, entity declarations, or stylesheet
 * processing instructions.
 *
 * @license MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

class RP_SVG_Validator
{
    /** Elements that run script or embed active (HTML) content. */
    const BLOCKED_ELEMENTS = array('script', 'foreignobject', 'iframe', 'embed', 'object', 'handler', 'listener');

    const ANIMATION_ELEMENTS = array('animate', 'set', 'animatemotion', 'animatetransform');

    const ANIMATION_VALUE_ATTRS = array('values', 'from', 'to', 'by');

    /**
     * True when a path names a file this validator must check.
     */
    public static function applies_to($path)
    {
        return (bool) preg_match('/\.svg$/i', (string) $path);
    }

    /**
     * Validate an SVG file on disk; returns null when safe, otherwise a reason.
     */
    public static function check_file($path)
    {
        $content = @file_get_contents($path);
        if (!is_string($content)) {
            return 'the file could not be read';
        }
        return self::check($content);
    }

    /**
     * Validate SVG markup; returns null when safe, otherwise a short reason.
     */
    public static function check($content)
    {
        $content = (string) $content;
        if (trim($content) === '') {
            return 'the file is empty';
        }
        // Entities can hide markup from the checks below and enable
        // billion-laughs expansion; real-world SVGs do not need them.
        if (preg_match('/<!ENTITY/i', $content)) {
            return 'it declares XML entities';
        }
        if (!class_exists('DOMDocument')) {
            return 'the server cannot inspect SVG files (PHP DOM extension missing)';
        }

        $previous = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        // LIBXML_NONET: never fetch external resources. Entities are not substituted.
        $loaded = $dom->loadXML($content, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (!$loaded || !$dom->documentElement) {
            return 'it is not well-formed XML';
        }
        if (strtolower($dom->documentElement->localName) !== 'svg') {
            return 'its root element is not <svg>';
        }
        if ($dom->doctype && trim((string) $dom->doctype->internalSubset) !== '') {
            return 'it has an inline DOCTYPE subset';
        }

        $xpath = new DOMXPath($dom);
        // An xml-stylesheet processing instruction can load XSLT, which can emit script.
        if ($xpath->query('//processing-instruction()')->length > 0) {
            return 'it contains a processing instruction (e.g. xml-stylesheet)';
        }

        foreach ($xpath->query('//*') as $el) {
            $name = strtolower((string) $el->localName);
            if (in_array($name, self::BLOCKED_ELEMENTS, true)) {
                return sprintf('it contains a <%s> element', $el->localName);
            }
            if ($name === 'style' && self::is_dangerous_css($el->textContent)) {
                return 'a <style> block contains script-capable CSS';
            }

            $is_animation = in_array($name, self::ANIMATION_ELEMENTS, true);
            foreach ($el->attributes as $attr) {
                $attr_name = strtolower((string) $attr->localName);
                $value = (string) $attr->value;

                if (strpos($attr_name, 'on') === 0) {
                    return sprintf('<%s> has an event-handler attribute (%s)', $el->localName, $attr->nodeName);
                }
                if ($attr_name === 'style' && self::is_dangerous_css($value)) {
                    return sprintf('<%s> has a script-capable style attribute', $el->localName);
                }
                if (($attr_name === 'href' || $attr_name === 'src') && !self::is_safe_url($value)) {
                    return sprintf('<%s> links to a disallowed URL scheme', $el->localName);
                }
                if (self::is_script_url($value)) {
                    return sprintf('<%s> has a script URL in %s', $el->localName, $attr->nodeName);
                }
                if ($is_animation) {
                    if ($attr_name === 'attributename') {
                        $target = strtolower(trim($value));
                        if ($target === 'href' || substr($target, -5) === ':href' || $target === 'src'
                            || strpos($target, 'on') === 0 || $target === 'style') {
                            return sprintf('<%s> animates the %s attribute', $el->localName, $value);
                        }
                    } elseif (in_array($attr_name, self::ANIMATION_VALUE_ATTRS, true)) {
                        foreach (explode(';', $value) as $part) {
                            if (!self::is_safe_url($part)) {
                                return sprintf('<%s> animates to a disallowed URL', $el->localName);
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Collapse whitespace and control characters the way browsers do when parsing URL schemes.
     */
    private static function normalize_url($value)
    {
        return strtolower(preg_replace('/[\x00-\x20\x7F]+/', '', (string) $value));
    }

    private static function is_script_url($value)
    {
        $url = self::normalize_url($value);
        return strpos($url, 'javascript:') === 0 || strpos($url, 'vbscript:') === 0;
    }

    /**
     * Allow fragments, relative paths, http(s)/mailto, and raster data: images only.
     */
    private static function is_safe_url($value)
    {
        $url = self::normalize_url($value);
        if ($url === '' || !preg_match('/^([a-z][a-z0-9+.-]*):/', $url, $m)) {
            return true;
        }
        $scheme = $m[1];
        if (in_array($scheme, array('http', 'https', 'mailto'), true)) {
            return true;
        }
        return $scheme === 'data' && (bool) preg_match('#^data:image/(png|jpe?g|gif|webp|avif|bmp);#', $url);
    }

    private static function is_dangerous_css($css)
    {
        return (bool) preg_match('/javascript:|vbscript:|expression\s*\(|-moz-binding|behavior\s*:/i', (string) $css);
    }
}
