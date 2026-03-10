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
        add_action('admin_post_rp_approve_pair_request', array($this, 'handle_approve_pair_request'));
        add_action('admin_post_rp_reject_pair_request', array($this, 'handle_reject_pair_request'));
        add_action('admin_post_rp_delete_paired_client', array($this, 'handle_delete_paired_client'));
        add_action('wp_ajax_rp_pairing_poll', array($this, 'handle_pairing_poll'));
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
        $clean['max_publish_request_mb'] = max(0, intval(isset($input['max_publish_request_mb']) ? $input['max_publish_request_mb'] : $defaults['max_publish_request_mb']));
        $clean['allow_embed'] = empty($input['allow_embed']) ? 0 : 1;
        $clean['show_splash_screen'] = empty($input['show_splash_screen']) ? 0 : 1;
        $clean['use_db_index'] = empty($input['use_db_index']) ? 0 : 1;
        $clean['enabled_runtime_plugins'] = array();

        $catalog = RP_Plugin::hosted_runtime_plugin_catalog();
        $requested_runtime_plugins = isset($input['enabled_runtime_plugins']) && is_array($input['enabled_runtime_plugins'])
            ? $input['enabled_runtime_plugins']
            : array();
        foreach ($requested_runtime_plugins as $slug) {
            $key = sanitize_key((string) $slug);
            if ($key !== '' && isset($catalog[$key])) {
                $clean['enabled_runtime_plugins'][] = $key;
            }
        }
        $clean['enabled_runtime_plugins'] = array_values(array_unique($clean['enabled_runtime_plugins']));

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
                        $shortcode = sprintf('[revelation slug="%s" md="%s" width="640px" height="360px"]', esc_attr($slug), esc_attr($first_md));
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
        $runtime_catalog = RP_Plugin::hosted_runtime_plugin_catalog();
        $enabled_runtime_plugins = $this->plugin->get_enabled_hosted_runtime_plugins();
        $pending_requests = method_exists($this->plugin->api, 'list_pair_requests')
            ? $this->plugin->api->list_pair_requests()
            : array();
        $pending_requests = array_values(array_filter($pending_requests, function ($item) {
            return ($item['status'] ?? '') === 'pending';
        }));
        $paired_clients = method_exists($this->plugin->api, 'list_paired_clients')
            ? $this->plugin->api->list_paired_clients()
            : array();
        $pairing_snapshot = $this->build_pairing_snapshot($pending_requests, $paired_clients);
        $poll_nonce = wp_create_nonce('rp_pairing_poll');
        ?>
        <div class="wrap">
            <h1>REVELation Settings</h1>
            <?php $this->render_notice(); ?>
            <form method="post" action="options.php">
                <?php settings_fields('rp_settings_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="rp_reveal_remote_url">Reveal Remote URL</label></th>
                        <td>
                            <input type="url" id="rp_reveal_remote_url" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[reveal_remote_url]" value="<?php echo esc_attr($settings['reveal_remote_url']); ?>" class="regular-text" placeholder="https://remote.example.com" />
                            <p class="description">Socket server URL used by runtime as <code>window.revealRemoteServer</code>. Default: <code>https://revealremote.fiforms.org/</code>. The hosted runtime also derives <code>window.presenterPluginsPublicServer</code> from this value using <code>/presenter-plugins-socket</code>.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rp_max_zip_mb">Max ZIP Size (MB)</label></th>
                        <td><input type="number" min="1" step="1" id="rp_max_zip_mb" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[max_zip_mb]" value="<?php echo esc_attr($settings['max_zip_mb']); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="rp_max_publish_request_mb">Max Publish Upload Request (MB)</label></th>
                        <td>
                            <input type="number" min="0" step="1" id="rp_max_publish_request_mb" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[max_publish_request_mb]" value="<?php echo esc_attr($settings['max_publish_request_mb']); ?>" />
                            <p class="description">Optional hard cap advertised to desktop clients for each `/publish/file` request. `0` means auto-detect from PHP limits only.</p>
                        </td>
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
                        <th scope="row">Show Splash Screen</th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[show_splash_screen]" value="1" <?php checked(!empty($settings['show_splash_screen'])); ?> /> Show the REVELation splash screen before each hosted presentation loads</label></td>
                    </tr>
                    <tr>
                        <th scope="row">Use DB Index</th>
                        <td><label><input type="checkbox" name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[use_db_index]" value="1" <?php checked(!empty($settings['use_db_index'])); ?> /> Use custom table index (fallback is filesystem scan)</label></td>
                    </tr>
                    <tr>
                        <th scope="row">Desktop Pairing URL</th>
                        <td>
                            <?php $desktop_pairing_url = rest_url('revelation/v1/pair'); ?>
                            <code id="rp-desktop-pair-url"><?php echo esc_html($desktop_pairing_url); ?></code>
                            <button type="button" id="rp-copy-pair-url-btn" class="button" style="margin-left:0.5rem;">Copy URL</button>
                            <p class="description">Use this URL (or site base URL) in REVELation WordPress Pairing. Pairing currently uses RSA challenge-response only. HTTPS is strongly recommended; HTTP exposes pairing and publish traffic to interception and replay on the network.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Hosted Runtime Plugins</th>
                        <td>
                            <?php foreach ($runtime_catalog as $slug => $plugin_meta) : ?>
                                <label style="display:block;margin-bottom:0.5rem;">
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(RP_Plugin::OPTION_SETTINGS); ?>[enabled_runtime_plugins][]"
                                        value="<?php echo esc_attr($slug); ?>"
                                        <?php checked(in_array($slug, $enabled_runtime_plugins, true)); ?>
                                    />
                                    <strong><?php echo esc_html((string) ($plugin_meta['label'] ?? $slug)); ?></strong>
                                    <span style="opacity:0.8;"><?php echo esc_html((string) ($plugin_meta['description'] ?? '')); ?></span>
                                </label>
                            <?php endforeach; ?>
                            <p class="description">Enabled plugins are loaded for every hosted presentation and embed rendered by this WordPress plugin.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Settings'); ?>
            </form>

            <h2>Pending Pairing Requests</h2>
            <p><strong>Pairing message:</strong> Pairing attempt from (IP) (claimed hostname) (One-time Code). Do you want to fully trust this software to upload and publish presentations?</p>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Requested</th>
                        <th>IP</th>
                        <th>Claimed Hostname</th>
                        <th>Claimed Name</th>
                        <th>Instance ID</th>
                        <th>One-time Code</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($pending_requests)) : ?>
                    <tr><td colspan="7">No pending pairing requests.</td></tr>
                <?php else : ?>
                    <?php foreach ($pending_requests as $request) : ?>
                    <tr>
                        <td><?php echo esc_html((string) ($request['created_at'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($request['request_ip'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($request['claimed_hostname'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($request['client_name'] ?? '')); ?></td>
                        <td><code><?php echo esc_html((string) ($request['client_instance_id'] ?? '')); ?></code></td>
                        <td><strong><?php echo esc_html((string) ($request['one_time_code'] ?? '')); ?></strong></td>
                        <td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline;">
                                <?php wp_nonce_field('rp_approve_pair_request'); ?>
                                <input type="hidden" name="action" value="rp_approve_pair_request" />
                                <input type="hidden" name="request_id" value="<?php echo esc_attr((string) ($request['request_id'] ?? '')); ?>" />
                                <?php submit_button('Approve', 'primary small', '', false); ?>
                            </form>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline;margin-left:0.25rem;">
                                <?php wp_nonce_field('rp_reject_pair_request'); ?>
                                <input type="hidden" name="action" value="rp_reject_pair_request" />
                                <input type="hidden" name="request_id" value="<?php echo esc_attr((string) ($request['request_id'] ?? '')); ?>" />
                                <?php submit_button('Reject', 'secondary small', '', false); ?>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>

            <h2 style="margin-top:1.25rem;">Paired Instances</h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Paired At</th>
                        <th>IP</th>
                        <th>Claimed Hostname</th>
                        <th>Claimed Name</th>
                        <th>Instance ID</th>
                        <th>Pairing ID</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($paired_clients)) : ?>
                    <tr><td colspan="7">No paired instances.</td></tr>
                <?php else : ?>
                    <?php foreach ($paired_clients as $item) : ?>
                    <tr>
                        <td><?php echo esc_html((string) ($item['approved_at'] ?? $item['paired_at'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($item['request_ip'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($item['claimed_hostname'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($item['client_name'] ?? '')); ?></td>
                        <td><code><?php echo esc_html((string) ($item['client_instance_id'] ?? '')); ?></code></td>
                        <td><code><?php echo esc_html((string) ($item['pairing_id'] ?? '')); ?></code></td>
                        <td>
                            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('Delete this paired instance?');" style="display:inline;">
                                <?php wp_nonce_field('rp_delete_paired_client'); ?>
                                <input type="hidden" name="action" value="rp_delete_paired_client" />
                                <input type="hidden" name="pairing_id" value="<?php echo esc_attr((string) ($item['pairing_id'] ?? '')); ?>" />
                                <?php submit_button('Delete', 'delete small', '', false); ?>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>

            <script>
              (function() {
                const pollNonce = <?php echo wp_json_encode($poll_nonce); ?>;
                let lastSnapshot = <?php echo wp_json_encode($pairing_snapshot); ?>;
                let pollTimer = null;
                const pollEveryMs = 3000;
                const copyBtn = document.getElementById('rp-copy-pair-url-btn');
                const copyUrlEl = document.getElementById('rp-desktop-pair-url');

                async function copyPairingUrl() {
                  if (!copyBtn || !copyUrlEl) return;
                  const urlText = String(copyUrlEl.textContent || '').trim();
                  if (!urlText) return;
                  const originalLabel = copyBtn.textContent;
                  try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      await navigator.clipboard.writeText(urlText);
                    } else {
                      const input = document.createElement('textarea');
                      input.value = urlText;
                      input.setAttribute('readonly', '');
                      input.style.position = 'absolute';
                      input.style.left = '-9999px';
                      document.body.appendChild(input);
                      input.select();
                      document.execCommand('copy');
                      document.body.removeChild(input);
                    }
                    copyBtn.textContent = 'Copied!';
                    window.setTimeout(() => {
                      copyBtn.textContent = originalLabel;
                    }, 1200);
                  } catch (_err) {
                    copyBtn.textContent = 'Copy Failed';
                    window.setTimeout(() => {
                      copyBtn.textContent = originalLabel;
                    }, 1600);
                  }
                }

                async function pollPairingUpdates() {
                  if (document.hidden) return;
                  try {
                    const url = `${ajaxurl}?action=rp_pairing_poll&_ajax_nonce=${encodeURIComponent(pollNonce)}`;
                    const response = await fetch(url, {
                      method: 'GET',
                      credentials: 'same-origin',
                      headers: { 'Accept': 'application/json' }
                    });
                    if (!response.ok) return;
                    const payload = await response.json();
                    if (!payload || payload.success !== true || !payload.data) return;
                    const nextSnapshot = String(payload.data.snapshot || '');
                    if (nextSnapshot && lastSnapshot && nextSnapshot !== lastSnapshot) {
                      window.location.reload();
                      return;
                    }
                    if (nextSnapshot) {
                      lastSnapshot = nextSnapshot;
                    }
                  } catch (_err) {
                    // Ignore transient polling errors.
                  }
                }

                pollTimer = window.setInterval(pollPairingUpdates, pollEveryMs);
                if (copyBtn) {
                  copyBtn.addEventListener('click', copyPairingUrl);
                }
                document.addEventListener('visibilitychange', function() {
                  if (!document.hidden) {
                    pollPairingUpdates();
                  }
                });
                window.addEventListener('beforeunload', function() {
                  if (pollTimer) window.clearInterval(pollTimer);
                });
              })();
            </script>
        </div>
        <?php
    }

    public function handle_pairing_poll()
    {
        if (!current_user_can('manage_options')) {
            wp_send_json_error(array('message' => 'Unauthorized'), 403);
        }
        check_ajax_referer('rp_pairing_poll');

        $pending_requests = method_exists($this->plugin->api, 'list_pair_requests')
            ? $this->plugin->api->list_pair_requests()
            : array();
        $pending_requests = array_values(array_filter($pending_requests, function ($item) {
            return ($item['status'] ?? '') === 'pending';
        }));

        $paired_clients = method_exists($this->plugin->api, 'list_paired_clients')
            ? $this->plugin->api->list_paired_clients()
            : array();

        wp_send_json_success(array(
            'snapshot' => $this->build_pairing_snapshot($pending_requests, $paired_clients),
            'pendingCount' => count($pending_requests),
            'pairedCount' => count($paired_clients),
        ));
    }

    private function build_pairing_snapshot($pending_requests, $paired_clients)
    {
        $pending = is_array($pending_requests) ? $pending_requests : array();
        $paired = is_array($paired_clients) ? $paired_clients : array();
        $shape = array(
            'pending' => array_map(function ($item) {
                return array(
                    'request_id' => (string) ($item['request_id'] ?? ''),
                    'status' => (string) ($item['status'] ?? ''),
                    'updated_at' => (string) ($item['updated_at'] ?? ''),
                    'one_time_code' => (string) ($item['one_time_code'] ?? ''),
                );
            }, $pending),
            'paired' => array_map(function ($item) {
                return array(
                    'pairing_id' => (string) ($item['pairing_id'] ?? ''),
                    'approved_at' => (string) ($item['approved_at'] ?? ''),
                    'updated_at' => (string) ($item['updated_at'] ?? ''),
                );
            }, $paired),
        );
        return hash('sha256', wp_json_encode($shape));
    }

    public function handle_approve_pair_request()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        check_admin_referer('rp_approve_pair_request');
        $request_id = isset($_POST['request_id']) ? sanitize_text_field(wp_unslash($_POST['request_id'])) : '';
        $result = method_exists($this->plugin->api, 'approve_pair_request')
            ? $this->plugin->api->approve_pair_request($request_id)
            : new WP_Error('unsupported', 'Pair API not available.');

        $redirect = admin_url('admin.php?page=rp_settings');
        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg(array(
                'rp_notice' => 'pair_error',
                'rp_message' => rawurlencode($result->get_error_message()),
            ), $redirect));
            exit;
        }
        wp_safe_redirect(add_query_arg(array('rp_notice' => 'pair_approved'), $redirect));
        exit;
    }

    public function handle_reject_pair_request()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        check_admin_referer('rp_reject_pair_request');
        $request_id = isset($_POST['request_id']) ? sanitize_text_field(wp_unslash($_POST['request_id'])) : '';
        $result = method_exists($this->plugin->api, 'reject_pair_request')
            ? $this->plugin->api->reject_pair_request($request_id)
            : new WP_Error('unsupported', 'Pair API not available.');

        $redirect = admin_url('admin.php?page=rp_settings');
        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg(array(
                'rp_notice' => 'pair_error',
                'rp_message' => rawurlencode($result->get_error_message()),
            ), $redirect));
            exit;
        }
        wp_safe_redirect(add_query_arg(array('rp_notice' => 'pair_rejected'), $redirect));
        exit;
    }

    public function handle_delete_paired_client()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Unauthorized');
        }
        check_admin_referer('rp_delete_paired_client');
        $pairing_id = isset($_POST['pairing_id']) ? sanitize_text_field(wp_unslash($_POST['pairing_id'])) : '';
        $result = method_exists($this->plugin->api, 'delete_paired_client')
            ? $this->plugin->api->delete_paired_client($pairing_id)
            : new WP_Error('unsupported', 'Pair API not available.');

        $redirect = admin_url('admin.php?page=rp_settings');
        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg(array(
                'rp_notice' => 'pair_error',
                'rp_message' => rawurlencode($result->get_error_message()),
            ), $redirect));
            exit;
        }
        wp_safe_redirect(add_query_arg(array('rp_notice' => 'pair_deleted'), $redirect));
        exit;
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
        } elseif ($notice === 'pair_approved') {
            $class = 'notice notice-success';
            $text = 'Pairing request approved.';
        } elseif ($notice === 'pair_rejected') {
            $class = 'notice notice-warning';
            $text = 'Pairing request rejected.';
        } elseif ($notice === 'pair_deleted') {
            $class = 'notice notice-success';
            $text = 'Paired instance deleted.';
        } elseif ($notice === 'pair_error') {
            $class = 'notice notice-error';
            $text = $message ?: 'Pairing action failed.';
        }

        if ($text) {
            printf('<div class="%s"><p>%s</p></div>', esc_attr($class), esc_html($text));
        }
    }
}
