<?php

if (!defined('ABSPATH')) {
    exit;
}

class RP_Admin
{
    /** @var RP_Plugin */
    private $plugin;

    public function __construct($plugin)
    {
        $this->plugin = $plugin;

        add_action('admin_menu', array($this, 'register_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_post_rp_upload_zip', array($this, 'handle_upload'));
        add_action('admin_post_rp_delete_presentation', array($this, 'handle_delete'));
    }

    public function register_menu()
    {
        add_menu_page(
            'REVELation',
            'REVELation',
            'manage_options',
            'rp_presentations',
            array($this, 'render_presentations_page'),
            'dashicons-format-gallery',
            56
        );

        add_submenu_page(
            'rp_presentations',
            'Presentations',
            'Presentations',
            'manage_options',
            'rp_presentations',
            array($this, 'render_presentations_page')
        );

        add_submenu_page(
            'rp_presentations',
            'Settings',
            'Settings',
            'manage_options',
            'rp_settings',
            array($this, 'render_settings_page')
        );
    }

    public function register_settings()
    {
        register_setting('rp_settings_group', RP_Plugin::OPTION_SETTINGS, array($this, 'sanitize_settings'));
    }

    public function sanitize_settings($input)
    {
        $defaults = RP_Plugin::default_settings();
        $input = is_array($input) ? $input : array();

        $clean = array();
        $clean['reveal_remote_url'] = esc_url_raw(isset($input['reveal_remote_url']) ? $input['reveal_remote_url'] : '');
        $clean['max_zip_mb'] = max(1, intval(isset($input['max_zip_mb']) ? $input['max_zip_mb'] : $defaults['max_zip_mb']));
        $clean['allow_embed'] = empty($input['allow_embed']) ? 0 : 1;
        $clean['use_db_index'] = empty($input['use_db_index']) ? 0 : 1;

        $raw_ext = strtolower((string) (isset($input['allowed_extensions']) ? $input['allowed_extensions'] : $defaults['allowed_extensions']));
        $parts = array_filter(array_map('trim', explode(',', $raw_ext)));
        $safe = array();
        foreach ($parts as $ext) {
            if (preg_match('/^[a-z0-9]{1,10}$/', $ext)) {
                $safe[] = $ext;
            }
        }
        $clean['allowed_extensions'] = implode(',', array_values(array_unique($safe)));
        if ($clean['allowed_extensions'] === '') {
            $clean['allowed_extensions'] = $defaults['allowed_extensions'];
        }

        return $clean;
    }

    public function handle_upload()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        check_admin_referer('rp_upload_zip');

        $redirect = admin_url('admin.php?page=rp_presentations');

        if (empty($_FILES['rp_zip'])) {
            wp_safe_redirect(add_query_arg(array('rp_notice' => 'missing_file'), $redirect));
            exit;
        }

        $slug = isset($_POST['rp_slug']) ? sanitize_text_field(wp_unslash($_POST['rp_slug'])) : '';
        $result = $this->plugin->storage->import_zip($_FILES['rp_zip'], $slug);

        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg(array(
                'rp_notice' => 'upload_error',
                'rp_message' => rawurlencode($result->get_error_message()),
            ), $redirect));
            exit;
        }

        wp_safe_redirect(add_query_arg(array(
            'rp_notice' => 'uploaded',
            'rp_slug' => rawurlencode($result['slug']),
        ), $redirect));
        exit;
    }

    public function handle_delete()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        check_admin_referer('rp_delete_presentation');

        $slug = isset($_POST['rp_slug']) ? sanitize_text_field(wp_unslash($_POST['rp_slug'])) : '';
        $result = $this->plugin->storage->delete_presentation($slug);

        $redirect = admin_url('admin.php?page=rp_presentations');
        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg(array(
                'rp_notice' => 'delete_error',
                'rp_message' => rawurlencode($result->get_error_message()),
            ), $redirect));
            exit;
        }

        wp_safe_redirect(add_query_arg(array('rp_notice' => 'deleted'), $redirect));
        exit;
    }

    public function render_presentations_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $presentations = $this->plugin->storage->list_presentations();
        $base_url = trailingslashit(home_url('/_revelation'));
        ?>
        <div class="wrap">
            <h1>REVELation Presentations</h1>
            <?php $this->render_notice(); ?>

            <h2>Upload Presentation ZIP</h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" enctype="multipart/form-data">
                <?php wp_nonce_field('rp_upload_zip'); ?>
                <input type="hidden" name="action" value="rp_upload_zip" />
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="rp_zip">REVELation ZIP</label></th>
                        <td><input type="file" name="rp_zip" id="rp_zip" accept=".zip" required /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rp_slug">Custom Slug (optional)</label></th>
                        <td><input type="text" name="rp_slug" id="rp_slug" class="regular-text" placeholder="my-presentation" /></td>
                    </tr>
                </table>
                <?php submit_button('Upload & Import'); ?>
            </form>

            <h2>Imported Presentations</h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Slug</th>
                        <th>Title</th>
                        <th>Direct URL</th>
                        <th>Shortcode</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($presentations)) : ?>
                    <tr><td colspan="5">No presentations imported yet.</td></tr>
                <?php else : ?>
                    <?php foreach ($presentations as $item) :
                        $slug = $item['slug'];
                        $first_md = !empty($item['md_files']) ? $item['md_files'][0] : 'presentation.md';
                        $direct_url = add_query_arg('p', $first_md, trailingslashit($base_url . $slug));
                        $shortcode = sprintf('[revelation slug="%s" md="%s" embed="1"]', esc_attr($slug), esc_attr($first_md));
                    ?>
                    <tr>
                        <td><code><?php echo esc_html($slug); ?></code></td>
                        <td><?php echo esc_html($item['title']); ?></td>
                        <td><a href="<?php echo esc_url($direct_url); ?>" target="_blank" rel="noopener noreferrer"><?php echo esc_html($direct_url); ?></a></td>
                        <td><code><?php echo esc_html($shortcode); ?></code></td>
                        <td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('Delete this presentation?');" style="display:inline;">
                                <?php wp_nonce_field('rp_delete_presentation'); ?>
                                <input type="hidden" name="action" value="rp_delete_presentation" />
                                <input type="hidden" name="rp_slug" value="<?php echo esc_attr($slug); ?>" />
                                <?php submit_button('Delete', 'delete small', '', false); ?>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    public function render_settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = $this->plugin->get_settings();
        ?>
        <div class="wrap">
            <h1>REVELation Settings</h1>
            <form method="post" action="options.php">
                <?php settings_fields('rp_settings_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="rp_reveal_remote_url">Reveal Remote URL</label></th>
                        <td>
                            <input type="url" id="rp_reveal_remote_url" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[reveal_remote_url]" value="<?php echo esc_attr($settings['reveal_remote_url']); ?>" class="regular-text" placeholder="https://remote.example.com" />
                            <p class="description">Optional Socket server URL used by runtime as <code>window.revealRemoteServer</code>.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rp_max_zip_mb">Max ZIP Size (MB)</label></th>
                        <td><input type="number" min="1" step="1" id="rp_max_zip_mb" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[max_zip_mb]" value="<?php echo esc_attr($settings['max_zip_mb']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rp_allowed_extensions">Allowed File Extensions</label></th>
                        <td>
                            <input type="text" id="rp_allowed_extensions" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[allowed_extensions]" value="<?php echo esc_attr($settings['allowed_extensions']); ?>" class="regular-text" />
                            <p class="description">Comma-separated whitelist for extracted files.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Allow Shortcode Embeds</th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[allow_embed]" value="1" <?php checked(!empty($settings['allow_embed'])); ?> /> Enable iframe embed output</label></td>
                    </tr>
                    <tr>
                        <th scope="row">Use DB Index</th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[use_db_index]" value="1" <?php checked(!empty($settings['use_db_index'])); ?> /> Use custom table index (fallback is filesystem scan)</label></td>
                    </tr>
                </table>
                <?php submit_button('Save Settings'); ?>
            </form>
        </div>
        <?php
    }

    private function render_notice()
    {
        if (empty($_GET['rp_notice'])) {
            return;
        }

        $notice = sanitize_text_field(wp_unslash($_GET['rp_notice']));
        $message = isset($_GET['rp_message']) ? sanitize_text_field(rawurldecode(wp_unslash($_GET['rp_message']))) : '';

        $class = 'notice notice-info';
        $text = '';

        if ($notice === 'uploaded') {
            $class = 'notice notice-success';
            $slug = isset($_GET['rp_slug']) ? sanitize_text_field(rawurldecode(wp_unslash($_GET['rp_slug']))) : '';
            $text = $slug ? sprintf('Imported presentation: %s', $slug) : 'Presentation imported.';
        } elseif ($notice === 'deleted') {
            $class = 'notice notice-success';
            $text = 'Presentation deleted.';
        } elseif ($notice === 'missing_file') {
            $class = 'notice notice-error';
            $text = 'Please select a ZIP file.';
        } elseif ($notice === 'upload_error') {
            $class = 'notice notice-error';
            $text = $message ?: 'Upload/import failed.';
        } elseif ($notice === 'delete_error') {
            $class = 'notice notice-error';
            $text = $message ?: 'Delete failed.';
        }

        if ($text) {
            printf('<div class="%s"><p>%s</p></div>', esc_attr($class), esc_html($text));
        }
    }
}
