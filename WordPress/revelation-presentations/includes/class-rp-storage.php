<?php
/**
 * Presentation storage and import logic.
 *
 * @license MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

class RP_Storage
{
    /** @var RP_Plugin */
    private $plugin;

    /**
     * Store the parent plugin reference for settings and shared helpers.
     */
    public function __construct($plugin)
    {
        $this->plugin = $plugin;
    }

    /**
     * Return the uploads-based root directory for hosted presentation data.
     */
    public function base_dir()
    {
        $uploads = wp_upload_dir();
        $base = trailingslashit($uploads['basedir']) . 'revelation-presentations';
        if (!is_dir($base)) {
            wp_mkdir_p($base);
        }
        return $base;
    }

    /**
     * Sanitize a presentation slug to a WordPress-safe directory key.
     */
    public function sanitize_slug($value)
    {
        $slug = sanitize_title((string) $value);
        return trim($slug);
    }

    /**
     * Validate a relative markdown path while blocking traversal and non-markdown targets.
     */
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

    /**
     * Resolve the absolute directory path for a hosted presentation slug.
     */
    public function presentation_dir($slug)
    {
        $slug = $this->sanitize_slug($slug);
        if (!$slug) {
            return null;
        }
        return trailingslashit($this->base_dir()) . $slug;
    }

    /**
     * Return the shared media directory used by desktop media sync.
     */
    public function shared_media_dir()
    {
        $dir = trailingslashit($this->base_dir()) . '_shared_media';
        if (!is_dir($dir)) {
            wp_mkdir_p($dir);
        }
        return $dir;
    }

    /**
     * Return the public uploads URL for the shared media mirror.
     */
    public function shared_media_url()
    {
        $uploads = wp_upload_dir();
        return trailingslashit($uploads['baseurl']) . 'revelation-presentations/_shared_media';
    }

    /**
     * List hosted presentations using the DB index when enabled, with filesystem fallback.
     */
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

    /**
     * Read presentation metadata from the custom index table and verify the folders still exist.
     */
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

    /**
     * Scan the uploads directory directly when the DB index is unavailable or empty.
     */
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

    /**
     * Recursively collect markdown entry files from a hosted presentation directory.
     */
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

    /**
     * Read a markdown file from a hosted presentation after path validation.
     */
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

    /**
     * Rename a hosted presentation: moves the directory and updates the index.
     * Does NOT update publish maps — the caller is responsible for that.
     */
    public function rename_presentation($old_slug, $new_slug)
    {
        $old = $this->sanitize_slug($old_slug);
        $new = $this->sanitize_slug($new_slug);

        if (!$old || !$new) {
            return new WP_Error('invalid_slug', 'Invalid slug.');
        }
        if ($old === $new) {
            return new WP_Error('same_slug', 'The new slug is the same as the current one.');
        }

        $old_dir = $this->presentation_dir($old);
        if (!$old_dir || !is_dir($old_dir)) {
            return new WP_Error('missing', 'Presentation folder not found.');
        }

        $new_dir = $this->presentation_dir($new);
        if (!$new_dir) {
            return new WP_Error('invalid_dest', 'Could not resolve destination path.');
        }
        if (is_dir($new_dir) || file_exists($new_dir)) {
            return new WP_Error('slug_taken', sprintf('A presentation with the slug "%s" already exists.', $new));
        }

        if (!rename($old_dir, $new_dir)) {
            return new WP_Error('rename_failed', 'Could not rename the presentation directory. Check filesystem permissions.');
        }

        $this->rename_slug_in_index($old, $new);

        return true;
    }

    /**
     * Update the slug and folder_name in the index table when a presentation is renamed.
     */
    private function rename_slug_in_index($old_slug, $new_slug)
    {
        global $wpdb;
        $table = RP_Plugin::table_name();
        $wpdb->update(
            $table,
            array(
                'slug'        => $new_slug,
                'folder_name' => $new_slug,
                'updated_at'  => current_time('mysql', true),
            ),
            array('slug' => $old_slug),
            array('%s', '%s', '%s'),
            array('%s')
        );
    }

    /**
     * Delete a hosted presentation directory and remove its index entry.
     */
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

    /**
     * Clear and recreate the shared media mirror directory.
     */
    public function purge_shared_media()
    {
        $dir = $this->shared_media_dir();
        if (!$dir || !is_dir($dir)) {
            return true;
        }

        $this->delete_tree($dir);
        wp_mkdir_p($dir);

        return true;
    }

    /**
     * Ensure derived runtime assets exist inside an imported presentation directory.
     */
    public function ensure_runtime_assets_for_slug($slug)
    {
        $dir = $this->presentation_dir($slug);
        if (!$dir || !is_dir($dir)) {
            return;
        }
        $this->ensure_runtime_css_bundle($dir);
    }

    /**
     * Import a presentation ZIP with path validation, file filtering, and index updates.
     */
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

    /**
     * Decide whether a ZIP entry is safe and permitted to be extracted.
     */
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

    /**
     * Parse the configured extension allowlist and apply sane defaults.
     */
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
            $safe = array('md', 'yml', 'yaml', 'json', 'css', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'avif', 'mp3', 'wav', 'm4a', 'pdf');
        }
        $safe[] = 'css';
        return array_values(array_unique($safe));
    }

    /**
     * Copy the plugin's runtime CSS bundle into an imported presentation package.
     */
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

    /**
     * Recursively copy a directory tree, creating destination folders as needed.
     */
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

    /**
     * Normalize a ZIP entry path and reject traversal or malformed segments.
     */
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

    /**
     * Join a relative path to a trusted base directory while preventing escape.
     */
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

    /**
     * Normalize an absolute path by collapsing dot segments.
     */
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

    /**
     * Find an unused slug on disk by appending a numeric suffix when needed.
     */
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

    /**
     * Insert or update a presentation row in the custom index table.
     */
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

    /**
     * Remove a presentation row from the custom index table.
     */
    private function delete_index($slug)
    {
        global $wpdb;
        $table = RP_Plugin::table_name();
        $wpdb->delete($table, array('slug' => $slug), array('%s'));
    }

    /**
     * Derive a human title from markdown front matter or the first H1 heading.
     */
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

    /**
     * Recursively delete a directory tree used by hosted presentation storage.
     */
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
