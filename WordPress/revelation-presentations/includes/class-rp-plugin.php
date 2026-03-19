<?php
/**
 * Core plugin container and settings.
 *
 * @license MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once RP_PLUGIN_DIR . 'includes/class-rp-storage.php';
require_once RP_PLUGIN_DIR . 'includes/class-rp-admin.php';
require_once RP_PLUGIN_DIR . 'includes/class-rp-router.php';
require_once RP_PLUGIN_DIR . 'includes/class-rp-shortcode.php';
require_once RP_PLUGIN_DIR . 'includes/class-rp-api.php';

class RP_Plugin
{
    const OPTION_SETTINGS = 'rp_settings';
    const DB_VERSION_OPTION = 'rp_db_version';
    const DB_VERSION = '1';

    /** @var RP_Plugin|null */
    private static $instance = null;

    /** @var RP_Storage */
    public $storage;

    /** @var RP_Admin */
    public $admin;

    /** @var RP_Router */
    public $router;

    /** @var RP_Shortcode */
    public $shortcode;
    /** @var RP_API */
    public $api;

    public static function instance()
    {
        if (!self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        $this->storage = new RP_Storage($this);
        $this->router = new RP_Router($this);
        $this->admin = new RP_Admin($this);
        $this->shortcode = new RP_Shortcode($this);
        $this->api = new RP_API($this);

        add_action('plugins_loaded', array($this, 'maybe_upgrade'));
    }

    public static function activate()
    {
        self::ensure_default_settings();
        self::create_tables();
        RP_Router::register_rewrite_tags_and_rules();
        flush_rewrite_rules();
    }

    public static function deactivate()
    {
        flush_rewrite_rules();
    }

    public function maybe_upgrade()
    {
        $db_version = get_option(self::DB_VERSION_OPTION);
        if ((string) $db_version !== self::DB_VERSION) {
            self::create_tables();
        }
    }

    public static function ensure_default_settings()
    {
        $defaults = self::default_settings();
        $settings = get_option(self::OPTION_SETTINGS, array());
        if (!is_array($settings)) {
            $settings = array();
        }
        update_option(self::OPTION_SETTINGS, wp_parse_args($settings, $defaults));
    }

    public static function default_settings()
    {
        return array(
            'reveal_remote_url' => '',
            'max_zip_mb' => 128,
            'max_publish_request_mb' => 0,
            'allow_embed' => 1,
            'show_splash_screen' => 1,
            'use_db_index' => 1,
            'use_shared_media_library' => 1,
            'allowed_extensions' => 'md,yml,yaml,json,css,jpg,jpeg,png,webp,gif,mp4,webm,avif,mp3,wav,m4a,pdf',
            'enabled_runtime_plugins' => array(),
        );
    }

    public static function hosted_runtime_plugin_catalog()
    {
        return array(
            'highlight' => array(
                'label' => 'Highlight',
                'description' => 'Syntax highlighting for code blocks.',
                'priority' => 129,
                'clientHookJS' => 'client.js',
                'config' => array(
                    'stylesheet' => 'github.min.css',
                ),
            ),
            'markerboard' => array(
                'label' => 'Markerboard',
                'description' => 'Collaborative drawing overlay for live presentations.',
                'priority' => 95,
                'clientHookJS' => 'client.js',
                'config' => array(
                    'publicMode' => true,
                    'allowPeerFirstToggle' => true,
                ),
            ),
            'slidecontrol' => array(
                'label' => 'Slide Control',
                'description' => 'Remote slide navigation over the presenter plugin socket.',
                'priority' => 96,
                'clientHookJS' => 'client.js',
                'config' => array(
                    'allowControlFromAnyClient' => true,
                ),
            ),
            'captions' => array(
                'label' => 'Captions',
                'description' => 'Displays live captions over hosted presentations and can mirror caption state over the presenter plugin socket.',
                'priority' => 97,
                'clientHookJS' => 'client.js',
                'config' => array(
                    'autoStart' => false,
                ),
            ),
            'revealchart' => array(
                'label' => 'RevealChart',
                'description' => 'Charts and tables rendered inside presentations.',
                'priority' => 128,
                'clientHookJS' => 'client.js',
                'config' => array(),
            ),
            'credit_ccli' => array(
                'label' => 'CCLI Credits',
                'description' => 'Resolves :ccli: credit markers and allows a browser-stored fallback license number when desktop settings are unavailable.',
                'priority' => 120,
                'clientHookJS' => 'client.js',
                'config' => array(),
            ),
        );
    }

    public function get_enabled_hosted_runtime_plugins()
    {
        $settings = $this->get_settings();
        $raw = isset($settings['enabled_runtime_plugins']) && is_array($settings['enabled_runtime_plugins'])
            ? $settings['enabled_runtime_plugins']
            : array();
        $catalog = self::hosted_runtime_plugin_catalog();
        $enabled = array();

        foreach ($raw as $slug) {
            $key = sanitize_key((string) $slug);
            if ($key !== '' && isset($catalog[$key])) {
                $enabled[] = $key;
            }
        }

        return array_values(array_unique($enabled));
    }

    public function get_hosted_runtime_plugin_list()
    {
        $catalog = self::hosted_runtime_plugin_catalog();
        $enabled = $this->get_enabled_hosted_runtime_plugins();
        $list = array();

        foreach ($enabled as $slug) {
            if (!isset($catalog[$slug])) {
                continue;
            }
            $item = $catalog[$slug];
            $list[$slug] = array(
                'baseURL' => trailingslashit(RP_PLUGIN_URL . 'assets/plugins/' . rawurlencode($slug)),
                'priority' => intval($item['priority']),
                'config' => isset($item['config']) && is_array($item['config']) ? $item['config'] : array(),
                'clientHookJS' => (string) $item['clientHookJS'],
            );
        }

        return $list;
    }

    public function get_settings()
    {
        $settings = get_option(self::OPTION_SETTINGS, array());
        if (!is_array($settings)) {
            $settings = array();
        }
        return wp_parse_args($settings, self::default_settings());
    }

    public static function create_tables()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $table = self::table_name();
        $charset = $wpdb->get_charset_collate();
        $sql = "CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            slug VARCHAR(190) NOT NULL,
            title VARCHAR(255) NOT NULL DEFAULT '',
            folder_name VARCHAR(190) NOT NULL,
            source_zip VARCHAR(255) NOT NULL DEFAULT '',
            presentation_count INT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY slug_unique (slug),
            KEY updated_at_idx (updated_at)
        ) {$charset};";

        dbDelta($sql);
        update_option(self::DB_VERSION_OPTION, self::DB_VERSION);
    }

    public static function table_name()
    {
        global $wpdb;
        return $wpdb->prefix . 'revelation_presentations';
    }
}
