<?php
/**
 * Plugin Name: REVELation Presentations
 * Description: Upload and host REVELation presentation ZIP exports with sanitized runtime rendering.
 * Version: 1.0.4-beta3
 * Author: REVELation
 */

if (!defined('ABSPATH')) {
    exit;
}

define('RP_PLUGIN_VERSION', '1.0.4-beta3');
define('RP_PLUGIN_FILE', __FILE__);
define('RP_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('RP_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once RP_PLUGIN_DIR . 'includes/class-rp-plugin.php';

register_activation_hook(RP_PLUGIN_FILE, array('RP_Plugin', 'activate'));
register_deactivation_hook(RP_PLUGIN_FILE, array('RP_Plugin', 'deactivate'));

RP_Plugin::instance();
