<?php

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
            'use_db_index' => 1,
            'allowed_extensions' => 'md,yml,yaml,json,css,jpg,jpeg,png,webp,gif,mp4,webm,mp3,wav,m4a,pdf',
        );
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
