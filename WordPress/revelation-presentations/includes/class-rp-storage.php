<?php

if (!defined('ABSPATH')) {
    exit;
}

class RP_Storage
{
    /** @var RP_Plugin */
    private $plugin;

    public function __construct($plugin)
    {
        $this->plugin = $plugin;
    }

    public function base_dir()
    {
        $uploads = wp_upload_dir();
        $base = trailingslashit($uploads['basedir']) . 'revelation-presentations';
        if (!is_dir($base)) {
            wp_mkdir_p($base);
        }
        return $base;
    }

    public function sanitize_slug($value)
    {
        $slug = sanitize_title((string) $value);
        return trim($slug);
    }

    public function sanitize_markdown_rel_path($value)
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        $path = str_replace('\\', '/', $raw);
        $path = preg_replace('/\?.*$/', '', $path);
        $path = preg_replace('/#.*$/', '', $path);
        $path = preg_replace('/^\.\//', '', $path);

        if ($path === '' || strpos($path, '/') === 0) {
            return null;
        }

        $segments = explode('/', $path);
        foreach ($segments as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return null;
            }
            if (preg_match('/[\x00-\x1F\x7F]/', $segment)) {
                return null;
            }
        }

        $leaf = end($segments);
        if (!preg_match('/\.md$/i', (string) $leaf)) {
            return null;
        }

        return implode('/', $segments);
    }

    public function presentation_dir($slug)
    {
        $slug = $this->sanitize_slug($slug);
        if (!$slug) {
            return null;
        }
        return trailingslashit($this->base_dir()) . $slug;
    }

    public function list_presentations()
    {
        $settings = $this->plugin->get_settings();
        $use_db = !empty($settings['use_db_index']);

        if ($use_db) {
            $items = $this->list_from_db();
            if (!empty($items)) {
                return $items;
            }
        }

        return $this->list_from_filesystem();
    }

    private function list_from_db()
    {
        global $wpdb;
        $table = RP_Plugin::table_name();
        $rows = $wpdb->get_results("SELECT * FROM {$table} ORDER BY updated_at DESC", ARRAY_A);
        if (!is_array($rows)) {
            return array();
        }

        $result = array();
        foreach ($rows as $row) {
            $slug = isset($row['slug']) ? $this->sanitize_slug($row['slug']) : '';
            if (!$slug) {
                continue;
            }
            $dir = $this->presentation_dir($slug);
            if (!$dir || !is_dir($dir)) {
                continue;
            }
            $md_files = $this->collect_markdown_files($dir);
            $result[] = array(
                'slug' => $slug,
                'title' => $row['title'] ?: $slug,
                'md_files' => $md_files,
                'updated_at' => $row['updated_at'],
            );
        }

        return $result;
    }

    private function list_from_filesystem()
    {
        $base = $this->base_dir();
        if (!is_dir($base)) {
            return array();
        }

        $entries = scandir($base);
        if (!is_array($entries)) {
            return array();
        }

        $presentations = array();
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $slug = $this->sanitize_slug($entry);
            if (!$slug || $slug !== $entry) {
                continue;
            }
            $dir = trailingslashit($base) . $entry;
            if (!is_dir($dir)) {
                continue;
            }
            $md_files = $this->collect_markdown_files($dir);
            if (empty($md_files)) {
                continue;
            }
            $title = $this->extract_title_from_markdown($dir, $md_files[0]);
            $presentations[] = array(
                'slug' => $slug,
                'title' => $title ?: $slug,
                'md_files' => $md_files,
                'updated_at' => gmdate('Y-m-d H:i:s', filemtime($dir) ?: time()),
            );
        }

        usort($presentations, function ($a, $b) {
            return strcmp((string) $b['updated_at'], (string) $a['updated_at']);
        });

        return $presentations;
    }

    public function collect_markdown_files($dir)
    {
        $files = array();
        if (!is_dir($dir)) {
            return $files;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );

        $base = rtrim(str_replace('\\', '/', realpath($dir)), '/');
        foreach ($iterator as $item) {
            if (!$item->isFile()) {
                continue;
            }
            $path = str_replace('\\', '/', $item->getPathname());
            if (!preg_match('/\.md$/i', $path)) {
                continue;
            }
            $relative = ltrim(substr($path, strlen($base)), '/');
            if ($this->sanitize_markdown_rel_path($relative) === null) {
                continue;
            }
            if (basename($relative) === '__builder_temp.md') {
                continue;
            }
            $files[] = $relative;
        }

        sort($files, SORT_NATURAL | SORT_FLAG_CASE);
        return $files;
    }

    public function read_markdown($slug, $md_rel)
    {
        $dir = $this->presentation_dir($slug);
        if (!$dir || !is_dir($dir)) {
            return null;
        }

        $sanitized = $this->sanitize_markdown_rel_path($md_rel);
        if (!$sanitized) {
            return null;
        }

        $target = $this->safe_join($dir, $sanitized);
        if (!$target || !is_file($target)) {
            return null;
        }

        return file_get_contents($target);
    }

    public function delete_presentation($slug)
    {
        $slug = $this->sanitize_slug($slug);
        if (!$slug) {
            return new WP_Error('invalid_slug', 'Invalid presentation slug.');
        }

        $dir = $this->presentation_dir($slug);
        if (!$dir || !is_dir($dir)) {
            return new WP_Error('missing', 'Presentation folder not found.');
        }

        $this->delete_tree($dir);
        $this->delete_index($slug);

        return true;
    }

    public function ensure_runtime_assets_for_slug($slug)
    {
        $dir = $this->presentation_dir($slug);
        if (!$dir || !is_dir($dir)) {
            return;
        }
        $this->ensure_runtime_css_bundle($dir);
    }

    public function import_zip($file_info, $requested_slug = '')
    {
        if (empty($file_info['tmp_name']) || !is_uploaded_file($file_info['tmp_name'])) {
            return new WP_Error('invalid_upload', 'No uploaded ZIP file found.');
        }

        $name = isset($file_info['name']) ? (string) $file_info['name'] : 'presentation.zip';
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($ext !== 'zip') {
            return new WP_Error('invalid_ext', 'Only ZIP uploads are supported.');
        }

        $settings = $this->plugin->get_settings();
        $max_mb = max(1, intval($settings['max_zip_mb']));
        $max_bytes = $max_mb * 1024 * 1024;
        $size = isset($file_info['size']) ? intval($file_info['size']) : 0;
        if ($size > $max_bytes) {
            return new WP_Error('too_large', sprintf('ZIP exceeds max size (%d MB).', $max_mb));
        }

        $slug_base = $requested_slug ? $this->sanitize_slug($requested_slug) : $this->sanitize_slug(pathinfo($name, PATHINFO_FILENAME));
        if (!$slug_base) {
            $slug_base = 'presentation';
        }
        $slug = $this->find_available_slug($slug_base);

        $dest_dir = $this->presentation_dir($slug);
        if (!$dest_dir) {
            return new WP_Error('invalid_dest', 'Could not resolve destination path.');
        }

        wp_mkdir_p($dest_dir);

        $allowed_extensions = $this->allowed_extensions_from_settings($settings);
        $zip = new ZipArchive();
        if ($zip->open($file_info['tmp_name']) !== true) {
            $this->delete_tree($dest_dir);
            return new WP_Error('zip_open', 'Could not open ZIP archive.');
        }

        try {
            $extracted = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry_name = $zip->getNameIndex($i);
                $norm = $this->normalize_zip_entry($entry_name);
                if ($norm === null || substr($norm, -1) === '/') {
                    continue;
                }

                if (!$this->should_extract_entry($norm, $allowed_extensions)) {
                    continue;
                }

                $target = $this->safe_join($dest_dir, $norm);
                if (!$target) {
                    throw new RuntimeException('Unsafe ZIP path detected: ' . $entry_name);
                }

                $content = $zip->getFromIndex($i);
                if ($content === false) {
                    continue;
                }

                $parent = dirname($target);
                if (!is_dir($parent)) {
                    wp_mkdir_p($parent);
                }

                file_put_contents($target, $content);
                $extracted++;
            }
            $zip->close();

            if ($extracted < 1) {
                throw new RuntimeException('ZIP produced no allowed files after sanitization.');
            }

            $this->ensure_runtime_css_bundle($dest_dir);

            $md_files = $this->collect_markdown_files($dest_dir);
            if (empty($md_files)) {
                throw new RuntimeException('No markdown files found after import.');
            }

            $title = $this->extract_title_from_markdown($dest_dir, $md_files[0]);
            $this->upsert_index(array(
                'slug' => $slug,
                'title' => $title ?: $slug,
                'folder_name' => $slug,
                'source_zip' => sanitize_text_field($name),
                'presentation_count' => count($md_files),
            ));

            return array(
                'slug' => $slug,
                'title' => $title ?: $slug,
                'md_files' => $md_files,
            );
        } catch (Throwable $e) {
            $zip->close();
            $this->delete_tree($dest_dir);
            return new WP_Error('import_failed', $e->getMessage());
        }
    }

    private function should_extract_entry($rel_path, $allowed_extensions)
    {
        $rel_path = ltrim(str_replace('\\', '/', $rel_path), '/');
        $lower = strtolower($rel_path);

        if (preg_match('/\.html?$/i', $lower)) {
            return false;
        }

        if (strpos($lower, '_resources/') === 0) {
            if (strpos($lower, '_resources/_media/') !== 0) {
                return false;
            }
        }

        $basename = basename($lower);
        if ($basename === '' || strpos($basename, '.') === false) {
            return false;
        }

        $ext = strtolower(pathinfo($basename, PATHINFO_EXTENSION));
        return in_array($ext, $allowed_extensions, true);
    }

    private function allowed_extensions_from_settings($settings)
    {
        $raw = isset($settings['allowed_extensions']) ? strtolower((string) $settings['allowed_extensions']) : '';
        $parts = array_filter(array_map('trim', explode(',', $raw)));
        $safe = array();
        foreach ($parts as $ext) {
            if (preg_match('/^[a-z0-9]{1,10}$/', $ext)) {
                $safe[] = $ext;
            }
        }
        if (empty($safe)) {
            $safe = array('md', 'yml', 'yaml', 'json', 'css', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'pdf');
        }
        $safe[] = 'css';
        return array_values(array_unique($safe));
    }

    private function ensure_runtime_css_bundle($dest_dir)
    {
        $src_css_dir = RP_PLUGIN_DIR . 'assets/runtime/css';
        if (!is_dir($src_css_dir)) {
            throw new RuntimeException('Runtime CSS bundle not found in plugin assets.');
        }

        $dest_css_dir = trailingslashit($dest_dir) . '_resources/css';
        if (!is_dir($dest_css_dir)) {
            wp_mkdir_p($dest_css_dir);
        }

        $this->copy_directory($src_css_dir, $dest_css_dir);
    }

    private function copy_directory($source, $destination)
    {
        if (!is_dir($source)) {
            return;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );

        $source_real = rtrim(str_replace('\\', '/', realpath($source)), '/');
        foreach ($iterator as $item) {
            $item_path = str_replace('\\', '/', $item->getPathname());
            $relative = ltrim(substr($item_path, strlen($source_real)), '/');
            if ($relative === '') {
                continue;
            }

            $dest_path = trailingslashit($destination) . $relative;
            if ($item->isDir()) {
                if (!is_dir($dest_path)) {
                    wp_mkdir_p($dest_path);
                }
                continue;
            }

            $parent = dirname($dest_path);
            if (!is_dir($parent)) {
                wp_mkdir_p($parent);
            }
            copy($item_path, $dest_path);
        }
    }

    private function normalize_zip_entry($name)
    {
        $path = str_replace('\\', '/', (string) $name);
        $path = preg_replace('#^\./+#', '', $path);
        $path = ltrim($path, '/');
        if ($path === '' || strpos($path, "\0") !== false) {
            return null;
        }

        $segments = explode('/', $path);
        foreach ($segments as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return null;
            }
        }

        return implode('/', $segments);
    }

    private function safe_join($base_dir, $rel)
    {
        $base = rtrim(str_replace('\\', '/', realpath($base_dir) ?: $base_dir), '/');
        $target = $base . '/' . ltrim(str_replace('\\', '/', $rel), '/');
        $norm = $this->normalize_abs_path($target);
        if (strpos($norm, $base . '/') !== 0) {
            return null;
        }
        return $norm;
    }

    private function normalize_abs_path($path)
    {
        $path = str_replace('\\', '/', $path);
        $parts = array();
        foreach (explode('/', $path) as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                array_pop($parts);
                continue;
            }
            $parts[] = $part;
        }
        return (strpos($path, '/') === 0 ? '/' : '') . implode('/', $parts);
    }

    private function find_available_slug($base)
    {
        $slug = $base;
        $i = 1;
        while (is_dir($this->presentation_dir($slug))) {
            $slug = $base . '-' . $i;
            $i++;
            if ($i > 9999) {
                $slug = $base . '-' . time();
                break;
            }
        }
        return $slug;
    }

    public function upsert_index($data)
    {
        global $wpdb;
        $table = RP_Plugin::table_name();

        $slug = $this->sanitize_slug(isset($data['slug']) ? $data['slug'] : '');
        if (!$slug) {
            return;
        }

        $now = current_time('mysql', true);
        $row = array(
            'slug' => $slug,
            'title' => isset($data['title']) ? sanitize_text_field($data['title']) : $slug,
            'folder_name' => isset($data['folder_name']) ? sanitize_text_field($data['folder_name']) : $slug,
            'source_zip' => isset($data['source_zip']) ? sanitize_text_field($data['source_zip']) : '',
            'presentation_count' => isset($data['presentation_count']) ? intval($data['presentation_count']) : 0,
            'updated_at' => $now,
        );

        $existing = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$table} WHERE slug = %s", $slug));
        if ($existing) {
            $wpdb->update($table, $row, array('id' => $existing));
        } else {
            $row['created_at'] = $now;
            $wpdb->insert($table, $row);
        }
    }

    private function delete_index($slug)
    {
        global $wpdb;
        $table = RP_Plugin::table_name();
        $wpdb->delete($table, array('slug' => $slug), array('%s'));
    }

    public function extract_title_from_markdown($dir, $md_rel)
    {
        $target = $this->safe_join($dir, $md_rel);
        if (!$target || !is_file($target)) {
            return null;
        }

        $content = file_get_contents($target);
        if (!is_string($content) || $content === '') {
            return null;
        }

        if (preg_match('/^---\R([\s\S]*?)\R---\R?/m', $content, $fm_match)) {
            if (preg_match('/^title\s*:\s*(.+)$/mi', $fm_match[1], $title_match)) {
                $title = trim((string) $title_match[1]);
                $title = trim($title, "\"' ");
                if ($title !== '') {
                    return sanitize_text_field($title);
                }
            }
        }

        if (preg_match('/^#\s+(.+)$/m', $content, $h1_match)) {
            return sanitize_text_field(trim((string) $h1_match[1]));
        }

        return null;
    }

    private function delete_tree($dir)
    {
        if (!is_dir($dir)) {
            return;
        }

        $items = scandir($dir);
        if (!is_array($items)) {
            @rmdir($dir);
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            if (is_dir($path)) {
                $this->delete_tree($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($dir);
    }
}
